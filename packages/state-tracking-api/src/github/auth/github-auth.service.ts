import { Injectable, Logger } from '@nestjs/common';
import { VSCodeTokenStrategy } from './strategies/vscode-token.strategy';
import { ConfigTokenStrategy } from './strategies/config-token.strategy';
import { EnvTokenStrategy } from './strategies/env-token.strategy';
import { ITokenStrategy } from './strategies/token-strategy.interface';
import {
  TokenMetadata,
  TokenValidationResult,
  CachedToken,
  TokenSource,
} from './types';
import {
  TokenNotFoundError,
  InsufficientScopesError,
  TokenExpiredError,
  TokenValidationError,
} from './errors/auth-errors';

/**
 * GitHub authentication service with support for multiple token sources
 * Implements token caching, validation, and automatic refresh
 */
@Injectable()
export class GitHubAuthService {
  private readonly logger = new Logger(GitHubAuthService.name);
  private readonly CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
  private tokenCache: CachedToken | null = null;

  // Token source precedence: VSCode > Config > Env
  private readonly strategies: ITokenStrategy[];

  constructor(
    private readonly vscodeStrategy: VSCodeTokenStrategy,
    private readonly configStrategy: ConfigTokenStrategy,
    private readonly envStrategy: EnvTokenStrategy,
  ) {
    // Strategies ordered by precedence
    this.strategies = [vscodeStrategy, configStrategy, envStrategy];
  }

  /**
   * Get a validated GitHub token
   * Uses cache if available and not expired, otherwise fetches from sources
   * @param requiredScopes - Array of OAuth scopes that the token must have
   * @returns Validated token metadata
   * @throws TokenNotFoundError if no valid token found
   * @throws InsufficientScopesError if token lacks required scopes
   */
  async getToken(requiredScopes: string[] = []): Promise<TokenMetadata> {
    // Check cache first
    if (this.isCacheValid()) {
      this.logger.debug('Returning cached token');
      const cached = this.tokenCache!.metadata;

      // Validate scopes even for cached tokens
      if (requiredScopes.length > 0) {
        this.validateScopes(cached.scopes, requiredScopes);
      }

      return cached;
    }

    // Cache miss or expired - fetch from sources
    this.logger.debug('Cache miss or expired, fetching token from sources');
    const metadata = await this.fetchTokenFromSources();

    if (!metadata) {
      const attemptedSources = await this.getAttemptedSources();
      throw new TokenNotFoundError(attemptedSources);
    }

    // Validate token scopes
    if (requiredScopes.length > 0) {
      // If token doesn't have scopes yet, validate it
      if (metadata.scopes.length === 0) {
        const validatedMetadata = await this.validateToken(
          metadata.token,
          requiredScopes,
        );
        if (!validatedMetadata.valid) {
          // Throw appropriate error type based on error code
          if (validatedMetadata.errorCode === 'AUTH_INSUFFICIENT_SCOPES') {
            throw new InsufficientScopesError(
              validatedMetadata.requiredScopes || requiredScopes,
              validatedMetadata.actualScopes || [],
            );
          }
          throw new TokenValidationError(
            validatedMetadata.errorMessage || 'Unknown validation error',
          );
        }
        metadata.scopes = validatedMetadata.metadata!.scopes;
      } else {
        // Token has scopes (e.g., from VSCode), just validate them
        this.validateScopes(metadata.scopes, requiredScopes);
      }
    }

    // Cache the validated token
    this.cacheToken(metadata);

    return metadata;
  }

