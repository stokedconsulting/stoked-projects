import { Test, TestingModule } from '@nestjs/testing';
import { RetryStrategyService } from './retry-strategy.service';
import { CircuitBreakerService } from './circuit-breaker.service';
import { ErrorCategorizationService } from './error-categorization.service';
import { GitHubErrorHandlerModule } from './github-error-handler.module';
import { CircuitBreakerState, GitHubErrorType } from './github-error.types';

/**
 * Integration tests for the complete error handling flow
 * Tests all acceptance criteria end-to-end
 */
describe('GitHub Error Handler Integration Tests', () => {
  let retryStrategy: RetryStrategyService;
  let circuitBreaker: CircuitBreakerService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      imports: [GitHubErrorHandlerModule],
    }).compile();

    retryStrategy = module.get<RetryStrategyService>(RetryStrategyService);
    circuitBreaker = module.get<CircuitBreakerService>(CircuitBreakerService);
  });

  afterEach(() => {
    retryStrategy.resetCircuitBreaker();
  });

  describe('Test-1.4.a: Rate Limit Handling', () => {
    it('should wait for rate limit reset and retry successfully', async () => {
      const resetTime = Math.floor(Date.now() / 1000) + 2; // 2 seconds
      const rateLimitError = {
        response: {
          status: 429,
          headers: { 'x-ratelimit-reset': resetTime.toString() },
        },
        message: 'API rate limit exceeded',
      };

      let attemptCount = 0;
      const operation = jest.fn().mockImplementation(() => {
        attemptCount++;
        if (attemptCount === 1) {
          return Promise.reject(rateLimitError);
        }
        return Promise.resolve({ data: 'success' });
      });

      const startTime = Date.now();
      const result = await retryStrategy.executeWithRetry(operation, {
        operation_type: 'test_rate_limit',
      });
      const elapsed = Date.now() - startTime;

      expect(result).toEqual({ data: 'success' });
      expect(operation).toHaveBeenCalledTimes(2);
      // Should wait approximately until reset time (allow tolerance for timing variance)
      expect(elapsed).toBeGreaterThanOrEqual(1000);
      expect(elapsed).toBeLessThan(3000);
    }, 10000);
  });

  describe('Test-1.4.b: Server Error Retry with Backoff', () => {
    it('should retry 500 errors with exponential backoff (1s, 2s, 4s)', async () => {
      const serverError = {
        response: { status: 500 },
        message: 'Internal server error',
      };

      const attemptTimes: number[] = [];
      let attemptCount = 0;

      const operation = jest.fn().mockImplementation(() => {
        attemptTimes.push(Date.now());
        attemptCount++;

        if (attemptCount <= 3) {
          return Promise.reject(serverError);
        }
        return Promise.resolve({ data: 'recovered' });
      });

      const result = await retryStrategy.executeWithRetry(operation);

      expect(result).toEqual({ data: 'recovered' });
      expect(operation).toHaveBeenCalledTimes(4);

      // Verify backoff delays (with tolerance)
      const delays = [];
      for (let i = 1; i < attemptTimes.length; i++) {
        delays.push(attemptTimes[i] - attemptTimes[i - 1]);
      }

      expect(delays[0]).toBeGreaterThanOrEqual(900); // ~1s
      expect(delays[0]).toBeLessThan(1500);

      expect(delays[1]).toBeGreaterThanOrEqual(1900); // ~2s
      expect(delays[1]).toBeLessThan(2500);

      expect(delays[2]).toBeGreaterThanOrEqual(3900); // ~4s
      expect(delays[2]).toBeLessThan(4500);
    }, 15000);
  });

  describe('Test-1.4.c: Auth Errors No Retry', () => {
    it('should return 401 errors immediately without retry', async () => {
      const authError = {
        response: { status: 401 },
        message: 'Bad credentials',
      };

      const operation = jest.fn().mockRejectedValue(authError);

      const startTime = Date.now();

      try {
        await retryStrategy.executeWithRetry(operation);
        fail('Should have thrown error');
      } catch (error: any) {
        const elapsed = Date.now() - startTime;

        expect(error.details.type).toBe(GitHubErrorType.AUTH);
        expect(error.details.status_code).toBe(401);
        expect(operation).toHaveBeenCalledTimes(1);
        expect(elapsed).toBeLessThan(100); // Should fail immediately
      }
    });

    it('should return 403 errors immediately without retry', async () => {
      const forbiddenError = {
        response: { status: 403 },
        message: 'Insufficient permissions',
      };

      const operation = jest.fn().mockRejectedValue(forbiddenError);

      try {
        await retryStrategy.executeWithRetry(operation);
        fail('Should have thrown error');
      } catch (error: any) {
        expect(error.details.type).toBe(GitHubErrorType.AUTH);
        expect(error.details.status_code).toBe(403);
        expect(operation).toHaveBeenCalledTimes(1);
      }
    });
  });

  describe('Test-1.4.d: Circuit Breaker Opens After Failures', () => {
    it('should open circuit and fast-fail after 5 consecutive failures', async () => {
      const serverError = {
        response: { status: 500 },
        message: 'Server error',
      };

      const operation = jest.fn().mockRejectedValue(serverError);

      // Execute 5 failing operations to open circuit
      for (let i = 0; i < 5; i++) {
        try {
          await retryStrategy.executeWithRetry(operation);
        } catch (e) {
          // Expected to fail
        }
      }

      // Verify circuit is open
      const stats = retryStrategy.getCircuitBreakerStats();
      expect(stats.state).toBe(CircuitBreakerState.OPEN);

      // Reset mock to verify next call doesn't execute
      operation.mockClear();

      // Next call should fast-fail without executing operation
      const fastFailStart = Date.now();
      try {
        await retryStrategy.executeWithRetry(operation);
        fail('Should have thrown');
      } catch (error: any) {
        const elapsed = Date.now() - fastFailStart;

        expect(error.details.type).toBe(GitHubErrorType.SERVICE_UNAVAILABLE);
        expect(operation).not.toHaveBeenCalled(); // Fast-fail
        expect(elapsed).toBeLessThan(100); // Should fail immediately
      }
    }, 30000);
  });

  describe('Test-1.4.e: Circuit Breaker Half-Open and Closing', () => {
    it('should allow test request in half-open and close after 3 successes', async () => {
      const error = { response: { status: 500 }, message: 'Error' };
      const failOp = jest.fn().mockRejectedValue(error);

      // Open circuit with 5 failures
      for (let i = 0; i < 5; i++) {
        try {
          await retryStrategy.executeWithRetry(failOp);
        } catch (e) {
          // Expected
        }
      }

      expect(retryStrategy.getCircuitBreakerStats().state).toBe(
        CircuitBreakerState.OPEN,
      );

      // Simulate 30s passing by manipulating next_attempt_time
      (circuitBreaker as any).nextAttemptTime = Date.now() - 1000;

      // Create successful operation
      const successOp = jest.fn().mockResolvedValue({ data: 'ok' });

      // First success should transition to half-open
      await retryStrategy.executeWithRetry(successOp);
      expect(retryStrategy.getCircuitBreakerStats().state).toBe(
        CircuitBreakerState.HALF_OPEN,
      );

      // Two more successes should close circuit
      await retryStrategy.executeWithRetry(successOp);
      expect(retryStrategy.getCircuitBreakerStats().state).toBe(
        CircuitBreakerState.HALF_OPEN,
      );

      await retryStrategy.executeWithRetry(successOp);
      expect(retryStrategy.getCircuitBreakerStats().state).toBe(
        CircuitBreakerState.CLOSED,
      );

      // Verify total of 3 successful calls in half-open state
      expect(successOp).toHaveBeenCalledTimes(3);
    }, 30000);

    it('should reopen circuit on failure in half-open state', async () => {
      const error = { response: { status: 500 }, message: 'Error' };
      const failOp = jest.fn().mockRejectedValue(error);

      // Open circuit
      for (let i = 0; i < 5; i++) {
        try {
          await retryStrategy.executeWithRetry(failOp);
        } catch (e) {
          // Expected
        }
      }

      // Transition to half-open
      (circuitBreaker as any).nextAttemptTime = Date.now() - 1000;

      // Failure should immediately reopen
      try {
        await retryStrategy.executeWithRetry(failOp);
      } catch (e) {
        // Expected
      }

      expect(retryStrategy.getCircuitBreakerStats().state).toBe(
        CircuitBreakerState.OPEN,
      );
    }, 30000);
  });

  describe('Test-1.4.f: User-Friendly Error Messages', () => {
    it('should provide actionable message for rate limit errors', async () => {
      // Use a reset time in the past to avoid waiting
      const resetTime = Math.floor(Date.now() / 1000) - 10;
      const error = {
        response: {
          status: 429,
          headers: { 'x-ratelimit-reset': resetTime.toString() },
        },
        message: 'Rate limited',
      };

      let callCount = 0;
      const operation = jest.fn().mockImplementation(() => {
        callCount++;
        // Fail twice to exhaust the single retry allowed for rate limits
        if (callCount <= 2) {
          return Promise.reject(error);
        }
        return Promise.resolve('success');
      });

      try {
        await retryStrategy.executeWithRetry(operation);
      } catch (e: any) {
        expect(e.details.user_message).toContain('rate limit');
        expect(e.details.user_message).toContain('wait');
        expect(e.details.user_message).toContain('try again');
      }
    });

    it('should provide actionable message for auth errors', async () => {
      const error = {
        response: { status: 401 },
        message: 'Unauthorized',
      };

      const operation = jest.fn().mockRejectedValue(error);

      try {
        await retryStrategy.executeWithRetry(operation);
      } catch (e: any) {
        expect(e.details.user_message).toContain('authentication');
        expect(e.details.user_message).toContain('token');
        expect(e.details.user_message).toContain('valid');
      }
    });

    it('should provide actionable message for validation errors', async () => {
      const error = {
        response: { status: 400 },
        message: 'Invalid input',
      };

      const operation = jest.fn().mockRejectedValue(error);

      try {
        await retryStrategy.executeWithRetry(operation);
      } catch (e: any) {
        expect(e.details.user_message).toContain('Invalid request');
        expect(e.details.user_message).toContain('check');
        expect(e.details.user_message).toContain('parameters');
      }
    });

    it('should provide remediation steps for server errors', async () => {
      const error = {
        response: { status: 500 },
        message: 'Server error',
      };

      const operation = jest.fn().mockRejectedValue(error);

      try {
        await retryStrategy.executeWithRetry(operation);
      } catch (e: any) {
        expect(e.details.user_message).toContain('technical difficulties');
        expect(e.details.user_message).toContain('automatically retry');
      }
    }, 15000);

    it('should provide wait time for circuit breaker errors', async () => {
      const error = { response: { status: 500 }, message: 'Error' };
      const operation = jest.fn().mockRejectedValue(error);

      // Open circuit
      for (let i = 0; i < 5; i++) {
        try {
          await retryStrategy.executeWithRetry(operation);
        } catch (e) {
          // Expected
        }
      }

      try {
        await retryStrategy.executeWithRetry(operation);
      } catch (e: any) {
        expect(e.details.user_message).toContain('temporarily unavailable');
        expect(e.details.user_message).toContain('seconds');
        expect(e.details.user_message).toContain('try again');
      }
    }, 30000);
  });

  describe('End-to-End Error Recovery Scenarios', () => {
    it('should recover from transient server errors', async () => {
      let callCount = 0;
      const operation = jest.fn().mockImplementation(() => {
        callCount++;
        if (callCount <= 2) {
          return Promise.reject({
            response: { status: 502 },
            message: 'Bad gateway',
          });
        }
        return Promise.resolve({ success: true });
      });

      const result = await retryStrategy.executeWithRetry(operation);

      expect(result).toEqual({ success: true });
      expect(callCount).toBe(3); // 2 failures + 1 success
    }, 10000);

    it('should track complete retry history', async () => {
      const error = { response: { status: 503 }, message: 'Unavailable' };
      const operation = jest.fn().mockRejectedValue(error);

      try {
        await retryStrategy.executeWithRetry(operation, {
          operation_type: 'test_operation',
          user_id: 'test-user-123',
        });
      } catch (e: any) {
        expect(e.details.retry_history).toBeDefined();
        expect(e.details.retry_history.length).toBe(4); // Initial + 3 retries

        // Verify each retry entry
        e.details.retry_history.forEach((entry: any, idx: number) => {
          expect(entry.attempt).toBe(idx);
          expect(entry.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
          expect(entry.error).toBeDefined();
        });

        // Verify context was preserved
        expect(e.details.context).toEqual({
          operation_type: 'test_operation',
          user_id: 'test-user-123',
        });
      }
    }, 15000);
  });
});
