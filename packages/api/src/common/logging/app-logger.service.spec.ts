import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { AppLoggerService, LogLevel } from './app-logger.service';

describe('AppLoggerService', () => {
  let service: AppLoggerService;
  let configService: ConfigService;
  let consoleLogSpy: jest.SpyInstance;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AppLoggerService,
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string, defaultValue?: any) => {
              if (key === 'app.environment') {
                return 'test';
              }
              return defaultValue;
            }),
          },
        },
      ],
    }).compile();

    // Use resolve() for TRANSIENT scope providers
    service = await module.resolve<AppLoggerService>(AppLoggerService);
    configService = module.get<ConfigService>(ConfigService);

    // Spy on console.log to capture output
    consoleLogSpy = jest.spyOn(console, 'log').mockImplementation();
  });

  afterEach(() => {
    if (consoleLogSpy) {
      consoleLogSpy.mockRestore();
    }
  });

  describe('Basic Logging', () => {
    it('should be defined', () => {
      expect(service).toBeDefined();
    });

    it('should set context', () => {
      service.setContext('TestContext');
      service.log('Test message');

      expect(consoleLogSpy).toHaveBeenCalled();
      const logOutput = consoleLogSpy.mock.calls[0][0];
      expect(logOutput).toContain('TestContext');
    });

    it('should log INFO level messages', () => {
      service.log('Info message', { request_id: 'test-123' });

      expect(consoleLogSpy).toHaveBeenCalled();
      const logOutput = JSON.parse(consoleLogSpy.mock.calls[0][0]);
      expect(logOutput.level).toBe(LogLevel.INFO);
      expect(logOutput.message).toBe('Info message');
      expect(logOutput.context.request_id).toBe('test-123');
    });

    it('should log ERROR level messages', () => {
      const error = new Error('Test error');
      service.error('Error occurred', error.stack, { request_id: 'test-456' });

      expect(consoleLogSpy).toHaveBeenCalled();
      const logOutput = JSON.parse(consoleLogSpy.mock.calls[0][0]);
      expect(logOutput.level).toBe(LogLevel.ERROR);
      expect(logOutput.message).toBe('Error occurred');
      expect(logOutput.error).toBeDefined();
      expect(logOutput.error.stack).toBeDefined();
    });

    it('should log WARN level messages', () => {
      service.warn('Warning message', { session_id: 'session-789' });

      expect(consoleLogSpy).toHaveBeenCalled();
      const logOutput = JSON.parse(consoleLogSpy.mock.calls[0][0]);
      expect(logOutput.level).toBe(LogLevel.WARN);
      expect(logOutput.message).toBe('Warning message');
      expect(logOutput.context.session_id).toBe('session-789');
    });

    it('should include timestamp in log entries', () => {
      service.log('Test message');

      expect(consoleLogSpy).toHaveBeenCalled();
      const logOutput = JSON.parse(consoleLogSpy.mock.calls[0][0]);
      expect(logOutput.timestamp).toBeDefined();
      expect(new Date(logOutput.timestamp)).toBeInstanceOf(Date);
    });
  });

  describe('Session Event Logging', () => {
    it('should log session creation', () => {
      service.logSessionCreated('session-123', 'project-456', {
        machine_id: 'machine-789',
      });

      expect(consoleLogSpy).toHaveBeenCalled();
      const logOutput = JSON.parse(consoleLogSpy.mock.calls[0][0]);
      expect(logOutput.message).toBe('Session created');
      expect(logOutput.context.session_id).toBe('session-123');
      expect(logOutput.context.project_id).toBe('project-456');
      expect(logOutput.context.machine_id).toBe('machine-789');
      expect(logOutput.context.event).toBe('session.created');
    });

    it('should log session update', () => {
      const updates = { status: 'ACTIVE' };
      service.logSessionUpdated('session-123', updates, {
        project_id: 'project-456',
      });

      expect(consoleLogSpy).toHaveBeenCalled();
      const logOutput = JSON.parse(consoleLogSpy.mock.calls[0][0]);
      expect(logOutput.message).toBe('Session updated');
      expect(logOutput.context.session_id).toBe('session-123');
      expect(logOutput.context.updates).toEqual(updates);
      expect(logOutput.context.event).toBe('session.updated');
    });

    it('should log session completion', () => {
      service.logSessionCompleted('session-123', {
        project_id: 'project-456',
        duration_ms: 5000,
      });

      expect(consoleLogSpy).toHaveBeenCalled();
      const logOutput = JSON.parse(consoleLogSpy.mock.calls[0][0]);
      expect(logOutput.message).toBe('Session completed');
      expect(logOutput.context.session_id).toBe('session-123');
      expect(logOutput.context.event).toBe('session.completed');
      expect(logOutput.context.duration_ms).toBe(5000);
    });

    it('should log session failure', () => {
      service.logSessionFailed('session-123', 'Database connection lost', {
        project_id: 'project-456',
      });

      expect(consoleLogSpy).toHaveBeenCalled();
      const logOutput = JSON.parse(consoleLogSpy.mock.calls[0][0]);
      expect(logOutput.level).toBe(LogLevel.ERROR);
      expect(logOutput.message).toBe('Session failed');
      expect(logOutput.context.session_id).toBe('session-123');
      expect(logOutput.context.failure_reason).toBe('Database connection lost');
      expect(logOutput.context.event).toBe('session.failed');
    });
  });

  describe('Heartbeat Logging', () => {
    it('should log heartbeat events', () => {
      service.logHeartbeat('session-123', { project_id: 'project-456' });

      // In test mode, heartbeat logs should still be emitted
      expect(consoleLogSpy).toHaveBeenCalled();
      const logOutput = JSON.parse(consoleLogSpy.mock.calls[0][0]);
      expect(logOutput.message).toBe('Heartbeat received');
      expect(logOutput.context.session_id).toBe('session-123');
      expect(logOutput.context.event).toBe('heartbeat.received');
    });

    it('should log heartbeat failures', () => {
      service.logHeartbeatFailure('session-123', 'Session already completed', {
        project_id: 'project-456',
      });

      expect(consoleLogSpy).toHaveBeenCalled();
      const logOutput = JSON.parse(consoleLogSpy.mock.calls[0][0]);
      expect(logOutput.level).toBe(LogLevel.WARN);
      expect(logOutput.message).toBe('Heartbeat failed');
      expect(logOutput.context.failure_reason).toBe('Session already completed');
    });

    it('should log stalled sessions', () => {
      service.logStalledSession('session-123', 10, { project_id: 'project-456' });

      expect(consoleLogSpy).toHaveBeenCalled();
      const logOutput = JSON.parse(consoleLogSpy.mock.calls[0][0]);
      expect(logOutput.level).toBe(LogLevel.WARN);
      expect(logOutput.message).toBe('Session stalled');
      expect(logOutput.context.minutes_since_heartbeat).toBe(10);
      expect(logOutput.context.event).toBe('session.stalled');
    });
  });

  describe('Recovery Logging', () => {
    it('should log recovery initiation', () => {
      service.logRecovery('session-123', { project_id: 'project-456' });

      expect(consoleLogSpy).toHaveBeenCalled();
      const logOutput = JSON.parse(consoleLogSpy.mock.calls[0][0]);
      expect(logOutput.message).toBe('Session recovery initiated');
      expect(logOutput.context.event).toBe('session.recovery');
    });

    it('should log recovery success', () => {
      service.logRecoverySuccess('session-123', {
        project_id: 'project-456',
        attempt_number: 1,
      });

      expect(consoleLogSpy).toHaveBeenCalled();
      const logOutput = JSON.parse(consoleLogSpy.mock.calls[0][0]);
      expect(logOutput.message).toBe('Session recovery successful');
      expect(logOutput.context.event).toBe('session.recovery.success');
      expect(logOutput.context.attempt_number).toBe(1);
    });

    it('should log recovery failure', () => {
      service.logRecoveryFailure('session-123', 'Max attempts reached', {
        project_id: 'project-456',
      });

      expect(consoleLogSpy).toHaveBeenCalled();
      const logOutput = JSON.parse(consoleLogSpy.mock.calls[0][0]);
      expect(logOutput.level).toBe(LogLevel.ERROR);
      expect(logOutput.message).toBe('Session recovery failed');
      expect(logOutput.context.failure_reason).toBe('Max attempts reached');
    });
  });

  describe('Task Logging', () => {
    it('should log task state changes', () => {
      service.logTaskStateChange('task-123', 'PENDING', 'IN_PROGRESS', {
        session_id: 'session-456',
      });

      expect(consoleLogSpy).toHaveBeenCalled();
      const logOutput = JSON.parse(consoleLogSpy.mock.calls[0][0]);
      expect(logOutput.message).toBe('Task state changed');
      expect(logOutput.context.task_id).toBe('task-123');
      expect(logOutput.context.from_state).toBe('PENDING');
      expect(logOutput.context.to_state).toBe('IN_PROGRESS');
      expect(logOutput.context.event).toBe('task.state_change');
    });
  });

  describe('Background Job Logging', () => {
    it('should log background job started', () => {
      service.logBackgroundJob('cleanup-job', 'started', { threshold: 90 });

      expect(consoleLogSpy).toHaveBeenCalled();
      const logOutput = JSON.parse(consoleLogSpy.mock.calls[0][0]);
      expect(logOutput.message).toBe('Background job started');
      expect(logOutput.context.job_name).toBe('cleanup-job');
      expect(logOutput.context.event).toBe('background_job.started');
    });

    it('should log background job completion', () => {
      service.logBackgroundJob('cleanup-job', 'completed', {
        duration_ms: 1500,
        items_processed: 10,
      });

      expect(consoleLogSpy).toHaveBeenCalled();
      const logOutput = JSON.parse(consoleLogSpy.mock.calls[0][0]);
      expect(logOutput.level).toBe(LogLevel.INFO);
      expect(logOutput.message).toBe('Background job completed');
      expect(logOutput.context.duration_ms).toBe(1500);
    });

    it('should log background job failure', () => {
      service.logBackgroundJob('cleanup-job', 'failed', {
        error_message: 'Database timeout',
      });

      expect(consoleLogSpy).toHaveBeenCalled();
      const logOutput = JSON.parse(consoleLogSpy.mock.calls[0][0]);
      expect(logOutput.level).toBe(LogLevel.ERROR);
      expect(logOutput.message).toBe('Background job failed');
    });
  });

  describe('Database Error Logging', () => {
    it('should log database errors', () => {
      const error = new Error('Connection timeout');
      (error as any).code = 'ETIMEDOUT';

      service.logDatabaseError('query', error, { session_id: 'session-123' });

      expect(consoleLogSpy).toHaveBeenCalled();
      const logOutput = JSON.parse(consoleLogSpy.mock.calls[0][0]);
      expect(logOutput.level).toBe(LogLevel.ERROR);
      expect(logOutput.message).toBe('Database query failed');
      expect(logOutput.error.code).toBe('ETIMEDOUT');
      expect(logOutput.context.session_id).toBe('session-123');
    });
  });

  describe('Validation Error Logging', () => {
    it('should log validation errors', () => {
      const errors = [
        { field: 'email', message: 'Invalid email format' },
        { field: 'age', message: 'Must be a positive number' },
      ];

      service.logValidationError('User', errors, { request_id: 'req-123' });

      expect(consoleLogSpy).toHaveBeenCalled();
      const logOutput = JSON.parse(consoleLogSpy.mock.calls[0][0]);
      expect(logOutput.level).toBe(LogLevel.WARN);
      expect(logOutput.message).toBe('Validation error');
      expect(logOutput.context.entity).toBe('User');
      expect(logOutput.context.validation_errors).toEqual(errors);
    });
  });

  describe('Production Environment', () => {
    it('should output JSON format in production', () => {
      // Create a new service with production config
      const prodService = new AppLoggerService({
        get: (key: string) => {
          if (key === 'app.environment') return 'production';
          return null;
        },
      } as ConfigService);

      prodService.log('Production log');

      expect(consoleLogSpy).toHaveBeenCalled();
      const output = consoleLogSpy.mock.calls[0][0];
      // Should be valid JSON
      expect(() => JSON.parse(output)).not.toThrow();
    });
  });
});
