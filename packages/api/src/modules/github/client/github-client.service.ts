import { Injectable, Logger } from '@nestjs/common';
import { graphql } from '@octokit/graphql';
import { Octokit } from '@octokit/rest';
import type { GraphQlQueryResponseData } from '@octokit/graphql';
import {
  GitHubClientConfig,
  GitHubResponse,
  GitHubError,
  GitHubErrorCode,
  GitHubOperationType,
  GraphQLOptions,
  RestOptions,
  RateLimitInfo,
  ConnectionPoolStatus,
} from './github-client.types';

/**
 * Unified GitHub Client Service
 *
 * Abstracts both GraphQL and REST API interactions with:
 * - Connection pooling
 * - Automatic retry with exponential backoff
 * - Rate limit handling
 * - Normalized error responses
 */
@Injectable()
export class GitHubClientService {
  private readonly logger = new Logger(GitHubClientService.name);
  private readonly graphqlClient: typeof graphql;
  private readonly restClient: Octokit;
  private readonly config: Required<GitHubClientConfig>;

  // Connection pool tracking
  private activeConnections = 0;
  private readonly requestQueue: Array<() => Promise<void>> = [];

  // Rate limit tracking
  private rateLimitInfo: RateLimitInfo | null = null;
  private rateLimitQueueTimer: NodeJS.Timeout | null = null;

  constructor(config: GitHubClientConfig) {
    this.config = {
      token: config.token,
      maxConnections: config.maxConnections ?? 10,
      retryAttempts: config.retryAttempts ?? 3,
      retryDelays: config.retryDelays ?? [1000, 2000, 4000],
      timeout: config.timeout ?? 30000,
    };

    // Initialize Octokit clients
    this.graphqlClient = graphql.defaults({
      headers: {
        authorization: `token ${this.config.token}`,
      },
      request: {
        timeout: this.config.timeout,
      },
    });

    this.restClient = new Octokit({
      auth: this.config.token,
      request: {
        timeout: this.config.timeout,
      },
    });

    this.logger.log('GitHub client initialized with connection pooling');
  }

  /**
   * Execute GraphQL query
   */
  async executeGraphQL<T = any>(options: GraphQLOptions): Promise<GitHubResponse<T>> {
    const startTime = Date.now();
    let retryCount = 0;

    const execute = async (): Promise<GitHubResponse<T>> => {
      try {
        await this.acquireConnection();

        const data = await this.graphqlClient<T>(options.query, options.variables);

        this.releaseConnection();

        return {
          success: true,
          data,
          metadata: {
            operation: GitHubOperationType.GRAPHQL,
            duration: Date.now() - startTime,
            retryCount,
          },
        };
      } catch (error: any) {
        this.releaseConnection();

        const githubError = this.normalizeError(error);

        // Handle retryable errors
        if (githubError.retryable && retryCount < this.config.retryAttempts) {
          const delay = githubError.retryAfter
            ? githubError.retryAfter * 1000
            : this.config.retryDelays[retryCount] || this.config.retryDelays[this.config.retryDelays.length - 1];

          this.logger.warn(
            `Retrying GraphQL request (attempt ${retryCount + 1}/${this.config.retryAttempts}) after ${delay}ms: ${githubError.message}`,
          );

          retryCount++;
          await this.delay(delay);
          return execute();
        }

        // Handle rate limit
        if (githubError.code === GitHubErrorCode.RATE_LIMIT_EXCEEDED && githubError.retryAfter) {
          return this.queueForRateLimit(() => execute(), githubError.retryAfter);
        }

        return {
          success: false,
          error: githubError,
          metadata: {
            operation: GitHubOperationType.GRAPHQL,
            duration: Date.now() - startTime,
            retryCount,
          },
        };
      }
    };

    return execute();
  }

  /**
   * Execute REST API request
   */
  async executeREST<T = any>(options: RestOptions): Promise<GitHubResponse<T>> {
    const startTime = Date.now();
    let retryCount = 0;

    const execute = async (): Promise<GitHubResponse<T>> => {
      try {
        await this.acquireConnection();

        let response: any;

        // Parse endpoint to extract route
        const endpoint = options.endpoint.startsWith('/') ? options.endpoint.slice(1) : options.endpoint;

        switch (options.method) {
          case 'GET':
            response = await this.restClient.request(`GET /${endpoint}`, options.params);
            break;
          case 'POST':
            response = await this.restClient.request(`POST /${endpoint}`, options.body);
            break;
          case 'PUT':
            response = await this.restClient.request(`PUT /${endpoint}`, options.body);
            break;
          case 'PATCH':
            response = await this.restClient.request(`PATCH /${endpoint}`, options.body);
            break;
          case 'DELETE':
            response = await this.restClient.request(`DELETE /${endpoint}`, options.params);
            break;
        }

        this.releaseConnection();

        return {
          success: true,
          data: response.data as T,
          metadata: {
            operation: GitHubOperationType.REST,
            duration: Date.now() - startTime,
            retryCount,
          },
        };
      } catch (error: any) {
        this.releaseConnection();

        const githubError = this.normalizeError(error);

        // Handle retryable errors
        if (githubError.retryable && retryCount < this.config.retryAttempts) {
          const delay = githubError.retryAfter
            ? githubError.retryAfter * 1000
            : this.config.retryDelays[retryCount] || this.config.retryDelays[this.config.retryDelays.length - 1];

          this.logger.warn(
            `Retrying REST request (attempt ${retryCount + 1}/${this.config.retryAttempts}) after ${delay}ms: ${githubError.message}`,
          );

          retryCount++;
          await this.delay(delay);
          return execute();
        }

        // Handle rate limit
        if (githubError.code === GitHubErrorCode.RATE_LIMIT_EXCEEDED && githubError.retryAfter) {
          return this.queueForRateLimit(() => execute(), githubError.retryAfter);
        }

        return {
          success: false,
          error: githubError,
          metadata: {
            operation: GitHubOperationType.REST,
            duration: Date.now() - startTime,
            retryCount,
          },
        };
      }
    };

    return execute();
  }

