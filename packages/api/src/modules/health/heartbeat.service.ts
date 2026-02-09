import { Injectable, Logger } from '@nestjs/common';
import { SessionsService } from '../sessions/sessions.service';
import { MachinesService } from '../machines/machines.service';

/**
 * Service responsible for detecting and marking stale sessions and offline machines
 */
@Injectable()
export class HeartbeatService {
  private readonly logger = new Logger(HeartbeatService.name);
  private readonly SESSION_STALE_THRESHOLD_MINUTES = 5;
  private readonly MACHINE_OFFLINE_THRESHOLD_MINUTES = 10;

  constructor(
    private readonly sessionsService: SessionsService,
    private readonly machinesService: MachinesService,
  ) {}

  /**
   * Detect and mark sessions as stalled if heartbeat is older than threshold
   * @returns Array of stalled session IDs
   */
  async detectAndMarkStaleSessions(): Promise<string[]> {
    try {
      const stalledSessionIds = await this.sessionsService.detectStaleSessions(
        this.SESSION_STALE_THRESHOLD_MINUTES
      );

      if (stalledSessionIds.length > 0) {
        this.logger.warn(
          `Detected ${stalledSessionIds.length} stale sessions: ${stalledSessionIds.join(', ')}`
        );
      }

      return stalledSessionIds;
    } catch (error) {
      this.logger.error('Failed to detect stale sessions', error);
      throw error;
    }
  }

  /**
   * Detect and mark machines as offline if heartbeat is older than threshold
   * @returns Array of offline machine IDs
   */
  async detectAndMarkOfflineMachines(): Promise<string[]> {
    try {
      const offlineMachineIds = await this.machinesService.detectOfflineMachines(
        this.MACHINE_OFFLINE_THRESHOLD_MINUTES
      );

      if (offlineMachineIds.length > 0) {
        this.logger.warn(
          `Detected ${offlineMachineIds.length} offline machines: ${offlineMachineIds.join(', ')}`
        );
      }

      return offlineMachineIds;
    } catch (error) {
      this.logger.error('Failed to detect offline machines', error);
      throw error;
    }
  }

  /**
   * Run full health check on all sessions and machines
   * Called by scheduled job
   */
  async runHealthCheck(): Promise<{
    stalledSessions: string[];
    offlineMachines: string[];
  }> {
    this.logger.debug('Running scheduled health check...');

    const [stalledSessions, offlineMachines] = await Promise.all([
      this.detectAndMarkStaleSessions(),
      this.detectAndMarkOfflineMachines(),
    ]);

    if (stalledSessions.length > 0 || offlineMachines.length > 0) {
      this.logger.log(
        `Health check complete - Stalled sessions: ${stalledSessions.length}, Offline machines: ${offlineMachines.length}`
      );
    } else {
      this.logger.debug('Health check complete - All systems healthy');
    }

    return {
      stalledSessions,
      offlineMachines,
    };
  }
}
