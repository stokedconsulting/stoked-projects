import { Injectable } from '@nestjs/common';
import { CircuitBreakerService } from './circuit-breaker.service';
import { ErrorCategorizationService } from './error-categorization.service';
import { GitHubException } from './github.exception';

/**
 * Retry Strategy Service
 *
 * Handles retry logic for GitHub API operations:
 * - Integrates with circuit breaker for fail-fast behavior
 * - Categorizes errors and determines retry strategy
 * - Implements exponential backoff and rate limit handling
 * - Tracks retry history for debugging
 */
@Injectable()
export class RetryStrategyService {
  constructor(
    private readonly circuitBreaker: CircuitBreakerService,
    private readonly errorCategorization: ErrorCategorizationService,
  ) {}

  /**
   * Execute operation with automatic retry logic
   *
   * @param operation - Async function to execute
   * @param context - Operation context for error tracking
   * @returns Operation result
   * @throws GitHubException - If operation fails after retries
   */
  async executeWithRetry<T>(
    operation: () => Promise<T>,
    context?: any,
  ): Promise<T> {
    let lastError: GitHubException | undefined;
    let attempt = 0;
    const retryHistory: Array<{
      attempt: number;
      timestamp: string;
      error: string;
    }> = [];

    while (true) {
      try {
        // Check circuit breaker before attempting
        this.circuitBreaker.checkState(context);

        // Execute operation
        const result = await operation();

        // Record success in circuit breaker
        this.circuitBreaker.recordSuccess();

        return result;
      } catch (error: any) {
        // Categorize error if it's not already a GitHubException
        const githubError =
          error instanceof GitHubException
            ? error
            : this.errorCategorization.categorize(error, attempt, context);

        // Record failure in circuit breaker
        this.circuitBreaker.recordFailure();

        // Track retry history
        retryHistory.push({
          attempt,
          timestamp: new Date().toISOString(),
          error: githubError.details.technical_message,
        });

        // Update error with retry history
        githubError.details.retry_history = retryHistory;

        // Check if we should retry
        const shouldRetry =
          githubError.shouldRetry() &&
          attempt < githubError.details.retry_decision.max_retries;

        if (!shouldRetry) {
          // No more retries - throw error
          throw githubError;
        }

        // Wait before retrying
        const delayMs = githubError.getRetryDelay();
        if (delayMs > 0) {
          await this.delay(delayMs);
        }

        // Increment attempt and retry
        attempt++;
        lastError = githubError;
      }
    }
  }

  /**
   * Delay execution for specified milliseconds
   */
  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Get circuit breaker statistics
   */
  getCircuitBreakerStats() {
    return this.circuitBreaker.getStats();
  }

  /**
   * Reset circuit breaker (for testing/manual recovery)
   */
  resetCircuitBreaker(): void {
    this.circuitBreaker.reset();
  }
}
