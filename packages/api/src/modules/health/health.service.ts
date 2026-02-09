import { Injectable, Logger } from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
import { Connection } from 'mongoose';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Session, SessionDocument, SessionStatus } from '../../schemas/session.schema';
import { MetricsService } from '../../common/metrics/metrics.service';
import * as os from 'os';

@Injectable()
export class HealthService {
  private readonly logger = new Logger(HealthService.name);
  private readonly appVersion = '0.1.0';

  constructor(
    @InjectConnection() private connection: Connection,
    @InjectModel(Session.name) private sessionModel: Model<SessionDocument>,
    private metricsService: MetricsService,
  ) {}

  /**
   * Get database latency by measuring ping response time
   */
  private async getDatabaseLatency(): Promise<number> {
    const startTime = Date.now();
    try {
      const db = this.connection?.db;
      if (!db) {
        return -1;
      }
      await db.admin().ping();
      return Date.now() - startTime;
    } catch (error) {
      this.logger.warn('Database ping failed', error);
      return -1;
    }
  }

  /**
   * Count active sessions (not completed or failed)
   */
  private async getActiveSessionCount(): Promise<number> {
    try {
      const count = await this.sessionModel.countDocuments({
        status: { $in: [SessionStatus.ACTIVE, SessionStatus.PAUSED, SessionStatus.STALLED] },
      });
      return count;
    } catch (error) {
      this.logger.warn('Failed to get active session count', error);
      return 0;
    }
  }

  /**
   * Check basic health status
   */
  async check() {
    const dbStatus = this.connection.readyState === 1 ? 'connected' : 'disconnected';
    const dbLatency = await this.getDatabaseLatency();

    return {
      status: 'ok',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      database: dbStatus,
      latency: dbLatency >= 0 ? dbLatency : null,
    };
  }

  /**
   * Readiness probe - checks if the application is ready to serve traffic
   */
  async ready() {
    const isConnected = this.connection.readyState === 1;

    return {
      ready: isConnected,
      timestamp: new Date().toISOString(),
      database: isConnected ? 'connected' : 'disconnected',
    };
  }

  /**
   * Liveness probe - checks if the application process is alive and responsive
   */
  async live() {
    return {
      alive: true,
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
    };
  }

  /**
   * Detailed health check with system metrics
   */
  async detailed() {
    const isConnected = this.connection.readyState === 1;
    const dbLatency = await this.getDatabaseLatency();
    const activeSessionCount = await this.getActiveSessionCount();

    const result = this.metricsService.buildHealthCheckResult(
      isConnected,
      dbLatency >= 0 ? dbLatency : 10000, // Default to 10s if ping failed
      activeSessionCount,
      this.appVersion,
    );

    // Publish metrics
    await this.metricsService.publishCustomMetrics(
      activeSessionCount,
      this.metricsService.getErrorRate(),
      this.metricsService.getAverageResponseTime(),
    );

    return result;
  }

  /**
   * Get system information
   */
  getSystemInfo() {
    const memUsage = process.memoryUsage();

    return {
      uptime: process.uptime(),
      nodeVersion: process.version,
      platform: process.platform,
      arch: process.arch,
      cpus: os.cpus().length,
      totalMemory: Math.round(os.totalmem() / 1024 / 1024), // MB
      freeMemory: Math.round(os.freemem() / 1024 / 1024), // MB
      heapUsed: Math.round(memUsage.heapUsed / 1024 / 1024), // MB
      heapTotal: Math.round(memUsage.heapTotal / 1024 / 1024), // MB
      external: Math.round(memUsage.external / 1024 / 1024), // MB
      rss: Math.round(memUsage.rss / 1024 / 1024), // MB
    };
  }
}