  /**
   * Get current rate limit information
   */
  async getRateLimitInfo(): Promise<RateLimitInfo> {
    try {
      const response = await this.restClient.rateLimit.get();
      const core = response.data.resources.core;

      this.rateLimitInfo = {
        limit: core.limit,
        remaining: core.remaining,
        reset: new Date(core.reset * 1000),
        used: core.used,
      };

      return this.rateLimitInfo;
    } catch (error) {
      this.logger.error('Failed to fetch rate limit info', error);
      throw error;
    }
  }

  /**
   * Get connection pool status
   */
  getConnectionPoolStatus(): ConnectionPoolStatus {
    return {
      total: this.config.maxConnections,
      active: this.activeConnections,
      idle: this.config.maxConnections - this.activeConnections,
      queued: this.requestQueue.length,
    };
  }

  /**
   * Normalize errors from different API types
   */
  private normalizeError(error: any): GitHubError {
    // Authentication errors
    if (error.status === 401 || error.message?.includes('Bad credentials')) {
      return {
        code: GitHubErrorCode.GITHUB_AUTH_FAILED,
        message: 'GitHub authentication failed. Check your token.',
        retryable: false,
        originalError: error,
      };
    }

    // Rate limit errors
    if (error.status === 403 && error.response?.headers?.['x-ratelimit-remaining'] === '0') {
      const resetTime = error.response.headers['x-ratelimit-reset'];
      const retryAfter = resetTime ? parseInt(resetTime) - Math.floor(Date.now() / 1000) : 60;

      this.logger.warn(`Rate limit exceeded. Retry after ${retryAfter} seconds`);

      return {
        code: GitHubErrorCode.RATE_LIMIT_EXCEEDED,
        message: 'GitHub API rate limit exceeded',
        retryable: true,
        retryAfter,
        originalError: error,
      };
    }

    // Network timeout errors
    if (error.name === 'TimeoutError' || error.code === 'ETIMEDOUT' || error.message?.includes('timeout')) {
      return {
        code: GitHubErrorCode.NETWORK_TIMEOUT,
        message: 'Request timed out',
        retryable: true,
        originalError: error,
      };
    }

    // API deprecation warnings
    if (error.status === 410 || error.message?.includes('deprecated')) {
      this.logger.warn('GitHub API deprecation warning detected', {
        endpoint: error.request?.url,
        message: error.message,
      });

      return {
        code: GitHubErrorCode.API_DEPRECATED,
        message: error.message || 'API endpoint is deprecated',
        retryable: false,
        originalError: error,
      };
    }

    // Network errors (5xx) are retryable
    if (error.status >= 500 && error.status < 600) {
      return {
        code: GitHubErrorCode.UNKNOWN_ERROR,
        message: error.message || 'Server error',
        retryable: true,
        originalError: error,
      };
    }

    // Unknown errors
    return {
      code: GitHubErrorCode.UNKNOWN_ERROR,
      message: error.message || 'Unknown error occurred',
      retryable: false,
      originalError: error,
    };
  }

  /**
   * Connection pool management - acquire connection
   */
  private async acquireConnection(): Promise<void> {
    if (this.activeConnections < this.config.maxConnections) {
      this.activeConnections++;
      return;
    }

    // Wait for available connection
    return new Promise((resolve) => {
      this.requestQueue.push(async () => {
        this.activeConnections++;
        resolve();
      });
    });
  }

  /**
   * Connection pool management - release connection
   */
  private releaseConnection(): void {
    this.activeConnections--;

    // Process queued requests
    if (this.requestQueue.length > 0) {
      const next = this.requestQueue.shift();
      if (next) {
        next();
      }
    }
  }

  /**
   * Queue request for rate limit window
   */
  private async queueForRateLimit<T>(
    operation: () => Promise<GitHubResponse<T>>,
    retryAfter: number,
  ): Promise<GitHubResponse<T>> {
    this.logger.log(`Queueing request for rate limit. Retry after ${retryAfter} seconds`);

    return new Promise((resolve) => {
      setTimeout(async () => {
        const result = await operation();
        resolve(result);
      }, retryAfter * 1000);
    });
  }

  /**
   * Delay helper
   */
  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Cleanup on service destruction
   */
  onModuleDestroy(): void {
    if (this.rateLimitQueueTimer) {
      clearTimeout(this.rateLimitQueueTimer);
    }
    this.logger.log('GitHub client service destroyed');
  }
}
