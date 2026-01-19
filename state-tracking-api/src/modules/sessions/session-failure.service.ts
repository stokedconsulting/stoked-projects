import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Session, SessionDocument, SessionStatus } from '../../schemas/session.schema';
import { Task, TaskDocument, TaskStatus } from '../../schemas/task.schema';
import { MarkFailedDto } from './dto/mark-failed.dto';
import { MarkStalledDto } from './dto/mark-stalled.dto';
import { FailureInfoDto, FailureAnalysis } from './dto/failure-info.dto';
import { FailedSessionQueryDto } from './dto/failed-session-query.dto';
import { AppLoggerService } from '../../common/logging/app-logger.service';

@Injectable()
export class SessionFailureService {
  private readonly VERY_STALE_THRESHOLD_MINUTES = 15;

  constructor(
    @InjectModel(Session.name) private sessionModel: Model<SessionDocument>,
    @InjectModel(Task.name) private taskModel: Model<TaskDocument>,
    private readonly logger: AppLoggerService,
  ) {
    this.logger.setContext('SessionFailureService');
  }

  /**
   * Mark a session as failed with reason and error details
   */
  async markSessionFailed(
    sessionId: string,
    markFailedDto: MarkFailedDto,
  ): Promise<Session> {
    const session = await this.sessionModel
      .findOne({ session_id: sessionId })
      .exec();

    if (!session) {
      throw new NotFoundException(`Session with ID ${sessionId} not found`);
    }

    // Don't allow marking already completed sessions as failed
    if (session.status === SessionStatus.COMPLETED) {
      throw new BadRequestException(
        'Cannot mark completed session as failed'
      );
    }

    // Already failed sessions can be updated with new failure info
    const now = new Date();
    const updateData: Partial<Session> = {
      status: SessionStatus.FAILED,
      completed_at: session.status === SessionStatus.FAILED ? session.completed_at : now,
      metadata: {
        ...(session.metadata || {}),
        failure_reason: markFailedDto.reason,
        failure_timestamp: now.toISOString(),
        ...(markFailedDto.error_details && {
          error_details: markFailedDto.error_details,
        }),
      },
    };

    const updatedSession = await this.sessionModel
      .findOneAndUpdate(
        { session_id: sessionId },
        { $set: updateData },
        { new: true }
      )
      .exec();

    // Log session failure
    this.logger.logSessionFailed(sessionId, markFailedDto.reason, {
      project_id: session.project_id,
      previous_status: session.status,
      error_details: markFailedDto.error_details,
    });

    return updatedSession!;
  }

  /**
   * Mark a session as stalled with reason
   */
  async markSessionStalled(
    sessionId: string,
    markStalledDto: MarkStalledDto,
  ): Promise<Session> {
    const session = await this.sessionModel
      .findOne({ session_id: sessionId })
      .exec();

    if (!session) {
      throw new NotFoundException(`Session with ID ${sessionId} not found`);
    }

    // Don't allow marking completed/failed sessions as stalled
    if (
      session.status === SessionStatus.COMPLETED ||
      session.status === SessionStatus.FAILED
    ) {
      throw new BadRequestException(
        `Cannot mark ${session.status} session as stalled`
      );
    }

    const now = new Date();
    const updateData: Partial<Session> = {
      status: SessionStatus.STALLED,
      metadata: {
        ...(session.metadata || {}),
        stalled_reason: markStalledDto.reason,
        stalled_timestamp: now.toISOString(),
      },
    };

    const updatedSession = await this.sessionModel
      .findOneAndUpdate(
        { session_id: sessionId },
        { $set: updateData },
        { new: true }
      )
      .exec();

    return updatedSession!;
  }

  /**
   * Query failed sessions with optional filters
   */
  async findFailedSessions(
    queryDto: FailedSessionQueryDto,
  ): Promise<Session[]> {
    const filter: any = { status: SessionStatus.FAILED };

    if (queryDto.project_id) {
      filter.project_id = queryDto.project_id;
    }

    if (queryDto.machine_id) {
      filter.machine_id = queryDto.machine_id;
    }

    const limit = queryDto.limit || 20;
    const offset = queryDto.offset || 0;

    return this.sessionModel
      .find(filter)
      .sort({ completed_at: -1 }) // Most recent failures first
      .limit(limit)
      .skip(offset)
      .exec();
  }

