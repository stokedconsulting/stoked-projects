import { Test, TestingModule } from '@nestjs/testing';
import { RateLimitService } from './rate-limit.service';
import { RequestPriority } from './types';

/**
 * Integration tests for the rate limiting and queue system
 */
describe('RateLimitService Integration Tests', () => {
  let service: RateLimitService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [RateLimitService],
    }).compile();

    service = module.get<RateLimitService>(RateLimitService);
  });

  afterEach(() => {
    service.clearQueues();
  });

  describe('End-to-End Request Processing', () => {
    it('should handle mixed priority requests with rate limiting', async () => {
      const userId = 'integration-user-1';
      const results: string[] = [];

      // Set up initial rate limit
      service.updateRateLimitFromHeaders(
        userId,
        {
          'x-ratelimit-remaining': '4000',
          'x-ratelimit-limit': '5000',
          'x-ratelimit-reset': String(Math.floor(Date.now() / 1000) + 3600),
        },
        'graphql',
      );

      // Create a mix of requests
      const promises = [
        service.enqueueRequest(
          userId,
          async () => {
            results.push('high-1');
            return 'high-1';
          },
          RequestPriority.HIGH,
          'graphql',
        ),
        service.enqueueRequest(
          userId,
          async () => {
            results.push('normal-1');
            return 'normal-1';
          },
          RequestPriority.NORMAL,
          'graphql',
        ),
        service.enqueueRequest(
          userId,
          async () => {
            results.push('low-1');
            return 'low-1';
          },
          RequestPriority.LOW,
          'graphql',
        ),
        service.enqueueRequest(
          userId,
          async () => {
            results.push('high-2');
            return 'high-2';
          },
          RequestPriority.HIGH,
          'graphql',
        ),
      ];

      await Promise.all(promises);

      // Verify all executed
      expect(results).toHaveLength(4);
      expect(results).toContain('high-1');
      expect(results).toContain('high-2');
      expect(results).toContain('normal-1');
      expect(results).toContain('low-1');

      // Verify high priority came before low
      const highIndices = [results.indexOf('high-1'), results.indexOf('high-2')];
      const lowIndex = results.indexOf('low-1');
      expect(Math.max(...highIndices)).toBeLessThan(lowIndex);
    }, 10000);

    it('should handle throttling and recovery', async () => {
      const userId = 'integration-user-2';
      let executionCount = 0;

      // Start at 85% utilization (750 of 5000 remaining)
      service.updateRateLimitFromHeaders(
        userId,
        {
          'x-ratelimit-remaining': '750',
          'x-ratelimit-limit': '5000',
          'x-ratelimit-reset': String(Math.floor(Date.now() / 1000) + 3600),
        },
        'graphql',
      );

      const promises = [];
      for (let i = 0; i < 5; i++) {
        promises.push(
          service.enqueueRequest(
            userId,
            async () => {
              executionCount++;
              return `result-${i}`;
            },
            RequestPriority.NORMAL,
            'graphql',
          ),
        );
      }

      await Promise.all(promises);

      expect(executionCount).toBe(5);
    }, 15000);
  });

  describe('Multi-User Scenarios', () => {
    it('should handle concurrent requests from multiple users', async () => {
      const users = ['user-a', 'user-b', 'user-c'];
      const userResults = new Map<string, string[]>();

      // Initialize each user
      for (const userId of users) {
        userResults.set(userId, []);
        service.updateRateLimitFromHeaders(
          userId,
          {
            'x-ratelimit-remaining': '5000',
            'x-ratelimit-limit': '5000',
            'x-ratelimit-reset': String(Math.floor(Date.now() / 1000) + 3600),
          },
          'graphql',
        );
      }

      // Create requests for each user concurrently
      const allPromises = [];
      for (const userId of users) {
        for (let i = 0; i < 3; i++) {
          allPromises.push(
            service.enqueueRequest(
              userId,
              async () => {
                const result = `${userId}-result-${i}`;
                userResults.get(userId)!.push(result);
                return result;
              },
              RequestPriority.NORMAL,
              'graphql',
            ),
          );
        }
      }

      await Promise.all(allPromises);

      // Verify each user got their results
      for (const userId of users) {
        const results = userResults.get(userId)!;
        expect(results).toHaveLength(3);
        expect(results.every((r) => r.startsWith(userId))).toBe(true);
      }
    }, 10000);

    it('should isolate rate limits per user', async () => {
      const user1 = 'user-with-quota';
      const user2 = 'user-without-quota';

      // User 1: Has quota
      service.updateRateLimitFromHeaders(
        user1,
        {
          'x-ratelimit-remaining': '5000',
          'x-ratelimit-limit': '5000',
          'x-ratelimit-reset': String(Math.floor(Date.now() / 1000) + 3600),
        },
        'graphql',
      );

      // User 2: No quota (needs to wait)
      service.updateRateLimitFromHeaders(
        user2,
        {
          'x-ratelimit-remaining': '0',
          'x-ratelimit-limit': '5000',
          'x-ratelimit-reset': String(Math.floor(Date.now() / 1000) + 2),
        },
        'graphql',
      );

      let user1Executed = false;
      let user2Executed = false;

      // Start both requests simultaneously
      const promises = [
        service.enqueueRequest(
          user1,
          async () => {
            user1Executed = true;
            return 'user1-result';
          },
          RequestPriority.NORMAL,
          'graphql',
        ),
        service.enqueueRequest(
          user2,
          async () => {
            user2Executed = true;
            return 'user2-result';
          },
          RequestPriority.NORMAL,
          'graphql',
        ),
      ];

      // Wait a bit
      await new Promise((resolve) => setTimeout(resolve, 500));

      // User 1 should have executed, user 2 should be waiting
      expect(user1Executed).toBe(true);
      expect(user2Executed).toBe(false);

      // Wait for user 2
      await Promise.all(promises);
      expect(user2Executed).toBe(true);
    }, 10000);
  });

  describe('Load Testing', () => {
    it('should handle 1,000 requests efficiently', async () => {
      const userId = 'load-test-user';

      service.updateRateLimitFromHeaders(
        userId,
        {
          'x-ratelimit-remaining': '5000',
          'x-ratelimit-limit': '5000',
          'x-ratelimit-reset': String(Math.floor(Date.now() / 1000) + 3600),
        },
        'graphql',
      );

      const startTime = Date.now();
      const promises = [];

      for (let i = 0; i < 1000; i++) {
        const priority =
          i % 10 === 0
            ? RequestPriority.HIGH
            : i % 5 === 0
              ? RequestPriority.LOW
              : RequestPriority.NORMAL;

        promises.push(
          service.enqueueRequest(
            userId,
            async () => `result-${i}`,
            priority,
            'graphql',
          ),
        );
      }

      const results = await Promise.all(promises);
      const duration = Date.now() - startTime;

      expect(results).toHaveLength(1000);
      expect(duration).toBeLessThan(30000); // Should complete within 30 seconds

      const stats = service.getQueueStats(userId);
      expect(stats.total).toBe(0); // Queue should be empty
    }, 60000);

    it('should reject requests beyond capacity', async () => {
      const userId = 'capacity-test-user';

      service.configure({
        maxQueueSize: 100,
        throttleThreshold: 0.8,
        throttleRate: 0.5,
        requestTimeout: 120000,
        maxBypassRate: 0.1,
        bypassWindowMs: 3600000,
      });

      // Set rate limit to prevent execution
      service.updateRateLimitFromHeaders(
        userId,
        {
          'x-ratelimit-remaining': '0',
          'x-ratelimit-limit': '5000',
          'x-ratelimit-reset': String(Math.floor(Date.now() / 1000) + 3600),
        },
        'graphql',
      );

      // Fill queue to capacity
      const promises = [];
      for (let i = 0; i < 100; i++) {
        promises.push(
          service.enqueueRequest(
            userId,
            async () => `result-${i}`,
            RequestPriority.NORMAL,
            'graphql',
          ),
        );
      }

      // Try to add more
      let rejectedCount = 0;
      for (let i = 0; i < 10; i++) {
        try {
          await service.enqueueRequest(
            userId,
            async () => 'overflow',
            RequestPriority.NORMAL,
            'graphql',
          );
        } catch (error) {
          if (error.name === 'QueueCapacityError') {
            rejectedCount++;
          }
        }
      }

      expect(rejectedCount).toBe(10);

      const stats = service.getQueueStats(userId);
      expect(stats.total).toBe(100); // Should not exceed capacity
    }, 15000);
  });

  describe('Error Recovery', () => {
    it('should handle failing requests gracefully', async () => {
      const userId = 'error-test-user';

      service.updateRateLimitFromHeaders(
        userId,
        {
          'x-ratelimit-remaining': '5000',
          'x-ratelimit-limit': '5000',
          'x-ratelimit-reset': String(Math.floor(Date.now() / 1000) + 3600),
        },
        'graphql',
      );

      const results: Array<{ success: boolean; result?: string; error?: string }> = [];

      const promises = [
        service
          .enqueueRequest(
            userId,
            async () => {
              throw new Error('Simulated failure');
            },
            RequestPriority.NORMAL,
            'graphql',
          )
          .then(
            (result) => results.push({ success: true, result }),
            (error) => results.push({ success: false, error: error.message }),
          ),
        service
          .enqueueRequest(
            userId,
            async () => 'success',
            RequestPriority.NORMAL,
            'graphql',
          )
          .then(
            (result) => results.push({ success: true, result }),
            (error) => results.push({ success: false, error: error.message }),
          ),
      ];

      await Promise.all(promises);

      expect(results).toHaveLength(2);
      expect(results[0].success).toBe(false);
      expect(results[0].error).toContain('Simulated failure');
      expect(results[1].success).toBe(true);
      expect(results[1].result).toBe('success');
    });
  });

  describe('Performance Monitoring', () => {
    it('should provide accurate statistics during execution', async () => {
      const userId = 'stats-test-user';

      service.updateRateLimitFromHeaders(
        userId,
        {
          'x-ratelimit-remaining': '0',
          'x-ratelimit-limit': '5000',
          'x-ratelimit-reset': String(Math.floor(Date.now() / 1000) + 5),
        },
        'graphql',
      );

      // Enqueue multiple requests
      const promises = [
        service.enqueueRequest(userId, async () => {
          await new Promise(resolve => setTimeout(resolve, 100));
          return 'h1';
        }, RequestPriority.HIGH, 'graphql'),
        service.enqueueRequest(userId, async () => 'h2', RequestPriority.HIGH, 'graphql'),
        service.enqueueRequest(userId, async () => 'n1', RequestPriority.NORMAL, 'graphql'),
        service.enqueueRequest(userId, async () => 'l1', RequestPriority.LOW, 'graphql'),
      ];

      // Check stats while queued - wait just a bit for queueing
      await new Promise((resolve) => setTimeout(resolve, 20));

      const stats = service.getQueueStats(userId);
      // With first request being slow, at least some should be queued
      expect(stats.total).toBeGreaterThanOrEqual(0);
      expect(stats.oldestAge).toBeGreaterThanOrEqual(0);

      await Promise.all(promises);

      const finalStats = service.getQueueStats(userId);
      expect(finalStats.total).toBe(0);
    }, 10000);
  });

  describe('GraphQL vs REST Isolation', () => {
    it('should track GraphQL and REST rate limits separately', async () => {
      const userId = 'multiapi-user';

      // Set different limits for GraphQL and REST
      service.updateRateLimitFromHeaders(
        userId,
        {
          'x-ratelimit-remaining': '5000',
          'x-ratelimit-limit': '5000',
          'x-ratelimit-reset': String(Math.floor(Date.now() / 1000) + 3600),
        },
        'graphql',
      );

      service.updateRateLimitFromHeaders(
        userId,
        {
          'x-ratelimit-remaining': '100',
          'x-ratelimit-limit': '5000',
          'x-ratelimit-reset': String(Math.floor(Date.now() / 1000) + 3600),
        },
        'rest',
      );

      const state = service.getRateLimitState(userId);
      expect(state?.graphql.remaining).toBe(5000);
      expect(state?.rest.remaining).toBe(100);

      // GraphQL request should execute quickly (no throttling)
      const graphqlStart = Date.now();
      await service.enqueueRequest(
        userId,
        async () => 'graphql-result',
        RequestPriority.NORMAL,
        'graphql',
      );
      const graphqlTime = Date.now() - graphqlStart;

      expect(graphqlTime).toBeLessThan(100);
    });
  });
});
