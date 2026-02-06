import { Injectable, BadRequestException, NotFoundException, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Session, SessionDocument, SessionStatus } from '../../schemas/session.schema';
import { TasksService } from '../tasks/tasks.service';
import { CleanupRequestDto, CleanupSummaryDto } from './dto';

/**
 * Service for managing session cleanup and archival operations
 * Handles archiving, purging, and bulk cleanup of sessions
 */
@Injectable()
export class SessionCleanupService {
  private readonly logger = new Logger(SessionCleanupService.name);

  constructor(
    @InjectModel(Session.name) private sessionModel: Model<SessionDocument>,
    private tasksService: TasksService,
  ) {}

  /**
   * Archive a completed session
   * Sets status to ARCHIVED so it's excluded from normal queries
   * Session remains in database for record keeping
   * @param sessionId - The session ID to archive
   * @returns The archived session
   * @throws NotFoundException if session not found
   */
  async archiveSession(sessionId: string): Promise<Session> {
    const session = await this.sessionModel
      .findOne({ session_id: sessionId })
      .exec();

    if (!session) {
      throw new NotFoundException(`Session with ID ${sessionId} not found`);
    }

    // Only allow archiving of completed, failed, or already archived sessions
    if (
      session.status !== SessionStatus.COMPLETED &&
      session.status !== SessionStatus.FAILED &&
      session.status !== SessionStatus.ARCHIVED
    ) {
      throw new BadRequestException(
        `Cannot archive session with status "${session.status}". Only completed, failed, or already archived sessions can be archived.`
      );
    }

    const now = new Date();
    const archivedSession = await this.sessionModel
      .findOneAndUpdate(
        { session_id: sessionId },
        {
          $set: {
            status: SessionStatus.ARCHIVED,
            updated_at: now,
          }
        },
        { new: true }
      )
      .exec();

    this.logger.log(`Archived session ${sessionId}`);
    return archivedSession!;
  }

  /**
   * Permanently delete (purge) a session and all associated tasks
   * This is a hard delete - data cannot be recovered
   * @param sessionId - The session ID to purge
   * @param confirm - Must be true to prevent accidental deletion
   * @returns Object with purge details including count of tasks deleted
   * @throws NotFoundException if session not found
   * @throws BadRequestException if confirmation not provided or session cannot be purged
   */
  async purgeSession(sessionId: string, confirm: boolean): Promise<{ session_id: string; tasks_deleted: number; purged_at: Date }> {
    if (!confirm) {
      throw new BadRequestException(
        'Confirmation required to permanently delete session. Set confirm=true.'
      );
    }

    const session = await this.sessionModel
      .findOne({ session_id: sessionId })
      .exec();

    if (!session) {
      throw new NotFoundException(`Session with ID ${sessionId} not found`);
    }

    // Only allow purging of completed, failed, or archived sessions
    if (
      session.status !== SessionStatus.COMPLETED &&
      session.status !== SessionStatus.FAILED &&
      session.status !== SessionStatus.ARCHIVED
    ) {
      throw new BadRequestException(
        `Cannot purge session with status "${session.status}". Only completed, failed, or archived sessions can be purged.`
      );
    }

    // Count tasks before deletion
    const taskCount = await this.tasksService.countBySession(sessionId);

    // Delete associated tasks (cascade delete)
    await this.tasksService.deleteBySession(sessionId);

    // Delete the session
    await this.sessionModel
      .deleteOne({ session_id: sessionId })
      .exec();

    this.logger.warn(`Purged session ${sessionId} and ${taskCount} associated tasks`);
    return {
      session_id: sessionId,
      tasks_deleted: taskCount,
      purged_at: new Date(),
    };
  }

  /**
   * Bulk cleanup of old sessions matching specified criteria
   * Can archive or delete sessions based on age and status
   * @param request - Cleanup request with criteria and options
   * @returns Summary of cleanup operation
   */
  async bulkCleanup(request: CleanupRequestDto): Promise<CleanupSummaryDto> {
    const { older_than_days, statuses, dry_run = false, archive = true } = request;

    // Calculate cutoff date
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - older_than_days);

    // Find sessions matching criteria
    const sessionsToClean = await this.sessionModel
      .find({
        created_at: { $lt: cutoffDate },
        status: { $in: statuses }
      })
      .exec();

    // Build breakdown by status
    const breakdownByStatus: Record<string, number> = {};
    let totalTasksToDelete = 0;

    for (const status of statuses) {
      breakdownByStatus[status] = sessionsToClean.filter(s => s.status === status).length;
    }

    // Count total tasks for all sessions being deleted
    if (!dry_run) {
      for (const session of sessionsToClean) {
        const taskCount = await this.tasksService.countBySession(session.session_id);
        totalTasksToDelete += taskCount;
      }
    }

