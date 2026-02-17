import { Test, TestingModule } from '@nestjs/testing';
import { ExecutionContext, CallHandler, HttpStatus } from '@nestjs/common';
import { of, throwError } from 'rxjs';
import { AuditInterceptor } from './audit.interceptor';
import { AuditHistoryService } from '../../modules/audit-history/audit-history.service';
import { AppLoggerService } from '../logging/app-logger.service';
import { HttpMethod } from '../../schemas/audit-history.schema';
import { REQUEST_ID_KEY } from './request-id.interceptor';

describe('AuditInterceptor', () => {
  let interceptor: AuditInterceptor;
  let auditService: jest.Mocked<AuditHistoryService>;
  let logger: jest.Mocked<AppLoggerService>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuditInterceptor,
        {
          provide: AuditHistoryService,
          useValue: {
            writeAuditRecord: jest.fn(),
          },
        },
        {
          provide: AppLoggerService,
          useValue: {
            setContext: jest.fn(),
            debug: jest.fn(),
            warn: jest.fn(),
            log: jest.fn(),
            error: jest.fn(),
          },
        },
      ],
    }).compile();

    interceptor = module.get<AuditInterceptor>(AuditInterceptor);
    auditService = module.get(AuditHistoryService) as jest.Mocked<AuditHistoryService>;
    logger = module.get(AppLoggerService) as jest.Mocked<AppLoggerService>;

    jest.clearAllMocks();
  });

  const createMockExecutionContext = (
    method: string,
    url: string,
    body?: any,
    headers?: Record<string, string>,
  ): ExecutionContext => {
    const request = {
      method,
      url,
      body,
      headers: headers || {},
      [REQUEST_ID_KEY]: 'test-request-id',
    };

    const response = {
      statusCode: 200,
    };

    return {
      switchToHttp: () => ({
        getRequest: () => request,
        getResponse: () => response,
      }),
    } as ExecutionContext;
  };

  const createMockCallHandler = (result?: any, shouldError = false): CallHandler => {
    return {
      handle: () => (shouldError ? throwError(() => result) : of(result)),
    } as CallHandler;
  };

  describe('POST request', () => {
    it('should call writeAuditRecord with correct fields', (done) => {
      const context = createMockExecutionContext(
        'POST',
        '/api/tasks',
        { projectNumber: 123, title: 'Test Task' },
        { 'x-workspace-id': 'ws-123', 'x-worktree-path': '/path/to/worktree' },
      );

      const next = createMockCallHandler();

      interceptor.intercept(context, next).subscribe(() => {
        expect(auditService.writeAuditRecord).toHaveBeenCalledTimes(1);

        const call = auditService.writeAuditRecord.mock.calls[0][0];
        expect(call.api_endpoint).toBe('/api/tasks');
        expect(call.http_method).toBe(HttpMethod.POST);
        expect(call.workspace_id).toBe('ws-123');
        expect(call.worktree_path).toBe('/path/to/worktree');
        expect(call.project_number).toBe(123);
        expect(call.operation_type).toBe('task.created'); // Static mapping for POST /api/tasks
        expect(call.request_summary).toEqual({ projectNumber: 123, title: 'Test Task' });
        expect(call.response_status).toBe(200);
        expect(call.duration_ms).toBeGreaterThanOrEqual(0);
        expect(call.request_id).toBe('test-request-id');

        done();
      });
    });

    it('should derive operation_type as session.created for POST /api/sessions', (done) => {
      const context = createMockExecutionContext('POST', '/api/sessions', {});
      const next = createMockCallHandler();

      interceptor.intercept(context, next).subscribe(() => {
        const call = auditService.writeAuditRecord.mock.calls[0][0];
        expect(call.operation_type).toBe('session.created');
        done();
      });
    });

    it('should derive operation_type as task.created for POST /api/tasks', (done) => {
      const context = createMockExecutionContext('POST', '/api/tasks', {});
      const next = createMockCallHandler();

      interceptor.intercept(context, next).subscribe(() => {
        const call = auditService.writeAuditRecord.mock.calls[0][0];
        expect(call.operation_type).toBe('task.created');
        done();
      });
    });

    it('should derive operation_type as task.started for POST /api/tasks/:id/start', (done) => {
      const context = createMockExecutionContext('POST', '/api/tasks/123/start', {});
      const next = createMockCallHandler();

      interceptor.intercept(context, next).subscribe(() => {
        const call = auditService.writeAuditRecord.mock.calls[0][0];
        expect(call.operation_type).toBe('task.started');
        done();
      });
    });
  });

  describe('GET request', () => {
    it('should NOT call writeAuditRecord', (done) => {
      const context = createMockExecutionContext('GET', '/api/tasks');
      const next = createMockCallHandler();

      interceptor.intercept(context, next).subscribe(() => {
        expect(auditService.writeAuditRecord).not.toHaveBeenCalled();
        done();
      });
    });
  });

  describe('OPTIONS request', () => {
    it('should NOT call writeAuditRecord', (done) => {
      const context = createMockExecutionContext('OPTIONS', '/api/tasks');
      const next = createMockCallHandler();

      interceptor.intercept(context, next).subscribe(() => {
        expect(auditService.writeAuditRecord).not.toHaveBeenCalled();
        done();
      });
    });
  });

  describe('PUT request', () => {
    it('should call writeAuditRecord with PUT method', (done) => {
      const context = createMockExecutionContext('PUT', '/api/tasks/123', { status: 'done' });
      const next = createMockCallHandler();

      interceptor.intercept(context, next).subscribe(() => {
        expect(auditService.writeAuditRecord).toHaveBeenCalledTimes(1);

        const call = auditService.writeAuditRecord.mock.calls[0][0];
        expect(call.http_method).toBe(HttpMethod.PUT);
        expect(call.api_endpoint).toBe('/api/tasks/123');
        done();
      });
    });
  });

  describe('PATCH request', () => {
    it('should call writeAuditRecord with PATCH method', (done) => {
      const context = createMockExecutionContext('PATCH', '/api/tasks/123', { status: 'in_progress' });
      const next = createMockCallHandler();

      interceptor.intercept(context, next).subscribe(() => {
        expect(auditService.writeAuditRecord).toHaveBeenCalledTimes(1);

        const call = auditService.writeAuditRecord.mock.calls[0][0];
        expect(call.http_method).toBe(HttpMethod.PATCH);
        expect(call.operation_type).toBe('task.updated'); // Static mapping for PATCH /api/tasks
        done();
      });
    });
  });

  describe('DELETE request', () => {
    it('should call writeAuditRecord with DELETE method', (done) => {
      const context = createMockExecutionContext('DELETE', '/api/tasks/123');
      const next = createMockCallHandler();

      interceptor.intercept(context, next).subscribe(() => {
        expect(auditService.writeAuditRecord).toHaveBeenCalledTimes(1);

        const call = auditService.writeAuditRecord.mock.calls[0][0];
        expect(call.http_method).toBe(HttpMethod.DELETE);
        done();
      });
    });
  });

  describe('Workspace headers', () => {
    it('should extract workspace_id when X-Workspace-Id header is present', (done) => {
      const context = createMockExecutionContext(
        'POST',
        '/api/tasks',
        {},
        { 'x-workspace-id': 'ws-456' },
      );
      const next = createMockCallHandler();

      interceptor.intercept(context, next).subscribe(() => {
        const call = auditService.writeAuditRecord.mock.calls[0][0];
        expect(call.workspace_id).toBe('ws-456');
        done();
      });
    });

    it('should extract worktree_path when X-Worktree-Path header is present', (done) => {
      const context = createMockExecutionContext(
        'POST',
        '/api/tasks',
        {},
        { 'x-worktree-path': '/custom/path' },
      );
      const next = createMockCallHandler();

      interceptor.intercept(context, next).subscribe(() => {
        const call = auditService.writeAuditRecord.mock.calls[0][0];
        expect(call.worktree_path).toBe('/custom/path');
        done();
      });
    });

    it('should handle missing workspace headers with undefined values', (done) => {
      const context = createMockExecutionContext('POST', '/api/tasks', {});
      const next = createMockCallHandler();

      interceptor.intercept(context, next).subscribe(() => {
        const call = auditService.writeAuditRecord.mock.calls[0][0];
        expect(call.workspace_id).toBeUndefined();
        expect(call.worktree_path).toBeUndefined();
        done();
      });
    });
  });

  describe('Sensitive field redaction', () => {
    it('should redact password fields in request_summary', (done) => {
      const context = createMockExecutionContext('POST', '/api/auth/login', {
        username: 'test@example.com',
        password: 'secret123',
      });
      const next = createMockCallHandler();

      interceptor.intercept(context, next).subscribe(() => {
        const call = auditService.writeAuditRecord.mock.calls[0][0];
        expect(call.request_summary).toBeDefined();
        expect(call.request_summary!.username).toBe('test@example.com');
        expect(call.request_summary!.password).toBe('***REDACTED***');
        done();
      });
    });

    it('should redact token fields in request_summary', (done) => {
      const context = createMockExecutionContext('POST', '/api/auth', {
        apiToken: 'abc123',
        data: { token: 'xyz789' },
      });
      const next = createMockCallHandler();

      interceptor.intercept(context, next).subscribe(() => {
        const call = auditService.writeAuditRecord.mock.calls[0][0];
        expect(call.request_summary).toBeDefined();
        expect(call.request_summary!.apiToken).toBe('***REDACTED***');
        expect(call.request_summary!.data.token).toBe('***REDACTED***');
        done();
      });
    });

    it('should redact secret fields in request_summary', (done) => {
      const context = createMockExecutionContext('POST', '/api/config', {
        clientSecret: 'my-secret',
      });
      const next = createMockCallHandler();

      interceptor.intercept(context, next).subscribe(() => {
        const call = auditService.writeAuditRecord.mock.calls[0][0];
        expect(call.request_summary).toBeDefined();
        expect(call.request_summary!.clientSecret).toBe('***REDACTED***');
        done();
      });
    });

    it('should redact apiKey fields in request_summary', (done) => {
      const context = createMockExecutionContext('POST', '/api/external', {
        apiKey: 'key-12345',
      });
      const next = createMockCallHandler();

      interceptor.intercept(context, next).subscribe(() => {
        const call = auditService.writeAuditRecord.mock.calls[0][0];
        expect(call.request_summary).toBeDefined();
        expect(call.request_summary!.apiKey).toBe('***REDACTED***');
        done();
      });
    });

    it('should redact authorization fields in request_summary', (done) => {
      const context = createMockExecutionContext('POST', '/api/data', {
        authorization: 'Bearer token123',
      });
      const next = createMockCallHandler();

      interceptor.intercept(context, next).subscribe(() => {
        const call = auditService.writeAuditRecord.mock.calls[0][0];
        expect(call.request_summary).toBeDefined();
        expect(call.request_summary!.authorization).toBe('***REDACTED***');
        done();
      });
    });

    it('should redact nested sensitive fields', (done) => {
      const context = createMockExecutionContext('POST', '/api/config', {
        user: {
          name: 'John',
          password: 'secret',
          settings: {
            apiKey: 'key123',
          },
        },
      });
      const next = createMockCallHandler();

      interceptor.intercept(context, next).subscribe(() => {
        const call = auditService.writeAuditRecord.mock.calls[0][0];
        expect(call.request_summary).toBeDefined();
        expect(call.request_summary!.user.name).toBe('John');
        expect(call.request_summary!.user.password).toBe('***REDACTED***');
        expect(call.request_summary!.user.settings.apiKey).toBe('***REDACTED***');
        done();
      });
    });
  });

  describe('Error responses', () => {
    it('should still produce audit records on error', (done) => {
      const context = createMockExecutionContext('POST', '/api/tasks', { title: 'Test' });
      const error = { status: HttpStatus.BAD_REQUEST, message: 'Invalid request' };
      const next = createMockCallHandler(error, true);

      interceptor.intercept(context, next).subscribe({
        error: () => {
          expect(auditService.writeAuditRecord).toHaveBeenCalledTimes(1);

          const call = auditService.writeAuditRecord.mock.calls[0][0];
          expect(call.response_status).toBe(HttpStatus.BAD_REQUEST);
          done();
        },
      });
    });

    it('should use INTERNAL_SERVER_ERROR for errors without status', (done) => {
      const context = createMockExecutionContext('POST', '/api/tasks', {});
      const error = new Error('Unexpected error');
      const next = createMockCallHandler(error, true);

      interceptor.intercept(context, next).subscribe({
        error: () => {
          expect(auditService.writeAuditRecord).toHaveBeenCalledTimes(1);

          const call = auditService.writeAuditRecord.mock.calls[0][0];
          expect(call.response_status).toBe(HttpStatus.INTERNAL_SERVER_ERROR);
          done();
        },
      });
    });
  });

  describe('Interceptor errors', () => {
    it('should not affect API response when audit write fails', (done) => {
      const context = createMockExecutionContext('POST', '/api/tasks', {});
      const next = createMockCallHandler({ success: true });

      // Make writeAuditRecord throw an error
      auditService.writeAuditRecord.mockImplementation(() => {
        throw new Error('Database connection failed');
      });

      interceptor.intercept(context, next).subscribe({
        next: (result) => {
          expect(result).toEqual({ success: true });
          expect(logger.warn).toHaveBeenCalledWith(
            'Failed to write audit record',
            expect.objectContaining({
              error: 'Database connection failed',
              request_id: 'test-request-id',
              url: '/api/tasks',
            }),
          );
          done();
        },
      });
    });
  });

  describe('Project number extraction', () => {
    it('should extract project_number from body.projectNumber', (done) => {
      const context = createMockExecutionContext('POST', '/api/tasks', {
        projectNumber: 789,
        title: 'Task',
      });
      const next = createMockCallHandler();

      interceptor.intercept(context, next).subscribe(() => {
        const call = auditService.writeAuditRecord.mock.calls[0][0];
        expect(call.project_number).toBe(789);
        done();
      });
    });

    it('should extract project_number from body.data.projectNumber', (done) => {
      const context = createMockExecutionContext('POST', '/api/tasks', {
        data: { projectNumber: 456 },
      });
      const next = createMockCallHandler();

      interceptor.intercept(context, next).subscribe(() => {
        const call = auditService.writeAuditRecord.mock.calls[0][0];
        expect(call.project_number).toBe(456);
        done();
      });
    });

    it('should prioritize body.data.projectNumber over body.projectNumber', (done) => {
      const context = createMockExecutionContext('POST', '/api/tasks', {
        projectNumber: 100,
        data: { projectNumber: 200 },
      });
      const next = createMockCallHandler();

      interceptor.intercept(context, next).subscribe(() => {
        const call = auditService.writeAuditRecord.mock.calls[0][0];
        expect(call.project_number).toBe(200);
        done();
      });
    });

    it('should handle missing project_number gracefully', (done) => {
      const context = createMockExecutionContext('POST', '/api/tasks', { title: 'Task' });
      const next = createMockCallHandler();

      interceptor.intercept(context, next).subscribe(() => {
        const call = auditService.writeAuditRecord.mock.calls[0][0];
        expect(call.project_number).toBeUndefined();
        done();
      });
    });
  });

  describe('Operation type derivation', () => {
    it('should derive task.completed for /api/tasks/:id/complete', (done) => {
      const context = createMockExecutionContext('POST', '/api/tasks/123/complete', {});
      const next = createMockCallHandler();

      interceptor.intercept(context, next).subscribe(() => {
        const call = auditService.writeAuditRecord.mock.calls[0][0];
        expect(call.operation_type).toBe('task.completed');
        done();
      });
    });

    it('should derive task.paused for /api/tasks/:id/pause', (done) => {
      const context = createMockExecutionContext('POST', '/api/tasks/123/pause', {});
      const next = createMockCallHandler();

      interceptor.intercept(context, next).subscribe(() => {
        const call = auditService.writeAuditRecord.mock.calls[0][0];
        expect(call.operation_type).toBe('task.paused');
        done();
      });
    });

    it('should derive task.resumed for /api/tasks/:id/resume', (done) => {
      const context = createMockExecutionContext('POST', '/api/tasks/123/resume', {});
      const next = createMockCallHandler();

      interceptor.intercept(context, next).subscribe(() => {
        const call = auditService.writeAuditRecord.mock.calls[0][0];
        expect(call.operation_type).toBe('task.resumed');
        done();
      });
    });

    it('should derive project.event for /api/events/project', (done) => {
      const context = createMockExecutionContext('POST', '/api/events/project', {});
      const next = createMockCallHandler();

      interceptor.intercept(context, next).subscribe(() => {
        const call = auditService.writeAuditRecord.mock.calls[0][0];
        expect(call.operation_type).toBe('project.event');
        done();
      });
    });

    it('should derive session.ended for DELETE /api/sessions/:id', (done) => {
      const context = createMockExecutionContext('DELETE', '/api/sessions/abc', {});
      const next = createMockCallHandler();

      interceptor.intercept(context, next).subscribe(() => {
        const call = auditService.writeAuditRecord.mock.calls[0][0];
        expect(call.operation_type).toBe('session.ended');
        done();
      });
    });

    it('should use fallback pattern for unknown URLs', (done) => {
      const context = createMockExecutionContext('POST', '/api/custom/endpoint', {});
      const next = createMockCallHandler();

      interceptor.intercept(context, next).subscribe(() => {
        const call = auditService.writeAuditRecord.mock.calls[0][0];
        expect(call.operation_type).toBe('post.custom');
        done();
      });
    });
  });

  describe('Duration calculation', () => {
    it('should calculate duration_ms correctly', (done) => {
      const context = createMockExecutionContext('POST', '/api/tasks', {});
      const next = createMockCallHandler({});

      interceptor.intercept(context, next).subscribe(() => {
        const call = auditService.writeAuditRecord.mock.calls[0][0];

        // Duration should be a non-negative number
        expect(call.duration_ms).toBeGreaterThanOrEqual(0);
        expect(typeof call.duration_ms).toBe('number');
        done();
      });
    });
  });
});
