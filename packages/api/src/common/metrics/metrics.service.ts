import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export interface SystemMetrics {
  timestamp: string;
  uptime: number;
  memoryUsage: {
    heapUsed: number;
    heapTotal: number;
    external: number;
    rss: number;
    percentage: number;
  };
  cpuUsage: {
    user: number;
    system: number;
  };
  activeSessionCount: number;
  errorRate: number;
  averageResponseTime: number;
  databaseLatency: number;
  version: string;
}

export interface HealthCheckResult {
  status: 'ok' | 'degraded' | 'unhealthy';
  timestamp: string;
  uptime: number;
  database: {
    status: 'connected' | 'disconnected';
    latency: number;
  };
  metrics: Omit<SystemMetrics, 'timestamp'>;
  checks: {
    memory: 'ok' | 'warning' | 'critical';
    database: 'ok' | 'warning' | 'critical';
    responseTime: 'ok' | 'warning' | 'critical';
  };
}

@Injectable()
export class MetricsService {
  private readonly logger = new Logger(MetricsService.name);
  private requestCount = 0;
  private errorCount = 0;
  private responseTimes: number[] = [];
  private lastMetricsPublish = Date.now();
  private readonly metricsPublishInterval = 60000; // Publish every 60 seconds

  constructor(private configService: ConfigService) {}

  /**
   * Record a request for metrics tracking
   */
  recordRequest(): void {
    this.requestCount++;
  }

  /**
   * Record an error for metrics tracking
   */
  recordError(): void {
    this.errorCount++;
  }

  /**
   * Record response time in milliseconds
   */
  recordResponseTime(ms: number): void {
    this.responseTimes.push(ms);
    // Keep only the last 1000 measurements
    if (this.responseTimes.length > 1000) {
      this.responseTimes = this.responseTimes.slice(-1000);
    }
  }

  /**
   * Reset metrics for a new collection period
   */
  resetMetrics(): void {
    this.requestCount = 0;
    this.errorCount = 0;
    this.responseTimes = [];
  }

  /**
   * Get memory usage metrics
   */
  getMemoryMetrics(): SystemMetrics['memoryUsage'] {
    const memUsage = process.memoryUsage();
    const heapUsedPercent = (memUsage.heapUsed / memUsage.heapTotal) * 100;

    return {
      heapUsed: Math.round(memUsage.heapUsed / 1024 / 1024), // MB
      heapTotal: Math.round(memUsage.heapTotal / 1024 / 1024), // MB
      external: Math.round(memUsage.external / 1024 / 1024), // MB
      rss: Math.round(memUsage.rss / 1024 / 1024), // MB
      percentage: Math.round(heapUsedPercent * 100) / 100,
    };
  }

  /**
   * Get CPU usage metrics
   */
  getCpuMetrics(): SystemMetrics['cpuUsage'] {
    const cpuUsage = process.cpuUsage();

    return {
      user: Math.round(cpuUsage.user / 1000), // Convert to ms
      system: Math.round(cpuUsage.system / 1000), // Convert to ms
    };
  }

  /**
   * Get error rate as a percentage
   */
  getErrorRate(): number {
    if (this.requestCount === 0) return 0;
    return Math.round((this.errorCount / this.requestCount) * 10000) / 100;
  }

  /**
   * Get average response time in milliseconds
   */
  getAverageResponseTime(): number {
    if (this.responseTimes.length === 0) return 0;
    const sum = this.responseTimes.reduce((a, b) => a + b, 0);
    return Math.round((sum / this.responseTimes.length) * 100) / 100;
  }

  /**
   * Get P95 response time
   */
  getP95ResponseTime(): number {
    if (this.responseTimes.length === 0) return 0;
    const sorted = [...this.responseTimes].sort((a, b) => a - b);
    const index = Math.ceil(sorted.length * 0.95) - 1;
    return sorted[Math.max(0, index)];
  }

  /**
   * Get P99 response time
   */
  getP99ResponseTime(): number {
    if (this.responseTimes.length === 0) return 0;
    const sorted = [...this.responseTimes].sort((a, b) => a - b);
    const index = Math.ceil(sorted.length * 0.99) - 1;
    return sorted[Math.max(0, index)];
  }

