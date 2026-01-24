import { Module } from '@nestjs/common';
import { GitHubLoggerService } from './github-logger.service';
import { MetricsService } from './metrics.service';
import { MetricsController } from './metrics.controller';

/**
 * GitHub Logging Module
 *
 * Provides:
 * - Structured logging with Winston
 * - Sensitive data filtering
 * - Separate audit log stream
 * - Prometheus metrics
 * - Request tracing
 */
@Module({
  providers: [GitHubLoggerService, MetricsService],
  controllers: [MetricsController],
  exports: [GitHubLoggerService, MetricsService],
})
export class GitHubLoggingModule {}