  /**
   * Get comprehensive failure information for a session
   */
  async getFailureInfo(sessionId: string): Promise<FailureInfoDto> {
    const session = await this.sessionModel
      .findOne({ session_id: sessionId })
      .exec();

    if (!session) {
      throw new NotFoundException(`Session with ID ${sessionId} not found`);
    }

    if (session.status !== SessionStatus.FAILED) {
      throw new BadRequestException(
        `Session is not in failed state (current status: ${session.status})`
      );
    }

    // Get the last successful task
    const lastSuccessfulTask = await this.taskModel
      .findOne({
        session_id: sessionId,
        status: TaskStatus.COMPLETED,
      })
      .sort({ completed_at: -1 })
      .exec();

    // Perform failure analysis
    const analysis = await this.analyzeFailure(session);

    // Calculate session duration
    const durationMs = session.completed_at
      ? session.completed_at.getTime() - session.started_at.getTime()
      : Date.now() - session.started_at.getTime();
    const durationMinutes = Math.floor(durationMs / (1000 * 60));

    return {
      session_id: session.session_id,
      project_id: session.project_id,
      machine_id: session.machine_id,
      docker_slot: session.docker_slot,
      status: session.status,
      failure_reason: session.metadata?.failure_reason || 'Unknown',
      error_details: session.metadata?.error_details,
      failed_at: session.completed_at || new Date(),
      last_heartbeat: session.last_heartbeat,
      last_successful_task_id: lastSuccessfulTask?.task_id,
      last_successful_task_name: lastSuccessfulTask?.task_name,
      current_task_id: session.current_task_id,
      started_at: session.started_at,
      duration_minutes: durationMinutes,
      analysis,
      session: session.toObject(),
    };
  }

  /**
   * Analyze a failed session and provide recovery recommendations
   */
  async analyzeFailure(session: Session): Promise<FailureAnalysis> {
    // Calculate time since last heartbeat
    const timeSinceHeartbeat = Date.now() - new Date(session.last_heartbeat).getTime();
    const minutesSinceHeartbeat = Math.floor(timeSinceHeartbeat / (1000 * 60));
    const isVeryStale = minutesSinceHeartbeat > this.VERY_STALE_THRESHOLD_MINUTES;

    // Check for stuck tasks
    const stuckTasks = await this.taskModel
      .find({
        session_id: session.session_id,
        status: TaskStatus.IN_PROGRESS,
      })
      .exec();

    const hasStuckTasks = stuckTasks.length > 0;
    const stuckTaskCount = stuckTasks.length;

    // Generate recovery recommendations
    const recoveryRecommendations = this.generateRecoveryRecommendations(
      session,
      isVeryStale,
      hasStuckTasks,
      stuckTaskCount,
      minutesSinceHeartbeat,
    );

    return {
      is_very_stale: isVeryStale,
      has_stuck_tasks: hasStuckTasks,
      stuck_task_count: stuckTaskCount,
      minutes_since_heartbeat: minutesSinceHeartbeat,
      recovery_recommendations: recoveryRecommendations,
    };
  }

  /**
   * Generate recovery recommendations based on failure analysis
   */
  private generateRecoveryRecommendations(
    session: Session,
    isVeryStale: boolean,
    hasStuckTasks: boolean,
    stuckTaskCount: number,
    minutesSinceHeartbeat: number,
  ): string[] {
    const recommendations: string[] = [];

    if (isVeryStale) {
      recommendations.push(
        `Session has been unresponsive for ${minutesSinceHeartbeat} minutes`
      );
    }

    if (hasStuckTasks) {
      recommendations.push(
        `Found ${stuckTaskCount} task(s) stuck in in_progress state`
      );
      recommendations.push(
        'Consider marking stuck tasks as failed or blocked before restarting'
      );
    }

    if (session.metadata?.failure_reason) {
      recommendations.push(
        `Failure reason: ${session.metadata.failure_reason}`
      );
    }

    if (session.metadata?.error_details?.error_code) {
      recommendations.push(
        `Error code: ${session.metadata.error_details.error_code}`
      );
    }

    // Check for repeated failures on same machine
    recommendations.push(
      'Check machine logs and system resources before reassigning work'
    );

    if (session.docker_slot !== undefined) {
      recommendations.push(
        `Docker slot ${session.docker_slot} may need to be cleaned up or restarted`
      );
    }

    recommendations.push(
      'Consider creating a new session on a different machine for recovery'
    );

    if (session.current_task_id) {
      recommendations.push(
        `Review current task ${session.current_task_id} for potential issues`
      );
    }

    return recommendations;
  }

  /**
   * Get failure statistics for analysis
   */
  async getFailureStatistics(projectId?: string): Promise<{
    total_failed: number;
    failed_by_machine: Record<string, number>;
    average_duration_minutes: number;
    most_recent_failure?: Date;
  }> {
    const filter: any = { status: SessionStatus.FAILED };
    if (projectId) {
      filter.project_id = projectId;
    }

    const failedSessions = await this.sessionModel.find(filter).exec();

    const failedByMachine: Record<string, number> = {};
    let totalDuration = 0;
    let mostRecentFailure: Date | undefined;

    failedSessions.forEach((session) => {
      // Count by machine
      failedByMachine[session.machine_id] =
        (failedByMachine[session.machine_id] || 0) + 1;

      // Calculate duration
      if (session.completed_at) {
        const duration =
          session.completed_at.getTime() - session.started_at.getTime();
        totalDuration += duration;

        // Track most recent failure
        if (!mostRecentFailure || session.completed_at > mostRecentFailure) {
          mostRecentFailure = session.completed_at;
        }
      }
    });

    const averageDurationMinutes =
      failedSessions.length > 0
        ? Math.floor(totalDuration / failedSessions.length / (1000 * 60))
        : 0;

    return {
      total_failed: failedSessions.length,
      failed_by_machine: failedByMachine,
      average_duration_minutes: averageDurationMinutes,
      most_recent_failure: mostRecentFailure,
    };
  }
}
