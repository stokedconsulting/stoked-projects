import { createHealthCheckTool, HealthCheckResult } from './health-check';
import { APIClient } from '../api-client';

/**
 * Mock API client for testing
 */
class MockAPIClient extends APIClient {
  private mockHealthResponse: any;
  private mockProjectsResponse: any;
  private shouldThrowHealthError: boolean = false;
  private shouldThrowProjectsError: boolean = false;
  private healthErrorMessage: string = '';
  private projectsErrorMessage: string = '';

  constructor() {
    // Override parent constructor to avoid requiring API key
    super({ apiKey: 'test-key', baseUrl: 'https://test.example.com' });
  }

  setHealthResponse(response: any) {
    this.mockHealthResponse = response;
    this.shouldThrowHealthError = false;
  }

  setHealthError(errorMessage: string) {
    this.healthErrorMessage = errorMessage;
    this.shouldThrowHealthError = true;
  }

  setProjectsResponse(response: any) {
    this.mockProjectsResponse = response;
    this.shouldThrowProjectsError = false;
  }

  setProjectsError(errorMessage: string) {
    this.projectsErrorMessage = errorMessage;
    this.shouldThrowProjectsError = true;
  }

  async get<T>(path: string): Promise<T> {
    if (path === '/health') {
      if (this.shouldThrowHealthError) {
        throw new Error(this.healthErrorMessage);
      }
      return this.mockHealthResponse as T;
    }

    if (path === '/api/projects') {
      if (this.shouldThrowProjectsError) {
        throw new Error(this.projectsErrorMessage);
      }
      return this.mockProjectsResponse as T;
    }

    throw new Error(`Unexpected path: ${path}`);
  }
}

