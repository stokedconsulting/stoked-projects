import { ConfigService } from '@nestjs/config';
import { ConfigTokenStrategy } from './config-token.strategy';
import { TokenSource } from '../types';

describe('ConfigTokenStrategy', () => {
  let strategy: ConfigTokenStrategy;
  let configService: jest.Mocked<ConfigService>;

  beforeEach(() => {
    configService = {
      get: jest.fn(),
    } as any;

    strategy = new ConfigTokenStrategy(configService);
  });

  describe('getToken', () => {
    it('should return token from config service', async () => {
      // Arrange
      configService.get.mockReturnValue('ghp_config_test_token');

      // Act
      const result = await strategy.getToken();

      // Assert
      expect(result).not.toBeNull();
      expect(result?.token).toBe('ghp_config_test_token');
      expect(result?.source).toBe(TokenSource.CONFIG);
      expect(result?.scopes).toEqual([]);
      expect(result?.expiresAt).toBeNull();
      expect(configService.get).toHaveBeenCalledWith('github.token');
    });

    it('should return null when config token is not set', async () => {
      // Arrange
      configService.get.mockReturnValue(undefined);

      // Act
      const result = await strategy.getToken();

      // Assert
      expect(result).toBeNull();
    });

    it('should return null when config token is empty string', async () => {
      // Arrange
      configService.get.mockReturnValue('');

      // Act
      const result = await strategy.getToken();

      // Assert
      expect(result).toBeNull();
    });

    it('should return null when config token is null', async () => {
      // Arrange
      configService.get.mockReturnValue(null);

      // Act
      const result = await strategy.getToken();

      // Assert
      expect(result).toBeNull();
    });
  });

  describe('refreshToken', () => {
    it('should return same token as getToken', async () => {
      // Arrange
      configService.get.mockReturnValue('ghp_config_test_token');

      // Act
      const getResult = await strategy.getToken();
      const refreshResult = await strategy.refreshToken();

      // Assert
      expect(refreshResult).toEqual(getResult);
    });

    it('should return null when no token available', async () => {
      // Arrange
      configService.get.mockReturnValue(undefined);

      // Act
      const result = await strategy.refreshToken();

      // Assert
      expect(result).toBeNull();
    });
  });

  describe('isAvailable', () => {
    it('should return true when config token is set', async () => {
      // Arrange
      configService.get.mockReturnValue('ghp_config_test_token');

      // Act
      const result = await strategy.isAvailable();

      // Assert
      expect(result).toBe(true);
    });

    it('should return false when config token is not set', async () => {
      // Arrange
      configService.get.mockReturnValue(undefined);

      // Act
      const result = await strategy.isAvailable();

      // Assert
      expect(result).toBe(false);
    });

    it('should return false when config token is empty string', async () => {
      // Arrange
      configService.get.mockReturnValue('');

      // Act
      const result = await strategy.isAvailable();

      // Assert
      expect(result).toBe(false);
    });
  });
});
