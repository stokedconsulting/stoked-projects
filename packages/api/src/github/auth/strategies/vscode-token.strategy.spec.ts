import { VSCodeTokenStrategy, VSCodeAuthSession } from './vscode-token.strategy';
import { TokenSource } from '../types';

describe('VSCodeTokenStrategy', () => {
  let strategy: VSCodeTokenStrategy;

  beforeEach(() => {
    strategy = new VSCodeTokenStrategy();
  });

  describe('getToken', () => {
    it('should return token from VSCode session provider', async () => {
      // Arrange
      const mockSession: VSCodeAuthSession = {
        accessToken: 'ghp_vscode_test_token',
        scopes: ['repo', 'read:org', 'project'],
        account: {
          id: '12345',
          label: 'test-user',
        },
      };

      strategy.setSessionProvider(async () => mockSession);

      // Act
      const result = await strategy.getToken();

      // Assert
      expect(result).not.toBeNull();
      expect(result?.token).toBe('ghp_vscode_test_token');
      expect(result?.source).toBe(TokenSource.VSCODE);
      expect(result?.scopes).toEqual(['repo', 'read:org', 'project']);
      expect(result?.expiresAt).toBeNull();
    });

    it('should return null when no session provider is set', async () => {
      // Act
      const result = await strategy.getToken();

      // Assert
      expect(result).toBeNull();
    });

    it('should return null when session provider returns null', async () => {
      // Arrange
      strategy.setSessionProvider(async () => null);

      // Act
      const result = await strategy.getToken();

      // Assert
      expect(result).toBeNull();
    });

    it('should handle empty scopes array', async () => {
      // Arrange
      const mockSession: VSCodeAuthSession = {
        accessToken: 'ghp_vscode_test_token',
        scopes: [],
        account: {
          id: '12345',
          label: 'test-user',
        },
      };

      strategy.setSessionProvider(async () => mockSession);

      // Act
      const result = await strategy.getToken();

      // Assert
      expect(result).not.toBeNull();
      expect(result?.scopes).toEqual([]);
    });

    it('should handle undefined scopes', async () => {
      // Arrange
      const mockSession: any = {
        accessToken: 'ghp_vscode_test_token',
        scopes: undefined,
        account: {
          id: '12345',
          label: 'test-user',
        },
      };

      strategy.setSessionProvider(async () => mockSession);

      // Act
      const result = await strategy.getToken();

      // Assert
      expect(result).not.toBeNull();
      expect(result?.scopes).toEqual([]);
    });
  });

  describe('refreshToken', () => {
    it('should return fresh token from session provider', async () => {
      // Arrange
      let tokenCounter = 1;
      const mockSessionProvider = async (): Promise<VSCodeAuthSession> => ({
        accessToken: `ghp_vscode_token_${tokenCounter++}`,
        scopes: ['repo', 'read:org'],
        account: {
          id: '12345',
          label: 'test-user',
        },
      });

      strategy.setSessionProvider(mockSessionProvider);

      // Act
      const firstToken = await strategy.getToken();
      const refreshedToken = await strategy.refreshToken();

      // Assert
      expect(firstToken?.token).toBe('ghp_vscode_token_1');
      expect(refreshedToken?.token).toBe('ghp_vscode_token_2');
    });

    it('should return null when no session provider is set', async () => {
      // Act
      const result = await strategy.refreshToken();

      // Assert
      expect(result).toBeNull();
    });

    it('should return null when session provider returns null', async () => {
      // Arrange
      strategy.setSessionProvider(async () => null);

      // Act
      const result = await strategy.refreshToken();

      // Assert
      expect(result).toBeNull();
    });
  });

  describe('isAvailable', () => {
    it('should return true when session provider returns a session', async () => {
      // Arrange
      const mockSession: VSCodeAuthSession = {
        accessToken: 'ghp_vscode_test_token',
        scopes: ['repo'],
        account: {
          id: '12345',
          label: 'test-user',
        },
      };

      strategy.setSessionProvider(async () => mockSession);

      // Act
      const result = await strategy.isAvailable();

      // Assert
      expect(result).toBe(true);
    });

    it('should return false when no session provider is set', async () => {
      // Act
      const result = await strategy.isAvailable();

      // Assert
      expect(result).toBe(false);
    });

    it('should return false when session provider returns null', async () => {
      // Arrange
      strategy.setSessionProvider(async () => null);

      // Act
      const result = await strategy.isAvailable();

      // Assert
      expect(result).toBe(false);
    });
  });

  describe('setSessionProvider', () => {
    it('should allow setting a new session provider', async () => {
      // Arrange
      const mockSession1: VSCodeAuthSession = {
        accessToken: 'ghp_token_1',
        scopes: ['repo'],
        account: { id: '1', label: 'user1' },
      };

      const mockSession2: VSCodeAuthSession = {
        accessToken: 'ghp_token_2',
        scopes: ['read:org'],
        account: { id: '2', label: 'user2' },
      };

      // Act
      strategy.setSessionProvider(async () => mockSession1);
      const result1 = await strategy.getToken();

      strategy.setSessionProvider(async () => mockSession2);
      const result2 = await strategy.getToken();

      // Assert
      expect(result1?.token).toBe('ghp_token_1');
      expect(result2?.token).toBe('ghp_token_2');
    });
  });
});
