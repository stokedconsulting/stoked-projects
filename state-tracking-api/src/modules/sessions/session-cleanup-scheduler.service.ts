import { Injectable } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { SessionCleanupService } from './session-cleanup.service';
import { AppLoggerService } from '../../common/logging/app-logger.service';

/**
 * Scheduled jobs for session cleanup and archival
 * Handles automatic cleanup of old sessions and TTL warnings
 */
@Injectable()
export class SessionCleanupSchedulerService {
  constructor(
    private readonly cleanupService: SessionCleanupService,
    private readonly logger: AppLoggerService,
  ) {
    this.logger.setContext('SessionCleanupScheduler');
  }

  /**
   * Daily job to archive old completed sessions (> 90 days)
   * Runs every day at 2:00 AM UTC
   * Archived sessions are kept in the database but excluded from normal queries
   */
  @Cron('0 2 * * *') // Every day at 2:00 AM UTC
  async handleDailyArchiveOldSessions(): Promise<void> {
    this.logger.logBackgroundJob('session-archive-cleanup', 'started');

    const startTime = Date.now();

    try {
      const result = await this.cleanupService.cleanupOldArchivedSessions();

      if (result.archived_count > 0) {
        this.logger.log(
          `Successfully archived ${result.archived_count} old sessions`,
          {
            event: 'cleanup.archive.success',
            archived_count: result.archived_count,
          }
        );
      }

      this.logger.logBackgroundJob('session-archive-cleanup', 'completed', {
        duration_ms: Date.now() - startTime,
        archived_count: result.archived_count,
      });
    } catch (error) {
      this.logger.logBackgroundJob('session-archive-cleanup', 'failed', {
        duration_ms: Date.now() - startTime,
        error_message: error instanceof Error ? error.message : String(error),
      });
      this.logger.error(
        'Failed to archive old sessions',
        error instanceof Error ? error.stack : undefined,
      );
    }
  }

  /**
   * Weekly job to warn about sessions approaching TTL (30 days)
   * Runs every Monday at 3:00 AM UTC
   * Identifies sessions that will be auto-deleted by MongoDB TTL index in ~5 days
   */
  @Cron('0 3 * * 1') // Every Monday at 3:00 AM UTC
  async handleWeeklyTTLWarning(): Promise<void> {
    this.logger.logBackgroundJob('ttl-warning-check', 'started');

    const startTime = Date.now();

    try {
      const sessionIds = await this.cleanupService.findSessionsApproachingTTL();

      if (sessionIds.length > 0) {
        this.logger.warn(
          `${sessionIds.length} sessions will be auto-deleted by TTL in ~5 days`,
          {
            event: 'cleanup.ttl.warning',
            sessions_count: sessionIds.length,
            sample_sessions: sessionIds.slice(0, 5),
          }
        );
      } else {
        this.logger.debug('No sessions approaching TTL');
      }

      this.logger.logBackgroundJob('ttl-warning-check', 'completed', {
        duration_ms: Date.now() - startTime,
        sessions_at_risk: sessionIds.length,
      });
    } catch (error) {
      this.logger.logBackgroundJob('ttl-warning-check', 'failed', {
        duration_ms: Date.now() - startTime,
        error_message: error instanceof Error ? error.message : String(error),
      });
      this.logger.error(
        'Failed to check for sessions approaching TTL',
        error instanceof Error ? error.stack : undefined,
      );
    }
  }
}
