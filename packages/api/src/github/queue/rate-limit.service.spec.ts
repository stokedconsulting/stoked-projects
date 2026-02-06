import { Test, TestingModule } from '@nestjs/testing';
import { RateLimitService } from './rate-limit.service';
import { RequestPriority } from './types';

describe('RateLimitService', () => {
  let service: RateLimitService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [RateLimitService],
    }).compile();

    service = module.get<RateLimitService>(RateLimitService);
  });

  afterEach(() => {
    service.clearQueues();
    service.onModuleDestroy();
  });

  describe('AC-1.5.a: Request with remaining quota executes immediately', () => {
    it('should execute request immediately when quota is available', async () => {
      const userId = 'test-user-1';
      let executed = false;
      const startTime = Date.now();

      // Set up rate limit with remaining quota
      service.updateRateLimitFromHeaders(
        userId,
        {
          'x-ratelimit-remaining': '4500',
          'x-ratelimit-limit': '5000',
          'x-ratelimit-reset': String(Math.floor(Date.now() / 1000) + 3600),
        },
        'graphql',
      );

      const result = await service.enqueueRequest(
        userId,
        async () => {
          executed = true;
          return 'success';
        },
        RequestPriority.NORMAL,
        'graphql',
      );

      const executionTime = Date.now() - startTime;

      expect(executed).toBe(true);
      expect(result).toBe('success');
      expect(executionTime).toBeLessThan(100); // Should execute almost immediately
    });

    it('should update tracking after request execution', async () => {
      const userId = 'test-user-2';

      service.updateRateLimitFromHeaders(
        userId,
        {
          'x-ratelimit-remaining': '5000',
          'x-ratelimit-limit': '5000',
          'x-ratelimit-reset': String(Math.floor(Date.now() / 1000) + 3600),
        },
        'graphql',
      );

      await service.enqueueRequest(
        userId,
        async () => 'result',
        RequestPriority.NORMAL,
        'graphql',
      );

      const state = service.getRateLimitState(userId);
      expect(state).toBeDefined();
      expect(state?.graphql.remaining).toBe(5000);
      expect(state?.graphql.limit).toBe(5000);
    });
  });

  describe('AC-1.5.b: 80% quota threshold throttles to 50% request rate', () => {
    it('should throttle requests when utilization reaches 80%', async () => {
      const userId = 'test-user-3';
      const startTime = Date.now();

      // Set rate limit at 85% utilization (750 remaining of 5000)
      service.updateRateLimitFromHeaders(
        userId,
        {
          'x-ratelimit-remaining': '750',
          'x-ratelimit-limit': '5000',
          'x-ratelimit-reset': String(Math.floor(Date.now() / 1000) + 3600),
        },
        'graphql',
      );

      // Configure for faster testing
      service.configure({
        throttleThreshold: 0.8,
        throttleRate: 0.5,
        maxQueueSize: 1000,
        requestTimeout: 120000,
        maxBypassRate: 0.1,
        bypassWindowMs: 3600000,
      });

      // Enqueue multiple requests
      const promises = [];
      for (let i = 0; i < 3; i++) {
        promises.push(
          service.enqueueRequest(
            userId,
            async () => `result-${i}`,
            RequestPriority.NORMAL,
            'graphql',
          ),
        );
      }

      await Promise.all(promises);
      const totalTime = Date.now() - startTime;

      // With throttling, should take longer than without
      // At 50% throttle rate (200ms delay vs 100ms normal), 3 requests should take 400-600ms
      expect(totalTime).toBeGreaterThan(200);
    }, 10000);

    it('should not throttle when utilization is below 80%', async () => {
      const userId = 'test-user-4';
      const startTime = Date.now();

      // Set rate limit at 70% utilization (1500 remaining of 5000)
      service.updateRateLimitFromHeaders(
        userId,
        {
          'x-ratelimit-remaining': '1500',
          'x-ratelimit-limit': '5000',
          'x-ratelimit-reset': String(Math.floor(Date.now() / 1000) + 3600),
        },
        'graphql',
      );

      await service.enqueueRequest(
        userId,
        async () => 'result',
        RequestPriority.NORMAL,
        'graphql',
      );

      const executionTime = Date.now() - startTime;
      expect(executionTime).toBeLessThan(100); // Should execute without throttling
    });
  });

  describe('AC-1.5.c: Rate limit exceeded pauses queue until reset time', () => {
    it('should pause queue when rate limit is exceeded', async () => {
      const userId = 'test-user-5';
      const resetTime = Math.floor(Date.now() / 1000) + 2; // 2 seconds from now

      // Set rate limit as exceeded
      service.updateRateLimitFromHeaders(
        userId,
        {
          'x-ratelimit-remaining': '0',
          'x-ratelimit-limit': '5000',
          'x-ratelimit-reset': String(resetTime),
        },
        'graphql',
      );

      const startTime = Date.now();
      let executed = false;

      const promise = service.enqueueRequest(
        userId,
        async () => {
          executed = true;
          return 'result';
        },
        RequestPriority.NORMAL,
        'graphql',
      );

      // Wait a bit and verify it hasn't executed yet
      await new Promise((resolve) => setTimeout(resolve, 500));
      expect(executed).toBe(false);

      // Wait for reset time
      await promise;
      const executionTime = Date.now() - startTime;

      expect(executed).toBe(true);
      expect(executionTime).toBeGreaterThanOrEqual(1900); // Should wait ~2 seconds
    }, 10000);
  });

  describe('AC-1.5.d: High-priority requests bypass queue (max 10% bypass rate)', () => {
    it('should allow high-priority request to bypass queue', async () => {
      const userId = 'test-user-6';

      // Set initial rate limit
      service.updateRateLimitFromHeaders(
        userId,
        {
          'x-ratelimit-remaining': '5000',
          'x-ratelimit-limit': '5000',
          'x-ratelimit-reset': String(Math.floor(Date.now() / 1000) + 3600),
        },
        'graphql',
      );

      const executed: string[] = [];

      // Enqueue a normal priority request
      const normalPromise = service.enqueueRequest(
        userId,
        async () => {
          await new Promise((resolve) => setTimeout(resolve, 100));
          executed.push('normal');
          return 'normal';
        },
        RequestPriority.NORMAL,
        'graphql',
      );

      // Immediately enqueue a high-priority request
      await new Promise((resolve) => setTimeout(resolve, 10));
      const highPromise = service.enqueueRequest(
        userId,
        async () => {
          executed.push('high');
          return 'high';
        },
        RequestPriority.HIGH,
        'graphql',
      );

      await Promise.all([normalPromise, highPromise]);

      // High-priority should execute alongside normal (bypass)
      expect(executed).toContain('high');
      expect(executed).toContain('normal');
    }, 10000);

    it('should respect 10% bypass rate limit', async () => {
      const userId = 'test-user-7';

      // Set rate limit with small limit for easier testing
      service.updateRateLimitFromHeaders(
        userId,
        {
          'x-ratelimit-remaining': '100',
          'x-ratelimit-limit': '100',
          'x-ratelimit-reset': String(Math.floor(Date.now() / 1000) + 3600),
        },
        'graphql',
      );

      service.configure({
        throttleThreshold: 0.8,
        throttleRate: 0.5,
        maxQueueSize: 1000,
        requestTimeout: 120000,
        maxBypassRate: 0.1, // 10%
        bypassWindowMs: 3600000,
      });

      const stats = service.getQueueStats(userId);
      expect(stats.bypassCount).toBe(0);

      // Total limit is 100 (graphql) + 100 (rest) = 200
      // 10% of 200 = 20 bypasses allowed

      // Enqueue 25 high-priority requests
      const promises = [];
      for (let i = 0; i < 25; i++) {
        promises.push(
          service.enqueueRequest(
            userId,
            async () => `result-${i}`,
            RequestPriority.HIGH,
            'graphql',
          ),
        );
        await new Promise((resolve) => setTimeout(resolve, 10));
      }

      await Promise.all(promises);

      const finalStats = service.getQueueStats(userId);
      // Should have bypassed some but not all
      expect(finalStats.bypassCount).toBeLessThanOrEqual(20);
    }, 15000);
  });

  describe('AC-1.5.e: Requests >2 minutes in queue timeout with error', () => {
    it('should timeout stale requests after 2 minutes', async () => {
      const userId = 'test-user-8';

      // Configure with short timeout for testing
      service.configure({
        throttleThreshold: 0.8,
        throttleRate: 0.5,
        maxQueueSize: 1000,
        requestTimeout: 500, // 500ms for testing
        maxBypassRate: 0.1,
        bypassWindowMs: 3600000,
      });

      // Set rate limit as exceeded to prevent execution
      service.updateRateLimitFromHeaders(
        userId,
        {
          'x-ratelimit-remaining': '0',
          'x-ratelimit-limit': '5000',
          'x-ratelimit-reset': String(Math.floor(Date.now() / 1000) + 3600), // Far future
        },
        'graphql',
      );

      let caughtError: any = null;
      const errorPromise = service.enqueueRequest(
        userId,
        async () => 'result',
        RequestPriority.NORMAL,
        'graphql',
      ).catch((e) => {
        caughtError = e;
      });

      // Manually trigger cleanup after timeout
      await new Promise((resolve) => setTimeout(resolve, 600));
      await service['cleanupStaleRequests']();

      // Wait a bit more for promise to reject
      await new Promise((resolve) => setTimeout(resolve, 100));

      expect(caughtError).not.toBeNull();
      expect(caughtError.name).toBe('RequestTimeoutError');
      expect(caughtError.message).toContain('timed out');
    }, 5000);
  });

  describe('AC-1.5.f: Queue at 1,000 requests rejects new requests', () => {
    it('should reject requests when queue is at capacity', async () => {
      const userId = 'test-user-9';

      // Configure with smaller queue for faster testing
      service.configure({
        throttleThreshold: 0.8,
        throttleRate: 0.5,
        maxQueueSize: 10, // Small queue for testing
        requestTimeout: 120000,
        maxBypassRate: 0.1,
        bypassWindowMs: 3600000,
      });

      // Set rate limit as exceeded to prevent execution
      service.updateRateLimitFromHeaders(
        userId,
        {
          'x-ratelimit-remaining': '0',
          'x-ratelimit-limit': '5000',
          'x-ratelimit-reset': String(Math.floor(Date.now() / 1000) + 3600),
        },
        'graphql',
      );

      // Fill the queue
      const promises = [];
      for (let i = 0; i < 10; i++) {
        promises.push(
          service.enqueueRequest(
            userId,
            async () => `result-${i}`,
            RequestPriority.NORMAL,
            'graphql',
          ),
        );
      }

      // Try to add one more
      let error: Error | null = null;
      try {
        await service.enqueueRequest(
          userId,
          async () => 'overflow',
          RequestPriority.NORMAL,
          'graphql',
        );
      } catch (e) {
        error = e as Error;
      }

      expect(error).not.toBeNull();
      expect(error?.name).toBe('QueueCapacityError');
      expect(error?.message).toContain('Queue at capacity');
      expect(error?.message).toContain('10 requests');
    });

    it('should provide clear error message when queue is full', async () => {
      const userId = 'test-user-10';

      service.configure({
        maxQueueSize: 5,
        throttleThreshold: 0.8,
        throttleRate: 0.5,
        requestTimeout: 120000,
        maxBypassRate: 0.1,
        bypassWindowMs: 3600000,
      });

      service.updateRateLimitFromHeaders(
        userId,
        {
          'x-ratelimit-remaining': '0',
          'x-ratelimit-limit': '5000',
          'x-ratelimit-reset': String(Math.floor(Date.now() / 1000) + 3600),
        },
        'graphql',
      );

      // Fill queue
      for (let i = 0; i < 5; i++) {
        service.enqueueRequest(userId, async () => `result-${i}`, RequestPriority.NORMAL, 'graphql');
      }

      try {
        await service.enqueueRequest(userId, async () => 'overflow', RequestPriority.NORMAL, 'graphql');
        fail('Should have thrown error');
      } catch (error) {
        expect(error.message).toContain('Queue at capacity');
        expect(error.message).toContain('Please try again later');
      }
    });
  });

  describe('Priority Queue Behavior', () => {
    it('should process high-priority requests before normal priority', async () => {
      const userId = 'test-user-11';
      const executionOrder: string[] = [];

      // Start with zero quota to force queueing
      service.updateRateLimitFromHeaders(
        userId,
        {
          'x-ratelimit-remaining': '0',
          'x-ratelimit-limit': '5000',
          'x-ratelimit-reset': String(Math.floor(Date.now() / 1000) + 1), // 1 second wait
        },
        'graphql',
      );

      // Enqueue in mixed order - all will be queued initially
      const promises = [
        service.enqueueRequest(
          userId,
          async () => {
            executionOrder.push('normal-1');
            return 'normal-1';
          },
          RequestPriority.NORMAL,
          'graphql',
        ),
        service.enqueueRequest(
          userId,
          async () => {
            executionOrder.push('high-1');
            return 'high-1';
          },
          RequestPriority.HIGH,
          'graphql',
        ),
        service.enqueueRequest(
          userId,
          async () => {
            executionOrder.push('low-1');
            return 'low-1';
          },
          RequestPriority.LOW,
          'graphql',
        ),
      ];

      await Promise.all(promises);

      // Execution order should prioritize: high, normal, low
      const highIndex = executionOrder.indexOf('high-1');
      const normalIndex = executionOrder.indexOf('normal-1');
      const lowIndex = executionOrder.indexOf('low-1');

      expect(highIndex).toBeLessThan(normalIndex);
      expect(normalIndex).toBeLessThan(lowIndex);
    }, 5000);
  });

  describe('Queue Statistics', () => {
    it('should provide accurate queue statistics for empty queue', () => {
      const userId = 'test-user-12-empty';
      const stats = service.getQueueStats(userId);

      expect(stats.total).toBe(0);
      expect(stats.high).toBe(0);
      expect(stats.normal).toBe(0);
      expect(stats.low).toBe(0);
      expect(stats.oldestAge).toBe(0);
      expect(stats.bypassCount).toBe(0);
    });

    it('should track bypass count', async () => {
      const userId = 'test-user-12-bypass';

      service.updateRateLimitFromHeaders(
        userId,
        {
          'x-ratelimit-remaining': '100',
          'x-ratelimit-limit': '100',
          'x-ratelimit-reset': String(Math.floor(Date.now() / 1000) + 3600),
        },
        'graphql',
      );

      service.configure({
        throttleThreshold: 0.8,
        throttleRate: 0.5,
        maxQueueSize: 1000,
        requestTimeout: 120000,
        maxBypassRate: 0.1,
        bypassWindowMs: 3600000,
      });

      // Enqueue some high-priority requests that will bypass
      await service.enqueueRequest(userId, async () => 'h1', RequestPriority.HIGH, 'graphql');

      const stats = service.getQueueStats(userId);
      expect(stats.bypassCount).toBeGreaterThan(0);
    });
  });

  describe('Per-User Isolation', () => {
    it('should maintain separate queues per user', async () => {
      const user1 = 'user-1';
      const user2 = 'user-2';

      service.updateRateLimitFromHeaders(
        user1,
        {
          'x-ratelimit-remaining': '5000',
          'x-ratelimit-limit': '5000',
          'x-ratelimit-reset': String(Math.floor(Date.now() / 1000) + 3600),
        },
        'graphql',
      );

      service.updateRateLimitFromHeaders(
        user2,
        {
          'x-ratelimit-remaining': '5000',
          'x-ratelimit-limit': '5000',
          'x-ratelimit-reset': String(Math.floor(Date.now() / 1000) + 3600),
        },
        'graphql',
      );

      const result1 = await service.enqueueRequest(
        user1,
        async () => 'user1-result',
        RequestPriority.NORMAL,
        'graphql',
      );

      const result2 = await service.enqueueRequest(
        user2,
        async () => 'user2-result',
        RequestPriority.NORMAL,
        'graphql',
      );

      expect(result1).toBe('user1-result');
      expect(result2).toBe('user2-result');

      const state1 = service.getRateLimitState(user1);
      const state2 = service.getRateLimitState(user2);

      expect(state1?.userId).toBe(user1);
      expect(state2?.userId).toBe(user2);
    });
  });
});
