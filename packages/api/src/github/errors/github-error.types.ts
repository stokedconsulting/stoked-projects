/**
 * GitHub API Error Types
 * Categorizes errors for appropriate handling and retry strategies
 */
export enum GitHubErrorType {
  /**
   * Rate limit exceeded (429)
   * Retry after reset time from headers
   */
  RATE_LIMIT = 'GITHUB_RATE_LIMIT',

  /**
   * Authentication/authorization failures (401/403)
   * No retry - requires user action
   */
  AUTH = 'GITHUB_AUTH_ERROR',

  /**
   * Server errors (500/502/503)
   * Retry with exponential backoff
   */
  SERVER = 'GITHUB_SERVER_ERROR',

  /**
   * Network timeouts and connection failures
   * Retry with exponential backoff
   */
  NETWORK = 'GITHUB_NETWORK_ERROR',

  /**
   * Validation errors (400/422)
   * No retry - invalid request
   */
  VALIDATION = 'GITHUB_VALIDATION_ERROR',

  /**
   * Unknown/unclassified errors
   * Single retry attempt
   */
  UNKNOWN = 'GITHUB_UNKNOWN_ERROR',

  /**
   * Service unavailable due to circuit breaker
   * Fast-fail without calling GitHub
   */
  SERVICE_UNAVAILABLE = 'SERVICE_UNAVAILABLE',
}

/**
 * Retry decision for error handling
 */
export interface RetryDecision {
  /** Whether the operation should be retried */
  should_retry: boolean;

  /** Delay in milliseconds before retry (0 for immediate) */
  delay_ms: number;

  /** Maximum number of retry attempts */
  max_retries: number;

  /** Current attempt number */
  attempt: number;
}

/**
 * GitHub API error details
 */
export interface GitHubErrorDetails {
  /** Categorized error type */
  type: GitHubErrorType;

  /** HTTP status code (if applicable) */
  status_code?: number;

  /** Technical error message */
  technical_message: string;

  /** User-friendly error message with actionable guidance */
  user_message: string;

  /** Original error object */
  original_error?: any;

  /** GitHub API rate limit reset time (Unix timestamp) */
  rate_limit_reset?: number;

  /** Retry decision */
  retry_decision: RetryDecision;

  /** Operation context */
  context?: {
    operation_type?: string;
    user_id?: string;
    resource?: string;
  };

  /** Retry history for debugging */
  retry_history?: Array<{
    attempt: number;
    timestamp: string;
    error: string;
  }>;
}

/**
 * Circuit breaker state
 */
export enum CircuitBreakerState {
  /** Circuit is closed, requests flow normally */
  CLOSED = 'CLOSED',

  /** Circuit is open, requests fail immediately */
  OPEN = 'OPEN',

  /** Circuit is testing if service recovered */
  HALF_OPEN = 'HALF_OPEN',
}

/**
 * Circuit breaker statistics
 */
export interface CircuitBreakerStats {
  state: CircuitBreakerState;
  failure_count: number;
  success_count: number;
  last_failure_time?: number;
  last_state_change?: number;
  next_attempt_time?: number;
}
