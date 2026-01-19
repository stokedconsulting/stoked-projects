import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
  BadRequestException,
  NotFoundException,
  UnauthorizedException,
  ForbiddenException,
  ConflictException,
  InternalServerErrorException,
} from '@nestjs/common';
import { Request as ExpressRequest, Response as ExpressResponse } from 'express';
import { Error as MongooseError } from 'mongoose';
import { v4 as uuidv4 } from 'uuid';
import { AppLoggerService } from '../logging/app-logger.service';
import { REQUEST_ID_KEY } from '../interceptors/request-id.interceptor';

/**
 * Error code mapping for structured error responses
 */
export enum ErrorCode {
  VALIDATION_ERROR = 'validation_error',
  NOT_FOUND = 'not_found',
  UNAUTHORIZED = 'unauthorized',
  FORBIDDEN = 'forbidden',
  CONFLICT = 'conflict',
  RATE_LIMIT_EXCEEDED = 'rate_limit_exceeded',
  TIMEOUT = 'timeout',
  DATABASE_ERROR = 'database_error',
  INTERNAL_ERROR = 'internal_error',
}

/**
 * Structured error response interface
 */
export interface ErrorResponse {
  statusCode: number;
  error: ErrorCode;
  message: string;
  details?: string[] | Record<string, any>;
  request_id: string;
  timestamp: string;
  path?: string;
  stack?: string;
}

