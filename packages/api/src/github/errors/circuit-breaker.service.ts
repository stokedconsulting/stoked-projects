import { Injectable } from '@nestjs/common';
import {
  CircuitBreakerState,
  CircuitBreakerStats,
} from './github-error.types';
import { GitHubServiceUnavailableException } from './github.exception';

/**
 * Circuit Breaker Service
 *
 * Implements the circuit breaker pattern to prevent cascading failures:
 * - CLOSED: Normal operation, requests flow through
 * - OPEN: Fast-fail mode after threshold failures, blocks all requests
 * - HALF_OPEN: Testing mode, allows limited requests to test recovery
 *
 * Configuration:
 * - Failure threshold: 5 consecutive failures opens circuit
 * - Recovery timeout: 30 seconds before transitioning to half-open
 * - Success threshold: 3 consecutive successes closes circuit
 */
@Injectable()
export class CircuitBreakerService {
  private state: CircuitBreakerState = CircuitBreakerState.CLOSED;
  private failureCount: number = 0;
  private successCount: number = 0;
  private lastFailureTime?: number;
  private lastStateChangeTime?: number;
  private nextAttemptTime?: number;

  // Configuration constants
  private readonly FAILURE_THRESHOLD = 5;
  private readonly SUCCESS_THRESHOLD = 3;
  private readonly RECOVERY_TIMEOUT_MS = 30000; // 30 seconds

  /**
   * Check if request should be allowed through circuit breaker
   * Throws GitHubServiceUnavailableException if circuit is open
   */
  checkState(context?: any): void {
    const now = Date.now();

    switch (this.state) {
      case CircuitBreakerState.CLOSED:
        // Normal operation - allow all requests
        return;

      case CircuitBreakerState.OPEN:
        // Check if recovery timeout has elapsed
        if (
          this.nextAttemptTime &&
          now >= this.nextAttemptTime
        ) {
          this.transitionToHalfOpen();
          return;
        }
        // Circuit still open - fast fail
        throw new GitHubServiceUnavailableException(
          this.nextAttemptTime || now + this.RECOVERY_TIMEOUT_MS,
          context,
        );

      case CircuitBreakerState.HALF_OPEN:
        // Allow test request through
        return;
    }
  }

  /**
   * Record successful operation
   * May close circuit if in half-open state with enough successes
   */
  recordSuccess(): void {
    switch (this.state) {
      case CircuitBreakerState.CLOSED:
        // Reset failure count on success
        this.failureCount = 0;
        break;

      case CircuitBreakerState.HALF_OPEN:
        this.successCount++;
        if (this.successCount >= this.SUCCESS_THRESHOLD) {
          this.transitionToClosed();
        }
        break;

      case CircuitBreakerState.OPEN:
        // Shouldn't happen, but reset if it does
        this.transitionToClosed();
        break;
    }
  }

  /**
   * Record failed operation
   * May open circuit if failure threshold is reached
   */
  recordFailure(): void {
    this.lastFailureTime = Date.now();

    switch (this.state) {
      case CircuitBreakerState.CLOSED:
        this.failureCount++;
        if (this.failureCount >= this.FAILURE_THRESHOLD) {
          this.transitionToOpen();
        }
        break;

      case CircuitBreakerState.HALF_OPEN:
        // Failure in half-open state immediately reopens circuit
        this.transitionToOpen();
        break;

      case CircuitBreakerState.OPEN:
        // Already open, just track the failure
        this.failureCount++;
        break;
    }
  }

  /**
   * Transition to OPEN state
   */
  private transitionToOpen(): void {
    this.state = CircuitBreakerState.OPEN;
    this.lastStateChangeTime = Date.now();
    this.nextAttemptTime = this.lastStateChangeTime + this.RECOVERY_TIMEOUT_MS;
    this.successCount = 0;
  }

  /**
   * Transition to HALF_OPEN state
   */
  private transitionToHalfOpen(): void {
    this.state = CircuitBreakerState.HALF_OPEN;
    this.lastStateChangeTime = Date.now();
    this.nextAttemptTime = undefined;
    this.successCount = 0;
    this.failureCount = 0;
  }

  /**
   * Transition to CLOSED state
   */
  private transitionToClosed(): void {
    this.state = CircuitBreakerState.CLOSED;
    this.lastStateChangeTime = Date.now();
    this.nextAttemptTime = undefined;
    this.successCount = 0;
    this.failureCount = 0;
  }

  /**
   * Get current circuit breaker statistics
   */
  getStats(): CircuitBreakerStats {
    return {
      state: this.state,
      failure_count: this.failureCount,
      success_count: this.successCount,
      last_failure_time: this.lastFailureTime,
      last_state_change: this.lastStateChangeTime,
      next_attempt_time: this.nextAttemptTime,
    };
  }

  /**
   * Reset circuit breaker to initial state
   * Useful for testing or manual recovery
   */
  reset(): void {
    this.state = CircuitBreakerState.CLOSED;
    this.failureCount = 0;
    this.successCount = 0;
    this.lastFailureTime = undefined;
    this.lastStateChangeTime = undefined;
    this.nextAttemptTime = undefined;
  }
}
