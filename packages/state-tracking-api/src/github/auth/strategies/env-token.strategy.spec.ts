import { EnvTokenStrategy } from './env-token.strategy';
import { TokenSource } from '../types';

describe('EnvTokenStrategy', () => {
  let strategy: EnvTokenStrategy;

  beforeEach(() => {
    strategy = new EnvTokenStrategy();
    delete process.env.GITHUB_TOKEN;
  });

  afterEach(() => {
    delete process.env.GITHUB_TOKEN;
  });

  describe('getToken', () => {
    it('should return token from GITHUB_TOKEN environment variable', async () => {
      // Arrange
      process.env.GITHUB_TOKEN = 'ghp_env_test_token';

      // Act
      const result = await strategy.getToken();

      // Assert
      expect(result).not.toBeNull();
      expect(result?.token).toBe('ghp_env_test_token');
      expect(result?.source).toBe(TokenSource.ENV);
      expect(result?.scopes).toEqual([]);
      expect(result?.expiresAt).toBeNull();
    });

    it('should return null when GITHUB_TOKEN is not set', async () => {
      // Act
      const result = await strategy.getToken();

      // Assert
      expect(result).toBeNull();
    });

    it('should return null when GITHUB_TOKEN is empty string', async () => {
      // Arrange
      process.env.GITHUB_TOKEN = '';

      // Act
      const result = await strategy.getToken();

      // Assert
      expect(result).toBeNull();
    });
  });

  describe('refreshToken', () => {
    it('should return same token as getToken', async () => {
      // Arrange
      process.env.GITHUB_TOKEN = 'ghp_env_test_token';

      // Act
      const getResult = await strategy.getToken();
      const refreshResult = await strategy.refreshToken();

      // Assert
      expect(refreshResult).toEqual(getResult);
    });

    it('should return null when no token available', async () => {
      // Act
      const result = await strategy.refreshToken();

      // Assert
      expect(result).toBeNull();
    });
  });

  describe('isAvailable', () => {
    it('should return true when GITHUB_TOKEN is set', async () => {
      // Arrange
      process.env.GITHUB_TOKEN = 'ghp_env_test_token';

      // Act
      const result = await strategy.isAvailable();

      // Assert
      expect(result).toBe(true);
    });

    it('should return false when GITHUB_TOKEN is not set', async () => {
      // Act
      const result = await strategy.isAvailable();

      // Assert
      expect(result).toBe(false);
    });

    it('should return false when GITHUB_TOKEN is empty string', async () => {
      // Arrange
      process.env.GITHUB_TOKEN = '';

      // Act
      const result = await strategy.isAvailable();

      // Assert
      expect(result).toBe(false);
    });
  });
});
