import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/**
 * Prometheus metrics service
 * Collects and exports metrics in Prometheus format
 */
@Injectable()
export class PrometheusService {
  private readonly logger = new Logger(PrometheusService.name);

  // Counter metrics
  private httpRequestsTotal = new Map<string, number>();
  private httpRequestsByMethod = new Map<string, number>();
  private httpRequestsByStatus = new Map<string, number>();
  private httpErrorsTotal = new Map<string, number>();

  // Gauge metrics
  private httpRequestsInProgress = 0;
  private activeSessionCount = 0;
  private databaseConnectionsActive = 0;
  private githubApiRateLimitRemaining = 5000;

  // Histogram metrics (stored as arrays for percentile calculation)
  private httpResponseTimeMs: number[] = [];
  private databaseQueryTimeMs: number[] = [];
  private githubApiLatencyMs: number[] = [];

  // Cache metrics
  private cacheHits = 0;
  private cacheMisses = 0;
  private cacheEvictions = 0;

  // GitHub API rate limiting
  private githubApiCallsRemaining = 5000;
  private githubApiResetTime = 0;

  constructor(private configService: ConfigService) {}

  /**
   * Record HTTP request start
   */
  recordHttpRequestStart(method: string, path: string): void {
    this.httpRequestsInProgress++;
    const key = `${method}:${this.normalizePath(path)}`;
    this.httpRequestsTotal.set(key, (this.httpRequestsTotal.get(key) || 0) + 1);
    this.httpRequestsByMethod.set(method, (this.httpRequestsByMethod.get(method) || 0) + 1);
  }

  /**
   * Record HTTP request end
   */
  recordHttpRequestEnd(
    method: string,
    path: string,
    status: number,
    responseTimeMs: number,
  ): void {
    this.httpRequestsInProgress--;
    this.httpResponseTimeMs.push(responseTimeMs);
    if (this.httpResponseTimeMs.length > 10000) {
      this.httpResponseTimeMs = this.httpResponseTimeMs.slice(-10000);
    }

    const statusKey = `${status}`;
    this.httpRequestsByStatus.set(statusKey, (this.httpRequestsByStatus.get(statusKey) || 0) + 1);

    if (status >= 400) {
      const errorKey = `${method}:${this.normalizePath(path)}:${status}`;
      this.httpErrorsTotal.set(errorKey, (this.httpErrorsTotal.get(errorKey) || 0) + 1);
    }
  }

  /**
   * Record database query
   */
  recordDatabaseQuery(queryTimeMs: number): void {
    this.databaseQueryTimeMs.push(queryTimeMs);
    if (this.databaseQueryTimeMs.length > 10000) {
      this.databaseQueryTimeMs = this.databaseQueryTimeMs.slice(-10000);
    }
  }

  /**
   * Record GitHub API call
   */
  recordGithubApiCall(latencyMs: number, remaining: number, resetTime: number): void {
    this.githubApiLatencyMs.push(latencyMs);
    if (this.githubApiLatencyMs.length > 10000) {
      this.githubApiLatencyMs = this.githubApiLatencyMs.slice(-10000);
    }
    this.githubApiRateLimitRemaining = remaining;
    this.githubApiResetTime = resetTime;
  }

  /**
   * Update active session count
   */
  setActiveSessionCount(count: number): void {
    this.activeSessionCount = count;
  }

  /**
   * Update active database connections
   */
  setActiveConnections(count: number): void {
    this.databaseConnectionsActive = count;
  }

  /**
   * Record cache hit
   */
  recordCacheHit(): void {
    this.cacheHits++;
  }

  /**
   * Record cache miss
   */
  recordCacheMiss(): void {
    this.cacheMisses++;
  }

  /**
   * Record cache eviction
   */
  recordCacheEviction(): void {
    this.cacheEvictions++;
  }

  /**
   * Get cache hit rate
   */
  getCacheHitRate(): number {
    const total = this.cacheHits + this.cacheMisses;
    return total === 0 ? 0 : Math.round((this.cacheHits / total) * 10000) / 100;
  }

  /**
   * Calculate percentile from array of values
   */
  private calculatePercentile(values: number[], percentile: number): number {
    if (values.length === 0) return 0;
    const sorted = [...values].sort((a, b) => a - b);
    const index = Math.ceil((sorted.length * percentile) / 100) - 1;
    return sorted[Math.max(0, index)];
  }

  /**
   * Normalize path to avoid high cardinality
   */
  private normalizePath(path: string): string {
    // Replace IDs with placeholders
    return path
      .replace(/\/[a-f0-9]{24}/g, '/:id') // MongoDB ObjectId
      .replace(/\/[0-9]+/g, '/:id')
      .replace(/\?.*/, ''); // Remove query strings
  }

