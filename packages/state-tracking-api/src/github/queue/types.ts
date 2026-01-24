/**
 * Types for GitHub API rate limiting and request queuing
 */

/**
 * Priority levels for queued requests
 */
export enum RequestPriority {
  HIGH = 'high',
  NORMAL = 'normal',
  LOW = 'low',
}

/**
 * Rate limit information parsed from GitHub API response headers
 */
export interface RateLimitInfo {
  /** Remaining requests in current window */
  remaining: number;
  /** Total request limit per window */
  limit: number;
  /** Timestamp when rate limit resets (Unix epoch seconds) */
  resetAt: number;
  /** Resource type (e.g., 'graphql', 'core', 'search') */
  resource: string;
}

/**
 * Per-user rate limit tracking state
 */
export interface UserRateLimitState {
  /** GitHub username or user ID */
  userId: string;
  /** GraphQL API rate limit info */
  graphql: RateLimitInfo;
  /** REST API core rate limit info */
  rest: RateLimitInfo;
  /** Last update timestamp */
  lastUpdated: number;
}

/**
 * Queued request metadata
 */
export interface QueuedRequest<T = any> {
  /** Unique request ID */
  id: string;
  /** User making the request */
  userId: string;
  /** Priority level */
  priority: RequestPriority;
  /** Request function to execute */
  execute: () => Promise<T>;
  /** Request enqueued timestamp */
  enqueuedAt: number;
  /** Promise resolve function */
  resolve: (value: T) => void;
  /** Promise reject function */
  reject: (error: Error) => void;
  /** API resource type (graphql or rest) */
  resource: 'graphql' | 'rest';
}

/**
 * Queue statistics
 */
export interface QueueStats {
  /** Total requests in queue */
  total: number;
  /** High priority requests */
  high: number;
  /** Normal priority requests */
  normal: number;
  /** Low priority requests */
  low: number;
  /** Oldest request age in milliseconds */
  oldestAge: number;
  /** High priority bypass count in current window */
  bypassCount: number;
}

/**
 * Rate limit configuration
 */
export interface RateLimitConfig {
  /** Maximum queue capacity */
  maxQueueSize: number;
  /** Request timeout in milliseconds */
  requestTimeout: number;
  /** Throttle threshold (0-1, where 0.8 = 80%) */
  throttleThreshold: number;
  /** Throttle rate multiplier (0-1, where 0.5 = 50% of normal rate) */
  throttleRate: number;
  /** Maximum high-priority bypass percentage (0-1, where 0.1 = 10%) */
  maxBypassRate: number;
  /** Window size for tracking bypass count (milliseconds) */
  bypassWindowMs: number;
}