    // Perform cleanup if not dry run
    if (!dry_run) {
      if (archive) {
        // Archive sessions
        for (const session of sessionsToClean) {
          await this.archiveSession(session.session_id);
        }
        this.logger.log(`Archived ${sessionsToClean.length} sessions`);
      } else {
        // Purge sessions
        for (const session of sessionsToClean) {
          // Delete associated tasks
          await this.tasksService.deleteBySession(session.session_id);

          // Delete the session
          await this.sessionModel
            .deleteOne({ session_id: session.session_id })
            .exec();
        }
        this.logger.warn(`Purged ${sessionsToClean.length} sessions and ${totalTasksToDelete} tasks`);
      }
    }

    // Estimate space freed (rough estimate: 2KB per session + 1KB per task)
    const estimatedSpaceFreed = sessionsToClean.length * 2048 + totalTasksToDelete * 1024;

    return {
      sessions_affected: sessionsToClean.length,
      tasks_deleted: totalTasksToDelete,
      breakdown_by_status: breakdownByStatus,
      operation: dry_run ? 'dry_run' : archive ? 'archive' : 'delete',
      estimated_space_freed_bytes: estimatedSpaceFreed,
      completed_at: new Date(),
    };
  }

  /**
   * Find all archived sessions with optional filtering
   * @param projectId - Optional filter by project ID
   * @param machineId - Optional filter by machine ID
   * @param limit - Pagination limit (default: 20)
   * @param offset - Pagination offset (default: 0)
   * @returns Array of archived sessions
   */
  async findArchivedSessions(
    projectId?: string,
    machineId?: string,
    limit: number = 20,
    offset: number = 0,
  ): Promise<Session[]> {
    const filter: any = { status: SessionStatus.ARCHIVED };

    if (projectId) {
      filter.project_id = projectId;
    }
    if (machineId) {
      filter.machine_id = machineId;
    }

    return this.sessionModel
      .find(filter)
      .sort({ updated_at: -1 })
      .limit(limit)
      .skip(offset)
      .exec();
  }

  /**
   * Count archived sessions matching criteria
   * @param projectId - Optional filter by project ID
   * @param machineId - Optional filter by machine ID
   * @returns Count of archived sessions
   */
  async countArchived(projectId?: string, machineId?: string): Promise<number> {
    const filter: any = { status: SessionStatus.ARCHIVED };

    if (projectId) {
      filter.project_id = projectId;
    }
    if (machineId) {
      filter.machine_id = machineId;
    }

    return this.sessionModel.countDocuments(filter).exec();
  }

  /**
   * Clean up old archived sessions (automatic cleanup for archived sessions)
   * Called by scheduled job - archives sessions that have been completed for > 90 days
   * @returns Object with cleanup statistics
   */
  async cleanupOldArchivedSessions(): Promise<{ archived_count: number; details: string }> {
    const ninetyDaysAgo = new Date();
    ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);

    const sessionsToArchive = await this.sessionModel
      .find({
        completed_at: { $lt: ninetyDaysAgo },
        status: { $in: [SessionStatus.COMPLETED, SessionStatus.FAILED] }
      })
      .select('session_id')
      .exec();

    if (sessionsToArchive.length === 0) {
      this.logger.debug('No sessions found to archive');
      return { archived_count: 0, details: 'No sessions matching cleanup criteria' };
    }

    // Archive each session
    for (const session of sessionsToArchive) {
      try {
        await this.archiveSession(session.session_id);
      } catch (error) {
        this.logger.error(
          `Failed to archive session ${session.session_id}`,
          error instanceof Error ? error.message : String(error)
        );
      }
    }

    this.logger.log(`Automatically archived ${sessionsToArchive.length} old sessions`);
    return {
      archived_count: sessionsToArchive.length,
      details: `Archived ${sessionsToArchive.length} sessions older than 90 days`,
    };
  }

  /**
   * Warn about sessions approaching TTL (30 days)
   * Called by scheduled job - identifies sessions that will be auto-deleted soon
   * @returns Array of session IDs approaching TTL
   */
  async findSessionsApproachingTTL(): Promise<string[]> {
    const approachingTTL = new Date();
    approachingTTL.setDate(approachingTTL.getDate() - 25); // 25 days (5 days before 30-day TTL)

    const sessionsApproaching = await this.sessionModel
      .find({
        completed_at: { $lt: approachingTTL },
        status: { $in: [SessionStatus.COMPLETED, SessionStatus.FAILED] }
      })
      .select('session_id')
      .exec();

    const sessionIds = sessionsApproaching.map(s => s.session_id);

    if (sessionIds.length > 0) {
      this.logger.warn(
        `${sessionIds.length} sessions approaching TTL expiration in 5 days`
      );
    }

    return sessionIds;
  }
}
