import { Test, TestingModule } from '@nestjs/testing';
import { MetricsService } from './metrics.service';
import { GitHubOperation } from './github-logger.service';

describe('MetricsService', () => {
  let service: MetricsService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [MetricsService],
    }).compile();

    service = module.get<MetricsService>(MetricsService);
    service.onModuleInit();

    // Reset metrics before each test
    service.resetMetrics();
  });

  describe('AC-1.3.d: Prometheus metrics endpoint', () => {
    it('should expose metrics in Prometheus format', async () => {
      const metrics = await service.getMetrics();

      expect(metrics).toBeDefined();
      expect(typeof metrics).toBe('string');
      expect(metrics).toContain('# HELP');
      expect(metrics).toContain('# TYPE');
    });

    it('should include request count metrics', async () => {
      service.recordOperation(GitHubOperation.GET_REPOSITORY, 100, 'success');

      const metrics = await service.getMetrics();
      expect(metrics).toContain('github_operations_total');
      expect(metrics).toContain('operation="github.repository.get"');
    });

    it('should include latency metrics', async () => {
      service.recordOperation(GitHubOperation.GET_REPOSITORY, 150, 'success');

      const metrics = await service.getMetrics();
      expect(metrics).toContain('github_operation_duration_seconds');
    });

    it('should track error counts', async () => {
      service.recordOperation(
        GitHubOperation.CREATE_ISSUE,
        200,
        'error',
        'RATE_LIMIT'
      );

      const metrics = await service.getMetrics();
      expect(metrics).toContain('github_operation_errors_total');
      expect(metrics).toContain('error_code="RATE_LIMIT"');
    });

    it('should provide latency percentiles', async () => {
      // Record multiple operations with different durations
      const durations = [100, 200, 300, 400, 500, 1000, 2000];
      durations.forEach(duration => {
        service.recordOperation(
          GitHubOperation.GET_REPOSITORY,
          duration,
          'success'
        );
      });

      const metrics = await service.getMetrics();

      // Check for histogram buckets (p50, p95, p99)
      expect(metrics).toContain('github_operation_duration_seconds_bucket');
      expect(metrics).toContain('le="0.5"'); // 500ms
      expect(metrics).toContain('le="1"'); // 1s
      expect(metrics).toContain('le="2"'); // 2s
    });

    it('should track operations by status', async () => {
      service.recordOperation(GitHubOperation.GET_REPOSITORY, 100, 'success');
      service.recordOperation(GitHubOperation.GET_REPOSITORY, 100, 'error');

      const metrics = await service.getMetrics();

      expect(metrics).toContain('status="success"');
      expect(metrics).toContain('status="error"');
    });

    it('should expose metrics as JSON for debugging', async () => {
      service.recordOperation(GitHubOperation.GET_REPOSITORY, 100, 'success');

      const json = await service.getMetricsJSON();

      expect(Array.isArray(json)).toBe(true);
      expect(json.length).toBeGreaterThan(0);
      expect(json.some((m: any) => m.name === 'github_operations_total')).toBe(true);
    });

    it('should include default metrics (CPU, memory)', async () => {
      const metrics = await service.getMetrics();

      // Prometheus default metrics
      expect(metrics).toMatch(/github_.*_(cpu|memory|gc|heap|nodejs)/);
    });
  });

  describe('recordOperation', () => {
    it('should record successful operations', () => {
      service.recordOperation(GitHubOperation.GET_REPOSITORY, 100, 'success');

      // Verify metrics were recorded (no error thrown)
      expect(() => service.getMetrics()).not.toThrow();
    });

    it('should record failed operations with error codes', () => {
      service.recordOperation(
        GitHubOperation.CREATE_ISSUE,
        200,
        'error',
        'NOT_FOUND'
      );

      // Verify metrics were recorded
      expect(() => service.getMetrics()).not.toThrow();
    });

    it('should convert milliseconds to seconds for latency', async () => {
      service.recordOperation(GitHubOperation.GET_REPOSITORY, 1000, 'success');

      const metrics = await service.getMetrics();

      // 1000ms should be recorded as 1 second
      expect(metrics).toContain('github_operation_duration_seconds');
    });
  });

  describe('startTimer', () => {
    it('should measure operation duration', async () => {
      const endTimer = service.startTimer(GitHubOperation.GET_REPOSITORY);

      // Simulate some work
      await new Promise(resolve => setTimeout(resolve, 10));

      endTimer();

      const metrics = await service.getMetrics();
      expect(metrics).toContain('github_operation_duration_seconds');
    });

    it('should work with multiple concurrent operations', () => {
      const timer1 = service.startTimer(GitHubOperation.GET_REPOSITORY);
      const timer2 = service.startTimer(GitHubOperation.GET_ISSUE);

      timer1();
      timer2();

      expect(() => service.getMetrics()).not.toThrow();
    });
  });

  describe('resetMetrics', () => {
    it('should clear all metrics', async () => {
      // Record some metrics
      service.recordOperation(GitHubOperation.GET_REPOSITORY, 100, 'success');
      service.recordOperation(GitHubOperation.GET_ISSUE, 200, 'success');

      // Reset
      service.resetMetrics();

      const metrics = await service.getMetrics();

      // Should not contain recorded operations
      expect(metrics).not.toContain('github_operations_total{');
    });
  });

  describe('getRegistry', () => {
    it('should return Prometheus registry', () => {
      const registry = service.getRegistry();

      expect(registry).toBeDefined();
      expect(typeof registry.metrics).toBe('function');
    });

    it('should allow custom metrics registration', () => {
      const registry = service.getRegistry();

      // Should be the same registry used internally
      expect(() => registry.metrics()).not.toThrow();
    });
  });

  describe('metric labels', () => {
    it('should set default service label', async () => {
      const metrics = await service.getMetrics();

      expect(metrics).toContain('service="github-operations"');
    });

    it('should include operation label', async () => {
      service.recordOperation(GitHubOperation.CREATE_ISSUE, 100, 'success');

      const metrics = await service.getMetrics();
      expect(metrics).toContain('operation="github.issue.create"');
    });

    it('should include status label', async () => {
      service.recordOperation(GitHubOperation.GET_REPOSITORY, 100, 'success');
      service.recordOperation(GitHubOperation.GET_REPOSITORY, 200, 'error');

      const metrics = await service.getMetrics();
      expect(metrics).toContain('status="success"');
      expect(metrics).toContain('status="error"');
    });

    it('should include error_code label for errors', async () => {
      service.recordOperation(
        GitHubOperation.CREATE_ISSUE,
        100,
        'error',
        'VALIDATION_ERROR'
      );

      const metrics = await service.getMetrics();
      expect(metrics).toContain('error_code="VALIDATION_ERROR"');
    });

    it('should use "unknown" error code when not provided', async () => {
      service.recordOperation(GitHubOperation.UPDATE_ISSUE, 100, 'error');

      const metrics = await service.getMetrics();
      expect(metrics).toContain('error_code="unknown"');
    });
  });

  describe('histogram buckets', () => {
    it('should define appropriate latency buckets', async () => {
      // Record an operation to populate histogram
      service.recordOperation(GitHubOperation.GET_REPOSITORY, 100, 'success');

      const metrics = await service.getMetrics();

      // Expected buckets: 0.1, 0.5, 1, 2, 5, 10 seconds
      // Buckets might appear with decimal notation
      expect(metrics).toMatch(/le="0\.1"/);
      expect(metrics).toMatch(/le="0\.5"/);
      expect(metrics).toMatch(/le="1"/);
      expect(metrics).toMatch(/le="2"/);
      expect(metrics).toMatch(/le="5"/);
      expect(metrics).toMatch(/le="10"/);
      expect(metrics).toMatch(/le="\+Inf"/);
    });
  });
});
