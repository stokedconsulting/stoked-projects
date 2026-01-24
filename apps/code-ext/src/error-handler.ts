/**
 * Error Handler for VSCode Extension
 *
 * Provides consistent error handling with standardized error codes,
 * user-friendly messages, and remediation steps.
 */

import * as vscode from 'vscode';

/**
 * Standardized error codes for VSCode extension
 */
export enum ErrorCode {
  // Authentication errors
  AUTH_CRITICAL_MISSING_KEY = 'AUTH_CRITICAL_MISSING_KEY',
  AUTH_ERROR_INVALID_CREDENTIALS = 'AUTH_ERROR_INVALID_CREDENTIALS',
  AUTH_ERROR_INSUFFICIENT_SCOPES = 'AUTH_ERROR_INSUFFICIENT_SCOPES',
  AUTH_ERROR_GITHUB_OAUTH_RESTRICTION = 'AUTH_ERROR_GITHUB_OAUTH_RESTRICTION',

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

  // State management errors
  STATE_ERROR_NO_SESSION = 'STATE_ERROR_NO_SESSION',
  STATE_ERROR_SESSION_EXPIRED = 'STATE_ERROR_SESSION_EXPIRED',
  STATE_ERROR_INVALID_STATE = 'STATE_ERROR_INVALID_STATE',

  // VSCode extension specific errors
  VSC_ERROR_NO_WORKSPACE = 'VSC_ERROR_NO_WORKSPACE',
  VSC_ERROR_GIT_EXTENSION_NOT_FOUND = 'VSC_ERROR_GIT_EXTENSION_NOT_FOUND',
  VSC_ERROR_NO_GIT_REPO = 'VSC_ERROR_NO_GIT_REPO',
  VSC_ERROR_NO_REMOTE = 'VSC_ERROR_NO_REMOTE',
  VSC_ERROR_INVALID_GH_URL = 'VSC_ERROR_INVALID_GH_URL',
  VSC_ERROR_REPOSITORY_NOT_FOUND = 'VSC_ERROR_REPOSITORY_NOT_FOUND',
  VSC_ERROR_STATUS_FIELD_NOT_FOUND = 'VSC_ERROR_STATUS_FIELD_NOT_FOUND',
  VSC_ERROR_INVALID_PROJECT = 'VSC_ERROR_INVALID_PROJECT',
  VSC_ERROR_LINK_FAILED = 'VSC_ERROR_LINK_FAILED',
  VSC_ERROR_UNLINK_FAILED = 'VSC_ERROR_UNLINK_FAILED',

  // Generic errors
  ERROR_UNKNOWN = 'ERROR_UNKNOWN',
}

/**
 * Structured error response
 */
export interface ErrorDetails {
  errorCode: ErrorCode;
  message: string;
  remediation?: string;
  details?: string;
  originalError?: Error;
}

/**
 * Custom error class for extension errors
 */
export class ExtensionError extends Error {
  errorCode: ErrorCode;
  remediation?: string;
  details?: string;
  originalError?: Error;

  constructor(
    errorCode: ErrorCode,
    message: string,
    remediation?: string,
    details?: string,
    originalError?: Error
  ) {
    super(message);
    this.name = 'ExtensionError';
    this.errorCode = errorCode;
    this.remediation = remediation;
    this.details = details;
    this.originalError = originalError;

    // Maintain prototype chain for instanceof checks
    Object.setPrototypeOf(this, ExtensionError.prototype);
  }

  /**
   * Get full error message with code, message, and remediation
   */
  getFullMessage(): string {
    let msg = `[${this.errorCode}] ${this.message}`;
    if (this.details) {
      msg += `\n\nDetails: ${this.details}`;
    }
    if (this.remediation) {
      msg += `\n\nFix: ${this.remediation}`;
    }
    return msg;
  }

  /**
   * Convert to JSON for logging
   */
  toJSON(): ErrorDetails {
    return {
      errorCode: this.errorCode,
      message: this.message,
      remediation: this.remediation,
      details: this.details,
    };
  }
}

/**
 * Error handler service for VSCode extension
 */
export class ExtensionErrorHandler {
  private outputChannel: vscode.OutputChannel;

  constructor(outputChannel: vscode.OutputChannel) {
    this.outputChannel = outputChannel;
  }

  /**
   * Handle error and show to user
   * @param error - Error to handle
   * @param showModal - Show as modal dialog instead of toast
   */
  async handleError(error: unknown, showModal: boolean = false): Promise<void> {
    const errorDetails = this.parseError(error);
    await this.logError(errorDetails);
    await this.showErrorToUser(errorDetails, showModal);
  }

