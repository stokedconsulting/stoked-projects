import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
  HttpStatus,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import { AppLoggerService } from '../logging/app-logger.service';
import { REQUEST_ID_KEY } from './request-id.interceptor';
import { AuditHistoryService } from '../../modules/audit-history/audit-history.service';
import { HttpMethod } from '../../schemas/audit-history.schema';

/**
 * Interceptor that automatically writes audit records for every mutating API request.
 *
 * Audits:
 * - POST, PUT, PATCH, DELETE requests only (GET and OPTIONS are skipped)
 * - Captures request metadata, headers, and sanitized body
 * - Records response status and operation duration
 * - Derives operation_type from URL patterns
 * - Never affects API responses (all errors caught and logged)
 */
@Injectable()
export class AuditInterceptor implements NestInterceptor {
  private static readonly SENSITIVE_FIELDS = [
    'password',
    'token',
    'secret',
    'apiKey',
    'authorization',
  ];

  private static readonly MAX_SUMMARY_SIZE = 4 * 1024; // 4KB

  constructor(
    private readonly auditService: AuditHistoryService,
    private readonly logger: AppLoggerService,
  ) {
    this.logger.setContext('AuditInterceptor');
  }

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const request = context.switchToHttp().getRequest();
    const response = context.switchToHttp().getResponse();

    const { method, url, body, headers } = request;

    // Skip GET and OPTIONS requests
    if (method === 'GET' || method === 'OPTIONS') {
      return next.handle();
    }

    const requestId = request[REQUEST_ID_KEY];
    const startTime = Date.now();

    // Extract headers
    const workspaceId = headers['x-workspace-id'];
    const worktreePath = headers['x-worktree-path'];

