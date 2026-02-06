import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { GitHubAuthService } from './github-auth.service';
import { VSCodeTokenStrategy } from './strategies/vscode-token.strategy';
import { ConfigTokenStrategy } from './strategies/config-token.strategy';
import { EnvTokenStrategy } from './strategies/env-token.strategy';
import {
  TokenNotFoundError,
  InsufficientScopesError,
  TokenValidationError,
} from './errors/auth-errors';
import { TokenMetadata, TokenSource } from './types';

describe('GitHubAuthService', () => {
  let service: GitHubAuthService;
  let vscodeStrategy: VSCodeTokenStrategy;
  let configStrategy: ConfigTokenStrategy;
  let envStrategy: EnvTokenStrategy;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        GitHubAuthService,
        VSCodeTokenStrategy,
        ConfigTokenStrategy,
        EnvTokenStrategy,
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get<GitHubAuthService>(GitHubAuthService);
    vscodeStrategy = module.get<VSCodeTokenStrategy>(VSCodeTokenStrategy);
    configStrategy = module.get<ConfigTokenStrategy>(ConfigTokenStrategy);
    envStrategy = module.get<EnvTokenStrategy>(EnvTokenStrategy);
  });

  afterEach(() => {
    service.clearCache();
    jest.clearAllMocks();
  });

  describe('AC-1.2.a: VSCode authentication session extracts and validates token', () => {
    it('should extract token from VSCode session with scopes', async () => {
      // Arrange
      const mockSession = {
        accessToken: 'ghp_vscode_token_123',
        scopes: ['repo', 'read:org', 'project'],
        account: { id: '123', label: 'test-user' },
      };

      vscodeStrategy.setSessionProvider(async () => mockSession);

      // Act
      const result = await service.getToken(['repo', 'read:org']);

      // Assert
      expect(result.token).toBe('ghp_vscode_token_123');
      expect(result.scopes).toEqual(['repo', 'read:org', 'project']);
      expect(result.source).toBe(TokenSource.VSCODE);
    });

    it('should validate VSCode token has required scopes', async () => {
      // Arrange
      const mockSession = {
        accessToken: 'ghp_vscode_token_123',
        scopes: ['repo', 'read:org'],
        account: { id: '123', label: 'test-user' },
      };

      vscodeStrategy.setSessionProvider(async () => mockSession);

      // Act & Assert
      await expect(service.getToken(['repo'])).resolves.toBeDefined();
    });
  });

  describe('AC-1.2.b: Token validation caches token for 5 minutes', () => {
    it('should cache token for 5 minutes', async () => {
      // Arrange
      process.env.GITHUB_TOKEN = 'ghp_test_token';
      const getSpy = jest.spyOn(envStrategy, 'getToken');

      // Mock validateToken to return scopes
      jest.spyOn(service as any, 'fetchTokenScopes').mockResolvedValue([
        'repo',
        'read:org',
      ]);

      // Act - First call
      const result1 = await service.getToken(['repo']);
      expect(result1.token).toBe('ghp_test_token');
      expect(getSpy).toHaveBeenCalledTimes(1);

      // Act - Second call within cache TTL
      const result2 = await service.getToken(['repo']);
      expect(result2.token).toBe('ghp_test_token');

      // Assert - Should use cache, not call getToken again
      expect(getSpy).toHaveBeenCalledTimes(1);

      // Cleanup
      delete process.env.GITHUB_TOKEN;
    });

    it('should return cached token on subsequent calls', async () => {
      // Arrange
      const mockMetadata: TokenMetadata = {
        token: 'ghp_cached_token',
        scopes: ['repo', 'read:org'],
        expiresAt: null,
        source: TokenSource.ENV,
      };

      jest.spyOn(envStrategy, 'getToken').mockResolvedValue(mockMetadata);
      jest.spyOn(envStrategy, 'isAvailable').mockResolvedValue(true);

      // Act
      const result1 = await service.getToken(['repo']);
      const result2 = await service.getToken(['repo']);

      // Assert
      expect(result1).toEqual(result2);
      expect(envStrategy.getToken).toHaveBeenCalledTimes(1);
    });
  });

  describe('AC-1.2.c: Insufficient scopes returns error with details', () => {
    it('should throw InsufficientScopesError with required and actual scopes', async () => {
      // Arrange
      const mockSession = {
        accessToken: 'ghp_vscode_token_123',
        scopes: ['repo'],
        account: { id: '123', label: 'test-user' },
      };

      vscodeStrategy.setSessionProvider(async () => mockSession);

      // Act & Assert
      await expect(
        service.getToken(['repo', 'read:org', 'project']),
      ).rejects.toThrow(InsufficientScopesError);

      try {
        await service.getToken(['repo', 'read:org', 'project']);
      } catch (error) {
        expect(error).toBeInstanceOf(InsufficientScopesError);
        const authError = error as InsufficientScopesError;
        expect(authError.requiredScopes).toEqual([
          'repo',
          'read:org',
          'project',
        ]);
        expect(authError.actualScopes).toEqual(['repo']);
        expect(authError.details?.missingScopes).toEqual([
          'read:org',
          'project',
        ]);
      }
    });

    it('should include remediation steps in error', async () => {
      // Arrange
      const mockSession = {
        accessToken: 'ghp_vscode_token_123',
        scopes: ['repo'],
        account: { id: '123', label: 'test-user' },
      };

      vscodeStrategy.setSessionProvider(async () => mockSession);

      // Act & Assert
      try {
        await service.getToken(['repo', 'read:org', 'project']);
        fail('Should have thrown InsufficientScopesError');
      } catch (error) {
        expect(error).toBeInstanceOf(InsufficientScopesError);
        const authError = error as InsufficientScopesError;
        expect(authError.details?.remediation).toBeDefined();
        expect(authError.details?.remediation).toEqual(
          expect.arrayContaining([
            expect.stringContaining('Generate a new token'),
          ]),
        );
      }
    });
  });

  describe('AC-1.2.d: Cached token expires and auto-refreshes', () => {
    it('should auto-refresh token after cache expiration', async () => {
      // Arrange
      const mockMetadata: TokenMetadata = {
        token: 'ghp_test_token',
        scopes: ['repo', 'read:org'],
        expiresAt: null,
        source: TokenSource.ENV,
      };

      jest.spyOn(envStrategy, 'getToken').mockResolvedValue(mockMetadata);
      jest.spyOn(envStrategy, 'isAvailable').mockResolvedValue(true);

      // Act - First call to populate cache
      await service.getToken(['repo']);
      expect(envStrategy.getToken).toHaveBeenCalledTimes(1);

      // Simulate cache expiration by manipulating private cache
      const cache = (service as any).tokenCache;
      cache.cachedAt = new Date(Date.now() - 6 * 60 * 1000); // 6 minutes ago

      // Act - Second call should refresh
      await service.getToken(['repo']);

      // Assert - Should have fetched token again
      expect(envStrategy.getToken).toHaveBeenCalledTimes(2);
    });

    it('should use refreshToken method to refresh from source', async () => {
      // Arrange
      const mockMetadata: TokenMetadata = {
        token: 'ghp_refreshed_token',
        scopes: ['repo', 'read:org'],
        expiresAt: null,
        source: TokenSource.ENV,
      };

      jest.spyOn(envStrategy, 'refreshToken').mockResolvedValue(mockMetadata);
      jest.spyOn(envStrategy, 'isAvailable').mockResolvedValue(true);

      // Populate cache first
      (service as any).cacheToken(mockMetadata);

      // Expire the cache
      const cache = (service as any).tokenCache;
      cache.cachedAt = new Date(Date.now() - 6 * 60 * 1000);

      // Act
      const result = await service.refreshToken();

      // Assert
      expect(result?.token).toBe('ghp_refreshed_token');
    });
  });

  describe('AC-1.2.e: Multiple sources use precedence order', () => {
    it('should prefer VSCode over config over env', async () => {
      // Arrange - Set up all three sources
      const vscodeSession = {
        accessToken: 'ghp_vscode_token',
        scopes: ['repo', 'read:org'],
        account: { id: '123', label: 'test-user' },
      };

      vscodeStrategy.setSessionProvider(async () => vscodeSession);
      process.env.GITHUB_TOKEN = 'ghp_env_token';

      const configService = {
        get: jest.fn().mockReturnValue('ghp_config_token'),
      };
      const configStrategyWithMock = new ConfigTokenStrategy(
        configService as any,
      );

      // Create service with all strategies available
      const testService = new GitHubAuthService(
        vscodeStrategy,
        configStrategyWithMock,
        envStrategy,
      );

      // Act
      const result = await testService.getToken(['repo']);

      // Assert - Should use VSCode token
      expect(result.token).toBe('ghp_vscode_token');
      expect(result.source).toBe(TokenSource.VSCODE);

      // Cleanup
      delete process.env.GITHUB_TOKEN;
    });

    it('should fall back to config when VSCode unavailable', async () => {
      // Arrange - VSCode not available, config and env available
      vscodeStrategy.setSessionProvider(async () => null);
      process.env.GITHUB_TOKEN = 'ghp_env_token';

      const configService = {
        get: jest.fn().mockReturnValue('ghp_config_token'),
      };
      const configStrategyWithMock = new ConfigTokenStrategy(
        configService as any,
      );

      const testService = new GitHubAuthService(
        vscodeStrategy,
        configStrategyWithMock,
        envStrategy,
      );

      // Mock scope validation
      jest.spyOn(testService as any, 'fetchTokenScopes').mockResolvedValue([
        'repo',
        'read:org',
      ]);

      // Act
      const result = await testService.getToken(['repo']);

      // Assert - Should use config token
      expect(result.token).toBe('ghp_config_token');
      expect(result.source).toBe(TokenSource.CONFIG);

      // Cleanup
      delete process.env.GITHUB_TOKEN;
    });

    it('should fall back to env when VSCode and config unavailable', async () => {
      // Arrange - Only env available
      vscodeStrategy.setSessionProvider(async () => null);
      process.env.GITHUB_TOKEN = 'ghp_env_token';

      const configService = {
        get: jest.fn().mockReturnValue(undefined),
      };
      const configStrategyWithMock = new ConfigTokenStrategy(
        configService as any,
      );

      const testService = new GitHubAuthService(
        vscodeStrategy,
        configStrategyWithMock,
        envStrategy,
      );

      // Mock scope validation
      jest.spyOn(testService as any, 'fetchTokenScopes').mockResolvedValue([
        'repo',
        'read:org',
      ]);

      // Act
      const result = await testService.getToken(['repo']);

      // Assert - Should use env token
      expect(result.token).toBe('ghp_env_token');
      expect(result.source).toBe(TokenSource.ENV);

      // Cleanup
      delete process.env.GITHUB_TOKEN;
    });
  });

  describe('AC-1.2.f: No valid token returns clear error with remediation', () => {
    it('should throw TokenNotFoundError when no sources available', async () => {
      // Arrange - No sources available
      vscodeStrategy.setSessionProvider(async () => null);
      delete process.env.GITHUB_TOKEN;

      const configService = {
        get: jest.fn().mockReturnValue(undefined),
      };
      const configStrategyWithMock = new ConfigTokenStrategy(
        configService as any,
      );

      const testService = new GitHubAuthService(
        vscodeStrategy,
        configStrategyWithMock,
        envStrategy,
      );

      // Act & Assert
      await expect(testService.getToken(['repo'])).rejects.toThrow(
        TokenNotFoundError,
      );
    });

    it('should include remediation steps in TokenNotFoundError', async () => {
      // Arrange
      vscodeStrategy.setSessionProvider(async () => null);
      delete process.env.GITHUB_TOKEN;

      // Act & Assert
      try {
        await service.getToken(['repo']);
        fail('Should have thrown TokenNotFoundError');
      } catch (error) {
        expect(error).toBeInstanceOf(TokenNotFoundError);
        const authError = error as TokenNotFoundError;
        expect(authError.details?.remediation).toBeDefined();
        expect(authError.details?.remediation).toEqual(
          expect.arrayContaining([
            expect.stringContaining('GITHUB_TOKEN'),
            expect.stringContaining('config'),
            expect.stringContaining('VSCode'),
          ]),
        );
      }
    });

    it('should list attempted sources in error details', async () => {
      // Arrange
      vscodeStrategy.setSessionProvider(async () => null);
      delete process.env.GITHUB_TOKEN;

      // Act & Assert
      try {
        await service.getToken(['repo']);
        fail('Should have thrown TokenNotFoundError');
      } catch (error) {
        expect(error).toBeInstanceOf(TokenNotFoundError);
        const authError = error as TokenNotFoundError;
        expect(authError.details?.attemptedSources).toEqual([
          'vscode',
          'config',
          'env',
        ]);
      }
    });
  });

  describe('Token validation', () => {
    it('should validate token and return metadata', async () => {
      // Arrange
      const mockScopes = ['repo', 'read:org', 'project'];
      jest
        .spyOn(service as any, 'fetchTokenScopes')
        .mockResolvedValue(mockScopes);

      // Act
      const result = await service.validateToken('ghp_test_token', ['repo']);

      // Assert
      expect(result.valid).toBe(true);
      expect(result.metadata?.token).toBe('ghp_test_token');
      expect(result.metadata?.scopes).toEqual(mockScopes);
    });

    it('should return error when validation fails', async () => {
      // Arrange
      jest
        .spyOn(service as any, 'fetchTokenScopes')
        .mockRejectedValue(new Error('API Error'));

      // Act
      const result = await service.validateToken('ghp_invalid_token');

      // Assert
      expect(result.valid).toBe(false);
      expect(result.errorCode).toBe('AUTH_VALIDATION_FAILED');
      expect(result.errorMessage).toContain('API Error');
    });
  });

  describe('Cache management', () => {
    it('should clear cache when clearCache is called', async () => {
      // Arrange
      process.env.GITHUB_TOKEN = 'ghp_test_token';
      jest.spyOn(service as any, 'fetchTokenScopes').mockResolvedValue([
        'repo',
      ]);

      // Populate cache
      await service.getToken(['repo']);
      expect((service as any).tokenCache).not.toBeNull();

      // Act
      service.clearCache();

      // Assert
      expect((service as any).tokenCache).toBeNull();

      // Cleanup
      delete process.env.GITHUB_TOKEN;
    });
  });

  describe('VSCode strategy access', () => {
    it('should provide access to VSCode strategy for configuration', () => {
      // Act
      const strategy = service.getVSCodeStrategy();

      // Assert
      expect(strategy).toBe(vscodeStrategy);
    });
  });
});
