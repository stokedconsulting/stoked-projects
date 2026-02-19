/**
 * Unit tests for API Client
 *
 * Tests all acceptance criteria:
 * - AC-1.2.a: API key validation
 * - AC-1.2.b: Authentication header inclusion
 * - AC-1.2.c: 401 error handling
 * - AC-1.2.d: 5xx retry logic
 * - AC-1.2.e: Timeout handling
 * - AC-1.2.f: JSON response parsing
 */

import {
  APIClient,
  createAPIClient,
  AuthenticationError,
  TimeoutError,
  NotFoundError,
  RateLimitError,
  ServerError,
  Project,
  Issue,
  Phase,
  WorkItem,
} from './api-client';

// Mock global fetch
global.fetch = jest.fn();

describe('API Client', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Clear environment variables
    delete process.env.STATE_TRACKING_API_KEY;
    delete process.env.STATE_TRACKING_API_URL;
  });

  describe('AC-1.2.a: Initialization without API key', () => {
    it('should throw error when API key is not provided', () => {
      expect(() => {
        new APIClient();
      }).toThrow('STATE_TRACKING_API_KEY environment variable required');
    });

    it('should throw error when API key environment variable is empty', () => {
      process.env.STATE_TRACKING_API_KEY = '';

      expect(() => {
        new APIClient();
      }).toThrow('STATE_TRACKING_API_KEY environment variable required');
    });

    it('should succeed when API key is provided via config', () => {
      const client = new APIClient({ apiKey: 'test-key' });
      expect(client.getConfig().hasApiKey).toBe(true);
    });

    it('should succeed when API key is in environment variable', () => {
      process.env.STATE_TRACKING_API_KEY = 'test-env-key';
      const client = new APIClient();
      expect(client.getConfig().hasApiKey).toBe(true);
    });
  });

  describe('AC-1.2.b: Authentication header inclusion', () => {
    it('should include X-API-Key header in requests', async () => {
      const mockFetch = global.fetch as jest.Mock;
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ success: true }),
      });

      const client = new APIClient({ apiKey: 'test-key-123' });
      await client.get('/test');

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          headers: expect.objectContaining({
            'X-API-Key': 'test-key-123',
          }),
        })
      );
    });

    it('should include Authorization Bearer header in requests', async () => {
      const mockFetch = global.fetch as jest.Mock;
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ success: true }),
      });

      const client = new APIClient({ apiKey: 'test-key-456' });
      await client.get('/test');

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          headers: expect.objectContaining({
            'Authorization': 'Bearer test-key-456',
          }),
        })
      );
    });

    it('should include Content-Type header in requests', async () => {
      const mockFetch = global.fetch as jest.Mock;
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ success: true }),
      });

      const client = new APIClient({ apiKey: 'test-key' });
      await client.post('/test', { data: 'test' });

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          headers: expect.objectContaining({
            'Content-Type': 'application/json',
          }),
        })
      );
    });
  });

  describe('AC-1.2.c: 401 error handling with AuthenticationError', () => {
    it('should throw AuthenticationError on 401 response', async () => {
      const mockFetch = global.fetch as jest.Mock;
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 401,
        statusText: 'Unauthorized',
        json: async () => ({ message: 'Invalid API key' }),
      });

      const client = new APIClient({ apiKey: 'invalid-key' });

      await expect(client.get('/test')).rejects.toThrow(AuthenticationError);
    });

    it('should throw AuthenticationError on 403 response', async () => {
      const mockFetch = global.fetch as jest.Mock;
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 403,
        statusText: 'Forbidden',
        json: async () => ({ message: 'Insufficient permissions' }),
      });

      const client = new APIClient({ apiKey: 'test-key' });

      await expect(client.get('/test')).rejects.toThrow(AuthenticationError);
    });

    it('should include setup instructions in AuthenticationError message', async () => {
      const mockFetch = global.fetch as jest.Mock;
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 401,
        statusText: 'Unauthorized',
        json: async () => ({ message: 'Invalid API key' }),
      });

      const client = new APIClient({ apiKey: 'invalid-key' });

      try {
        await client.get('/test');
        fail('Should have thrown AuthenticationError');
      } catch (error) {
        expect(error).toBeInstanceOf(AuthenticationError);
        expect((error as Error).message).toContain('STATE_TRACKING_API_KEY');
        expect((error as Error).message).toContain('export STATE_TRACKING_API_KEY');
      }
    });
  });

  describe('AC-1.2.d: 5xx retry logic with exponential backoff', () => {
    // Increase timeout for retry tests (1s + 2s + 4s = 7s minimum)
    jest.setTimeout(15000);

    it('should retry 3 times on 500 error with exponential backoff', async () => {
      const mockFetch = global.fetch as jest.Mock;

      // Mock 3 failures followed by success
      mockFetch
        .mockResolvedValueOnce({
          ok: false,
          status: 500,
          statusText: 'Internal Server Error',
          json: async () => ({ error: 'Server error' }),
        })
        .mockResolvedValueOnce({
          ok: false,
          status: 500,
          statusText: 'Internal Server Error',
          json: async () => ({ error: 'Server error' }),
        })
        .mockResolvedValueOnce({
          ok: false,
          status: 500,
          statusText: 'Internal Server Error',
          json: async () => ({ error: 'Server error' }),
        })
        .mockResolvedValueOnce({
          ok: true,
        status: 200,
          json: async () => ({ success: true }),
        });

      const client = new APIClient({ apiKey: 'test-key' });
      const result = await client.get('/test');

      expect(mockFetch).toHaveBeenCalledTimes(4); // 3 retries + 1 success
      expect(result).toEqual({ success: true });
    });

    it('should throw ServerError after max retries exceeded', async () => {
      const mockFetch = global.fetch as jest.Mock;

      // Mock all attempts failing
      mockFetch.mockResolvedValue({
        ok: false,
        status: 503,
        statusText: 'Service Unavailable',
        json: async () => ({ error: 'Service down' }),
      });

      const client = new APIClient({ apiKey: 'test-key' });

      await expect(client.get('/test')).rejects.toThrow(ServerError);
      expect(mockFetch).toHaveBeenCalledTimes(4); // Initial + 3 retries
    });

    it('should use exponential backoff delays (1s, 2s, 4s)', async () => {
      const mockFetch = global.fetch as jest.Mock;
      const sleepSpy = jest.spyOn(global, 'setTimeout');

      mockFetch.mockResolvedValue({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
        json: async () => ({ error: 'Server error' }),
      });

      const client = new APIClient({ apiKey: 'test-key' });

      try {
        await client.get('/test');
      } catch (error) {
        // Expected to fail
      }

      // Check setTimeout calls for backoff delays
      const timeoutCalls = sleepSpy.mock.calls.filter(call => {
        const delay = call[1];
        return delay === 1000 || delay === 2000 || delay === 4000;
      });

      expect(timeoutCalls.length).toBeGreaterThanOrEqual(3);

      sleepSpy.mockRestore();
    });

    it('should handle different 5xx status codes', async () => {
      const statusCodes = [500, 502, 503, 504];

      for (const statusCode of statusCodes) {
        const mockFetch = global.fetch as jest.Mock;

        // Mock 4 responses (1 initial + 3 retries) all failing
        mockFetch
          .mockResolvedValueOnce({
            ok: false,
            status: statusCode,
            statusText: 'Server Error',
            json: async () => ({ error: 'Error' }),
          })
          .mockResolvedValueOnce({
            ok: false,
            status: statusCode,
            statusText: 'Server Error',
            json: async () => ({ error: 'Error' }),
          })
          .mockResolvedValueOnce({
            ok: false,
            status: statusCode,
            statusText: 'Server Error',
            json: async () => ({ error: 'Error' }),
          })
          .mockResolvedValueOnce({
            ok: false,
            status: statusCode,
            statusText: 'Server Error',
            json: async () => ({ error: 'Error' }),
          });

        const client = new APIClient({ apiKey: 'test-key' });

        try {
          await client.get('/test');
          fail(`Should have thrown ServerError for ${statusCode}`);
        } catch (error) {
          expect(error).toBeInstanceOf(ServerError);
          expect((error as ServerError).statusCode).toBe(statusCode);
        }

        jest.clearAllMocks();
      }
    }, 30000); // 30 second timeout for this test
  });

  describe('AC-1.2.e: Timeout handling after 10 seconds', () => {
    beforeEach(() => {
      jest.resetAllMocks();
    });

    it('should throw TimeoutError after 10 seconds', async () => {
      const mockFetch = global.fetch as jest.Mock;

      // Clear any previous mock implementations and set new one
      mockFetch.mockReset();
      mockFetch.mockImplementation(() => {
        const error = new Error('The operation was aborted');
        error.name = 'AbortError';
        return Promise.reject(error);
      });

      const client = new APIClient({ apiKey: 'test-key' });

      await expect(client.get('/test')).rejects.toThrow(TimeoutError);
    });

    it('should use custom timeout from config', async () => {
      const client = new APIClient({ apiKey: 'test-key', timeout: 5000 });
      expect(client.getConfig().timeout).toBe(5000);
    });

    it('should use default 10 second timeout', async () => {
      const client = new APIClient({ apiKey: 'test-key' });
      expect(client.getConfig().timeout).toBe(10000);
    });
  });

  describe('AC-1.2.f: JSON response parsing with TypeScript types', () => {
    it('should parse and return typed Project object', async () => {
      const mockFetch = global.fetch as jest.Mock;
      const mockProject: Project = {
        id: 'proj-123',
        name: 'Test Project',
        description: 'A test project',
        status: 'active',
        createdAt: '2026-01-20T00:00:00Z',
        updatedAt: '2026-01-20T00:00:00Z',
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => mockProject,
      });

      const client = new APIClient({ apiKey: 'test-key' });
      const result = await client.get<Project>('/projects/proj-123');

      expect(result).toEqual(mockProject);
      expect(result.id).toBe('proj-123');
      expect(result.status).toBe('active');
    });

    it('should parse and return typed Issue object', async () => {
      const mockFetch = global.fetch as jest.Mock;
      const mockIssue: Issue = {
        id: 'issue-456',
        projectId: 'proj-123',
        title: 'Test Issue',
        description: 'A test issue',
        status: 'open',
        labels: ['bug', 'high-priority'],
        createdAt: '2026-01-20T00:00:00Z',
        updatedAt: '2026-01-20T00:00:00Z',
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => mockIssue,
      });

      const client = new APIClient({ apiKey: 'test-key' });
      const result = await client.get<Issue>('/issues/issue-456');

      expect(result).toEqual(mockIssue);
      expect(result.labels).toContain('bug');
    });

    it('should parse and return typed Phase object', async () => {
      const mockFetch = global.fetch as jest.Mock;
      const mockPhase: Phase = {
        id: 'phase-789',
        projectId: 'proj-123',
        name: 'Phase 1',
        description: 'First phase',
        order: 1,
        status: 'in_progress',
        createdAt: '2026-01-20T00:00:00Z',
        updatedAt: '2026-01-20T00:00:00Z',
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => mockPhase,
      });

      const client = new APIClient({ apiKey: 'test-key' });
      const result = await client.get<Phase>('/phases/phase-789');

      expect(result).toEqual(mockPhase);
      expect(result.order).toBe(1);
    });

    it('should parse and return typed WorkItem object', async () => {
      const mockFetch = global.fetch as jest.Mock;
      const mockWorkItem: WorkItem = {
        id: 'work-101',
        phaseId: 'phase-789',
        projectId: 'proj-123',
        name: 'Work Item 1',
        description: 'A work item',
        status: 'pending',
        priority: 'high',
        order: 1,
        createdAt: '2026-01-20T00:00:00Z',
        updatedAt: '2026-01-20T00:00:00Z',
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => mockWorkItem,
      });

      const client = new APIClient({ apiKey: 'test-key' });
      const result = await client.get<WorkItem>('/work-items/work-101');

      expect(result).toEqual(mockWorkItem);
      expect(result.priority).toBe('high');
    });

    it('should handle array responses', async () => {
      const mockFetch = global.fetch as jest.Mock;
      const mockProjects: Project[] = [
        {
          id: 'proj-1',
          name: 'Project 1',
          status: 'active',
          createdAt: '2026-01-20T00:00:00Z',
          updatedAt: '2026-01-20T00:00:00Z',
        },
        {
          id: 'proj-2',
          name: 'Project 2',
          status: 'completed',
          createdAt: '2026-01-20T00:00:00Z',
          updatedAt: '2026-01-20T00:00:00Z',
        },
      ];

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => mockProjects,
      });

      const client = new APIClient({ apiKey: 'test-key' });
      const result = await client.get<Project[]>('/projects');

      expect(Array.isArray(result)).toBe(true);
      expect(result).toHaveLength(2);
      expect(result[0].id).toBe('proj-1');
    });
  });

  describe('Additional error handling', () => {
    it('should throw NotFoundError on 404 response', async () => {
      const mockFetch = global.fetch as jest.Mock;
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
        statusText: 'Not Found',
        json: async () => ({ message: 'Resource not found' }),
      });

      const client = new APIClient({ apiKey: 'test-key' });

      await expect(client.get('/nonexistent')).rejects.toThrow(NotFoundError);
    });

    it('should throw RateLimitError on 429 response', async () => {
      const mockFetch = global.fetch as jest.Mock;
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 429,
        statusText: 'Too Many Requests',
        headers: new Map([['Retry-After', '60']]),
        json: async () => ({ message: 'Rate limit exceeded' }),
      });

      const client = new APIClient({ apiKey: 'test-key' });

      try {
        await client.get('/test');
        fail('Should have thrown RateLimitError');
      } catch (error) {
        expect(error).toBeInstanceOf(RateLimitError);
        expect((error as RateLimitError).retryAfter).toBe(60);
      }
    });
  });

  describe('HTTP methods', () => {
    it('should support GET requests', async () => {
      const mockFetch = global.fetch as jest.Mock;
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ method: 'GET' }),
      });

      const client = new APIClient({ apiKey: 'test-key' });
      await client.get('/test');

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ method: 'GET' })
      );
    });

    it('should support POST requests with body', async () => {
      const mockFetch = global.fetch as jest.Mock;
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ created: true }),
      });

      const client = new APIClient({ apiKey: 'test-key' });
      const body = { name: 'Test' };
      await client.post('/test', body);

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify(body),
        })
      );
    });

    it('should support PUT requests with body', async () => {
      const mockFetch = global.fetch as jest.Mock;
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ updated: true }),
      });

      const client = new APIClient({ apiKey: 'test-key' });
      const body = { name: 'Updated' };
      await client.put('/test', body);

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          method: 'PUT',
          body: JSON.stringify(body),
        })
      );
    });

    it('should support DELETE requests', async () => {
      const mockFetch = global.fetch as jest.Mock;
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ deleted: true }),
      });

      const client = new APIClient({ apiKey: 'test-key' });
      await client.delete('/test');

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ method: 'DELETE' })
      );
    });
  });

  describe('Configuration', () => {
    it('should use default base URL', () => {
      const client = new APIClient({ apiKey: 'test-key' });
      expect(client.getConfig().baseUrl).toBe('http://localhost:8167');
    });

    it('should use custom base URL from config', () => {
      const client = new APIClient({
        apiKey: 'test-key',
        baseUrl: 'https://custom.api.com',
      });
      expect(client.getConfig().baseUrl).toBe('https://custom.api.com');
    });

    it('should use base URL from environment variable', () => {
      process.env.STATE_TRACKING_API_URL = 'https://env.api.com';
      const client = new APIClient({ apiKey: 'test-key' });
      expect(client.getConfig().baseUrl).toBe('https://env.api.com');
    });

    it('should use custom retry count', () => {
      const client = new APIClient({ apiKey: 'test-key', maxRetries: 5 });
      expect(client.getConfig().maxRetries).toBe(5);
    });
  });

  describe('Factory function', () => {
    it('should create client with factory function', () => {
      const client = createAPIClient({ apiKey: 'test-key' });
      expect(client).toBeInstanceOf(APIClient);
      expect(client.getConfig().hasApiKey).toBe(true);
    });
  });
});
