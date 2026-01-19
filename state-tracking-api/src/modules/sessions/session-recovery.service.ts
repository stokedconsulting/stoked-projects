import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Session, SessionDocument, SessionStatus } from '../../schemas/session.schema';
import { Task, TaskDocument } from '../../schemas/task.schema';
import { PrepareRecoveryDto } from './dto/prepare-recovery.dto';
import { RecoverSessionDto } from './dto/recover-session.dto';
import { RecoveryHistoryDto } from './dto/recovery-history.dto';
import { RecoverableSessionDto } from './dto/recoverable-session.dto';
import { RecoverableSessionsQueryDto } from './dto/recoverable-sessions-query.dto';
import { RecoveryAttemptDto } from './dto/recovery-attempt.dto';
import { AppLoggerService } from '../../common/logging/app-logger.service';

/**
 * Maximum number of recovery attempts allowed per session
 */
const MAX_RECOVERY_ATTEMPTS = 3;

/**
 * Service for managing session recovery
 */
@Injectable()
export class SessionRecoveryService {
  constructor(
    @InjectModel(Session.name) private sessionModel: Model<SessionDocument>,
    @InjectModel(Task.name) private taskModel: Model<TaskDocument>,
    private readonly logger: AppLoggerService,
  ) {
    this.logger.setContext('SessionRecoveryService');
  }

  /**
   * Prepare a session for recovery by capturing its current state
   * @param sessionId - The session ID to prepare for recovery
   * @returns Recovery preparation metadata
   * @throws NotFoundException if session not found
   * @throws BadRequestException if session cannot be recovered
   */
  async prepareRecovery(sessionId: string): Promise<PrepareRecoveryDto> {
    const session = await this.sessionModel.findOne({ session_id: sessionId }).exec();

    if (!session) {
      throw new NotFoundException(`Session with ID ${sessionId} not found`);
    }

    // Validate session is in a recoverable state
    if (session.status === SessionStatus.COMPLETED) {
      throw new BadRequestException('Cannot prepare recovery for completed sessions');
    }

    // Check recovery attempt limit
    const currentAttempts = session.metadata?.recovery?.recovery_attempts || 0;
    if (currentAttempts >= MAX_RECOVERY_ATTEMPTS) {
      throw new BadRequestException(
        `Maximum recovery attempts (${MAX_RECOVERY_ATTEMPTS}) reached for this session`
      );
    }

    // Create recovery checkpoint
    const now = new Date();
    const recoveryCheckpoint = {
      captured_at: now,
      status: session.status,
      machine_id: session.machine_id,
      docker_slot: session.docker_slot,
      current_task_id: session.current_task_id,
      last_heartbeat: session.last_heartbeat,
      metadata_snapshot: { ...session.metadata },
    };

    // Update session metadata with recovery checkpoint
    const recoveryMetadata = {
      recovery: {
        recovery_attempts: currentAttempts,
        last_checkpoint_at: now,
        recovery_checkpoints: [
          ...(session.metadata?.recovery?.recovery_checkpoints || []),
          recoveryCheckpoint,
        ],
      },
    };

    await this.sessionModel
      .findOneAndUpdate(
        { session_id: sessionId },
        {
          $set: {
            'metadata.recovery': recoveryMetadata.recovery,
          },
        },
        { new: true }
      )
      .exec();

    // Log recovery preparation
    this.logger.logRecovery(sessionId, {
      project_id: session.project_id,
      event: 'session.recovery.prepare',
      current_attempts: currentAttempts,
      current_status: session.status,
    });

    return {
      session_id: session.session_id,
      status: session.status,
      last_task_id: session.current_task_id,
      machine_id: session.machine_id,
      docker_slot: session.docker_slot,
      recovery_attempts: currentAttempts,
      recovery_checkpoint_at: now,
      metadata: session.metadata || {},
    };
  }

