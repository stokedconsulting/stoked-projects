import { Injectable, OnModuleInit } from '@nestjs/common';
import { Counter, Histogram, Registry, collectDefaultMetrics } from 'prom-client';
import { GitHubOperation } from './github-logger.service';

/**
 * Metrics Service
 *
 * Exports Prometheus-compatible metrics for GitHub operations:
 * - Request counts by operation and status
 * - Latency percentiles (p50, p95, p99)
 * - Error rates by operation
 * - Active operations gauge
 */
@Injectable()
export class MetricsService implements OnModuleInit {
  private readonly registry: Registry;
  private readonly requestCounter: Counter;
  private readonly latencyHistogram: Histogram;
  private readonly errorCounter: Counter;

  constructor() {
    // Create separate registry for GitHub metrics
    this.registry = new Registry();

    // Collect default metrics (CPU, memory, etc.)
    collectDefaultMetrics({
      register: this.registry,
      prefix: 'github_',
    });

    // Request counter by operation and status
    this.requestCounter = new Counter({
      name: 'github_operations_total',
      help: 'Total number of GitHub operations',
      labelNames: ['operation', 'status'],
      registers: [this.registry],
    });

    // Latency histogram with percentile buckets
    this.latencyHistogram = new Histogram({
      name: 'github_operation_duration_seconds',
      help: 'Duration of GitHub operations in seconds',
      labelNames: ['operation'],
      buckets: [0.1, 0.5, 1, 2, 5, 10], // seconds
      registers: [this.registry],
    });

    // Error counter by operation
    this.errorCounter = new Counter({
      name: 'github_operation_errors_total',
      help: 'Total number of GitHub operation errors',
      labelNames: ['operation', 'error_code'],
      registers: [this.registry],
    });
  }

  onModuleInit() {
    // Initialize default labels
    this.registry.setDefaultLabels({
      service: 'github-operations',
    });
  }

  /**
   * Record a completed operation
   */
  recordOperation(
    operation: GitHubOperation | string,
    duration: number,
    status: 'success' | 'error',
    errorCode?: string
  ): void {
    // Increment request counter
    this.requestCounter.inc({
      operation,
      status,
    });

    // Record latency (convert ms to seconds)
    this.latencyHistogram.observe(
      { operation },
      duration / 1000
    );

    // Record error if applicable
    if (status === 'error') {
      this.errorCounter.inc({
        operation,
        error_code: errorCode || 'unknown',
      });
    }
  }

  /**
   * Get metrics in Prometheus format
   */
  async getMetrics(): Promise<string> {
    return this.registry.metrics();
  }

  /**
   * Get metrics as JSON (for debugging)
   */
  async getMetricsJSON(): Promise<any> {
    const metrics = await this.registry.getMetricsAsJSON();
    return metrics;
  }

  /**
   * Reset all metrics (for testing)
   */
  resetMetrics(): void {
    this.registry.resetMetrics();
  }

  /**
   * Get registry for custom metrics
   */
  getRegistry(): Registry {
    return this.registry;
  }

  /**
   * Create a timer for an operation
   */
  startTimer(operation: GitHubOperation | string): () => void {
    const end = this.latencyHistogram.startTimer({ operation });
    return end;
  }
}
