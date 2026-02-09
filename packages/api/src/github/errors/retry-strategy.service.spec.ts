import { Test, TestingModule } from '@nestjs/testing';
import { RetryStrategyService } from './retry-strategy.service';
import { CircuitBreakerService } from './circuit-breaker.service';
import { ErrorCategorizationService } from './error-categorization.service';
import {
  GitHubRateLimitException,
  GitHubAuthException,
  GitHubServerException,
  GitHubServiceUnavailableException,
} from './github.exception';
import { CircuitBreakerState } from './github-error.types';

describe('RetryStrategyService', () => {
  let service: RetryStrategyService;
  let circuitBreaker: CircuitBreakerService;
  let errorCategorization: ErrorCategorizationService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RetryStrategyService,
        CircuitBreakerService,
        ErrorCategorizationService,
      ],
    }).compile();

    service = module.get<RetryStrategyService>(RetryStrategyService);
    circuitBreaker = module.get<CircuitBreakerService>(CircuitBreakerService);
    errorCategorization = module.get<ErrorCategorizationService>(
      ErrorCategorizationService,
    );
  });

  afterEach(() => {
    service.resetCircuitBreaker();
  });

  describe('Successful Operations', () => {
    it('should execute successful operation without retry', async () => {
      const operation = jest.fn().mockResolvedValue('success');

      const result = await service.executeWithRetry(operation);

      expect(result).toBe('success');
      expect(operation).toHaveBeenCalledTimes(1);
    });

    it('should record success in circuit breaker', async () => {
      const operation = jest.fn().mockResolvedValue('success');

      await service.executeWithRetry(operation);

      const stats = service.getCircuitBreakerStats();
      expect(stats.failure_count).toBe(0);
    });
  });

  describe('AC-1.4.a: Rate Limit Retry', () => {
    it('should wait until reset time and retry on 429', async () => {
      const resetTime = Math.floor(Date.now() / 1000) + 2; // 2 seconds from now
      const rateLimitError = {
        response: {
          status: 429,
          headers: { 'x-ratelimit-reset': resetTime.toString() },
        },
        message: 'Rate limit exceeded',
      };

      let callCount = 0;
      const operation = jest.fn().mockImplementation(() => {
        callCount++;
        if (callCount === 1) {
          return Promise.reject(rateLimitError);
        }
        return Promise.resolve('success after retry');
      });

      const startTime = Date.now();
      const result = await service.executeWithRetry(operation);
      const elapsedTime = Date.now() - startTime;

      expect(result).toBe('success after retry');
      expect(operation).toHaveBeenCalledTimes(2);
      // Should wait approximately until reset time (allow wider tolerance for timing variance)
      expect(elapsedTime).toBeGreaterThanOrEqual(1000);
      expect(elapsedTime).toBeLessThan(3000);
    }, 10000); // Increase timeout for this test
  });

  describe('AC-1.4.b: Server Error Retry with Exponential Backoff', () => {
    it('should retry 500 errors 3 times with exponential backoff', async () => {
      const serverError = {
        response: { status: 500 },
        message: 'Internal server error',
      };

      const callTimes: number[] = [];
      let callCount = 0;
      const operation = jest.fn().mockImplementation(() => {
        callTimes.push(Date.now());
        callCount++;
        if (callCount <= 3) {
          return Promise.reject(serverError);
        }
        return Promise.resolve('success after retries');
      });

      const result = await service.executeWithRetry(operation);

      expect(result).toBe('success after retries');
      expect(operation).toHaveBeenCalledTimes(4); // 1 initial + 3 retries

      // Verify exponential backoff delays (allow 200ms tolerance)
      if (callTimes.length >= 4) {
        const delay1 = callTimes[1] - callTimes[0];
        const delay2 = callTimes[2] - callTimes[1];
        const delay3 = callTimes[3] - callTimes[2];

        expect(delay1).toBeGreaterThanOrEqual(800); // ~1s
        expect(delay1).toBeLessThan(1500);

        expect(delay2).toBeGreaterThanOrEqual(1800); // ~2s
        expect(delay2).toBeLessThan(2500);

        expect(delay3).toBeGreaterThanOrEqual(3800); // ~4s
        expect(delay3).toBeLessThan(4500);
      }
    }, 15000); // Increase timeout for this test

    it('should fail after max retries exceeded', async () => {
      const serverError = {
        response: { status: 502 },
        message: 'Bad gateway',
      };

      const operation = jest.fn().mockRejectedValue(serverError);

      await expect(service.executeWithRetry(operation)).rejects.toThrow(
        GitHubServerException,
      );

      // 1 initial + 3 retries = 4 total calls
      expect(operation).toHaveBeenCalledTimes(4);
    }, 15000);
  });

  describe('AC-1.4.c: Auth Errors - No Retry', () => {
    it('should not retry 401 auth errors', async () => {
      const authError = {
        response: { status: 401 },
        message: 'Unauthorized',
      };

      const operation = jest.fn().mockRejectedValue(authError);

      await expect(service.executeWithRetry(operation)).rejects.toThrow(
        GitHubAuthException,
      );

      // Should only be called once (no retries)
      expect(operation).toHaveBeenCalledTimes(1);
    });

    it('should not retry 403 forbidden errors', async () => {
      const forbiddenError = {
        response: { status: 403 },
        message: 'Forbidden',
      };

      const operation = jest.fn().mockRejectedValue(forbiddenError);

      await expect(service.executeWithRetry(operation)).rejects.toThrow(
        GitHubAuthException,
      );

      expect(operation).toHaveBeenCalledTimes(1);
    });
  });

  describe('AC-1.4.d: Circuit Breaker Opening', () => {
    it('should open circuit breaker after 5 consecutive failures', async () => {
      const error = {
        response: { status: 500 },
        message: 'Server error',
      };

      const operation = jest.fn().mockRejectedValue(error);

      // Execute 5 failing operations
      for (let i = 0; i < 5; i++) {
        try {
          await service.executeWithRetry(operation);
        } catch (e) {
          // Expected to fail
        }
      }

      // Circuit should now be open
      const stats = service.getCircuitBreakerStats();
      expect(stats.state).toBe(CircuitBreakerState.OPEN);
    }, 30000);

    it('should fast-fail when circuit is open', async () => {
      const error = {
        response: { status: 500 },
        message: 'Server error',
      };

      const operation = jest.fn().mockRejectedValue(error);

      // Open the circuit
      for (let i = 0; i < 5; i++) {
        try {
          await service.executeWithRetry(operation);
        } catch (e) {
          // Expected
        }
      }

      // Reset call count
      operation.mockClear();

      // Next operation should fail immediately without calling the operation
      await expect(service.executeWithRetry(operation)).rejects.toThrow(
        GitHubServiceUnavailableException,
      );

      // Operation should not be called (circuit breaker fails fast)
      expect(operation).not.toHaveBeenCalled();
    }, 30000);
  });

  describe('AC-1.4.e: Circuit Breaker Half-Open and Closing', () => {
    it('should transition to half-open and close after successes', async () => {
      const error = {
        response: { status: 500 },
        message: 'Server error',
      };

      // Open circuit
      const failingOp = jest.fn().mockRejectedValue(error);
      for (let i = 0; i < 5; i++) {
        try {
          await service.executeWithRetry(failingOp);
        } catch (e) {
          // Expected
        }
      }

      expect(service.getCircuitBreakerStats().state).toBe(
        CircuitBreakerState.OPEN,
      );

      // Simulate time passing by directly manipulating circuit breaker
      (circuitBreaker as any).nextAttemptTime = Date.now() - 1000;

      // First successful operation should transition to half-open
      const successOp = jest.fn().mockResolvedValue('success');
      await service.executeWithRetry(successOp);

      expect(service.getCircuitBreakerStats().state).toBe(
        CircuitBreakerState.HALF_OPEN,
      );

      // Two more successes should close circuit
      await service.executeWithRetry(successOp);
      await service.executeWithRetry(successOp);

      expect(service.getCircuitBreakerStats().state).toBe(
        CircuitBreakerState.CLOSED,
      );
    }, 30000);

    it('should reopen circuit on failure in half-open state', async () => {
      // Open circuit
      const error = { response: { status: 500 }, message: 'Error' };
      const failingOp = jest.fn().mockRejectedValue(error);

      for (let i = 0; i < 5; i++) {
        try {
          await service.executeWithRetry(failingOp);
        } catch (e) {
          // Expected
        }
      }

      // Transition to half-open
      (circuitBreaker as any).nextAttemptTime = Date.now() - 1000;

      // Failing operation in half-open should reopen circuit
      try {
        await service.executeWithRetry(failingOp);
      } catch (e) {
        // Expected
      }

      expect(service.getCircuitBreakerStats().state).toBe(
        CircuitBreakerState.OPEN,
      );
    }, 30000);
  });

  describe('Retry History Tracking', () => {
    it('should track retry history in error details', async () => {
      const error = {
        response: { status: 502 },
        message: 'Bad gateway',
      };

      const operation = jest.fn().mockRejectedValue(error);

      try {
        await service.executeWithRetry(operation);
      } catch (e: any) {
        expect(e.details.retry_history).toBeDefined();
        expect(e.details.retry_history.length).toBe(4); // 1 initial + 3 retries

        // Verify history structure
        e.details.retry_history.forEach((entry: any, index: number) => {
          expect(entry.attempt).toBe(index);
          expect(entry.timestamp).toBeDefined();
          expect(entry.error).toBeDefined();
        });
      }
    }, 15000);
  });

  describe('Context Propagation', () => {
    it('should propagate context to error details', async () => {
      const error = {
        response: { status: 401 },
        message: 'Unauthorized',
      };

      const context = {
        operation_type: 'fetch_project',
        user_id: 'test-user',
      };

      const operation = jest.fn().mockRejectedValue(error);

      try {
        await service.executeWithRetry(operation, context);
      } catch (e: any) {
        expect(e.details.context).toEqual(context);
      }
    });
  });
});
