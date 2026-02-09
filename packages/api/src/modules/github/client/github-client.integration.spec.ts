import { GitHubClientService } from './github-client.service';
import { GitHubClientConfig, GitHubErrorCode } from './github-client.types';

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

describe('GitHubClientService Integration Tests', () => {
  let service: GitHubClientService;
  let mockGraphqlClient: jest.Mock;
  let mockRestClient: any;

  const mockConfig: GitHubClientConfig = {
    token: 'test-token',
    maxConnections: 10,
    retryAttempts: 3,
    retryDelays: [100, 200, 400], // Shorter delays for testing
    timeout: 5000,
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

  /**
   * Test-1.1.c: Integration test simulates rate limit (429 response)
   * and verifies request queuing behavior
   */
  describe('Rate Limit Handling', () => {
    it('should handle rate limit with proper queuing and retry', async () => {
      const resetTime = Math.floor(Date.now() / 1000) + 1; // 1 second from now
      const rateLimitError = {
        status: 403,
        message: 'API rate limit exceeded',
        response: {
          headers: {
            'x-ratelimit-remaining': '0',
            'x-ratelimit-reset': resetTime.toString(),
          },
        },
      };

      // First call hits rate limit, second succeeds
      mockGraphqlClient
        .mockRejectedValueOnce(rateLimitError)
        .mockResolvedValueOnce({ viewer: { login: 'testuser' } });

      const startTime = Date.now();
      const result = await service.executeGraphQL({
        query: 'query { viewer { login } }',
      });
      const duration = Date.now() - startTime;

      // Verify request succeeded after waiting
      expect(result.success).toBe(true);
      expect(result.data).toEqual({ viewer: { login: 'testuser' } });

      // Verify it waited for rate limit window
      expect(duration).toBeGreaterThanOrEqual(1000);
      expect(duration).toBeLessThan(2000);

      // Verify both attempts were made
      expect(mockGraphqlClient).toHaveBeenCalledTimes(2);
    }, 5000);

    it('should handle rate limit for REST endpoints', async () => {
      const resetTime = Math.floor(Date.now() / 1000) + 1;
      const rateLimitError = {
        status: 403,
        message: 'API rate limit exceeded',
        response: {
          headers: {
            'x-ratelimit-remaining': '0',
            'x-ratelimit-reset': resetTime.toString(),
          },
        },
      };

      mockRestClient.request
        .mockRejectedValueOnce(rateLimitError)
        .mockResolvedValueOnce({ data: { id: 1 } });

      const result = await service.executeREST({
        method: 'GET',
        endpoint: 'user',
      });

      expect(result.success).toBe(true);
      expect(result.data).toEqual({ id: 1 });
      expect(mockRestClient.request).toHaveBeenCalledTimes(2);
    }, 5000);
  });

  /**
   * Test-1.1.d: Integration test simulates network timeout
   * and verifies 3 retry attempts with correct delays
   */
  describe('Retry with Exponential Backoff', () => {
    it('should retry with exponential backoff on timeout', async () => {
      const timeoutError = {
        name: 'TimeoutError',
        message: 'Request timed out',
      };

      const startTime = Date.now();
      const callTimes: number[] = [];

      // Track when each call is made and fail 3 times, then succeed
      mockGraphqlClient.mockImplementation(async (...args) => {
        callTimes.push(Date.now() - startTime);
        if (callTimes.length <= 3) {
          throw timeoutError;
        }
        return { data: 'success' };
      });

      const result = await service.executeGraphQL({
        query: 'query { test }',
      });

      expect(result.success).toBe(true);
      expect(result.metadata?.retryCount).toBe(3);
      expect(callTimes.length).toBe(4); // 1 initial + 3 retries

      // Verify delays: initial (0ms), then +100ms, +200ms, +400ms
      expect(callTimes[0]).toBeLessThan(50); // Initial call (allow small variance)
      expect(callTimes[1]).toBeGreaterThanOrEqual(100);
      expect(callTimes[1]).toBeLessThan(150);
      expect(callTimes[2]).toBeGreaterThanOrEqual(300); // 100 + 200
      expect(callTimes[2]).toBeLessThan(350);
      expect(callTimes[3]).toBeGreaterThanOrEqual(700); // 100 + 200 + 400
      expect(callTimes[3]).toBeLessThan(800);
    }, 5000);

    it('should stop retrying after max attempts', async () => {
      const timeoutError = {
        name: 'TimeoutError',
        message: 'Request timed out',
      };

      mockGraphqlClient.mockRejectedValue(timeoutError);

      const result = await service.executeGraphQL({
        query: 'query { test }',
      });

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe(GitHubErrorCode.NETWORK_TIMEOUT);
      expect(mockGraphqlClient).toHaveBeenCalledTimes(4); // 1 initial + 3 retries
    }, 5000);

    it('should retry server errors (5xx) with backoff', async () => {
      const serverError = {
        status: 503,
        message: 'Service unavailable',
      };

      mockRestClient.request
        .mockRejectedValueOnce(serverError)
        .mockRejectedValueOnce(serverError)
        .mockResolvedValueOnce({ data: { id: 1 } });

      const startTime = Date.now();
      const result = await service.executeREST({
        method: 'GET',
        endpoint: 'user',
      });
      const duration = Date.now() - startTime;

      expect(result.success).toBe(true);
      expect(result.metadata?.retryCount).toBe(2);

      // Should have delays: 100ms + 200ms = 300ms
      expect(duration).toBeGreaterThanOrEqual(300);
      expect(duration).toBeLessThan(400);
    }, 5000);
  });

  /**
   * Test-1.1.e: Unit test verifies authentication failure
   * returns specific error code and skips retry
   */
  describe('Authentication Error Handling', () => {
    it('should not retry on authentication errors', async () => {
      const authError = {
        status: 401,
        message: 'Bad credentials',
      };

      mockGraphqlClient.mockRejectedValue(authError);

      const startTime = Date.now();
      const result = await service.executeGraphQL({
        query: 'query { viewer { login } }',
      });
      const duration = Date.now() - startTime;

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe(GitHubErrorCode.GITHUB_AUTH_FAILED);
      expect(result.error?.retryable).toBe(false);
      expect(result.metadata?.retryCount).toBe(0);

      // Should fail immediately without retries
      expect(mockGraphqlClient).toHaveBeenCalledTimes(1);
      expect(duration).toBeLessThan(100);
    });

    it('should handle auth errors in REST calls', async () => {
      const authError = {
        status: 401,
        message: 'Requires authentication',
      };

      mockRestClient.request.mockRejectedValue(authError);

      const result = await service.executeREST({
        method: 'GET',
        endpoint: 'user/repos',
      });

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe(GitHubErrorCode.GITHUB_AUTH_FAILED);
      expect(mockRestClient.request).toHaveBeenCalledTimes(1);
    });
  });

  /**
   * Test-1.1.f: Unit test verifies deprecation warnings
   * are logged to monitoring system
   */
  describe('API Deprecation Handling', () => {
    it('should log deprecation warnings and return error', async () => {
      const deprecationError = {
        status: 410,
        message: 'This API endpoint has been deprecated',
        request: { url: 'https://api.github.com/old/endpoint' },
      };

      const logSpy = jest.spyOn(service['logger'], 'warn');

      mockRestClient.request.mockRejectedValue(deprecationError);

      const result = await service.executeREST({
        method: 'GET',
        endpoint: 'old/endpoint',
      });

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe(GitHubErrorCode.API_DEPRECATED);
      expect(result.error?.retryable).toBe(false);

      // Verify warning was logged
      expect(logSpy).toHaveBeenCalledWith(
        'GitHub API deprecation warning detected',
        expect.objectContaining({
          endpoint: 'https://api.github.com/old/endpoint',
          message: 'This API endpoint has been deprecated',
        }),
      );
    });

    it('should handle deprecation warnings with "deprecated" keyword', async () => {
      const deprecationError = {
        message: 'This endpoint is deprecated and will be removed',
      };

      mockGraphqlClient.mockRejectedValue(deprecationError);

      const result = await service.executeGraphQL({
        query: 'query { test }',
      });

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe(GitHubErrorCode.API_DEPRECATED);
    });
  });

  describe('Connection Pool Integration', () => {
    it('should queue requests when connection pool is full', async () => {
      // Create service with limited connections
      const limitedConfig = {
        ...mockConfig,
        maxConnections: 2,
      };
      const limitedService = new GitHubClientService(limitedConfig);

      const { graphql } = require('@octokit/graphql');
      graphql.defaults = jest.fn(() => mockGraphqlClient);

      // Simulate slow operations
      const delays: number[] = [];
      mockGraphqlClient.mockImplementation(async () => {
        delays.push(Date.now());
        await new Promise((resolve) => setTimeout(resolve, 200));
        return { data: 'done' };
      });

      // Launch 5 concurrent requests (should queue 3 of them)
      const promises = Array.from({ length: 5 }, (_, i) =>
        limitedService.executeGraphQL({ query: `query { test${i} }` }),
      );

      const results = await Promise.all(promises);

      // All should succeed
      expect(results.every((r) => r.success)).toBe(true);

      // Verify connection pool was enforced
      expect(mockGraphqlClient).toHaveBeenCalledTimes(5);

      // First 2 should start immediately, next 3 should wait
      const startTimes = delays.map((t) => t - delays[0]);
      expect(startTimes[0]).toBeLessThan(50);
      expect(startTimes[1]).toBeLessThan(50);
      expect(startTimes[2]).toBeGreaterThanOrEqual(200); // Waits for first to complete
      expect(startTimes[3]).toBeGreaterThanOrEqual(200);
      expect(startTimes[4]).toBeGreaterThanOrEqual(200);
    }, 10000);
  });

  describe('Mixed Operations', () => {
    it('should handle concurrent GraphQL and REST requests', async () => {
      mockGraphqlClient.mockResolvedValue({ viewer: { login: 'user' } });
      mockRestClient.request.mockResolvedValue({ data: { id: 1 } });

      const [graphqlResult, restResult] = await Promise.all([
        service.executeGraphQL({ query: 'query { viewer { login } }' }),
        service.executeREST({ method: 'GET', endpoint: 'user' }),
      ]);

      expect(graphqlResult.success).toBe(true);
      expect(restResult.success).toBe(true);
      expect(mockGraphqlClient).toHaveBeenCalledTimes(1);
      expect(mockRestClient.request).toHaveBeenCalledTimes(1);
    });

    it('should handle mixed success and failure', async () => {
      mockGraphqlClient.mockResolvedValue({ data: 'success' });
      mockRestClient.request.mockRejectedValue({
        status: 404,
        message: 'Not found',
      });

      const [graphqlResult, restResult] = await Promise.all([
        service.executeGraphQL({ query: 'query { test }' }),
        service.executeREST({ method: 'GET', endpoint: 'nonexistent' }),
      ]);

      expect(graphqlResult.success).toBe(true);
      expect(restResult.success).toBe(false);
    });
  });
});