/**
 * Global exception filter that provides:
 * - Structured error responses with error codes
 * - Request ID tracking
 * - Stack traces in development only
 * - Database error handling
 * - Validation error formatting
 * - Error tracking integration ready
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly isDevelopment: boolean;

  constructor(private readonly logger: AppLoggerService) {
    this.isDevelopment = process.env.NODE_ENV !== 'production';
    this.logger.setContext('ExceptionFilter');
  }

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<ExpressResponse>();
    const request = ctx.getRequest<ExpressRequest>();

    const requestId = this.getOrCreateRequestId(request);
    const { status, error, message, details } = this.parseException(exception);

    const errorResponse: ErrorResponse = {
      statusCode: status,
      error,
      message,
      request_id: requestId,
      timestamp: new Date().toISOString(),
      path: request.url,
    };

    // Add details if present
    if (details) {
      errorResponse.details = details;
    }

    // Include stack trace in development only
    if (this.isDevelopment && exception instanceof Error) {
      errorResponse.stack = exception.stack;
    }

    // Log error with context
    this.logError(exception, errorResponse, request);

    // Send structured error response
    response.status(status).json(errorResponse);
  }

  /**
   * Parse exception into structured error information
   */
  private parseException(exception: unknown): {
    status: number;
    error: ErrorCode;
    message: string;
    details?: string[] | Record<string, any>;
  } {
    // Handle NestJS HTTP exceptions
    if (exception instanceof HttpException) {
      return this.parseHttpException(exception);
    }

    // Handle Mongoose/MongoDB errors
    if (this.isMongooseError(exception)) {
      return this.parseMongooseError(exception);
    }

    // Handle timeout errors
    if (this.isTimeoutError(exception)) {
      return {
        status: HttpStatus.GATEWAY_TIMEOUT,
        error: ErrorCode.TIMEOUT,
        message: 'Request timeout',
        details: ['The operation took too long to complete'],
      };
    }

    // Default to internal server error
    return {
      status: HttpStatus.INTERNAL_SERVER_ERROR,
      error: ErrorCode.INTERNAL_ERROR,
      message: exception instanceof Error ? exception.message : 'Internal server error',
    };
  }

  /**
   * Parse NestJS HTTP exceptions
   */
  private parseHttpException(exception: HttpException): {
    status: number;
    error: ErrorCode;
    message: string;
    details?: string[] | Record<string, any>;
  } {
    const status = exception.getStatus();
    const exceptionResponse = exception.getResponse();

    // Handle validation errors from class-validator
    if (exception instanceof BadRequestException) {
      const details = this.extractValidationDetails(exceptionResponse);
      if (details) {
        return {
          status,
          error: ErrorCode.VALIDATION_ERROR,
          message: 'Validation failed',
          details,
        };
      }
    }

    // Map HTTP status to error code
    const error = this.mapStatusToErrorCode(status, exception);

    // Extract message
    let message: string;
    if (typeof exceptionResponse === 'string') {
      message = exceptionResponse;
    } else if (typeof exceptionResponse === 'object' && exceptionResponse !== null) {
      message = (exceptionResponse as any).message || exception.message;
    } else {
      message = exception.message;
    }

    return { status, error, message };
  }

  /**
   * Extract validation details from class-validator errors
   */
  private extractValidationDetails(
    exceptionResponse: string | object,
  ): string[] | undefined {
    if (typeof exceptionResponse === 'object' && exceptionResponse !== null) {
      const response = exceptionResponse as any;
      if (Array.isArray(response.message)) {
        return response.message;
      }
    }
    return undefined;
  }

  /**
   * Parse Mongoose/MongoDB errors
   */
  private parseMongooseError(error: any): {
    status: number;
    error: ErrorCode;
    message: string;
    details?: Record<string, any>;
  } {
    // Validation error
    if (error.name === 'ValidationError') {
      const details: Record<string, any> = {};
      for (const field in error.errors) {
        details[field] = error.errors[field].message;
      }
      return {
        status: HttpStatus.BAD_REQUEST,
        error: ErrorCode.VALIDATION_ERROR,
        message: 'Database validation failed',
        details,
      };
    }

    // Duplicate key error
    if (error.code === 11000) {
      return {
        status: HttpStatus.CONFLICT,
        error: ErrorCode.CONFLICT,
        message: 'Duplicate entry',
        details: { duplicateKey: error.keyValue },
      };
    }

    // Cast error (invalid ID format, etc.)
    if (error.name === 'CastError') {
      return {
        status: HttpStatus.BAD_REQUEST,
        error: ErrorCode.VALIDATION_ERROR,
        message: `Invalid ${error.path}: ${error.value}`,
      };
    }

    // Generic database error
    return {
      status: HttpStatus.INTERNAL_SERVER_ERROR,
      error: ErrorCode.DATABASE_ERROR,
      message: 'Database operation failed',
    };
  }

  /**
   * Map HTTP status code to error code
   */
  private mapStatusToErrorCode(status: number, exception: HttpException): ErrorCode {
    if (exception instanceof NotFoundException) {
      return ErrorCode.NOT_FOUND;
    }
    if (exception instanceof UnauthorizedException) {
      return ErrorCode.UNAUTHORIZED;
    }
    if (exception instanceof ForbiddenException) {
      return ErrorCode.FORBIDDEN;
    }
    if (exception instanceof ConflictException) {
      return ErrorCode.CONFLICT;
    }
    if (exception instanceof BadRequestException) {
      return ErrorCode.VALIDATION_ERROR;
    }

    // Check status code
    switch (status) {
      case HttpStatus.NOT_FOUND:
        return ErrorCode.NOT_FOUND;
      case HttpStatus.UNAUTHORIZED:
        return ErrorCode.UNAUTHORIZED;
      case HttpStatus.FORBIDDEN:
        return ErrorCode.FORBIDDEN;
      case HttpStatus.CONFLICT:
        return ErrorCode.CONFLICT;
      case HttpStatus.BAD_REQUEST:
        return ErrorCode.VALIDATION_ERROR;
      case HttpStatus.TOO_MANY_REQUESTS:
        return ErrorCode.RATE_LIMIT_EXCEEDED;
      case HttpStatus.GATEWAY_TIMEOUT:
      case HttpStatus.REQUEST_TIMEOUT:
        return ErrorCode.TIMEOUT;
      default:
        return ErrorCode.INTERNAL_ERROR;
    }
  }

  /**
   * Check if error is a Mongoose error
   */
  private isMongooseError(error: any): boolean {
    return (
      error instanceof MongooseError ||
      error.name === 'ValidationError' ||
      error.name === 'CastError' ||
      error.code === 11000 ||
      error.name === 'MongoError' ||
      error.name === 'MongoServerError'
    );
  }

  /**
   * Check if error is a timeout error
   */
  private isTimeoutError(error: any): boolean {
    return (
      error.name === 'TimeoutError' ||
      error.code === 'ETIMEDOUT' ||
      error.message?.includes('timeout') ||
      error.message?.includes('timed out')
    );
  }

  /**
   * Get or create request ID
   */
  private getOrCreateRequestId(request: ExpressRequest): string {
    // Check if request ID already exists (set by RequestIdInterceptor)
    const existingId = (request as any)[REQUEST_ID_KEY] || request.headers['x-request-id'];
    if (existingId && typeof existingId === 'string') {
      return existingId;
    }
    // Generate new UUID as fallback
    return uuidv4();
  }

  /**
   * Log error with context for debugging and error tracking
   */
  private logError(
    exception: unknown,
    errorResponse: ErrorResponse,
    request: ExpressRequest,
  ): void {
    const logContext = {
      request_id: errorResponse.request_id,
      error_code: errorResponse.error,
      status_code: errorResponse.statusCode,
      method: request.method,
      path: request.url,
      user_agent: request.headers['user-agent'],
      ip: request.ip,
    };

    const message = `Exception caught: ${errorResponse.message}`;
    const stack = exception instanceof Error ? exception.stack : undefined;

    // Use structured logger
    this.logger.error(message, stack, {
      ...logContext,
      details: errorResponse.details,
    });

    // TODO: Integrate with error tracking service (Sentry, etc.)
    // this.sentryService.captureException(exception, logContext);
  }
}
