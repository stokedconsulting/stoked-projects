import { Test, TestingModule } from '@nestjs/testing';
import { GitHubClientService } from './github-client.service';
import {
  GitHubClientConfig,
  GitHubErrorCode,
  GitHubOperationType,
} from './github-client.types';

// Mock @octokit/graphql
jest.mock('@octokit/graphql', () => ({
  graphql: {
    defaults: jest.fn(() => jest.fn()),
  },
}));

// Mock @octokit/rest
jest.mock('@octokit/rest', () => ({
  Octokit: jest.fn().mockImplementation(() => ({
    request: jest.fn(),
    rateLimit: {
      get: jest.fn(),
    },
  })),
}));

describe('GitHubClientService', () => {
  let service: GitHubClientService;
  let mockGraphqlClient: jest.Mock;
  let mockRestClient: any;

  const mockConfig: GitHubClientConfig = {
    token: 'test-token',
    maxConnections: 10,
    retryAttempts: 3,
    retryDelays: [1000, 2000, 4000],
    timeout: 30000,
  };

  beforeEach(async () => {
    const { graphql } = require('@octokit/graphql');
    const { Octokit } = require('@octokit/rest');

    mockGraphqlClient = jest.fn();
    graphql.defaults = jest.fn(() => mockGraphqlClient);

    mockRestClient = {
      request: jest.fn(),
      rateLimit: {
        get: jest.fn(),
      },
    };
    Octokit.mockImplementation(() => mockRestClient);

    service = new GitHubClientService(mockConfig);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('GraphQL Operations', () => {
    /**
     * AC-1.1.a: When client receives valid GraphQL query →
     * executes via Octokit and returns typed response within 2 seconds
     */
    it('should execute GraphQL query and return typed response within 2 seconds', async () => {
      const mockResponse = {
        viewer: {
          login: 'testuser',
          name: 'Test User',
        },
      };

      mockGraphqlClient.mockResolvedValue(mockResponse);

      const startTime = Date.now();
      const result = await service.executeGraphQL({
        query: 'query { viewer { login name } }',
      });
      const duration = Date.now() - startTime;

      expect(result.success).toBe(true);
      expect(result.data).toEqual(mockResponse);
      expect(result.metadata?.operation).toBe(GitHubOperationType.GRAPHQL);
      expect(result.metadata?.duration).toBeLessThan(2000);
      expect(duration).toBeLessThan(2000);
      expect(mockGraphqlClient).toHaveBeenCalledWith(
        'query { viewer { login name } }',
        undefined,
      );
    });

    it('should execute GraphQL query with variables', async () => {
      const mockResponse = { repository: { name: 'test-repo' } };
      mockGraphqlClient.mockResolvedValue(mockResponse);

      const variables = { owner: 'test-owner', repo: 'test-repo' };
      const result = await service.executeGraphQL({
        query: 'query($owner: String!, $repo: String!) { repository(owner: $owner, name: $repo) { name } }',
        variables,
      });

      expect(result.success).toBe(true);
      expect(result.data).toEqual(mockResponse);
      expect(mockGraphqlClient).toHaveBeenCalledWith(
        expect.any(String),
        variables,
      );
    });
  });

  describe('REST Operations', () => {
    /**
     * AC-1.1.b: When client receives valid REST endpoint →
     * executes via Octokit REST and returns normalized response
     */
    it('should execute REST GET request and return normalized response', async () => {
      const mockResponse = {
        data: {
          login: 'testuser',
          id: 12345,
        },
      };

      mockRestClient.request.mockResolvedValue(mockResponse);

      const result = await service.executeREST({
        method: 'GET',
        endpoint: 'user',
      });

      expect(result.success).toBe(true);
      expect(result.data).toEqual(mockResponse.data);
      expect(result.metadata?.operation).toBe(GitHubOperationType.REST);
      expect(mockRestClient.request).toHaveBeenCalledWith('GET /user', undefined);
    });

    it('should execute REST POST request with body', async () => {
      const mockResponse = {
        data: { id: 1, title: 'Test Issue' },
      };

      mockRestClient.request.mockResolvedValue(mockResponse);

      const body = { title: 'Test Issue', body: 'Test body' };
      const result = await service.executeREST({
        method: 'POST',
        endpoint: 'repos/owner/repo/issues',
        body,
      });

      expect(result.success).toBe(true);
      expect(result.data).toEqual(mockResponse.data);
      expect(mockRestClient.request).toHaveBeenCalledWith(
        'POST /repos/owner/repo/issues',
        body,
      );
    });

    it('should handle endpoints with leading slash', async () => {
      const mockResponse = { data: { id: 1 } };
      mockRestClient.request.mockResolvedValue(mockResponse);

      await service.executeREST({
        method: 'GET',
        endpoint: '/repos/owner/repo',
      });

      expect(mockRestClient.request).toHaveBeenCalledWith(
        'GET /repos/owner/repo',
        undefined,
      );
    });
  });

  describe('Error Handling', () => {
    /**
     * AC-1.1.e: When authentication fails →
     * client returns GITHUB_AUTH_FAILED error code without retry
     */
    it('should handle authentication failure without retry', async () => {
      const authError = {
        status: 401,
        message: 'Bad credentials',
      };

      mockGraphqlClient.mockRejectedValue(authError);

      const result = await service.executeGraphQL({
        query: 'query { viewer { login } }',
      });

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe(GitHubErrorCode.GITHUB_AUTH_FAILED);
      expect(result.error?.retryable).toBe(false);
      expect(result.metadata?.retryCount).toBe(0);
      // Should only be called once (no retries)
      expect(mockGraphqlClient).toHaveBeenCalledTimes(1);
    });

    /**
     * AC-1.1.d: When network timeout occurs →
     * client retries 3 times with exponential backoff (1s, 2s, 4s)
     */
    it('should retry on network timeout with exponential backoff', async () => {
      const timeoutError = {
        name: 'TimeoutError',
        message: 'Request timed out',
      };

      // Fail 3 times, then succeed
      mockGraphqlClient
        .mockRejectedValueOnce(timeoutError)
        .mockRejectedValueOnce(timeoutError)
        .mockRejectedValueOnce(timeoutError)
        .mockResolvedValueOnce({ data: 'success' });

      const startTime = Date.now();
      const result = await service.executeGraphQL({
        query: 'query { viewer { login } }',
      });
      const duration = Date.now() - startTime;

      expect(result.success).toBe(true);
      expect(result.data).toEqual({ data: 'success' });
      expect(result.metadata?.retryCount).toBe(3);
      expect(mockGraphqlClient).toHaveBeenCalledTimes(4); // Initial + 3 retries

      // Total delay should be approximately 1000 + 2000 + 4000 = 7000ms
      expect(duration).toBeGreaterThanOrEqual(7000);
      expect(duration).toBeLessThan(8000); // Allow 1s margin
    }, 10000);

    it('should stop retrying after max attempts on timeout', async () => {
      const timeoutError = {
        name: 'TimeoutError',
        message: 'Request timed out',
      };

      mockGraphqlClient.mockRejectedValue(timeoutError);

      const result = await service.executeGraphQL({
        query: 'query { viewer { login } }',
      });

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe(GitHubErrorCode.NETWORK_TIMEOUT);
      expect(result.error?.retryable).toBe(true);
      expect(mockGraphqlClient).toHaveBeenCalledTimes(4); // Initial + 3 retries
    }, 10000);

    /**
     * AC-1.1.f: When API deprecation warning received →
     * client logs warning and continues operation
     */
    it('should handle API deprecation warning', async () => {
      const deprecationError = {
        status: 410,
        message: 'This endpoint is deprecated',
        request: { url: '/old/endpoint' },
      };

      mockRestClient.request.mockRejectedValue(deprecationError);

      const result = await service.executeREST({
        method: 'GET',
        endpoint: '/old/endpoint',
      });

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe(GitHubErrorCode.API_DEPRECATED);
      expect(result.error?.retryable).toBe(false);
    });

    it('should retry on 5xx server errors', async () => {
      const serverError = {
        status: 503,
        message: 'Service unavailable',
      };

      mockGraphqlClient
        .mockRejectedValueOnce(serverError)
        .mockResolvedValueOnce({ data: 'success' });

      const result = await service.executeGraphQL({
        query: 'query { viewer { login } }',
      });

      expect(result.success).toBe(true);
      expect(result.metadata?.retryCount).toBe(1);
      expect(mockGraphqlClient).toHaveBeenCalledTimes(2);
    });
  });

  describe('Rate Limiting', () => {
    /**
     * AC-1.1.c: When GitHub API returns rate limit error →
     * client queues request and retries after rate limit window
     */
    it('should queue request on rate limit and retry after window', async () => {
      const resetTime = Math.floor(Date.now() / 1000) + 2; // 2 seconds from now
      const rateLimitError = {
        status: 403,
        message: 'Rate limit exceeded',
        response: {
          headers: {
            'x-ratelimit-remaining': '0',
            'x-ratelimit-reset': resetTime.toString(),
          },
        },
      };

      mockGraphqlClient
        .mockRejectedValueOnce(rateLimitError)
        .mockResolvedValueOnce({ data: 'success after wait' });

      const startTime = Date.now();
      const result = await service.executeGraphQL({
        query: 'query { viewer { login } }',
      });
      const duration = Date.now() - startTime;

      expect(result.success).toBe(true);
      expect(result.data).toEqual({ data: 'success after wait' });
      expect(mockGraphqlClient).toHaveBeenCalledTimes(2);

      // Should wait approximately 2 seconds
      expect(duration).toBeGreaterThanOrEqual(2000);
      expect(duration).toBeLessThan(3000);
    }, 5000);

    it('should get rate limit information', async () => {
      const mockRateLimitResponse = {
        data: {
          resources: {
            core: {
              limit: 5000,
              remaining: 4999,
              reset: Math.floor(Date.now() / 1000) + 3600,
              used: 1,
            },
          },
        },
      };

      mockRestClient.rateLimit.get.mockResolvedValue(mockRateLimitResponse);

      const rateLimitInfo = await service.getRateLimitInfo();

      expect(rateLimitInfo.limit).toBe(5000);
      expect(rateLimitInfo.remaining).toBe(4999);
      expect(rateLimitInfo.used).toBe(1);
      expect(rateLimitInfo.reset).toBeInstanceOf(Date);
    });
  });

  describe('Connection Pool', () => {
    it('should enforce max connections limit', async () => {
      // Create a service with max 2 connections
      const limitedConfig = { ...mockConfig, maxConnections: 2 };
      const limitedService = new GitHubClientService(limitedConfig);

      // Mock slow operations
      const slowOperation = () =>
        new Promise((resolve) => setTimeout(() => resolve({ data: 'done' }), 100));

      mockGraphqlClient.mockImplementation(slowOperation);

      // Start 3 requests simultaneously
      const promises = [
        limitedService.executeGraphQL({ query: 'query { test1 }' }),
        limitedService.executeGraphQL({ query: 'query { test2 }' }),
        limitedService.executeGraphQL({ query: 'query { test3 }' }),
      ];

      // Check pool status during execution
      const poolStatus = limitedService.getConnectionPoolStatus();
      expect(poolStatus.total).toBe(2);
      expect(poolStatus.active).toBeLessThanOrEqual(2);

      await Promise.all(promises);

      // After completion, all connections should be released
      const finalStatus = limitedService.getConnectionPoolStatus();
      expect(finalStatus.active).toBe(0);
      expect(finalStatus.queued).toBe(0);
    }, 10000);

    it('should return connection pool status', () => {
      const status = service.getConnectionPoolStatus();

      expect(status.total).toBe(10);
      expect(status.active).toBe(0);
      expect(status.idle).toBe(10);
      expect(status.queued).toBe(0);
    });
  });

  describe('Error Normalization', () => {
    it('should normalize unknown errors', async () => {
      const unknownError = new Error('Something went wrong');
      mockGraphqlClient.mockRejectedValue(unknownError);

      const result = await service.executeGraphQL({
        query: 'query { test }',
      });

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe(GitHubErrorCode.UNKNOWN_ERROR);
      expect(result.error?.message).toContain('Something went wrong');
    });

    it('should normalize ETIMEDOUT errors', async () => {
      const timeoutError = {
        code: 'ETIMEDOUT',
        message: 'Connection timed out',
      };

      mockGraphqlClient.mockRejectedValue(timeoutError);

      const result = await service.executeGraphQL({
        query: 'query { test }',
      });

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe(GitHubErrorCode.NETWORK_TIMEOUT);
      expect(result.error?.retryable).toBe(true);
    });
  });

  describe('Module Lifecycle', () => {
    it('should cleanup on destroy', () => {
      const logSpy = jest.spyOn(service['logger'], 'log');
      service.onModuleDestroy();

      expect(logSpy).toHaveBeenCalledWith('GitHub client service destroyed');
    });
  });
});
