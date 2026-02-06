/**
 * GitHub Error Handling Module
 *
 * Provides comprehensive error handling for GitHub API operations:
 * - Error categorization (rate limit, auth, server, network, validation)
 * - Automatic retry with exponential backoff
 * - Circuit breaker pattern for fault tolerance
 * - User-friendly error messages with actionable guidance
 */

export * from './github-error.types';
export * from './github.exception';
export * from './circuit-breaker.service';
export * from './error-categorization.service';
export * from './retry-strategy.service';
export * from './github-error-handler.module';
