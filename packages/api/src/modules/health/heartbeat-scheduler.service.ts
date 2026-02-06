import { Injectable } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { HeartbeatService } from './heartbeat.service';
import { AppLoggerService } from '../../common/logging/app-logger.service';

/**
 * Scheduled jobs for heartbeat health monitoring
 */
@Injectable()
export class HeartbeatSchedulerService {
  constructor(
    private readonly heartbeatService: HeartbeatService,
    private readonly logger: AppLoggerService,
  ) {
    this.logger.setContext('HeartbeatScheduler');
  }

  /**
   * Runs every minute to detect stale sessions and offline machines
   * Stale threshold: 5 minutes for sessions
   * Offline threshold: 10 minutes for machines
   */
  @Cron(CronExpression.EVERY_MINUTE)
  async handleHealthCheck() {
    this.logger.debug('Starting scheduled heartbeat health check');

    const startTime = Date.now();

    try {
      const result = await this.heartbeatService.runHealthCheck();

      // Log results if any issues were found
      if (result.stalledSessions.length > 0) {
        this.logger.warn(
          `Marked ${result.stalledSessions.length} sessions as stalled`,
          {
            event: 'heartbeat.check.stalled',
            stalled_count: result.stalledSessions.length,
            stalled_sessions: result.stalledSessions,
          }
        );
      }

      if (result.offlineMachines.length > 0) {
        this.logger.warn(
          `Marked ${result.offlineMachines.length} machines as offline`,
          {
            event: 'heartbeat.check.offline',
            offline_count: result.offlineMachines.length,
            offline_machines: result.offlineMachines,
          }
        );
      }

      // Log successful completion
      this.logger.logBackgroundJob('heartbeat-health-check', 'completed', {
        duration_ms: Date.now() - startTime,
        stalled_sessions: result.stalledSessions.length,
        offline_machines: result.offlineMachines.length,
      });
    } catch (error) {
      this.logger.logBackgroundJob('heartbeat-health-check', 'failed', {
        duration_ms: Date.now() - startTime,
        error_message: error instanceof Error ? error.message : 'Unknown error',
      });
      this.logger.error(
        'Failed to run scheduled heartbeat health check',
        error instanceof Error ? error.stack : undefined,
      );
    }
  }
}
