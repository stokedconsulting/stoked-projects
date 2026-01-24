/**
 * Error Handling for MCP Server
 *
 * Provides consistent error classes with standardized error codes,
 * user-friendly messages, and remediation steps across all tools.
 */

/**
 * Standardized error codes for MCP server
 */
export enum ErrorCode {
  // Authentication errors
  AUTH_CRITICAL_MISSING_KEY = 'AUTH_CRITICAL_MISSING_KEY',
  AUTH_ERROR_INVALID_CREDENTIALS = 'AUTH_ERROR_INVALID_CREDENTIALS',
  AUTH_ERROR_INSUFFICIENT_SCOPES = 'AUTH_ERROR_INSUFFICIENT_SCOPES',

  // Network errors
  NET_ERROR_TIMEOUT = 'NET_ERROR_TIMEOUT',
  NET_ERROR_CONNECTION_FAILED = 'NET_ERROR_CONNECTION_FAILED',
  NET_ERROR_DNS_RESOLUTION = 'NET_ERROR_DNS_RESOLUTION',

  // GitHub API errors
  GH_ERROR_RATE_LIMIT = 'GH_ERROR_RATE_LIMIT',
  GH_ERROR_NOT_FOUND = 'GH_ERROR_NOT_FOUND',
  GH_ERROR_INVALID_QUERY = 'GH_ERROR_INVALID_QUERY',
  GH_ERROR_GRAPHQL_ERROR = 'GH_ERROR_GRAPHQL_ERROR',
  GH_ERROR_MUTATION_FAILED = 'GH_ERROR_MUTATION_FAILED',

  // Validation errors
  VAL_ERROR_MISSING_FIELD = 'VAL_ERROR_MISSING_FIELD',
  VAL_ERROR_INVALID_FORMAT = 'VAL_ERROR_INVALID_FORMAT',
  VAL_ERROR_INVALID_ENUM = 'VAL_ERROR_INVALID_ENUM',

  // API errors
  API_ERROR_NOT_FOUND = 'API_ERROR_NOT_FOUND',
  API_ERROR_UNAUTHORIZED = 'API_ERROR_UNAUTHORIZED',
  API_ERROR_CONFLICT = 'API_ERROR_CONFLICT',
  API_ERROR_RATE_LIMIT = 'API_ERROR_RATE_LIMIT',
  API_ERROR_SERVER = 'API_ERROR_SERVER',

  // Configuration errors
  CONFIG_CRITICAL_MISSING_ENV = 'CONFIG_CRITICAL_MISSING_ENV',
  CONFIG_ERROR_INVALID_VALUE = 'CONFIG_ERROR_INVALID_VALUE',

  // Generic errors
  ERROR_UNKNOWN = 'ERROR_UNKNOWN',
}

/**
 * Error severity levels
 */
export enum ErrorSeverity {
  CRITICAL = 'critical',
  ERROR = 'error',
  WARNING = 'warning',
}

/**
 * Structured error response
 */
export interface ErrorResponse {
  errorCode: ErrorCode;
  message: string;
  remediation?: string;
  details?: string | Record<string, any>;
  severity?: ErrorSeverity;
}

/**
 * Base error class for all MCP errors
 */
export class MCPError extends Error {
  errorCode: ErrorCode;
  remediation?: string;
  details?: string | Record<string, any>;
  severity: ErrorSeverity;

  constructor(
    errorCode: ErrorCode,
    message: string,
    remediation?: string,
    details?: string | Record<string, any>,
    severity: ErrorSeverity = ErrorSeverity.ERROR
  ) {
    super(message);
    this.name = 'MCPError';
    this.errorCode = errorCode;
    this.remediation = remediation;
    this.details = details;
    this.severity = severity;

    // Maintain prototype chain
    Object.setPrototypeOf(this, MCPError.prototype);
  }

  /**
   * Convert to error response format
   */
  toErrorResponse(): ErrorResponse {
    return {
      errorCode: this.errorCode,
      message: this.message,
      remediation: this.remediation,
      details: this.details,
      severity: this.severity,
    };
  }
}

/**
 * Authentication error (401, 403)
 */
export class AuthenticationError extends MCPError {
  constructor(
    message: string,
    remediation?: string,
    details?: string | Record<string, any>
  ) {
    const remediationText = remediation || 'Verify your API key is set and valid';
    super(
      ErrorCode.AUTH_ERROR_INVALID_CREDENTIALS,
      message,
      remediationText,
      details,
      ErrorSeverity.ERROR
    );
    this.name = 'AuthenticationError';
    Object.setPrototypeOf(this, AuthenticationError.prototype);
  }
}

/**
 * Authorization error (missing scopes)
 */
export class AuthorizationError extends MCPError {
  constructor(
    scopes: string[],
    operation: string
  ) {
    const message = `Insufficient permissions for: ${operation}`;
    const remediation = `Required scopes: ${scopes.join(', ')}. Run 'gh auth login' with these scopes.`;
    super(
      ErrorCode.AUTH_ERROR_INSUFFICIENT_SCOPES,
      message,
      remediation
    );
    this.name = 'AuthorizationError';
    Object.setPrototypeOf(this, AuthorizationError.prototype);
  }
}

/**
 * Timeout error
 */
export class TimeoutError extends MCPError {
  timeoutMs: number;

