import { HttpException, HttpStatus } from '@nestjs/common';
import { GitHubErrorType, GitHubErrorDetails } from './github-error.types';

/**
 * Base exception class for GitHub API errors
 * Extends NestJS HttpException for consistent error handling
 */
export class GitHubException extends HttpException {
  constructor(
    public readonly details: GitHubErrorDetails,
    status?: HttpStatus,
  ) {
    const httpStatus = status || GitHubException.mapTypeToStatus(details.type);
    super(details.user_message, httpStatus);

    // Maintain proper stack trace for debugging
    Error.captureStackTrace(this, this.constructor);
  }

  /**
   * Map GitHub error type to HTTP status code
   */
  private static mapTypeToStatus(type: GitHubErrorType): HttpStatus {
    switch (type) {
      case GitHubErrorType.RATE_LIMIT:
        return HttpStatus.TOO_MANY_REQUESTS;
      case GitHubErrorType.AUTH:
        return HttpStatus.UNAUTHORIZED;
      case GitHubErrorType.VALIDATION:
        return HttpStatus.BAD_REQUEST;
      case GitHubErrorType.SERVER:
      case GitHubErrorType.NETWORK:
      case GitHubErrorType.UNKNOWN:
        return HttpStatus.BAD_GATEWAY;
      case GitHubErrorType.SERVICE_UNAVAILABLE:
        return HttpStatus.SERVICE_UNAVAILABLE;
      default:
        return HttpStatus.INTERNAL_SERVER_ERROR;
    }
  }

  /**
   * Get detailed error information for logging
   */
  getDetails(): GitHubErrorDetails {
    return this.details;
  }

  /**
   * Check if error should be retried
   */
  shouldRetry(): boolean {
    return this.details.retry_decision.should_retry;
  }

  /**
   * Get retry delay in milliseconds
   */
  getRetryDelay(): number {
    return this.details.retry_decision.delay_ms;
  }
}

/**
 * Rate limit exceeded exception
 */
export class GitHubRateLimitException extends GitHubException {
  constructor(resetTime: number, technical_message: string, context?: any) {
    super(
      {
        type: GitHubErrorType.RATE_LIMIT,
        status_code: 429,
        technical_message,
        user_message:
          'GitHub API rate limit exceeded. Please wait a few minutes and try again.',
        rate_limit_reset: resetTime,
        retry_decision: {
          should_retry: true,
          delay_ms: Math.max(0, resetTime * 1000 - Date.now()),
          max_retries: 1,
          attempt: 0,
        },
        context,
      },
      HttpStatus.TOO_MANY_REQUESTS,
    );
  }
}

/**
 * Authentication/authorization exception
 */
export class GitHubAuthException extends GitHubException {
  constructor(status_code: number, technical_message: string, context?: any) {
    const isUnauthorized = status_code === 401;
    super(
      {
        type: GitHubErrorType.AUTH,
        status_code,
        technical_message,
        user_message: isUnauthorized
          ? 'GitHub authentication failed. Please verify your access token is valid and has not expired.'
          : 'GitHub authorization failed. Your token does not have the required permissions for this operation. Please check that your token has the necessary scopes (repo, read:org, read:project, project).',
        retry_decision: {
          should_retry: false,
          delay_ms: 0,
          max_retries: 0,
          attempt: 0,
        },
        context,
      },
      isUnauthorized ? HttpStatus.UNAUTHORIZED : HttpStatus.FORBIDDEN,
    );
  }
}

/**
 * Server error exception (500/502/503)
 */
export class GitHubServerException extends GitHubException {
  constructor(
    status_code: number,
    technical_message: string,
    attempt: number = 0,
    context?: any,
  ) {
    // Exponential backoff: 1s, 2s, 4s (based on next retry attempt)
    const delay_ms = Math.pow(2, attempt) * 1000;

    super(
      {
        type: GitHubErrorType.SERVER,
        status_code,
        technical_message,
        user_message:
          'GitHub is experiencing technical difficulties. We will automatically retry your request.',
        retry_decision: {
          should_retry: attempt < 3,
          delay_ms,
          max_retries: 3,
          attempt,
        },
        context,
      },
      HttpStatus.BAD_GATEWAY,
    );
  }
}

/**
 * Network error exception (timeouts, connection failures)
 */
export class GitHubNetworkException extends GitHubException {
  constructor(technical_message: string, attempt: number = 0, context?: any) {
    // Exponential backoff: 1s, 2s, 4s (based on next retry attempt)
    const delay_ms = Math.pow(2, attempt) * 1000;

    super(
      {
        type: GitHubErrorType.NETWORK,
        technical_message,
        user_message:
          'Network error while connecting to GitHub. We will automatically retry your request.',
        retry_decision: {
          should_retry: attempt < 3,
          delay_ms,
          max_retries: 3,
          attempt,
        },
        context,
      },
      HttpStatus.BAD_GATEWAY,
    );
  }
}

/**
 * Validation error exception (400/422)
 */
export class GitHubValidationException extends GitHubException {
  constructor(status_code: number, technical_message: string, context?: any) {
    super(
      {
        type: GitHubErrorType.VALIDATION,
        status_code,
        technical_message,
        user_message:
          'Invalid request to GitHub API. Please check your input parameters and try again.',
        retry_decision: {
          should_retry: false,
          delay_ms: 0,
          max_retries: 0,
          attempt: 0,
        },
        context,
      },
      HttpStatus.BAD_REQUEST,
    );
  }
}

/**
 * Unknown error exception
 */
export class GitHubUnknownException extends GitHubException {
  constructor(technical_message: string, original_error?: any, context?: any) {
    super(
      {
        type: GitHubErrorType.UNKNOWN,
        technical_message,
        user_message:
          'An unexpected error occurred while communicating with GitHub. We will retry once.',
        original_error,
        retry_decision: {
          should_retry: true,
          delay_ms: 1000,
          max_retries: 1,
          attempt: 0,
        },
        context,
      },
      HttpStatus.BAD_GATEWAY,
    );
  }
}

/**
 * Service unavailable exception (circuit breaker open)
 */
export class GitHubServiceUnavailableException extends GitHubException {
  constructor(next_attempt_time: number, context?: any) {
    const waitTime = Math.ceil((next_attempt_time - Date.now()) / 1000);
    super(
      {
        type: GitHubErrorType.SERVICE_UNAVAILABLE,
        technical_message: 'Circuit breaker open due to consecutive failures',
        user_message: `GitHub service is temporarily unavailable due to repeated errors. Please try again in ${waitTime} seconds.`,
        retry_decision: {
          should_retry: false,
          delay_ms: next_attempt_time - Date.now(),
          max_retries: 0,
          attempt: 0,
        },
        context,
      },
      HttpStatus.SERVICE_UNAVAILABLE,
    );
  }
}