  /**
   * Export metrics in Prometheus format
   */
  export(): string {
    const lines: string[] = [];
    const timestamp = Date.now();

    // Help text
    lines.push('# HELP http_requests_total Total HTTP requests');
    lines.push('# TYPE http_requests_total counter');

    // HTTP requests total
    this.httpRequestsTotal.forEach((count, key) => {
      const [method, path] = key.split(':');
      lines.push(`http_requests_total{method="${method}",path="${path}"} ${count}`);
    });

    // HTTP requests by method
    lines.push('# HELP http_requests_by_method HTTP requests by method');
    lines.push('# TYPE http_requests_by_method counter');
    this.httpRequestsByMethod.forEach((count, method) => {
      lines.push(`http_requests_by_method{method="${method}"} ${count}`);
    });

    // HTTP requests by status
    lines.push('# HELP http_requests_by_status HTTP requests by status code');
    lines.push('# TYPE http_requests_by_status counter');
    this.httpRequestsByStatus.forEach((count, status) => {
      lines.push(`http_requests_by_status{status="${status}"} ${count}`);
    });

    // HTTP errors total
    lines.push('# HELP http_errors_total Total HTTP errors');
    lines.push('# TYPE http_errors_total counter');
    this.httpErrorsTotal.forEach((count, key) => {
      lines.push(`http_errors_total{endpoint="${key}"} ${count}`);
    });

    // HTTP requests in progress
    lines.push('# HELP http_requests_in_progress Current HTTP requests in progress');
    lines.push('# TYPE http_requests_in_progress gauge');
    lines.push(`http_requests_in_progress ${this.httpRequestsInProgress}`);

    // HTTP response time percentiles
    lines.push('# HELP http_response_time_ms HTTP response time in milliseconds');
    lines.push('# TYPE http_response_time_ms histogram');
    lines.push(
      `http_response_time_ms{quantile="0.5"} ${this.calculatePercentile(this.httpResponseTimeMs, 50)}`,
    );
    lines.push(
      `http_response_time_ms{quantile="0.95"} ${this.calculatePercentile(this.httpResponseTimeMs, 95)}`,
    );
    lines.push(
      `http_response_time_ms{quantile="0.99"} ${this.calculatePercentile(this.httpResponseTimeMs, 99)}`,
    );
    lines.push(`http_response_time_ms_sum ${this.httpResponseTimeMs.reduce((a, b) => a + b, 0)}`);
    lines.push(`http_response_time_ms_count ${this.httpResponseTimeMs.length}`);

    // Database query time
    lines.push('# HELP db_query_time_ms Database query time in milliseconds');
    lines.push('# TYPE db_query_time_ms histogram');
    lines.push(
      `db_query_time_ms{quantile="0.5"} ${this.calculatePercentile(this.databaseQueryTimeMs, 50)}`,
    );
    lines.push(
      `db_query_time_ms{quantile="0.95"} ${this.calculatePercentile(this.databaseQueryTimeMs, 95)}`,
    );
    lines.push(
      `db_query_time_ms{quantile="0.99"} ${this.calculatePercentile(this.databaseQueryTimeMs, 99)}`,
    );
    lines.push(`db_query_time_ms_sum ${this.databaseQueryTimeMs.reduce((a, b) => a + b, 0)}`);
    lines.push(`db_query_time_ms_count ${this.databaseQueryTimeMs.length}`);

    // Active sessions
    lines.push('# HELP active_sessions Active session count');
    lines.push('# TYPE active_sessions gauge');
    lines.push(`active_sessions ${this.activeSessionCount}`);

    // Active database connections
    lines.push('# HELP db_connections_active Active database connections');
    lines.push('# TYPE db_connections_active gauge');
    lines.push(`db_connections_active ${this.databaseConnectionsActive}`);

    // Cache metrics
    lines.push('# HELP cache_hits Cache hits total');
    lines.push('# TYPE cache_hits counter');
    lines.push(`cache_hits ${this.cacheHits}`);

    lines.push('# HELP cache_misses Cache misses total');
    lines.push('# TYPE cache_misses counter');
    lines.push(`cache_misses ${this.cacheMisses}`);

    lines.push('# HELP cache_evictions Cache evictions total');
    lines.push('# TYPE cache_evictions counter');
    lines.push(`cache_evictions ${this.cacheEvictions}`);

    lines.push('# HELP cache_hit_rate Cache hit rate percentage');
    lines.push('# TYPE cache_hit_rate gauge');
    lines.push(`cache_hit_rate ${this.getCacheHitRate()}`);

    // GitHub API rate limiting
    lines.push('# HELP github_api_rate_limit_remaining Rate limit remaining');
    lines.push('# TYPE github_api_rate_limit_remaining gauge');
    lines.push(`github_api_rate_limit_remaining ${this.githubApiRateLimitRemaining}`);

    lines.push('# HELP github_api_rate_limit_reset Rate limit reset time (Unix timestamp)');
    lines.push('# TYPE github_api_rate_limit_reset gauge');
    lines.push(`github_api_rate_limit_reset ${this.githubApiResetTime}`);

    // GitHub API latency
    lines.push('# HELP github_api_latency_ms GitHub API latency in milliseconds');
    lines.push('# TYPE github_api_latency_ms histogram');
    lines.push(
      `github_api_latency_ms{quantile="0.5"} ${this.calculatePercentile(this.githubApiLatencyMs, 50)}`,
    );
    lines.push(
      `github_api_latency_ms{quantile="0.95"} ${this.calculatePercentile(this.githubApiLatencyMs, 95)}`,
    );
    lines.push(
      `github_api_latency_ms{quantile="0.99"} ${this.calculatePercentile(this.githubApiLatencyMs, 99)}`,
    );

    return lines.join('\n');
  }

  /**
   * Reset metrics for a new collection period
   */
  reset(): void {
    this.httpRequestsTotal.clear();
    this.httpRequestsByMethod.clear();
    this.httpRequestsByStatus.clear();
    this.httpErrorsTotal.clear();
    this.httpResponseTimeMs = [];
    this.databaseQueryTimeMs = [];
    this.githubApiLatencyMs = [];
    this.cacheHits = 0;
    this.cacheMisses = 0;
    this.cacheEvictions = 0;
  }
}