  constructor(
    timeoutMs: number,
    operation: string = 'request'
  ) {
    const message = `${operation} timed out after ${timeoutMs}ms`;
    const remediation = 'Check network connectivity and try again';
    super(
      ErrorCode.NET_ERROR_TIMEOUT,
      message,
      remediation,
      undefined,
      ErrorSeverity.WARNING
    );
    this.name = 'TimeoutError';
    this.timeoutMs = timeoutMs;
    Object.setPrototypeOf(this, TimeoutError.prototype);
  }
}

/**
 * Not found error (404)
 */
export class NotFoundError extends MCPError {
  constructor(
    resource: string,
    identifier: string
  ) {
    const message = `${resource} not found: ${identifier}`;
    const remediation = `Verify the ${resource.toLowerCase()} exists and you have access`;
    super(
      ErrorCode.GH_ERROR_NOT_FOUND,
      message,
      remediation
    );
    this.name = 'NotFoundError';
    Object.setPrototypeOf(this, NotFoundError.prototype);
  }
}

/**
 * Rate limit error (429)
 */
export class RateLimitError extends MCPError {
  retryAfter?: number;

  constructor(
    message: string,
    retryAfter?: number,
    details?: string | Record<string, any>
  ) {
    const remediationText = retryAfter
      ? `Wait ${retryAfter} seconds before retrying`
      : 'Wait a few minutes before retrying';
    super(
      ErrorCode.GH_ERROR_RATE_LIMIT,
      message,
      remediationText,
      details,
      ErrorSeverity.WARNING
    );
    this.name = 'RateLimitError';
    this.retryAfter = retryAfter;
    Object.setPrototypeOf(this, RateLimitError.prototype);
  }
}

/**
 * Server error (5xx)
 */
export class ServerError extends MCPError {
  statusCode: number;

  constructor(
    statusCode: number,
    message: string,
    details?: string | Record<string, any>
  ) {
    const remediationText = statusCode === 503
      ? 'Service is temporarily unavailable. Try again in a few minutes.'
      : 'An error occurred on the server. Try again or contact support.';
    super(
      ErrorCode.API_ERROR_SERVER,
      message,
      remediationText,
      details,
      ErrorSeverity.CRITICAL
    );
    this.name = 'ServerError';
    this.statusCode = statusCode;
    Object.setPrototypeOf(this, ServerError.prototype);
  }
}

/**
 * Validation error (400)
 */
export class ValidationError extends MCPError {
  constructor(
    message: string,
    details?: string | Record<string, any>
  ) {
    const remediation = 'Check your input format and try again';
    super(
      ErrorCode.VAL_ERROR_INVALID_FORMAT,
      message,
      remediation,
      details,
      ErrorSeverity.ERROR
    );
    this.name = 'ValidationError';
    Object.setPrototypeOf(this, ValidationError.prototype);
  }
}

/**
 * Conflict error (409)
 */
export class ConflictError extends MCPError {
  constructor(
    resource: string,
    conflict: string
  ) {
    const message = `${resource} conflict: ${conflict}`;
    const remediation = `Resolve the conflict and try again`;
    super(
      ErrorCode.API_ERROR_CONFLICT,
      message,
      remediation,
      undefined,
      ErrorSeverity.ERROR
    );
    this.name = 'ConflictError';
    Object.setPrototypeOf(this, ConflictError.prototype);
  }
}

/**
 * Configuration error
 */
export class ConfigurationError extends MCPError {
  constructor(
    variable: string,
    issue: string
  ) {
    const message = `Configuration error: ${variable} - ${issue}`;
    const remediation = `Set the ${variable} environment variable and restart`;
    super(
      ErrorCode.CONFIG_CRITICAL_MISSING_ENV,
      message,
      remediation,
      undefined,
      ErrorSeverity.CRITICAL
    );
    this.name = 'ConfigurationError';
    Object.setPrototypeOf(this, ConfigurationError.prototype);
  }
}

/**
 * Helper function to convert HTTP status code to error
 */
export function statusCodeToError(
  statusCode: number,
  message: string,
  details?: string | Record<string, any>
): MCPError {
  switch (statusCode) {
    case 401:
    case 403:
      return new AuthenticationError(message, undefined, details);
    case 404:
      return new NotFoundError('Resource', message);
    case 409:
      return new ConflictError('Resource', message);
    case 429:
      return new RateLimitError(message, undefined, details);
    case 500:
    case 502:
    case 503:
    case 504:
      return new ServerError(statusCode, message, details);
    case 400:
      return new ValidationError(message, details);
    default:
      return new MCPError(
        ErrorCode.ERROR_UNKNOWN,
        `HTTP ${statusCode}: ${message}`,
        'Check the error details and contact support if issue persists',
        details
      );
  }
}

/**
 * Helper to safely convert errors to consistent format
 */
export function toErrorResponse(error: unknown): ErrorResponse {
  if (error instanceof MCPError) {
    return error.toErrorResponse();
  }

  if (error instanceof Error) {
    return {
      errorCode: ErrorCode.ERROR_UNKNOWN,
      message: error.message,
      severity: ErrorSeverity.ERROR,
    };
  }

  return {
    errorCode: ErrorCode.ERROR_UNKNOWN,
    message: 'An unknown error occurred',
    severity: ErrorSeverity.ERROR,
  };
}