  /**
   * Parse error into structured ErrorDetails
   */
  private parseError(error: unknown): ErrorDetails {
    if (error instanceof ExtensionError) {
      return error.toJSON();
    }

    if (error instanceof Error) {
      // Try to detect error type from message
      const message = error.message;

      if (message.includes('No workspace folder')) {
        return {
          errorCode: ErrorCode.VSC_ERROR_NO_WORKSPACE,
          message: 'No workspace folder is open',
          remediation: 'Open a folder containing a Git repository',
          originalError: error,
        };
      }

      if (message.includes('Git extension')) {
        return {
          errorCode: ErrorCode.VSC_ERROR_GIT_EXTENSION_NOT_FOUND,
          message: 'Git extension not found',
          remediation: 'Ensure VS Code has Git support installed',
          originalError: error,
        };
      }

      if (message.includes('No git repository')) {
        return {
          errorCode: ErrorCode.VSC_ERROR_NO_GIT_REPO,
          message: 'No git repository found',
          remediation: 'Initialize a git repository with "git init"',
          originalError: error,
        };
      }

      if (message.includes('No remote')) {
        return {
          errorCode: ErrorCode.VSC_ERROR_NO_REMOTE,
          message: 'No remote found in current repository',
          remediation: 'Add a remote with "git remote add origin <url>"',
          originalError: error,
        };
      }

      if (message.includes('Parse GitHub URL')) {
        return {
          errorCode: ErrorCode.VSC_ERROR_INVALID_GH_URL,
          message: 'Could not parse GitHub URL from remote',
          remediation: 'Verify remote is a valid GitHub URL',
          originalError: error,
        };
      }

      if (message.includes('GitHub API') && message.includes('rate limit')) {
        return {
          errorCode: ErrorCode.GH_ERROR_RATE_LIMIT,
          message: 'GitHub API rate limit exceeded',
          remediation: 'Wait a few minutes and try again, or upgrade your GitHub account',
          originalError: error,
        };
      }

      if (message.includes('authentication') || message.includes('GitHub')) {
        return {
          errorCode: ErrorCode.AUTH_ERROR_INVALID_CREDENTIALS,
          message: 'GitHub authentication failed',
          remediation: 'Run "gh auth login" to re-authenticate',
          originalError: error,
        };
      }

      if (message.includes('not found')) {
        return {
          errorCode: ErrorCode.GH_ERROR_NOT_FOUND,
          message: error.message,
          remediation: 'Verify the repository exists and you have access',
          originalError: error,
        };
      }

      // Generic error
      return {
        errorCode: ErrorCode.ERROR_UNKNOWN,
        message: error.message,
        details: error.stack,
        originalError: error,
      };
    }

    // Unknown error type
    return {
      errorCode: ErrorCode.ERROR_UNKNOWN,
      message: 'An unknown error occurred',
      details: String(error),
    };
  }

  /**
   * Log error to output channel
   */
  private async logError(errorDetails: ErrorDetails): Promise<void> {
    const timestamp = new Date().toISOString();
    const logEntry = `[${timestamp}] ${errorDetails.errorCode}: ${errorDetails.message}`;

    this.outputChannel.appendLine(logEntry);

    if (errorDetails.details) {
      this.outputChannel.appendLine(`Details: ${errorDetails.details}`);
    }

    if (errorDetails.remediation) {
      this.outputChannel.appendLine(`Remediation: ${errorDetails.remediation}`);
    }

    this.outputChannel.appendLine('---');
  }

  /**
   * Show error to user via toast or modal
   */
  private async showErrorToUser(errorDetails: ErrorDetails, showModal: boolean = false): Promise<void> {
    const title = `[${errorDetails.errorCode}] ${errorDetails.message}`;
    const message = errorDetails.remediation
      ? `${errorDetails.message}\n\n${errorDetails.remediation}`
      : errorDetails.message;

    if (showModal) {
      await vscode.window.showErrorMessage(message, { modal: true }, 'Open Output Channel');
      // Note: In actual implementation, would handle action response
    } else {
      vscode.window.showErrorMessage(message);
    }
  }

  /**
   * Show warning to user
   */
  async showWarning(message: string, remediation?: string): Promise<void> {
    const fullMessage = remediation ? `${message}\n\n${remediation}` : message;
    vscode.window.showWarningMessage(fullMessage);
  }

  /**
   * Show info to user
   */
  async showInfo(message: string): Promise<void> {
    vscode.window.showInformationMessage(message);
  }
}

/**
 * Helper function to safely execute async operations with error handling
 */
export async function executeWithErrorHandling<T>(
  operation: () => Promise<T>,
  errorHandler: ExtensionErrorHandler,
  operationName: string = 'Operation'
): Promise<T | null> {
  try {
    return await operation();
  } catch (error) {
    console.error(`${operationName} failed:`, error);
    await errorHandler.handleError(error);
    return null;
  }
}

/**
 * Helper to create error with consistent format
 */
export function createError(
  code: ErrorCode,
  message: string,
  remediation?: string,
  details?: string
): ExtensionError {
  return new ExtensionError(code, message, remediation, details);
}
