import { Injectable } from '@nestjs/common';
import { GitHubErrorType } from './github-error.types';
import {
  GitHubException,
  GitHubRateLimitException,
  GitHubAuthException,
  GitHubServerException,
  GitHubNetworkException,
  GitHubValidationException,
  GitHubUnknownException,
} from './github.exception';

/**
 * Error Categorization Service
 *
 * Categorizes raw errors from GitHub API into typed exceptions
 * with appropriate retry strategies and user-friendly messages.
 */
@Injectable()
export class ErrorCategorizationService {
  /**
   * Categorize error and create appropriate GitHubException
   *
   * @param error - Raw error from GitHub API or network layer
   * @param attempt - Current retry attempt number
   * @param context - Additional context (operation type, user, etc.)
   * @returns Categorized GitHubException
   */
  categorize(error: any, attempt: number = 0, context?: any): GitHubException {
    // Extract status code from various error formats
    const statusCode = this.extractStatusCode(error);

    // Check for rate limit errors (429)
    if (statusCode === 429) {
      return this.createRateLimitException(error, context);
    }

    // Check for auth errors (401/403)
    if (statusCode === 401 || statusCode === 403) {
      return this.createAuthException(statusCode, error, context);
    }

    // Check for validation errors (400/422)
    if (statusCode === 400 || statusCode === 422) {
      return this.createValidationException(statusCode, error, context);
    }

    // Check for server errors (500/502/503)
    if (statusCode && statusCode >= 500 && statusCode < 600) {
      return this.createServerException(statusCode, error, attempt, context);
    }

    // Check for network errors (timeouts, connection failures)
    if (this.isNetworkError(error)) {
      return this.createNetworkException(error, attempt, context);
    }

    // Unknown error type
    return this.createUnknownException(error, context);
  }

  /**
   * Extract HTTP status code from error object
   */
  private extractStatusCode(error: any): number | undefined {
    // Check various common error formats
    if (error.response?.status) {
      return error.response.status;
    }
    if (error.status) {
      return error.status;
    }
    if (error.statusCode) {
      return error.statusCode;
    }
    // GraphQL errors may have extensions.code
    if (error.extensions?.code === 'RATE_LIMITED') {
      return 429;
    }
    return undefined;
  }

  /**
   * Check if error is a network error
   */
  private isNetworkError(error: any): boolean {
    if (!error) return false;

    // Check error code
    const networkCodes = [
      'ETIMEDOUT',
      'ECONNREFUSED',
      'ECONNRESET',
      'ENOTFOUND',
      'ENETUNREACH',
      'EAI_AGAIN',
    ];
    if (error.code && networkCodes.includes(error.code)) {
      return true;
    }

    // Check error name
    if (error.name === 'TimeoutError' || error.name === 'NetworkError') {
      return true;
    }

    // Check error message
    const message = error.message?.toLowerCase() || '';
    return (
      message.includes('timeout') ||
      message.includes('timed out') ||
      message.includes('network') ||
      message.includes('connection')
    );
  }

  /**
   * Create rate limit exception
   */
  private createRateLimitException(
    error: any,
    context?: any,
  ): GitHubRateLimitException {
    // Extract rate limit reset time from headers
    const resetTime = this.extractRateLimitReset(error);
    const technicalMessage = this.extractTechnicalMessage(error);

    return new GitHubRateLimitException(resetTime, technicalMessage, context);
  }

  /**
   * Extract rate limit reset time from error
   */
  private extractRateLimitReset(error: any): number {
    // Check response headers for X-RateLimit-Reset
    const resetHeader =
      error.response?.headers?.['x-ratelimit-reset'] ||
      error.headers?.['x-ratelimit-reset'];

    if (resetHeader) {
      const resetTime = parseInt(resetHeader, 10);
      if (!isNaN(resetTime)) {
        return resetTime;
      }
    }

    // Default to 60 seconds from now if header not found
    return Math.floor(Date.now() / 1000) + 60;
  }

  /**
   * Create auth exception
   */
  private createAuthException(
    statusCode: number,
    error: any,
    context?: any,
  ): GitHubAuthException {
    const technicalMessage = this.extractTechnicalMessage(error);
    return new GitHubAuthException(statusCode, technicalMessage, context);
  }

  /**
   * Create validation exception
   */
  private createValidationException(
    statusCode: number,
    error: any,
    context?: any,
  ): GitHubValidationException {
    const technicalMessage = this.extractTechnicalMessage(error);
    return new GitHubValidationException(statusCode, technicalMessage, context);
  }

  /**
   * Create server exception
   */
  private createServerException(
    statusCode: number,
    error: any,
    attempt: number,
    context?: any,
  ): GitHubServerException {
    const technicalMessage = this.extractTechnicalMessage(error);
    return new GitHubServerException(
      statusCode,
      technicalMessage,
      attempt,
      context,
    );
  }

  /**
   * Create network exception
   */
  private createNetworkException(
    error: any,
    attempt: number,
    context?: any,
  ): GitHubNetworkException {
    const technicalMessage = this.extractTechnicalMessage(error);
    return new GitHubNetworkException(technicalMessage, attempt, context);
  }

  /**
   * Create unknown exception
   */
  private createUnknownException(
    error: any,
    context?: any,
  ): GitHubUnknownException {
    const technicalMessage = this.extractTechnicalMessage(error);
    return new GitHubUnknownException(technicalMessage, error, context);
  }

  /**
   * Extract technical error message from error object
   */
  private extractTechnicalMessage(error: any): string {
    if (!error) {
      return 'Unknown error';
    }

    // Try various message fields
    if (error.message) {
      return error.message;
    }
    if (error.response?.data?.message) {
      return error.response.data.message;
    }
    if (error.response?.statusText) {
      return error.response.statusText;
    }
    if (error.data?.message) {
      return error.data.message;
    }

    // GraphQL errors
    if (error.errors && Array.isArray(error.errors) && error.errors.length > 0) {
      return error.errors.map((e: any) => e.message).join('; ');
    }

    // Fallback to JSON stringify
    try {
      return JSON.stringify(error);
    } catch {
      return String(error);
    }
  }
}