describe('Health Check Tool', () => {
  let mockClient: MockAPIClient;

  beforeEach(() => {
    mockClient = new MockAPIClient();
  });

  /**
   * Helper function to extract HealthCheckResult from tool result
   */
  function extractHealthResult(result: any): HealthCheckResult {
    expect(result.content).toHaveLength(1);
    expect(result.content[0].type).toBe('text');

    const textContent = result.content[0];
    if (textContent.type !== 'text') throw new Error('Expected text content');
    return JSON.parse(textContent.text || '{}');
  }

  describe('AC-1.5.a: Valid API key returns authenticated=true', () => {
    it('should return authenticated=true when both health and projects endpoints succeed', async () => {
      // Setup: Mock successful responses
      mockClient.setHealthResponse({ status: 'ok', version: '1.0.0' });
      mockClient.setProjectsResponse([]);

      const tool = createHealthCheckTool(mockClient);
      const result = await tool.handler({});

      const healthResult = extractHealthResult(result);

      // Verify authenticated=true
      expect(healthResult.authenticated).toBe(true);
      expect(healthResult.apiAvailable).toBe(true);
      expect(healthResult.apiVersion).toBe('1.0.0');
      expect(healthResult.error).toBeUndefined();
    });

    it('should include API version when available', async () => {
      mockClient.setHealthResponse({ status: 'ok', version: '2.5.0' });
      mockClient.setProjectsResponse([]);

      const tool = createHealthCheckTool(mockClient);
      const result = await tool.handler({});

      const healthResult = extractHealthResult(result);
      expect(healthResult.apiVersion).toBe('2.5.0');
    });
  });

  describe('AC-1.5.b: Invalid API key returns authenticated=false', () => {
    it('should return authenticated=false when projects endpoint returns 401', async () => {
      // Setup: Health succeeds, but projects returns 401 (unauthorized)
      mockClient.setHealthResponse({ status: 'ok' });
      mockClient.setProjectsError('HTTP 401: Unauthorized');

      const tool = createHealthCheckTool(mockClient);
      const result = await tool.handler({});

      const healthResult = extractHealthResult(result);

      // Verify authenticated=false with proper error message
      expect(healthResult.authenticated).toBe(false);
      expect(healthResult.apiAvailable).toBe(true);
      expect(healthResult.error).toContain('Authentication failed');
    });

    it('should return authenticated=false when projects endpoint returns 403', async () => {
      // Setup: Health succeeds, but projects returns 403 (forbidden)
      mockClient.setHealthResponse({ status: 'ok' });
      mockClient.setProjectsError('HTTP 403: Forbidden');

      const tool = createHealthCheckTool(mockClient);
      const result = await tool.handler({});

      const healthResult = extractHealthResult(result);

      // Verify authenticated=false
      expect(healthResult.authenticated).toBe(false);
      expect(healthResult.apiAvailable).toBe(true);
      expect(healthResult.error).toContain('Authentication failed');
    });
  });

  describe('AC-1.5.c: API unreachable returns apiAvailable=false', () => {
    it('should return apiAvailable=false when health endpoint is unreachable', async () => {
      // Setup: Health endpoint throws network error
      mockClient.setHealthError('Network error: ECONNREFUSED');

      const tool = createHealthCheckTool(mockClient);
      const result = await tool.handler({});

      const healthResult = extractHealthResult(result);

      // Verify apiAvailable=false with error message
      expect(healthResult.apiAvailable).toBe(false);
      expect(healthResult.authenticated).toBe(false);
      expect(healthResult.error).toContain('API health check failed');
      expect(healthResult.error).toContain('Network error');
    });

    it('should return apiAvailable=false with timeout error', async () => {
      mockClient.setHealthError('Request timeout after 10000ms');

      const tool = createHealthCheckTool(mockClient);
      const result = await tool.handler({});

      const healthResult = extractHealthResult(result);

      expect(healthResult.apiAvailable).toBe(false);
      expect(healthResult.error).toContain('timeout');
    });

    it('should return apiAvailable=false with server error', async () => {
      mockClient.setHealthError('HTTP 500: Internal Server Error');

      const tool = createHealthCheckTool(mockClient);
      const result = await tool.handler({});

      const healthResult = extractHealthResult(result);

      expect(healthResult.apiAvailable).toBe(false);
      expect(healthResult.error).toContain('API health check failed');
    });
  });

  describe('AC-1.5.d: Response includes accurate responseTimeMs', () => {
    it('should include responseTimeMs field with timing information', async () => {
      mockClient.setHealthResponse({ status: 'ok' });
      mockClient.setProjectsResponse([]);

      const tool = createHealthCheckTool(mockClient);
      const startTime = Date.now();
      const result = await tool.handler({});
      const endTime = Date.now();

      const healthResult = extractHealthResult(result);

      // Verify responseTimeMs exists and is within reasonable bounds
      expect(healthResult.responseTimeMs).toBeDefined();
      expect(typeof healthResult.responseTimeMs).toBe('number');
      expect(healthResult.responseTimeMs).toBeGreaterThanOrEqual(0);
      expect(healthResult.responseTimeMs).toBeLessThanOrEqual(endTime - startTime);
    });

    it('should measure response time even when API is unavailable', async () => {
      mockClient.setHealthError('Network error');

      const tool = createHealthCheckTool(mockClient);
      const result = await tool.handler({});

      const healthResult = extractHealthResult(result);

      // Should still include timing
      expect(healthResult.responseTimeMs).toBeDefined();
      expect(healthResult.responseTimeMs).toBeGreaterThanOrEqual(0);
    });

    it('should respond within 2 seconds for successful health check', async () => {
      mockClient.setHealthResponse({ status: 'ok' });
      mockClient.setProjectsResponse([]);

      const tool = createHealthCheckTool(mockClient);
      const result = await tool.handler({});

      const healthResult = extractHealthResult(result);

      // Verify response time is under 2 seconds (2000ms)
      expect(healthResult.responseTimeMs).toBeLessThan(2000);
    });
  });

  describe('AC-1.5.e: Tool definition and registration', () => {
    it('should have correct tool name', () => {
      const tool = createHealthCheckTool(mockClient);
      expect(tool.name).toBe('health_check');
    });

    it('should have descriptive description', () => {
      const tool = createHealthCheckTool(mockClient);
      expect(tool.description).toContain('connectivity');
      expect(tool.description).toContain('authentication');
      expect(tool.description).toContain('state-tracking-api');
    });

    it('should have empty input schema (no parameters)', () => {
      const tool = createHealthCheckTool(mockClient);
      expect(tool.inputSchema.type).toBe('object');
      expect(tool.inputSchema.required).toEqual([]);
      expect(Object.keys(tool.inputSchema.properties)).toHaveLength(0);
    });

    it('should return valid MCP tool result format', async () => {
      mockClient.setHealthResponse({ status: 'ok' });
      mockClient.setProjectsResponse([]);

      const tool = createHealthCheckTool(mockClient);
      const result = await tool.handler({});

      // Verify MCP ToolResult format
      expect(result).toHaveProperty('content');
      expect(Array.isArray(result.content)).toBe(true);
      expect(result.content[0]).toHaveProperty('type');
      expect(result.content[0]).toHaveProperty('text');
    });
  });

  describe('Edge cases and error handling', () => {
    it('should handle health response without version field', async () => {
      mockClient.setHealthResponse({ status: 'ok' });
      mockClient.setProjectsResponse([]);

      const tool = createHealthCheckTool(mockClient);
      const result = await tool.handler({});

      const healthResult = extractHealthResult(result);
      expect(healthResult.apiAvailable).toBe(true);
      expect(healthResult.apiVersion).toBeUndefined();
    });

    it('should handle non-authentication errors in projects endpoint', async () => {
      mockClient.setHealthResponse({ status: 'ok' });
      mockClient.setProjectsError('HTTP 500: Internal Server Error');

      const tool = createHealthCheckTool(mockClient);
      const result = await tool.handler({});

      const healthResult = extractHealthResult(result);

      // Should still mark as not authenticated, but with different error message
      expect(healthResult.authenticated).toBe(false);
      expect(healthResult.error).toContain('Authentication check failed');
    });

    it('should return valid JSON in all error scenarios', async () => {
      const errorScenarios = [
        () => mockClient.setHealthError('Network error'),
        () => {
          mockClient.setHealthResponse({ status: 'ok' });
          mockClient.setProjectsError('HTTP 401: Unauthorized');
        },
        () => {
          mockClient.setHealthResponse({ status: 'ok' });
          mockClient.setProjectsError('Unexpected error');
        },
      ];

      for (const setupError of errorScenarios) {
        mockClient = new MockAPIClient();
        setupError();

        const tool = createHealthCheckTool(mockClient);
        const result = await tool.handler({});

        // Should always return valid JSON
        const textContent = result.content[0];
        if (textContent.type !== 'text') throw new Error('Expected text content');
        expect(() => JSON.parse(textContent.text || '{}')).not.toThrow();
      }
    });
  });
});
