import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Session, SessionDocument, SessionStatus } from '../../schemas/session.schema';
import { StaleSessionDto } from './dto/stale-session.dto';
import { ActiveSessionDto } from './dto/active-session.dto';
import { SessionHealthDto } from './dto/session-health.dto';
import { ProjectSessionsSummaryDto, SessionsByStatus, SessionStats } from './dto/project-sessions-summary.dto';

@Injectable()
export class SessionHealthService {
  private readonly DEFAULT_STALE_THRESHOLD = 300; // 5 minutes in seconds

  constructor(
    @InjectModel(Session.name) private sessionModel: Model<SessionDocument>,
  ) {}

  /**
   * Calculate time since last heartbeat in seconds
   */
  private calculateTimeSinceHeartbeat(lastHeartbeat: Date): number {
    const now = new Date();
    const diff = now.getTime() - new Date(lastHeartbeat).getTime();
    return Math.floor(diff / 1000); // Convert to seconds
  }

  /**
   * Check if a session is stale based on threshold
   */
  private isSessionStale(lastHeartbeat: Date, thresholdSeconds: number): boolean {
    const timeSince = this.calculateTimeSinceHeartbeat(lastHeartbeat);
    return timeSince > thresholdSeconds;
  }

  /**
   * Generate health recommendations for a session
   */
  private generateRecommendations(
    status: SessionStatus,
    isStale: boolean,
    timeSinceHeartbeat: number,
  ): string[] {
    const recommendations: string[] = [];

    if (isStale && status === SessionStatus.ACTIVE) {
      recommendations.push('Session may have crashed - no heartbeat received');
      recommendations.push('Consider marking session as stalled or failed');
      recommendations.push('Use POST /sessions/:id/mark-stalled to mark as stalled');
      recommendations.push('Use POST /sessions/:id/mark-failed to mark as failed');
      if (timeSinceHeartbeat > 600) {
        recommendations.push('Session has been unresponsive for over 10 minutes');
      }
      if (timeSinceHeartbeat > 900) {
        recommendations.push('Session is very stale (>15 minutes) - recommend marking as failed');
      }
    }

    if (status === SessionStatus.STALLED) {
      recommendations.push('Session is in stalled state');
      recommendations.push('Review session logs and consider recovery or cleanup');
      recommendations.push('Use GET /sessions/:id/health to check session health');
    }

    if (status === SessionStatus.FAILED) {
      recommendations.push('Session has failed');
      recommendations.push('Use GET /sessions/:id/failure-info for detailed failure analysis');
      recommendations.push('Review error logs and failure reason');
    }

    if (status === SessionStatus.PAUSED && isStale) {
      recommendations.push('Paused session has not sent heartbeat');
      recommendations.push('Session may need to be resumed or cleaned up');
    }

    if (recommendations.length === 0 && status === SessionStatus.ACTIVE) {
      recommendations.push('Session is healthy and active');
    }

    return recommendations;
  }

  /**
   * Find all stale sessions based on threshold
   */
  async findStaleSessions(thresholdSeconds: number = this.DEFAULT_STALE_THRESHOLD): Promise<StaleSessionDto[]> {
    const cutoffTime = new Date(Date.now() - thresholdSeconds * 1000);

    const sessions = await this.sessionModel
      .find({
        last_heartbeat: { $lt: cutoffTime },
        status: { $in: [SessionStatus.ACTIVE, SessionStatus.PAUSED] },
      })
      .sort({ last_heartbeat: 1 }) // Oldest first
      .exec();

    return sessions.map((session) => ({
      session_id: session.session_id,
      project_id: session.project_id,
      machine_id: session.machine_id,
      docker_slot: session.docker_slot,
      status: session.status,
      last_heartbeat: session.last_heartbeat,
      current_task_id: session.current_task_id,
      time_since_heartbeat: this.calculateTimeSinceHeartbeat(session.last_heartbeat),
      started_at: session.started_at,
    }));
  }

  /**
   * Find all active sessions with optional filters
   */
  async findActiveSessions(
    projectId?: string,
    machineId?: string,
  ): Promise<ActiveSessionDto[]> {
    const filter: any = { status: SessionStatus.ACTIVE };

    if (projectId) {
      filter.project_id = projectId;
    }

    if (machineId) {
      filter.machine_id = machineId;
    }

    const sessions = await this.sessionModel
      .find(filter)
      .sort({ started_at: -1 }) // Newest first
      .exec();

    return sessions.map((session) => ({
      session_id: session.session_id,
      project_id: session.project_id,
      machine_id: session.machine_id,
      docker_slot: session.docker_slot,
      status: session.status,
      last_heartbeat: session.last_heartbeat,
      current_task_id: session.current_task_id,
      started_at: session.started_at,
      time_since_heartbeat: this.calculateTimeSinceHeartbeat(session.last_heartbeat),
    }));
  }

  /**
   * Get all sessions for a project, grouped by status
   */
  async findSessionsByProject(projectId: string): Promise<ProjectSessionsSummaryDto> {
    const sessions = await this.sessionModel
      .find({ project_id: projectId })
      .sort({ started_at: -1 })
      .exec();

    const sessionsByStatus: SessionsByStatus = {
      active: [],
      paused: [],
      stalled: [],
      completed: [],
      failed: [],
    };

    const stats: SessionStats = {
      total: sessions.length,
      active: 0,
      paused: 0,
      stalled: 0,
      completed: 0,
      failed: 0,
    };

    sessions.forEach((session) => {
      const sessionObj = session.toObject();
      switch (session.status) {
        case SessionStatus.ACTIVE:
          sessionsByStatus.active.push(sessionObj);
          stats.active++;
          break;
        case SessionStatus.PAUSED:
          sessionsByStatus.paused.push(sessionObj);
          stats.paused++;
          break;
        case SessionStatus.STALLED:
          sessionsByStatus.stalled.push(sessionObj);
          stats.stalled++;
          break;
        case SessionStatus.COMPLETED:
          sessionsByStatus.completed.push(sessionObj);
          stats.completed++;
          break;
        case SessionStatus.FAILED:
          sessionsByStatus.failed.push(sessionObj);
          stats.failed++;
          break;
      }
    });

    return {
      project_id: projectId,
      sessions: sessionsByStatus,
      stats,
    };
  }

  /**
   * Get all sessions for a machine
   */
  async findSessionsByMachine(machineId: string): Promise<Session[]> {
    return this.sessionModel
      .find({ machine_id: machineId })
      .sort({ started_at: -1 })
      .exec();
  }

  /**
   * Get comprehensive health status for a session
   */
  async getSessionHealth(
    sessionId: string,
    thresholdSeconds: number = this.DEFAULT_STALE_THRESHOLD,
  ): Promise<SessionHealthDto | null> {
    const session = await this.sessionModel
      .findOne({ session_id: sessionId })
      .exec();

    if (!session) {
      return null;
    }

    const timeSinceHeartbeat = this.calculateTimeSinceHeartbeat(session.last_heartbeat);
    const isStale = this.isSessionStale(session.last_heartbeat, thresholdSeconds);
    const recommendations = this.generateRecommendations(
      session.status,
      isStale,
      timeSinceHeartbeat,
    );

    return {
      session_id: session.session_id,
      project_id: session.project_id,
      machine_id: session.machine_id,
      docker_slot: session.docker_slot,
      status: session.status,
      last_heartbeat: session.last_heartbeat,
      current_task_id: session.current_task_id,
      is_stale: isStale,
      time_since_heartbeat: timeSinceHeartbeat,
      recommendations,
      started_at: session.started_at,
      completed_at: session.completed_at,
    };
  }
}