  /**
   * Validate a token and return its metadata
   * This method can be used to validate tokens without caching
   * @param token - The GitHub personal access token
   * @param requiredScopes - Optional array of required scopes
   * @returns Validation result with metadata or error details
   */
  async validateToken(
    token: string,
    requiredScopes: string[] = [],
  ): Promise<TokenValidationResult> {
    try {
      // Make a GitHub API call to validate the token and get scopes
      // For now, we'll simulate this - in a real implementation,
      // this would call the GitHub API
      const scopes = await this.fetchTokenScopes(token);

      // Check if token has required scopes
      if (requiredScopes.length > 0) {
        const hasAllScopes = requiredScopes.every((required) =>
          scopes.includes(required),
        );

        if (!hasAllScopes) {
          return {
            valid: false,
            errorCode: 'AUTH_INSUFFICIENT_SCOPES',
            errorMessage: 'Token missing required scopes',
            requiredScopes,
            actualScopes: scopes,
          };
        }
      }

      return {
        valid: true,
        metadata: {
          token,
          scopes,
          expiresAt: null,
          source: TokenSource.ENV, // Source unknown in this context
        },
      };
    } catch (error) {
      this.logger.error('Token validation failed', error);
      return {
        valid: false,
        errorCode: 'AUTH_VALIDATION_FAILED',
        errorMessage: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * Refresh the cached token from its source
   * @returns Refreshed token metadata or null if refresh failed
   */
  async refreshToken(): Promise<TokenMetadata | null> {
    this.logger.debug('Refreshing token from source');

    // If we have a cached token, try to refresh from its source
    if (this.tokenCache) {
      const source = this.tokenCache.metadata.source;
      const strategy = this.getStrategyForSource(source);

      if (strategy) {
        const refreshed = await strategy.refreshToken();
        if (refreshed) {
          this.cacheToken(refreshed);
          return refreshed;
        }
      }
    }

    // If refresh failed or no cache, fetch from sources again
    const metadata = await this.fetchTokenFromSources();
    if (metadata) {
      this.cacheToken(metadata);
    }

    return metadata;
  }

  /**
   * Clear the token cache
   */
  clearCache(): void {
    this.logger.debug('Clearing token cache');
    this.tokenCache = null;
  }

  /**
   * Get the VSCode token strategy for external configuration
   * This allows the VSCode extension to inject its authentication session
   */
  getVSCodeStrategy(): VSCodeTokenStrategy {
    return this.vscodeStrategy;
  }

  // Private helper methods

  private isCacheValid(): boolean {
    if (!this.tokenCache) {
      return false;
    }

    const age = Date.now() - this.tokenCache.cachedAt.getTime();
    const isValid = age < this.tokenCache.ttl;

    if (!isValid) {
      this.logger.debug('Token cache expired', { age, ttl: this.tokenCache.ttl });
    }

    return isValid;
  }

  private cacheToken(metadata: TokenMetadata): void {
    this.tokenCache = {
      metadata,
      cachedAt: new Date(),
      ttl: this.CACHE_TTL_MS,
    };
    this.logger.debug('Token cached', {
      source: metadata.source,
      scopes: metadata.scopes,
      ttl: this.CACHE_TTL_MS,
    });
  }

  private async fetchTokenFromSources(): Promise<TokenMetadata | null> {
    // Try each strategy in order of precedence
    for (const strategy of this.strategies) {
      try {
        if (await strategy.isAvailable()) {
          const metadata = await strategy.getToken();
          if (metadata) {
            this.logger.debug('Token obtained from source', {
              source: metadata.source,
            });
            return metadata;
          }
        }
      } catch (error) {
        this.logger.warn('Strategy failed', {
          strategy: strategy.constructor.name,
          error: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    }

    return null;
  }

  private validateScopes(
    actualScopes: string[],
    requiredScopes: string[],
  ): void {
    const hasAllScopes = requiredScopes.every((required) =>
      actualScopes.includes(required),
    );

    if (!hasAllScopes) {
      throw new InsufficientScopesError(requiredScopes, actualScopes);
    }
  }

  private async getAttemptedSources(): Promise<string[]> {
    const sources: string[] = [];

    for (const strategy of this.strategies) {
      if (strategy instanceof VSCodeTokenStrategy) {
        sources.push('vscode');
      } else if (strategy instanceof ConfigTokenStrategy) {
        sources.push('config');
      } else if (strategy instanceof EnvTokenStrategy) {
        sources.push('env');
      }
    }

    return sources;
  }

  private getStrategyForSource(
    source: TokenSource,
  ): ITokenStrategy | undefined {
    switch (source) {
      case TokenSource.VSCODE:
        return this.vscodeStrategy;
      case TokenSource.CONFIG:
        return this.configStrategy;
      case TokenSource.ENV:
        return this.envStrategy;
      default:
        return undefined;
    }
  }

  /**
   * Fetch token scopes from GitHub API
   * In a real implementation, this would make an API call to GitHub
   * For now, we'll simulate it based on common patterns
   */
  private async fetchTokenScopes(token: string): Promise<string[]> {
    // TODO: Implement actual GitHub API call
    // This is a placeholder that would be replaced with:
    // const response = await fetch('https://api.github.com/user', {
    //   headers: { Authorization: `token ${token}` }
    // });
    // const scopes = response.headers.get('X-OAuth-Scopes');
    // return scopes ? scopes.split(',').map(s => s.trim()) : [];

    // For testing purposes, we'll return empty array
    // This will be mocked in tests
    return [];
  }
}
