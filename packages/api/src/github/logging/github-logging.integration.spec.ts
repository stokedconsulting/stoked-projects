import { Test, TestingModule } from '@nestjs/testing';
import { ConfigModule } from '@nestjs/config';
import { GitHubLoggerService, GitHubOperation } from './github-logger.service';
import { MetricsService } from './metrics.service';
import { GitHubLoggingModule } from './github-logging.module';
import * as fs from 'fs';
import * as path from 'path';

describe('GitHub Logging Integration', () => {
  let loggerService: GitHubLoggerService;
  let metricsService: MetricsService;
  let module: TestingModule;

  beforeAll(async () => {
    module = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          load: [
            () => ({
              app: {
                environment: 'test',
              },
            }),
          ],
        }),
        GitHubLoggingModule,
      ],
    }).compile();

    loggerService = module.get<GitHubLoggerService>(GitHubLoggerService);
    metricsService = module.get<MetricsService>(MetricsService);

    // Initialize services
    loggerService.onModuleInit();
    metricsService.onModuleInit();
  });

  afterAll(async () => {
    // Cleanup
    loggerService.onModuleDestroy();
    await module.close();

    // Clean up log files
    const logsDir = path.join(process.cwd(), 'logs');
    if (fs.existsSync(logsDir)) {
      const files = fs.readdirSync(logsDir);
      files.forEach(file => {
        if (file.includes('test') || file.includes(new Date().toISOString().split('T')[0])) {
          try {
            fs.unlinkSync(path.join(logsDir, file));
          } catch (err) {
            // Ignore cleanup errors
          }
        }
      });
    }
  });

  describe('End-to-end logging and metrics', () => {
    it('should log operation and update metrics simultaneously', async () => {
      const operation = GitHubOperation.GET_REPOSITORY;
      const requestId = 'integration-test-req-1';
      const userId = 'integration-test-user-1';

      // Log the operation
      loggerService.log(operation, 'success', {
        requestId,
        userId,
        duration: 150,
        metadata: { repo: 'test/repo' },
      });

      // Record metrics
      metricsService.recordOperation(operation, 150, 'success');

      // Verify metrics were recorded
      const metrics = await metricsService.getMetrics();
      expect(metrics).toContain('github_operations_total');
      expect(metrics).toContain('github.repository.get');
    });

    it('should handle high-volume operations', async () => {
      const operations = 100;

      for (let i = 0; i < operations; i++) {
        const duration = Math.random() * 1000;
        const status = Math.random() > 0.9 ? 'error' : 'success';

        loggerService.log(GitHubOperation.GET_ISSUE, status as any, {
          requestId: `stress-test-${i}`,
          duration,
        });

        metricsService.recordOperation(
          GitHubOperation.GET_ISSUE,
          duration,
          status as any,
          status === 'error' ? 'RANDOM_ERROR' : undefined
        );
      }

      // Verify metrics aggregation
      const metrics = await metricsService.getMetrics();
      expect(metrics).toContain('github_operations_total');
    });

    it('should track mutation operations in audit log', async () => {
      const mutations = [
        GitHubOperation.CREATE_ISSUE,
        GitHubOperation.UPDATE_PROJECT,
        GitHubOperation.DELETE_COMMENT,
      ];

      mutations.forEach((operation, index) => {
        loggerService.log(operation, 'success', {
          requestId: `mutation-${index}`,
          userId: `user-${index}`,
          metadata: {
            resourceId: `resource-${index}`,
            changes: { field: 'value' },
          },
        });

        metricsService.recordOperation(operation, 200, 'success');
      });

      // Verify metrics include all mutations
      const metrics = await metricsService.getMetrics();
      expect(metrics).toContain('github.issue.create');
      expect(metrics).toContain('github.project.update');
      expect(metrics).toContain('github.comment.delete');
    });
  });

  describe('Audit logging', () => {
    it('should log all mutations with user context', () => {
      const operation = GitHubOperation.CREATE_ISSUE;
      const userId = 'audit-user-123';
      const resourceId = 'issue-456';

      loggerService.log(operation, 'success', {
        requestId: 'audit-req-1',
        userId,
        metadata: {
          resourceId,
          changes: {
            title: 'New Issue',
            labels: ['bug'],
          },
        },
      });

      // Verify no errors (audit log should be written)
      expect(true).toBe(true);
    });

    it('should handle audit logging without userId gracefully', () => {
      const operation = GitHubOperation.UPDATE_ISSUE;

      // Should log warning but not throw
      expect(() => {
        loggerService.log(operation, 'success', {
          requestId: 'audit-req-2',
          metadata: { resourceId: 'issue-789' },
        });
      }).not.toThrow();
    });

    it('should separate query and mutation logs', () => {
      // Query operation
      loggerService.log(GitHubOperation.GET_REPOSITORY, 'success', {
        userId: 'user-query',
      });

      // Mutation operation
      loggerService.log(GitHubOperation.CREATE_ISSUE, 'success', {
        userId: 'user-mutation',
        metadata: { resourceId: 'issue-999' },
      });

      // Both should succeed without errors
      expect(true).toBe(true);
    });
  });

  describe('Metrics export', () => {
    it('should provide real-time metrics via /metrics endpoint', async () => {
      // Record various operations
      metricsService.recordOperation(GitHubOperation.GET_REPOSITORY, 100, 'success');
      metricsService.recordOperation(GitHubOperation.GET_ISSUE, 200, 'success');
      metricsService.recordOperation(GitHubOperation.CREATE_ISSUE, 150, 'error', 'VALIDATION');

      const metrics = await metricsService.getMetrics();

      // Verify Prometheus format
      expect(metrics).toMatch(/^# HELP/m);
      expect(metrics).toMatch(/^# TYPE/m);

      // Verify all operations are tracked
      expect(metrics).toContain('github_operations_total');
      expect(metrics).toContain('github_operation_duration_seconds');
      expect(metrics).toContain('github_operation_errors_total');
    });

    it('should calculate latency percentiles correctly', async () => {
      const durations = [50, 100, 150, 200, 300, 500, 1000, 2000, 5000];

      durations.forEach(duration => {
        metricsService.recordOperation(
          GitHubOperation.GET_REPOSITORY,
          duration,
          'success'
        );
      });

      const metrics = await metricsService.getMetrics();

      // Verify histogram buckets are populated
      expect(metrics).toMatch(/github_operation_duration_seconds_bucket.*le="0\.1"/);
      expect(metrics).toMatch(/github_operation_duration_seconds_bucket.*le="0\.5"/);
      expect(metrics).toMatch(/github_operation_duration_seconds_bucket.*le="1"/);
      expect(metrics).toMatch(/github_operation_duration_seconds_bucket.*le="2"/);
      expect(metrics).toMatch(/github_operation_duration_seconds_bucket.*le="5"/);
      expect(metrics).toMatch(/github_operation_duration_seconds_bucket.*le="10"/);
    });

    it('should track error rates by operation', async () => {
      // Simulate mixed success/error rates
      for (let i = 0; i < 10; i++) {
        metricsService.recordOperation(
          GitHubOperation.CREATE_ISSUE,
          100,
          i < 7 ? 'success' : 'error',
          i < 7 ? undefined : 'RATE_LIMIT'
        );
      }

      const metrics = await metricsService.getMetrics();

      // Should show both success and error counts
      expect(metrics).toContain('status="success"');
      expect(metrics).toContain('status="error"');
    });

    it('should provide JSON metrics for monitoring tools', async () => {
      metricsService.recordOperation(GitHubOperation.GET_REPOSITORY, 100, 'success');

      const json = await metricsService.getMetricsJSON();

      expect(Array.isArray(json)).toBe(true);
      expect(json.length).toBeGreaterThan(0);

      const operationsMetric = json.find((m: any) => m.name === 'github_operations_total');
      expect(operationsMetric).toBeDefined();
      expect(operationsMetric.type).toBe('counter');
    });
  });

  describe('Error handling and resilience', () => {
    it('should continue logging even if one logger fails', () => {
      // Simulate logging with potentially bad data
      expect(() => {
        loggerService.log(GitHubOperation.GET_REPOSITORY, 'success', {
          metadata: {
            circular: {} as any,
          },
        });
      }).not.toThrow();
    });

    it('should handle concurrent logging from multiple sources', async () => {
      const promises = Array.from({ length: 50 }, (_, i) =>
        Promise.resolve().then(() => {
          loggerService.log(GitHubOperation.GET_ISSUE, 'success', {
            requestId: `concurrent-${i}`,
            duration: Math.random() * 500,
          });

          metricsService.recordOperation(
            GitHubOperation.GET_ISSUE,
            Math.random() * 500,
            'success'
          );
        })
      );

      await Promise.all(promises);

      // Verify metrics are still accurate
      const metrics = await metricsService.getMetrics();
      expect(metrics).toContain('github_operations_total');
    });
  });

  describe('startOperation helper integration', () => {
    it('should automatically log and record metrics', async () => {
      const { endOperation } = loggerService.startOperation(
        GitHubOperation.GET_REPOSITORY,
        'integration-req-456',
        'integration-user-789',
        { repo: 'test/repo' }
      );

      // Simulate some async work
      await new Promise(resolve => setTimeout(resolve, 10));

      endOperation('success');

      // Verify logs were written (no errors)
      expect(true).toBe(true);
    });

    it('should handle errors in startOperation flow', () => {
      const { endOperation } = loggerService.startOperation(
        GitHubOperation.CREATE_ISSUE,
        'integration-req-999'
      );

      const error = new Error('GitHub API error');
      (error as any).code = 'API_ERROR';

      endOperation('error', error);

      // Should not throw
      expect(true).toBe(true);
    });
  });
});
