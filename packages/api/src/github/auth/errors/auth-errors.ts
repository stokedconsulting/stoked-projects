/**
 * Custom error codes for authentication failures
 */
export enum AuthErrorCode {
  TOKEN_NOT_FOUND = 'AUTH_TOKEN_NOT_FOUND',
  INSUFFICIENT_SCOPES = 'AUTH_INSUFFICIENT_SCOPES',
  TOKEN_EXPIRED = 'AUTH_TOKEN_EXPIRED',
  TOKEN_INVALID = 'AUTH_TOKEN_INVALID',
  VALIDATION_FAILED = 'AUTH_VALIDATION_FAILED',
}

/**
 * Base authentication error
 */
export class AuthError extends Error {
  constructor(
    public readonly code: AuthErrorCode,
    message: string,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'AuthError';
  }
}

/**
 * Error thrown when no valid token is found from any source
 */
export class TokenNotFoundError extends AuthError {
  constructor(sources: string[]) {
    super(
      AuthErrorCode.TOKEN_NOT_FOUND,
      'No valid GitHub token found',
      {
        attemptedSources: sources,
        remediation: [
          '1. Set GITHUB_TOKEN environment variable',
          '2. Configure token in application config',
          '3. Authenticate via VSCode (if using VSCode extension)',
        ],
      },
    );
  }
}

/**
 * Error thrown when token has insufficient scopes
 */
export class InsufficientScopesError extends AuthError {
  constructor(
    public readonly requiredScopes: string[],
    public readonly actualScopes: string[],
  ) {
    const missing = requiredScopes.filter((s) => !actualScopes.includes(s));
    super(
      AuthErrorCode.INSUFFICIENT_SCOPES,
      `Token missing required scopes: ${missing.join(', ')}`,
      {
        requiredScopes,
        actualScopes,
        missingScopes: missing,
        remediation: [
          'Generate a new token with the following scopes:',
          ...requiredScopes.map((s) => `  - ${s}`),
        ],
      },
    );
  }
}

/**
 * Error thrown when token has expired and cannot be refreshed
 */
export class TokenExpiredError extends AuthError {
  constructor(expiresAt: Date) {
    super(
      AuthErrorCode.TOKEN_EXPIRED,
      `Token expired at ${expiresAt.toISOString()}`,
      {
        expiresAt: expiresAt.toISOString(),
        remediation: [
          'Token has expired and automatic refresh failed',
          'Please obtain a new token:',
          '1. Generate a new personal access token from GitHub',
          '2. Update your GITHUB_TOKEN environment variable',
          '3. Or re-authenticate via VSCode',
        ],
      },
    );
  }
}

/**
 * Error thrown when token validation fails
 */
export class TokenValidationError extends AuthError {
  constructor(reason: string) {
    super(
      AuthErrorCode.VALIDATION_FAILED,
      `Token validation failed: ${reason}`,
      {
        remediation: [
          'Verify your GitHub token is valid',
          'Check that the token has not been revoked',
          'Ensure network connectivity to GitHub API',
        ],
      },
    );
  }
}