    return next.handle().pipe(
      tap({
        next: () => {
          this.writeAudit(
            method,
            url,
            body,
            response.statusCode,
            startTime,
            requestId,
            workspaceId,
            worktreePath,
          );
        },
        error: (error) => {
          const statusCode = error?.status || HttpStatus.INTERNAL_SERVER_ERROR;
          this.writeAudit(
            method,
            url,
            body,
            statusCode,
            startTime,
            requestId,
            workspaceId,
            worktreePath,
          );
        },
      }),
    );
  }

  /**
   * Write audit record with all extracted data.
   * All errors are caught to prevent affecting the API response.
   */
  private writeAudit(
    method: string,
    url: string,
    body: any,
    statusCode: number,
    startTime: number,
    requestId?: string,
    workspaceId?: string,
    worktreePath?: string,
  ): void {
    try {
      const duration = Date.now() - startTime;
      const httpMethod = this.mapHttpMethod(method);

      // Skip if not a mutating method
      if (!httpMethod) {
        return;
      }

      const operationType = this.deriveOperationType(method, url);
      const projectNumber = this.extractProjectNumber(body);
      const requestSummary = this.sanitizeRequestBody(body);

      this.auditService.writeAuditRecord({
        api_endpoint: url,
        http_method: httpMethod,
        workspace_id: workspaceId || undefined,
        worktree_path: worktreePath || undefined,
        project_number: projectNumber,
        operation_type: operationType,
        request_summary: requestSummary,
        response_status: statusCode,
        duration_ms: duration,
        request_id: requestId,
      });

      this.logger.debug('Audit record written', {
        request_id: requestId,
        operation_type: operationType,
        status: statusCode,
        duration_ms: duration,
      });
    } catch (error) {
      // CRITICAL: Never let audit failures affect the API response
      this.logger.warn('Failed to write audit record', {
        error: error.message,
        request_id: requestId,
        url,
      });
    }
  }

  /**
   * Map HTTP method string to HttpMethod enum
   */
  private mapHttpMethod(method: string): HttpMethod | null {
    const normalized = method.toUpperCase();
    switch (normalized) {
      case 'POST':
        return HttpMethod.POST;
      case 'PUT':
        return HttpMethod.PUT;
      case 'PATCH':
        return HttpMethod.PATCH;
      case 'DELETE':
        return HttpMethod.DELETE;
      default:
        return null;
    }
  }

  /**
   * Derive operation_type from URL pattern and HTTP method.
   *
   * Examples:
   * - POST /api/tasks/:id/start → task.started
   * - POST /api/sessions → session.created
   * - PATCH /api/events/project → project.event
   * - Fallback: {method.toLowerCase()}.{first_path_segment}
   */
  private deriveOperationType(method: string, url: string): string {
    const normalized = method.toLowerCase();

    // Remove query string if present
    const path = url.split('?')[0];

    // Static mappings for known patterns
    if (path.includes('/tasks/') && path.endsWith('/start')) {
      return 'task.started';
    }
    if (path.includes('/tasks/') && path.endsWith('/complete')) {
      return 'task.completed';
    }
    if (path.includes('/tasks/') && path.endsWith('/pause')) {
      return 'task.paused';
    }
    if (path.includes('/tasks/') && path.endsWith('/resume')) {
      return 'task.resumed';
    }
    if (path.includes('/events/project')) {
      return 'project.event';
    }
    if (path.includes('/sessions') && normalized === 'post') {
      return 'session.created';
    }
    if (path.includes('/sessions') && normalized === 'delete') {
      return 'session.ended';
    }
    if (path.includes('/tasks') && normalized === 'post') {
      return 'task.created';
    }
    if (path.includes('/tasks') && normalized === 'patch') {
      return 'task.updated';
    }

    // Fallback: extract first meaningful path segment
    const segments = path.split('/').filter(s => s && s !== 'api');
    const firstSegment = segments[0] || 'unknown';

    return `${normalized}.${firstSegment}`;
  }

  /**
   * Extract project_number from request body if present.
   * Checks both body.data.projectNumber and body.projectNumber.
   */
  private extractProjectNumber(body: any): number | undefined {
    if (!body) {
      return undefined;
    }

    // Check nested data.projectNumber first
    if (body.data && typeof body.data.projectNumber === 'number') {
      return body.data.projectNumber;
    }

    // Check top-level projectNumber
    if (typeof body.projectNumber === 'number') {
      return body.projectNumber;
    }

    return undefined;
  }

  /**
   * Sanitize request body by:
   * 1. Redacting sensitive fields (password, token, secret, apiKey, authorization)
   * 2. Limiting to first 4KB
   * 3. Converting to JSON object
   */
  private sanitizeRequestBody(body: any): Record<string, any> {
    if (!body) {
      return {};
    }

    try {
      // Deep clone and redact sensitive fields
      const sanitized = this.redactSensitiveFields(body);

      // Convert to JSON string and truncate
      const jsonString = JSON.stringify(sanitized);
      const truncated = jsonString.substring(0, AuditInterceptor.MAX_SUMMARY_SIZE);

      // Parse back to object
      return JSON.parse(truncated);
    } catch (error) {
      this.logger.warn('Failed to sanitize request body', {
        error: error.message,
      });
      return { error: 'Failed to sanitize request body' };
    }
  }

  /**
   * Recursively redact sensitive fields from an object.
   * Replaces values with '***REDACTED***' for fields matching sensitive field names.
   */
  private redactSensitiveFields(obj: any): any {
    if (obj === null || obj === undefined) {
      return obj;
    }

    if (typeof obj !== 'object') {
      return obj;
    }

    if (Array.isArray(obj)) {
      return obj.map(item => this.redactSensitiveFields(item));
    }

    const result: any = {};
    for (const [key, value] of Object.entries(obj)) {
      const lowerKey = key.toLowerCase();
      const isSensitive = AuditInterceptor.SENSITIVE_FIELDS.some(
        field => lowerKey.includes(field.toLowerCase()),
      );

      if (isSensitive) {
        result[key] = '***REDACTED***';
      } else if (typeof value === 'object') {
        result[key] = this.redactSensitiveFields(value);
      } else {
        result[key] = value;
      }
    }

    return result;
  }
}