  /**
   * Recover a failed or stalled session
   * @param sessionId - The session ID to recover
   * @param recoverDto - Recovery parameters
   * @returns Recovered session
   * @throws NotFoundException if session or task not found
   * @throws BadRequestException if recovery is not possible
   */
  async recoverSession(sessionId: string, recoverDto: RecoverSessionDto): Promise<Session> {
    const session = await this.sessionModel.findOne({ session_id: sessionId }).exec();

    if (!session) {
      throw new NotFoundException(`Session with ID ${sessionId} not found`);
    }

    // Validate session can be recovered
    if (session.status === SessionStatus.COMPLETED) {
      throw new BadRequestException('Cannot recover completed sessions');
    }

    // Check recovery attempt limit
    const currentAttempts = session.metadata?.recovery?.recovery_attempts || 0;
    if (currentAttempts >= MAX_RECOVERY_ATTEMPTS) {
      throw new BadRequestException(
        `Maximum recovery attempts (${MAX_RECOVERY_ATTEMPTS}) reached for this session`
      );
    }

    // Validate new machine exists if specified (would need machines service)
    // For now, we'll just accept any machine_id

    // Validate task exists if resume_from_task_id is specified
    if (recoverDto.resume_from_task_id) {
      const task = await this.taskModel
        .findOne({ task_id: recoverDto.resume_from_task_id })
        .exec();

      if (!task) {
        throw new NotFoundException(
          `Task with ID ${recoverDto.resume_from_task_id} not found`
        );
      }

      // Validate task belongs to this session
      if (task.session_id !== sessionId) {
        throw new BadRequestException(
          `Task ${recoverDto.resume_from_task_id} does not belong to session ${sessionId}`
        );
      }
    }

    // Track recovery attempt
    const now = new Date();
    const recoveryAttempt: RecoveryAttemptDto = {
      attempted_at: now,
      success: true,
      new_machine_id: recoverDto.new_machine_id,
      new_docker_slot: recoverDto.new_docker_slot,
      resumed_from_task_id: recoverDto.resume_from_task_id,
    };

    // Prepare update data
    const updateData: any = {
      status: SessionStatus.ACTIVE,
      last_heartbeat: now,
    };

    if (recoverDto.new_machine_id) {
      updateData.machine_id = recoverDto.new_machine_id;
    }

    if (recoverDto.new_docker_slot !== undefined) {
      updateData.docker_slot = recoverDto.new_docker_slot;
    }

    if (recoverDto.resume_from_task_id) {
      updateData.current_task_id = recoverDto.resume_from_task_id;
    }

    // Update recovery metadata
    const recoveryHistory = [
      ...(session.metadata?.recovery?.recovery_history || []),
      recoveryAttempt,
    ];

    updateData['metadata.recovery'] = {
      recovery_attempts: currentAttempts + 1,
      last_recovery_at: now,
      recovery_history: recoveryHistory,
      recovery_checkpoints: session.metadata?.recovery?.recovery_checkpoints || [],
    };

    // Execute recovery
    const recoveredSession = await this.sessionModel
      .findOneAndUpdate(
        { session_id: sessionId },
        { $set: updateData },
        { new: true, runValidators: true }
      )
      .exec();

    if (!recoveredSession) {
      this.logger.logRecoveryFailure(sessionId, 'Session not found during recovery update', {
        project_id: session.project_id,
      });
      throw new NotFoundException(`Session with ID ${sessionId} not found`);
    }

    // Log successful recovery
    this.logger.logRecoverySuccess(sessionId, {
      project_id: recoveredSession.project_id,
      attempt_number: currentAttempts + 1,
      new_machine_id: recoverDto.new_machine_id,
      new_docker_slot: recoverDto.new_docker_slot,
      resumed_from_task: recoverDto.resume_from_task_id,
    });

    return recoveredSession;
  }

  /**
   * Get recovery history for a session
   * @param sessionId - The session ID
   * @returns Recovery history
   * @throws NotFoundException if session not found
   */
  async getRecoveryHistory(sessionId: string): Promise<RecoveryHistoryDto> {
    const session = await this.sessionModel.findOne({ session_id: sessionId }).exec();

    if (!session) {
      throw new NotFoundException(`Session with ID ${sessionId} not found`);
    }

    const recoveryData = session.metadata?.recovery || {};
    const attempts: RecoveryAttemptDto[] = recoveryData.recovery_history || [];

    const successfulAttempts = attempts.filter((a) => a.success).length;
    const failedAttempts = attempts.filter((a) => !a.success).length;

    return {
      session_id: session.session_id,
      total_attempts: attempts.length,
      successful_attempts: successfulAttempts,
      failed_attempts: failedAttempts,
      attempts,
      last_recovery_at: recoveryData.last_recovery_at,
      current_status: session.status,
    };
  }

