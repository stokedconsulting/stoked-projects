import { Test, TestingModule } from '@nestjs/testing';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { GitHubAuthService } from './github-auth.service';
import { GitHubAuthModule } from './github-auth.module';
import { VSCodeTokenStrategy } from './strategies/vscode-token.strategy';
import { TokenSource } from './types';
import {
  TokenNotFoundError,
  InsufficientScopesError,
} from './errors/auth-errors';

describe('GitHubAuthService Integration Tests', () => {
  let service: GitHubAuthService;
  let vscodeStrategy: VSCodeTokenStrategy;
  let module: TestingModule;

  beforeEach(async () => {
    module = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          load: [
            () => ({
              github: {
                token: undefined,
              },
            }),
          ],
        }),
        GitHubAuthModule,
      ],
    }).compile();

    service = module.get<GitHubAuthService>(GitHubAuthService);
    vscodeStrategy = module.get<VSCodeTokenStrategy>(VSCodeTokenStrategy);

    // Clear environment
    delete process.env.GITHUB_TOKEN;
    service.clearCache();
  });

  afterEach(async () => {
    delete process.env.GITHUB_TOKEN;
    await module.close();
  });

  describe('Test-1.2.a: VSCode session integration', () => {
    it('should extract and validate token from VSCode session', async () => {
      // Arrange
      const mockSession = {
        accessToken: 'ghp_vscode_integration_token',
        scopes: ['repo', 'read:org', 'project', 'workflow'],
        account: { id: '12345', label: 'integration-test-user' },
      };

      vscodeStrategy.setSessionProvider(async () => mockSession);

      // Act
      const result = await service.getToken(['repo', 'read:org']);

      // Assert
      expect(result.token).toBe('ghp_vscode_integration_token');
      expect(result.scopes).toEqual([
        'repo',
        'read:org',
        'project',
        'workflow',
      ]);
      expect(result.source).toBe(TokenSource.VSCODE);
    });

    it('should validate VSCode token has required scopes', async () => {
      // Arrange
      const mockSession = {
        accessToken: 'ghp_vscode_token',
        scopes: ['repo', 'read:org'],
        account: { id: '12345', label: 'test-user' },
      };

      vscodeStrategy.setSessionProvider(async () => mockSession);

      // Act & Assert - Should succeed with subset of scopes
      await expect(service.getToken(['repo'])).resolves.toBeDefined();
    });

    it('should fail when VSCode token lacks required scopes', async () => {
      // Arrange
      const mockSession = {
        accessToken: 'ghp_vscode_token',
        scopes: ['repo'],
        account: { id: '12345', label: 'test-user' },
      };

      vscodeStrategy.setSessionProvider(async () => mockSession);

      // Act & Assert
      await expect(
        service.getToken(['repo', 'read:org', 'project']),
      ).rejects.toThrow(InsufficientScopesError);
    });
  });

  describe('Test-1.2.b: Token caching behavior', () => {
    it('should cache token for 5 minutes', async () => {
      // Arrange
      process.env.GITHUB_TOKEN = 'ghp_integration_cache_test';
      const mockScopes = ['repo', 'read:org', 'project'];

      // Mock fetchTokenScopes
      jest
        .spyOn(service as any, 'fetchTokenScopes')
        .mockResolvedValue(mockScopes);

      let callCount = 0;
      const originalFetch = (service as any).fetchTokenFromSources.bind(
        service,
      );
      jest
        .spyOn(service as any, 'fetchTokenFromSources')
        .mockImplementation(async () => {
          callCount++;
          return originalFetch();
        });

      // Act - Multiple calls within cache TTL
      const result1 = await service.getToken(['repo']);
      const result2 = await service.getToken(['repo']);
      const result3 = await service.getToken(['repo']);

      // Assert - Should only fetch once
      expect(callCount).toBe(1);
      expect(result1.token).toBe('ghp_integration_cache_test');
      expect(result2.token).toBe('ghp_integration_cache_test');
      expect(result3.token).toBe('ghp_integration_cache_test');
    });
  });

  describe('Test-1.2.d: Token refresh after expiration', () => {
    it('should auto-refresh token after 6-minute delay', async () => {
      // Arrange
      process.env.GITHUB_TOKEN = 'ghp_integration_refresh_test';
      const mockScopes = ['repo', 'read:org'];

      jest
        .spyOn(service as any, 'fetchTokenScopes')
        .mockResolvedValue(mockScopes);

      // First call to populate cache
      await service.getToken(['repo']);

      // Simulate cache expiration
      const cache = (service as any).tokenCache;
      cache.cachedAt = new Date(Date.now() - 6 * 60 * 1000); // 6 minutes ago

      // Mock to track refresh
      const refreshSpy = jest.spyOn(service as any, 'fetchTokenFromSources');

      // Act - Should trigger refresh
      const result = await service.getToken(['repo']);

      // Assert
      expect(refreshSpy).toHaveBeenCalled();
      expect(result.token).toBe('ghp_integration_refresh_test');
    });

    it('should use refreshToken method to refresh expired token', async () => {
      // Arrange
      process.env.GITHUB_TOKEN = 'ghp_refresh_method_test';
      const mockScopes = ['repo'];

      jest
        .spyOn(service as any, 'fetchTokenScopes')
        .mockResolvedValue(mockScopes);

      // Populate cache
      await service.getToken(['repo']);

      // Expire cache
      const cache = (service as any).tokenCache;
      cache.cachedAt = new Date(Date.now() - 10 * 60 * 1000);

      // Act
      const refreshed = await service.refreshToken();

      // Assert
      expect(refreshed).not.toBeNull();
      expect(refreshed?.token).toBe('ghp_refresh_method_test');

      // Verify cache was updated
      const newCache = (service as any).tokenCache;
      expect(newCache.cachedAt.getTime()).toBeGreaterThan(
        Date.now() - 1000,
      );
    });
  });

  describe('Test-1.2.e: Multi-source precedence order', () => {
    it('should prefer VSCode over config over env', async () => {
      // Arrange - Set up all three sources
      const vscodeToken = 'ghp_vscode_precedence';
      const configToken = 'ghp_config_precedence';
      const envToken = 'ghp_env_precedence';

      // Set VSCode
      vscodeStrategy.setSessionProvider(async () => ({
        accessToken: vscodeToken,
        scopes: ['repo', 'read:org'],
        account: { id: '1', label: 'vscode-user' },
      }));

      // Set env
      process.env.GITHUB_TOKEN = envToken;

      // Set config via a new module with config
      const testModule = await Test.createTestingModule({
        imports: [
          ConfigModule.forRoot({
            isGlobal: true,
            load: [
              () => ({
                github: {
                  token: configToken,
                },
              }),
            ],
          }),
          GitHubAuthModule,
        ],
      }).compile();

      const testService = testModule.get<GitHubAuthService>(GitHubAuthService);
      const testVSCodeStrategy = testModule.get<VSCodeTokenStrategy>(
        VSCodeTokenStrategy,
      );

      testVSCodeStrategy.setSessionProvider(async () => ({
        accessToken: vscodeToken,
        scopes: ['repo', 'read:org'],
        account: { id: '1', label: 'vscode-user' },
      }));

      // Act
      const result = await testService.getToken(['repo']);

      // Assert - Should use VSCode (highest priority)
      expect(result.token).toBe(vscodeToken);
      expect(result.source).toBe(TokenSource.VSCODE);

      await testModule.close();
    });

    it('should fall back to config when VSCode unavailable', async () => {
      // Arrange
      const configToken = 'ghp_config_fallback';
      const envToken = 'ghp_env_fallback';

      // VSCode not available
      vscodeStrategy.setSessionProvider(async () => null);

      // Set env
      process.env.GITHUB_TOKEN = envToken;

      // Set config
      const testModule = await Test.createTestingModule({
        imports: [
          ConfigModule.forRoot({
            isGlobal: true,
            load: [
              () => ({
                github: {
                  token: configToken,
                },
              }),
            ],
          }),
          GitHubAuthModule,
        ],
      }).compile();

      const testService = testModule.get<GitHubAuthService>(GitHubAuthService);
      const testVSCodeStrategy = testModule.get<VSCodeTokenStrategy>(
        VSCodeTokenStrategy,
      );
      testVSCodeStrategy.setSessionProvider(async () => null);

      // Mock scope validation
      jest
        .spyOn(testService as any, 'fetchTokenScopes')
        .mockResolvedValue(['repo', 'read:org']);

      // Act
      const result = await testService.getToken(['repo']);

      // Assert - Should use config (second priority)
      expect(result.token).toBe(configToken);
      expect(result.source).toBe(TokenSource.CONFIG);

      await testModule.close();
    });

    it('should fall back to env when VSCode and config unavailable', async () => {
      // Arrange
      const envToken = 'ghp_env_only';

      // VSCode not available
      vscodeStrategy.setSessionProvider(async () => null);

      // Set env only
      process.env.GITHUB_TOKEN = envToken;

      // Mock scope validation
      jest
        .spyOn(service as any, 'fetchTokenScopes')
        .mockResolvedValue(['repo', 'read:org']);

      // Act
      const result = await service.getToken(['repo']);

      // Assert - Should use env (lowest priority)
      expect(result.token).toBe(envToken);
      expect(result.source).toBe(TokenSource.ENV);
    });
  });

  describe('Test-1.2.f: No token error with remediation', () => {
    it('should return clear error when no sources available', async () => {
      // Arrange - No sources configured
      vscodeStrategy.setSessionProvider(async () => null);
      delete process.env.GITHUB_TOKEN;

      // Act & Assert
      await expect(service.getToken(['repo'])).rejects.toThrow(
        TokenNotFoundError,
      );
    });

    it('should include actionable remediation steps in error', async () => {
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

        // Verify remediation steps are actionable
        expect(authError.details?.remediation).toBeDefined();
        const remediation = authError.details?.remediation as string[];

        expect(remediation).toEqual(
          expect.arrayContaining([
            expect.stringMatching(/GITHUB_TOKEN/i),
            expect.stringMatching(/config/i),
            expect.stringMatching(/VSCode/i),
          ]),
        );

        // Verify attempted sources are listed
        expect(authError.details?.attemptedSources).toEqual([
          'vscode',
          'config',
          'env',
        ]);
      }
    });
  });

  describe('Cross-source refresh scenarios', () => {
    it('should refresh from original source when cache expires', async () => {
      // Arrange
      const vscodeToken = 'ghp_vscode_refresh';

      vscodeStrategy.setSessionProvider(async () => ({
        accessToken: vscodeToken,
        scopes: ['repo', 'read:org'],
        account: { id: '1', label: 'test' },
      }));

      // First call
      await service.getToken(['repo']);

      // Simulate expiration
      const cache = (service as any).tokenCache;
      cache.cachedAt = new Date(Date.now() - 10 * 60 * 1000);

      // Act
      const refreshed = await service.refreshToken();

      // Assert - Should refresh from VSCode source
      expect(refreshed?.token).toBe(vscodeToken);
      expect(refreshed?.source).toBe(TokenSource.VSCODE);
    });

    it('should fetch from highest priority source when refresh fails', async () => {
      // Arrange
      const envToken = 'ghp_env_token';

      // VSCode initially available
      let vscodeAvailable = true;
      vscodeStrategy.setSessionProvider(async () =>
        vscodeAvailable
          ? {
              accessToken: 'ghp_vscode_token',
              scopes: ['repo'],
              account: { id: '1', label: 'test' },
            }
          : null,
      );

      // First call with VSCode
      await service.getToken(['repo']);

      // Make VSCode unavailable but set env
      vscodeAvailable = false;
      process.env.GITHUB_TOKEN = envToken;

      // Mock scope validation
      jest
        .spyOn(service as any, 'fetchTokenScopes')
        .mockResolvedValue(['repo']);

      // Clear cache to force refresh
      service.clearCache();

      // Act
      const result = await service.getToken(['repo']);

      // Assert - Should fall back to env
      expect(result.token).toBe(envToken);
      expect(result.source).toBe(TokenSource.ENV);
    });
  });

  describe('Scope validation across sources', () => {
    it('should validate scopes for tokens from all sources', async () => {
      // Test VSCode
      vscodeStrategy.setSessionProvider(async () => ({
        accessToken: 'ghp_vscode',
        scopes: ['repo'],
        account: { id: '1', label: 'test' },
      }));

      await expect(service.getToken(['repo', 'admin:org'])).rejects.toThrow(
        InsufficientScopesError,
      );

      service.clearCache();

      // Test env
      vscodeStrategy.setSessionProvider(async () => null);
      process.env.GITHUB_TOKEN = 'ghp_env';
      jest
        .spyOn(service as any, 'fetchTokenScopes')
        .mockResolvedValue(['repo']);

      await expect(service.getToken(['repo', 'admin:org'])).rejects.toThrow(
        InsufficientScopesError,
      );
    });
  });
});