  /**
   * Collect all system metrics
   */
  collectMetrics(
    activeSessionCount: number,
    databaseLatency: number,
    version: string = 'unknown',
  ): SystemMetrics {
    return {
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      memoryUsage: this.getMemoryMetrics(),
      cpuUsage: this.getCpuMetrics(),
      activeSessionCount,
      errorRate: this.getErrorRate(),
      averageResponseTime: this.getAverageResponseTime(),
      databaseLatency,
      version,
    };
  }

  /**
   * Check memory usage thresholds
   */
  checkMemoryHealth(): 'ok' | 'warning' | 'critical' {
    const memory = this.getMemoryMetrics();
    if (memory.percentage > 90) return 'critical';
    if (memory.percentage > 75) return 'warning';
    return 'ok';
  }

  /**
   * Check response time thresholds
   */
  checkResponseTimeHealth(): 'ok' | 'warning' | 'critical' {
    const avgTime = this.getAverageResponseTime();
    if (avgTime > 2000) return 'critical';
    if (avgTime > 1000) return 'warning';
    return 'ok';
  }

  /**
   * Check database latency thresholds
   */
  checkDatabaseHealth(latency: number): 'ok' | 'warning' | 'critical' {
    if (latency > 1000) return 'critical';
    if (latency > 500) return 'warning';
    return 'ok';
  }

  /**
   * Determine overall health status based on all checks
   */
  determineHealthStatus(
    databaseConnected: boolean,
    databaseLatency: number,
  ): HealthCheckResult['status'] {
    if (!databaseConnected) return 'unhealthy';

    const memoryHealth = this.checkMemoryHealth();
    const responseTimeHealth = this.checkResponseTimeHealth();
    const databaseHealth = this.checkDatabaseHealth(databaseLatency);

    if (memoryHealth === 'critical' || responseTimeHealth === 'critical' || databaseHealth === 'critical') {
      return 'unhealthy';
    }

    if (memoryHealth === 'warning' || responseTimeHealth === 'warning' || databaseHealth === 'warning') {
      return 'degraded';
    }

    return 'ok';
  }

  /**
   * Build detailed health check result
   */
  buildHealthCheckResult(
    databaseConnected: boolean,
    databaseLatency: number,
    activeSessionCount: number,
    version: string = 'unknown',
  ): HealthCheckResult {
    const metrics = this.collectMetrics(activeSessionCount, databaseLatency, version);
    const status = this.determineHealthStatus(databaseConnected, databaseLatency);

    return {
      status,
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      database: {
        status: databaseConnected ? 'connected' : 'disconnected',
        latency: databaseLatency,
      },
      metrics: {
        ...metrics,
        timestamp: undefined,
      } as any,
      checks: {
        memory: this.checkMemoryHealth(),
        database: databaseConnected ? this.checkDatabaseHealth(databaseLatency) : 'critical',
        responseTime: this.checkResponseTimeHealth(),
      },
    };
  }

  /**
   * Publish custom metrics to CloudWatch (stub for now)
   * In production, this would use AWS SDK to publish to CloudWatch
   */
  async publishCustomMetrics(
    activeSessionCount: number,
    errorRate: number,
    averageResponseTime: number,
  ): Promise<void> {
    // Check if CloudWatch is enabled
    const cloudwatchEnabled = this.configService.get<boolean>('cloudwatch.enabled', false);

    if (!cloudwatchEnabled) {
      return;
    }

    // Only publish if enough time has passed
    if (Date.now() - this.lastMetricsPublish < this.metricsPublishInterval) {
      return;
    }

    try {
      this.logger.debug('Publishing custom metrics to CloudWatch', {
        activeSessionCount,
        errorRate,
        averageResponseTime,
      });

      // Stub implementation - in production this would use:
      // const cloudwatch = new AWS.CloudWatch();
      // await cloudwatch.putMetricData(...).promise();

      this.lastMetricsPublish = Date.now();
    } catch (error) {
      this.logger.error('Failed to publish custom metrics', error);
    }
  }
}
