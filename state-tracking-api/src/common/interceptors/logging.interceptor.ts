import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
  HttpStatus,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import { AppLoggerService, LogLevel } from '../logging/app-logger.service';
import { REQUEST_ID_KEY } from './request-id.interceptor';

/**
 * Interceptor that logs HTTP requests and responses.
 *
 * Logs:
 * - Request: method, path, request_id
 * - Response: status, duration_ms, request_id
 *
 * Log levels:
 * - INFO: Successful requests (2xx-3xx)
 * - WARN: Client errors (4xx)
 * - ERROR: Server errors (5xx)
 */
@Injectable()
export class LoggingInterceptor implements NestInterceptor {
  constructor(private readonly logger: AppLoggerService) {
    this.logger.setContext('HTTP');
  }

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const request = context.switchToHttp().getRequest();
    const response = context.switchToHttp().getResponse();

    const { method, url, body } = request;
    const requestId = request[REQUEST_ID_KEY];
    const startTime = Date.now();

    // Log request
    this.logger.debug('Incoming request', {
      request_id: requestId,
      method,
      path: url,
      body: this.shouldLogBody(method) ? body : undefined,
    });

    return next.handle().pipe(
      tap({
        next: () => {
          this.logResponse(method, url, response.statusCode, startTime, requestId);
        },
        error: (error) => {
          const statusCode = error?.status || HttpStatus.INTERNAL_SERVER_ERROR;
          this.logResponse(method, url, statusCode, startTime, requestId, error);
        },
      }),
    );
  }

  /**
   * Log the response with appropriate log level based on status code
   */
  private logResponse(
    method: string,
    path: string,
    statusCode: number,
    startTime: number,
    requestId?: string,
    error?: any,
  ) {
    const duration = Date.now() - startTime;
    const level = this.getLogLevel(statusCode);

    const context = {
      request_id: requestId,
      method,
      path,
      status_code: statusCode,
      duration_ms: duration,
    };

    const message = `${method} ${path} ${statusCode} - ${duration}ms`;

    if (error) {
      this.logger.error(message, error.stack, context);
    } else if (level === LogLevel.WARN) {
      this.logger.warn(message, context);
    } else {
      this.logger.log(message, context);
    }
  }

  /**
   * Determine log level based on HTTP status code
   */
  private getLogLevel(statusCode: number): LogLevel {
    if (statusCode >= 500) {
      return LogLevel.ERROR;
    } else if (statusCode >= 400) {
      return LogLevel.WARN;
    }
    return LogLevel.INFO;
  }

  /**
   * Determine if request body should be logged (avoid logging for GET/DELETE)
   */
  private shouldLogBody(method: string): boolean {
    return ['POST', 'PUT', 'PATCH'].includes(method.toUpperCase());
  }
}
