import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { GitHubLoggerService, GitHubOperation } from './github-logger.service';
import * as winston from 'winston';

// Mock winston
jest.mock('winston', () => {
  const mFormat = {
    combine: jest.fn(),
    timestamp: jest.fn(),
    errors: jest.fn(),
    json: jest.fn(),
    colorize: jest.fn(),
    simple: jest.fn(),
  };

  const mLogger = {
    log: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    end: jest.fn(),
    on: jest.fn(),
  };

  return {
    format: mFormat,
    createLogger: jest.fn(() => mLogger),
    transports: {
      Console: jest.fn(),
    },
  };
});

// Mock winston-daily-rotate-file
jest.mock('winston-daily-rotate-file', () => {
  return jest.fn().mockImplementation(() => ({}));
});

describe('GitHubLoggerService', () => {
  let service: GitHubLoggerService;
  let configService: ConfigService;
  let mockLogger: any;

  beforeEach(async () => {
    // Reset mocks
    jest.clearAllMocks();

    mockLogger = {
      log: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      end: jest.fn(),
      on: jest.fn(),
    };

    (winston.createLogger as jest.Mock).mockReturnValue(mockLogger);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        GitHubLoggerService,
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string, defaultValue?: any) => {
              if (key === 'app.environment') return 'test';
              return defaultValue;
            }),
          },
        },
      ],
    }).compile();

    service = module.get<GitHubLoggerService>(GitHubLoggerService);
    configService = module.get<ConfigService>(ConfigService);

    // Initialize the service
    service.onModuleInit();
  });

  afterEach(() => {
    service.onModuleDestroy();
  });

  describe('AC-1.3.a: Structured JSON logging', () => {
    it('should log with all required fields', () => {
      const operation = GitHubOperation.GET_REPOSITORY;
      const requestId = 'req-123';
      const userId = 'user-456';
      const duration = 150;

      service.log(operation, 'success', {
        requestId,
        userId,
        duration,
        metadata: { repo: 'test/repo' },
      });

      expect(mockLogger.log).toHaveBeenCalled();
      const level = mockLogger.log.mock.calls[0][0];
      const logCall = mockLogger.log.mock.calls[0][1];

      expect(level).toBe('info');
      expect(logCall).toMatchObject({
        requestId,
        userId,
        operation,
        duration,
        status: 'success',
      });
      expect(logCall.timestamp).toBeDefined();
      expect(logCall.metadata).toBeDefined();
    });

    it('should log errors with error details', () => {
      const operation = GitHubOperation.CREATE_ISSUE;
      const error = new Error('API rate limit exceeded');
      (error as any).code = 'RATE_LIMIT';

      service.log(operation, 'error', {
        requestId: 'req-789',
        error,
      });

      const level = mockLogger.log.mock.calls[0][0];
      const logCall = mockLogger.log.mock.calls[0][1];
      expect(level).toBe('error');
      expect(logCall.status).toBe('error');
      expect(logCall.error).toMatchObject({
        message: 'API rate limit exceeded',
        code: 'RATE_LIMIT',
      });
    });

    it('should log pending operations', () => {
      service.log(GitHubOperation.UPDATE_PROJECT, 'pending', {
        requestId: 'req-999',
      });

      const level = mockLogger.log.mock.calls[0][0];
      const logCall = mockLogger.log.mock.calls[0][1];
      expect(level).toBe('info');
      expect(logCall.status).toBe('pending');
    });
  });

  describe('AC-1.3.b: Sensitive data filtering', () => {
    it('should redact tokens from metadata', () => {
      service.log(GitHubOperation.GET_REPOSITORY, 'success', {
        metadata: {
          token: 'ghp_1234567890abcdefghijklmnopqrstuvwxyz',
          apiKey: 'sk_test_123',
          data: 'public',
        },
      });

      const logCall = mockLogger.log.mock.calls[0][1];
      expect(logCall.metadata.token).toBe('[REDACTED]');
      expect(logCall.metadata.apiKey).toBe('[REDACTED]');
      expect(logCall.metadata.data).toBe('public');
    });

    it('should redact nested sensitive data', () => {
      service.log(GitHubOperation.CREATE_ISSUE, 'success', {
        metadata: {
          user: {
            name: 'john',
            auth: {
              token: 'ghp_secret',
              password: 'secret123',
            },
          },
        },
      });

      const logCall = mockLogger.log.mock.calls[0][1];
      expect(logCall.metadata.user.name).toBe('john');
      expect(logCall.metadata.user.auth.token).toBe('[REDACTED]');
      expect(logCall.metadata.user.auth.password).toBe('[REDACTED]');
    });
  });

  describe('AC-1.3.c: Audit logging for mutations', () => {
    it('should log create operations to audit log', () => {
      service.log(GitHubOperation.CREATE_ISSUE, 'success', {
        userId: 'user-123',
        metadata: { resourceId: 'issue-456' },
      });

      // Both main and audit logger should be called
      expect(mockLogger.log).toHaveBeenCalled();
      expect(mockLogger.info).toHaveBeenCalled();
    });

    it('should log update operations to audit log', () => {
      service.log(GitHubOperation.UPDATE_PROJECT, 'success', {
        userId: 'user-123',
        metadata: { resourceId: 'project-789' },
      });

      expect(mockLogger.info).toHaveBeenCalled();
    });

    it('should log delete operations to audit log', () => {
      service.log(GitHubOperation.DELETE_COMMENT, 'success', {
        userId: 'user-123',
        metadata: { resourceId: 'comment-111' },
      });

      expect(mockLogger.info).toHaveBeenCalled();
    });

    it('should warn when mutation logged without userId', () => {
      service.log(GitHubOperation.CREATE_ISSUE, 'success', {
        metadata: { resourceId: 'issue-456' },
      });

      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.objectContaining({
          message: 'Mutation logged without userId',
        })
      );
    });

    it('should not log queries to audit log', () => {
      const auditCallsBefore = mockLogger.info.mock.calls.length;

      service.log(GitHubOperation.GET_REPOSITORY, 'success', {
        userId: 'user-123',
      });

      // Audit logger should not have additional calls
      expect(mockLogger.info).toHaveBeenCalledTimes(auditCallsBefore);
    });
  });

  describe('AC-1.3.e: Logging failure handling', () => {
    it('should fallback to stderr on logging error', () => {
      const stderrSpy = jest.spyOn(process.stderr, 'write').mockImplementation();
      mockLogger.log.mockImplementation(() => {
        throw new Error('Logger failed');
      });

      service.log(GitHubOperation.GET_REPOSITORY, 'success', {
        requestId: 'req-123',
      });

      expect(stderrSpy).toHaveBeenCalled();
      const stderrCall = stderrSpy.mock.calls[0][0] as string;
      expect(stderrCall).toContain('Failed to log operation');

      stderrSpy.mockRestore();
    });

    it('should not block operation on logging failure', () => {
      mockLogger.log.mockImplementation(() => {
        throw new Error('Logger failed');
      });

      // Should not throw
      expect(() => {
        service.log(GitHubOperation.GET_REPOSITORY, 'success');
      }).not.toThrow();
    });
  });

  describe('AC-1.3.f: Log volume monitoring', () => {
    beforeEach(() => {
      jest.useFakeTimers();
      // Reinitialize service with fake timers
      service.onModuleDestroy(); // Clean up old interval
      service.onModuleInit(); // Create new interval with fake timers
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    it('should warn on high log volume', () => {
      // Generate high volume of logs
      for (let i = 0; i < 1100; i++) {
        service.log(GitHubOperation.GET_REPOSITORY, 'success');
      }

      // Advance timer by 1 minute
      jest.advanceTimersByTime(60000);

      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.objectContaining({
          message: 'High log volume detected',
        })
      );
    });

    it('should reset volume counter after check', () => {
      // Generate logs
      for (let i = 0; i < 500; i++) {
        service.log(GitHubOperation.GET_REPOSITORY, 'success');
      }

      // Advance timer
      jest.advanceTimersByTime(60000);

      // Should not warn with low volume
      const warnCalls = mockLogger.warn.mock.calls.filter(
        (call: any) => call[0].message === 'High log volume detected'
      );
      expect(warnCalls.length).toBe(0);
    });
  });

  describe('startOperation helper', () => {
    it('should track operation duration', (done) => {
      jest.useRealTimers();
      const { endOperation } = service.startOperation(
        GitHubOperation.GET_REPOSITORY,
        'req-123',
        'user-456'
      );

      // Simulate some work
      setTimeout(() => {
        endOperation('success');

        const level = mockLogger.log.mock.calls[0][0];
        const logCall = mockLogger.log.mock.calls[0][1];
        expect(level).toBe('info');
        expect(logCall.duration).toBeGreaterThan(0);
        expect(logCall.status).toBe('success');
        done();
      }, 10);
    });

    it('should log errors with duration', () => {
      const { endOperation } = service.startOperation(
        GitHubOperation.CREATE_ISSUE,
        'req-789'
      );

      const error = new Error('Failed');
      endOperation('error', error);

      const logCall = mockLogger.log.mock.calls[0][1];
      expect(logCall.status).toBe('error');
      expect(logCall.error).toBeDefined();
      expect(logCall.duration).toBeDefined();
    });
  });

  describe('cleanup', () => {
    it('should close loggers on module destroy', () => {
      service.onModuleDestroy();

      expect(mockLogger.end).toHaveBeenCalledTimes(2); // Main and audit logger
    });
  });
});
