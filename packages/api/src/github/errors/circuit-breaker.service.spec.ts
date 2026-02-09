import { Test, TestingModule } from '@nestjs/testing';
import { CircuitBreakerService } from './circuit-breaker.service';
import { CircuitBreakerState } from './github-error.types';
import { GitHubServiceUnavailableException } from './github.exception';

describe('CircuitBreakerService', () => {
  let service: CircuitBreakerService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [CircuitBreakerService],
    }).compile();

    service = module.get<CircuitBreakerService>(CircuitBreakerService);
  });

  afterEach(() => {
    service.reset();
  });

  describe('Initial State', () => {
    it('should start in CLOSED state', () => {
      const stats = service.getStats();
      expect(stats.state).toBe(CircuitBreakerState.CLOSED);
      expect(stats.failure_count).toBe(0);
      expect(stats.success_count).toBe(0);
    });

    it('should allow requests in CLOSED state', () => {
      expect(() => service.checkState()).not.toThrow();
    });
  });

  describe('AC-1.4.d: Opening Circuit Breaker', () => {
    it('should open circuit after 5 consecutive failures', () => {
      // Record 4 failures - should stay closed
      for (let i = 0; i < 4; i++) {
        service.recordFailure();
        const stats = service.getStats();
        expect(stats.state).toBe(CircuitBreakerState.CLOSED);
      }

      // 5th failure should open circuit
      service.recordFailure();
      const stats = service.getStats();
      expect(stats.state).toBe(CircuitBreakerState.OPEN);
      expect(stats.failure_count).toBe(5);
    });

    it('should fast-fail when circuit is OPEN', () => {
      // Open circuit with 5 failures
      for (let i = 0; i < 5; i++) {
        service.recordFailure();
      }

      // Subsequent requests should throw immediately
      expect(() => service.checkState()).toThrow(
        GitHubServiceUnavailableException,
      );
    });

    it('should include wait time in exception message', () => {
      // Open circuit
      for (let i = 0; i < 5; i++) {
        service.recordFailure();
      }

      try {
        service.checkState();
        fail('Should have thrown exception');
      } catch (error: any) {
        expect(error).toBeInstanceOf(GitHubServiceUnavailableException);
        expect(error.details.user_message).toContain('seconds');
        expect(error.details.user_message).toContain('temporarily unavailable');
      }
    });

    it('should set next_attempt_time 30 seconds in future', () => {
      const beforeOpen = Date.now();

      // Open circuit
      for (let i = 0; i < 5; i++) {
        service.recordFailure();
      }

      const stats = service.getStats();
      const afterOpen = Date.now();

      expect(stats.next_attempt_time).toBeDefined();
      expect(stats.next_attempt_time!).toBeGreaterThanOrEqual(
        beforeOpen + 30000,
      );
      expect(stats.next_attempt_time!).toBeLessThanOrEqual(afterOpen + 30000);
    });
  });

  describe('AC-1.4.e: Half-Open State', () => {
    it('should transition to HALF_OPEN after 30 seconds', async () => {
      // Open circuit
      for (let i = 0; i < 5; i++) {
        service.recordFailure();
      }

      expect(service.getStats().state).toBe(CircuitBreakerState.OPEN);

      // Manually set next_attempt_time to past (simulate time passing)
      const stats = service.getStats();
      (service as any).nextAttemptTime = Date.now() - 1000;

      // Next check should transition to half-open
      expect(() => service.checkState()).not.toThrow();
      expect(service.getStats().state).toBe(CircuitBreakerState.HALF_OPEN);
    });

    it('should allow test request in HALF_OPEN state', () => {
      // Force to half-open state
      for (let i = 0; i < 5; i++) {
        service.recordFailure();
      }
      (service as any).nextAttemptTime = Date.now() - 1000;
      service.checkState(); // Transition to half-open

      // Should allow request
      expect(() => service.checkState()).not.toThrow();
    });

    it('should close circuit after 3 consecutive successes', () => {
      // Force to half-open state
      for (let i = 0; i < 5; i++) {
        service.recordFailure();
      }
      (service as any).nextAttemptTime = Date.now() - 1000;
      service.checkState();

      expect(service.getStats().state).toBe(CircuitBreakerState.HALF_OPEN);

      // Record 2 successes - should stay half-open
      service.recordSuccess();
      service.recordSuccess();
      expect(service.getStats().state).toBe(CircuitBreakerState.HALF_OPEN);

      // 3rd success should close circuit
      service.recordSuccess();
      expect(service.getStats().state).toBe(CircuitBreakerState.CLOSED);
      expect(service.getStats().success_count).toBe(0); // Reset after closing
    });

    it('should reopen circuit on failure in HALF_OPEN state', () => {
      // Force to half-open state
      for (let i = 0; i < 5; i++) {
        service.recordFailure();
      }
      (service as any).nextAttemptTime = Date.now() - 1000;
      service.checkState();

      expect(service.getStats().state).toBe(CircuitBreakerState.HALF_OPEN);

      // Record success then failure
      service.recordSuccess();
      service.recordFailure();

      // Should immediately reopen
      expect(service.getStats().state).toBe(CircuitBreakerState.OPEN);
    });
  });

  describe('Success Tracking', () => {
    it('should reset failure count on success in CLOSED state', () => {
      // Record some failures
      service.recordFailure();
      service.recordFailure();
      expect(service.getStats().failure_count).toBe(2);

      // Success should reset counter
      service.recordSuccess();
      expect(service.getStats().failure_count).toBe(0);
    });
  });

  describe('Reset Functionality', () => {
    it('should reset all state to initial values', () => {
      // Open circuit
      for (let i = 0; i < 5; i++) {
        service.recordFailure();
      }

      expect(service.getStats().state).toBe(CircuitBreakerState.OPEN);

      // Reset
      service.reset();

      const stats = service.getStats();
      expect(stats.state).toBe(CircuitBreakerState.CLOSED);
      expect(stats.failure_count).toBe(0);
      expect(stats.success_count).toBe(0);
      expect(stats.next_attempt_time).toBeUndefined();
    });
  });

  describe('Statistics', () => {
    it('should track failure count accurately', () => {
      service.recordFailure();
      expect(service.getStats().failure_count).toBe(1);

      service.recordFailure();
      expect(service.getStats().failure_count).toBe(2);
    });

    it('should track last failure time', () => {
      const before = Date.now();
      service.recordFailure();
      const after = Date.now();

      const stats = service.getStats();
      expect(stats.last_failure_time).toBeDefined();
      expect(stats.last_failure_time!).toBeGreaterThanOrEqual(before);
      expect(stats.last_failure_time!).toBeLessThanOrEqual(after);
    });

    it('should track state change time', () => {
      const before = Date.now();

      // Open circuit
      for (let i = 0; i < 5; i++) {
        service.recordFailure();
      }

      const after = Date.now();

      const stats = service.getStats();
      expect(stats.last_state_change).toBeDefined();
      expect(stats.last_state_change!).toBeGreaterThanOrEqual(before);
      expect(stats.last_state_change!).toBeLessThanOrEqual(after);
    });
  });
});
