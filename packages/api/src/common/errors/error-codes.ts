/**
 * Error Code Reference for State Tracking API
 *
 * Unified error codes and remediation guidance for the API.
 * Used by AllExceptionsFilter to provide consistent error responses.
 */

import { HttpStatus } from '@nestjs/common';

/**
 * Error code mapping with remediation steps
 */
export const ERROR_CODE_REFERENCE: Record<string, {
  code: string;
  httpStatus: number;
  message: string;
  remediation: string;
  severity: 'critical' | 'error' | 'warning';
}> = {
  // Validation errors (400)
  VALIDATION_ERROR: {
    code: 'VAL_ERROR_INVALID_FORMAT',
    httpStatus: HttpStatus.BAD_REQUEST,
    message: 'Request validation failed',
    remediation: 'Check your input format and ensure all required fields are provided',
    severity: 'error',
  },

  // Authentication errors (401)
  UNAUTHORIZED: {
    code: 'AUTH_ERROR_INVALID_CREDENTIALS',
    httpStatus: HttpStatus.UNAUTHORIZED,
    message: 'Authentication failed',
    remediation: 'Verify your API key is set and valid. Set STATE_TRACKING_API_KEY environment variable.',
    severity: 'error',
  },

  // Authorization errors (403)
  FORBIDDEN: {
    code: 'AUTH_ERROR_INSUFFICIENT_SCOPES',
    httpStatus: HttpStatus.FORBIDDEN,
    message: 'Access denied',
    remediation: 'Your API key lacks required permissions for this operation',
    severity: 'error',
  },

  // Not found errors (404)
  NOT_FOUND: {
    code: 'GH_ERROR_NOT_FOUND',
    httpStatus: HttpStatus.NOT_FOUND,
    message: 'Resource not found',
    remediation: 'Verify the resource exists and check the resource ID',
    severity: 'error',
  },

  // Conflict errors (409)
  CONFLICT: {
    code: 'API_ERROR_CONFLICT',
    httpStatus: HttpStatus.CONFLICT,
    message: 'Resource conflict',
    remediation: 'Resolve the conflict (e.g., use a different name or delete the existing resource)',
    severity: 'error',
  },

  // Rate limit errors (429)
  RATE_LIMIT_EXCEEDED: {
    code: 'API_ERROR_RATE_LIMIT',
    httpStatus: HttpStatus.TOO_MANY_REQUESTS,
    message: 'Rate limit exceeded',
    remediation: 'Wait a few minutes before retrying. Check the Retry-After header for guidance.',
    severity: 'warning',
  },

  // Timeout errors (504)
  TIMEOUT: {
    code: 'NET_ERROR_TIMEOUT',
    httpStatus: HttpStatus.GATEWAY_TIMEOUT,
    message: 'Request timeout',
    remediation: 'The operation took too long to complete. Try again or contact support.',
    severity: 'warning',
  },

  // Database errors (500)
  DATABASE_ERROR: {
    code: 'DB_ERROR_QUERY_FAILED',
    httpStatus: HttpStatus.INTERNAL_SERVER_ERROR,
    message: 'Database operation failed',
    remediation: 'A database error occurred. Check your data and try again, or contact support.',
    severity: 'critical',
  },

  // Internal errors (500)
  INTERNAL_ERROR: {
    code: 'ERROR_UNKNOWN',
    httpStatus: HttpStatus.INTERNAL_SERVER_ERROR,
    message: 'Internal server error',
    remediation: 'An unexpected error occurred. Try again or contact support.',
    severity: 'critical',
  },
};

/**
 * Get error code details by error code string
 */
export function getErrorCodeDetails(errorCodeString: string) {
  return ERROR_CODE_REFERENCE[errorCodeString] || ERROR_CODE_REFERENCE.INTERNAL_ERROR;
}

/**
 * Format remediation message with context
 */
export function formatRemediation(
  baseRemediation: string,
  context?: Record<string, string>
): string {
  if (!context) {
    return baseRemediation;
  }

  let formatted = baseRemediation;
  Object.entries(context).forEach(([key, value]) => {
    formatted = formatted.replace(`{${key}}`, value);
  });
  return formatted;
}

/**
 * Common remediation messages
 */
export const REMEDIATION_MESSAGES = {
  MISSING_FIELD: (field: string) =>
    `Provide the required field: ${field}`,

  INVALID_ENUM: (field: string, validValues: string[]) =>
    `${field} must be one of: ${validValues.join(', ')}`,

  DATABASE_CONNECTION: () =>
    'Database connection failed. Verify connection string and credentials are correct.',

  RETRY_EXPONENTIAL: (attempt: number, maxRetries: number) =>
    `Attempt ${attempt}/${maxRetries}. The system will retry automatically.`,

  API_KEY_SETUP: () =>
    'Set your API key: export STATE_TRACKING_API_KEY=your-key-here',

  CONTACT_SUPPORT: () =>
    'If the issue persists, contact support with the request ID provided.',

  CHECK_PERMISSIONS: (operation: string) =>
    `Ensure your credentials have permission to ${operation}`,
};
