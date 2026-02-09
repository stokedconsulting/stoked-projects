import {
  AuthError,
  AuthErrorCode,
  TokenNotFoundError,
  InsufficientScopesError,
  TokenExpiredError,
  TokenValidationError,
} from './auth-errors';

describe('Auth Errors', () => {
  describe('AuthError', () => {
    it('should create error with code, message, and details', () => {
      // Arrange & Act
      const error = new AuthError(
        AuthErrorCode.TOKEN_INVALID,
        'Test error message',
        { detail1: 'value1', detail2: 'value2' },
      );

      // Assert
      expect(error).toBeInstanceOf(Error);
      expect(error.name).toBe('AuthError');
      expect(error.code).toBe(AuthErrorCode.TOKEN_INVALID);
      expect(error.message).toBe('Test error message');
      expect(error.details).toEqual({ detail1: 'value1', detail2: 'value2' });
    });
  });

  describe('TokenNotFoundError', () => {
    it('should create error with attempted sources', () => {
      // Arrange & Act
      const error = new TokenNotFoundError(['vscode', 'config', 'env']);

      // Assert
      expect(error).toBeInstanceOf(AuthError);
      expect(error.code).toBe(AuthErrorCode.TOKEN_NOT_FOUND);
      expect(error.message).toContain('No valid GitHub token found');
      expect(error.details?.attemptedSources).toEqual([
        'vscode',
        'config',
        'env',
      ]);
    });

    it('should include remediation steps', () => {
      // Arrange & Act
      const error = new TokenNotFoundError(['env', 'config']);

      // Assert
      expect(error.details?.remediation).toBeDefined();
      expect(Array.isArray(error.details?.remediation)).toBe(true);
      expect(error.details?.remediation).toEqual(
        expect.arrayContaining([
          expect.stringContaining('GITHUB_TOKEN'),
          expect.stringContaining('config'),
          expect.stringContaining('VSCode'),
        ]),
      );
    });
  });

  describe('InsufficientScopesError', () => {
    it('should create error with required and actual scopes', () => {
      // Arrange
      const requiredScopes = ['repo', 'read:org', 'project'];
      const actualScopes = ['repo'];

      // Act
      const error = new InsufficientScopesError(requiredScopes, actualScopes);

      // Assert
      expect(error).toBeInstanceOf(AuthError);
      expect(error.code).toBe(AuthErrorCode.INSUFFICIENT_SCOPES);
      expect(error.requiredScopes).toEqual(requiredScopes);
      expect(error.actualScopes).toEqual(actualScopes);
      expect(error.message).toContain('read:org');
      expect(error.message).toContain('project');
    });

    it('should calculate missing scopes', () => {
      // Arrange
      const requiredScopes = ['repo', 'read:org', 'project', 'workflow'];
      const actualScopes = ['repo', 'workflow'];

      // Act
      const error = new InsufficientScopesError(requiredScopes, actualScopes);

      // Assert
      expect(error.details?.missingScopes).toEqual(['read:org', 'project']);
    });

    it('should include remediation steps with scope list', () => {
      // Arrange
      const requiredScopes = ['repo', 'read:org', 'project'];
      const actualScopes = ['repo'];

      // Act
      const error = new InsufficientScopesError(requiredScopes, actualScopes);

      // Assert
      expect(error.details?.remediation).toBeDefined();
      expect(Array.isArray(error.details?.remediation)).toBe(true);
      expect(error.details?.remediation).toEqual(
        expect.arrayContaining([
          expect.stringContaining('Generate a new token'),
          expect.stringContaining('repo'),
          expect.stringContaining('read:org'),
          expect.stringContaining('project'),
        ]),
      );
    });

    it('should handle case where all scopes are missing', () => {
      // Arrange
      const requiredScopes = ['repo', 'read:org'];
      const actualScopes: string[] = [];

      // Act
      const error = new InsufficientScopesError(requiredScopes, actualScopes);

      // Assert
      expect(error.details?.missingScopes).toEqual(requiredScopes);
    });

    it('should handle case where no scopes are missing', () => {
      // Arrange
      const requiredScopes = ['repo'];
      const actualScopes = ['repo', 'read:org', 'project'];

      // Act
      const error = new InsufficientScopesError(requiredScopes, actualScopes);

      // Assert
      expect(error.details?.missingScopes).toEqual([]);
    });
  });

  describe('TokenExpiredError', () => {
    it('should create error with expiration timestamp', () => {
      // Arrange
      const expiresAt = new Date('2024-01-01T00:00:00Z');

      // Act
      const error = new TokenExpiredError(expiresAt);

      // Assert
      expect(error).toBeInstanceOf(AuthError);
      expect(error.code).toBe(AuthErrorCode.TOKEN_EXPIRED);
      expect(error.message).toContain('2024-01-01T00:00:00.000Z');
      expect(error.details?.expiresAt).toBe('2024-01-01T00:00:00.000Z');
    });

    it('should include remediation steps', () => {
      // Arrange
      const expiresAt = new Date('2024-01-01T00:00:00Z');

      // Act
      const error = new TokenExpiredError(expiresAt);

      // Assert
      expect(error.details?.remediation).toBeDefined();
      expect(Array.isArray(error.details?.remediation)).toBe(true);
      expect(error.details?.remediation).toEqual(
        expect.arrayContaining([
          expect.stringContaining('expired'),
          expect.stringContaining('new token'),
          expect.stringContaining('GITHUB_TOKEN'),
        ]),
      );
    });
  });

  describe('TokenValidationError', () => {
    it('should create error with validation reason', () => {
      // Arrange & Act
      const error = new TokenValidationError('Invalid token format');

      // Assert
      expect(error).toBeInstanceOf(AuthError);
      expect(error.code).toBe(AuthErrorCode.VALIDATION_FAILED);
      expect(error.message).toContain('Invalid token format');
    });

    it('should include remediation steps', () => {
      // Arrange & Act
      const error = new TokenValidationError('API call failed');

      // Assert
      expect(error.details?.remediation).toBeDefined();
      expect(Array.isArray(error.details?.remediation)).toBe(true);
      expect(error.details?.remediation).toEqual(
        expect.arrayContaining([
          expect.stringContaining('valid'),
          expect.stringContaining('revoked'),
          expect.stringContaining('network'),
        ]),
      );
    });
  });
});