  /**
   * Find sessions eligible for recovery
   * @param queryDto - Query parameters for filtering
   * @returns List of recoverable sessions
   */
  async findRecoverableSessions(
    queryDto?: RecoverableSessionsQueryDto
  ): Promise<RecoverableSessionDto[]> {
    const filter: any = {
      status: { $in: [SessionStatus.FAILED, SessionStatus.STALLED] },
    };

    if (queryDto?.project_id) {
      filter.project_id = queryDto.project_id;
    }

    if (queryDto?.machine_id) {
      filter.machine_id = queryDto.machine_id;
    }

    // Apply age filters based on last_heartbeat
    if (queryDto?.max_age_minutes) {
      const minTime = new Date(Date.now() - queryDto.max_age_minutes * 60 * 1000);
      filter.last_heartbeat = { $gte: minTime };
    }

    if (queryDto?.min_age_minutes) {
      const maxTime = new Date(Date.now() - queryDto.min_age_minutes * 60 * 1000);
      filter.last_heartbeat = {
        ...filter.last_heartbeat,
        $lte: maxTime,
      };
    }

    const sessions = await this.sessionModel
      .find(filter)
      .sort({ last_heartbeat: 1 }) // Oldest first (higher priority)
      .exec();

    const now = Date.now();
    return sessions.map((session) => {
      const recoveryAttempts = session.metadata?.recovery?.recovery_attempts || 0;
      const canRecover = recoveryAttempts < MAX_RECOVERY_ATTEMPTS;
      const minutesSinceHeartbeat = Math.floor(
        (now - session.last_heartbeat.getTime()) / (60 * 1000)
      );

      return {
        session_id: session.session_id,
        project_id: session.project_id,
        status: session.status,
        machine_id: session.machine_id,
        docker_slot: session.docker_slot,
        current_task_id: session.current_task_id,
        recovery_attempts: recoveryAttempts,
        last_heartbeat: session.last_heartbeat,
        failed_at: session.completed_at,
        minutes_since_heartbeat: minutesSinceHeartbeat,
        can_recover: canRecover,
        recovery_blocked_reason: canRecover
          ? undefined
          : 'Maximum recovery attempts reached',
      };
    });
  }

  /**
   * Check if a session is eligible for recovery
   * @param sessionId - The session ID to check
   * @returns Whether the session can be recovered
   * @throws NotFoundException if session not found
   */
  async checkRecoverability(sessionId: string): Promise<{
    recoverable: boolean;
    reason?: string;
  }> {
    const session = await this.sessionModel.findOne({ session_id: sessionId }).exec();

    if (!session) {
      throw new NotFoundException(`Session with ID ${sessionId} not found`);
    }

    if (session.status === SessionStatus.COMPLETED) {
      return {
        recoverable: false,
        reason: 'Session is already completed',
      };
    }

    if (
      session.status !== SessionStatus.FAILED &&
      session.status !== SessionStatus.STALLED
    ) {
      return {
        recoverable: false,
        reason: 'Session must be in failed or stalled state',
      };
    }

    const recoveryAttempts = session.metadata?.recovery?.recovery_attempts || 0;
    if (recoveryAttempts >= MAX_RECOVERY_ATTEMPTS) {
      return {
        recoverable: false,
        reason: `Maximum recovery attempts (${MAX_RECOVERY_ATTEMPTS}) reached`,
      };
    }

    return {
      recoverable: true,
    };
  }

  /**
   * Track a failed recovery attempt
   * @param sessionId - The session ID
   * @param error - Error message
   * @throws NotFoundException if session not found
   */
  async trackFailedRecoveryAttempt(sessionId: string, error: string): Promise<void> {
    const session = await this.sessionModel.findOne({ session_id: sessionId }).exec();

    if (!session) {
      throw new NotFoundException(`Session with ID ${sessionId} not found`);
    }

    const now = new Date();
    const recoveryAttempt: RecoveryAttemptDto = {
      attempted_at: now,
      success: false,
      error,
    };

    const currentAttempts = session.metadata?.recovery?.recovery_attempts || 0;
    const recoveryHistory = [
      ...(session.metadata?.recovery?.recovery_history || []),
      recoveryAttempt,
    ];

    await this.sessionModel
      .findOneAndUpdate(
        { session_id: sessionId },
        {
          $set: {
            'metadata.recovery': {
              recovery_attempts: currentAttempts + 1,
              last_recovery_at: now,
              recovery_history: recoveryHistory,
              recovery_checkpoints: session.metadata?.recovery?.recovery_checkpoints || [],
            },
          },
        }
      )
      .exec();
  }
}
