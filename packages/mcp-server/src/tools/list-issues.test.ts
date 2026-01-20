import { createListIssuesTool, ListIssuesParams } from './list-issues.js';
import { APIClient, Issue } from '../api-client.js';

/**
 * Mock API client for testing
 */
class MockAPIClient extends APIClient {
  private mockIssuesResponse: Issue[] = [];
  private shouldThrowError: boolean = false;
  private errorMessage: string = '';
  private lastRequestPath: string = '';

  constructor() {
    // Override parent constructor to avoid requiring API key
    super({ apiKey: 'test-key', baseUrl: 'https://test.example.com' });
  }

  setIssuesResponse(issues: Issue[]) {
    this.mockIssuesResponse = issues;
    this.shouldThrowError = false;
  }

  setError(errorMessage: string) {
    this.errorMessage = errorMessage;
    this.shouldThrowError = true;
  }

  getLastRequestPath(): string {
    return this.lastRequestPath;
  }

  async get<T>(path: string): Promise<T> {
    this.lastRequestPath = path;

    if (this.shouldThrowError) {
      throw new Error(this.errorMessage);
    }

    return this.mockIssuesResponse as T;
  }
}

/**
 * Helper function to create mock issue data
 */
function createMockIssue(overrides: Partial<Issue> = {}): Issue {
  return {
    id: 'issue-1',
    projectId: 'project-123',
    title: 'Test Issue',
    description: 'Test description',
    status: 'open',
    labels: [],
    createdAt: '2026-01-20T00:00:00Z',
    updatedAt: '2026-01-20T00:00:00Z',
    ...overrides,
  };
}

/**
 * Helper function to extract response from tool result
 */
function extractResponse(result: any): any {
  expect(result.content).toHaveLength(1);
  expect(result.content[0].type).toBe('text');

  const textContent = result.content[0];
  if (textContent.type !== 'text') throw new Error('Expected text content');
  return JSON.parse(textContent.text || '{}');
}

describe('List Issues Tool', () => {
  let mockClient: MockAPIClient;

  beforeEach(() => {
    mockClient = new MockAPIClient();
  });

  describe('AC-2.2.a: List all issues with only project number', () => {
    it('should return all issues when no filters are provided', async () => {
      // Setup: Mock 3 issues with different statuses
      const mockIssues: Issue[] = [
        createMockIssue({ id: 'issue-1', title: 'Issue 1', status: 'open' }),
        createMockIssue({ id: 'issue-2', title: 'Issue 2', status: 'in_progress' }),
        createMockIssue({ id: 'issue-3', title: 'Issue 3', status: 'closed' }),
      ];
      mockClient.setIssuesResponse(mockIssues);

      const tool = createListIssuesTool(mockClient);
      const params: ListIssuesParams = { projectNumber: 72 };
      const result = await tool.handler(params);

      const response = extractResponse(result);

      // Verify all issues are returned
      expect(response.projectNumber).toBe(72);
      expect(response.issueCount).toBe(3);
      expect(response.issues).toHaveLength(3);
      expect(response.issues[0].title).toBe('Issue 1');
      expect(response.issues[1].title).toBe('Issue 2');
      expect(response.issues[2].title).toBe('Issue 3');

      // Verify no filters were applied
      expect(response.filters.status).toBeNull();
      expect(response.filters.phase).toBeNull();
      expect(response.filters.assignee).toBeNull();
    });

    it('should make request to correct API endpoint without query params', async () => {
      mockClient.setIssuesResponse([]);

      const tool = createListIssuesTool(mockClient);
      await tool.handler({ projectNumber: 72 });

      expect(mockClient.getLastRequestPath()).toBe('/api/projects/72/issues');
    });

    it('should return empty array when project has no issues', async () => {
      mockClient.setIssuesResponse([]);

      const tool = createListIssuesTool(mockClient);
      const result = await tool.handler({ projectNumber: 72 });

      const response = extractResponse(result);
      expect(response.issueCount).toBe(0);
      expect(response.issues).toEqual([]);
    });
  });

  describe('AC-2.2.b: Filter by status', () => {
    it('should return only issues with matching status', async () => {
      // Note: Filtering happens on API side, we just verify query params are built correctly
      const mockIssues: Issue[] = [
        createMockIssue({ id: 'issue-1', title: 'In Progress Issue', status: 'in_progress' }),
      ];
      mockClient.setIssuesResponse(mockIssues);

      const tool = createListIssuesTool(mockClient);
      const params: ListIssuesParams = { projectNumber: 72, status: 'in_progress' };
      const result = await tool.handler(params);

      // Verify query parameter was included in request
      expect(mockClient.getLastRequestPath()).toBe('/api/projects/72/issues?status=in_progress');

      const response = extractResponse(result);
      expect(response.filters.status).toBe('in_progress');
    });

    it('should support all valid status values', async () => {
      mockClient.setIssuesResponse([]);

      const tool = createListIssuesTool(mockClient);
      const validStatuses: Array<'backlog' | 'todo' | 'in_progress' | 'done'> = [
        'backlog',
        'todo',
        'in_progress',
        'done',
      ];

      for (const status of validStatuses) {
        await tool.handler({ projectNumber: 72, status });
        expect(mockClient.getLastRequestPath()).toBe(`/api/projects/72/issues?status=${status}`);
      }
    });
  });

  describe('AC-2.2.c: Filter by phase', () => {
    it('should return only issues in specified phase', async () => {
      const mockIssues: Issue[] = [
        createMockIssue({ id: 'issue-1', title: 'Phase 1 Issue' }),
      ];
      mockClient.setIssuesResponse(mockIssues);

      const tool = createListIssuesTool(mockClient);
      const params: ListIssuesParams = { projectNumber: 72, phase: 'Phase 1' };
      const result = await tool.handler(params);

      // Verify query parameter was included
      expect(mockClient.getLastRequestPath()).toBe('/api/projects/72/issues?phase=Phase%201');

      const response = extractResponse(result);
      expect(response.filters.phase).toBe('Phase 1');
    });

    it('should properly encode phase names with special characters', async () => {
      mockClient.setIssuesResponse([]);

      const tool = createListIssuesTool(mockClient);
      await tool.handler({ projectNumber: 72, phase: 'Phase 2: Core Operations' });

      expect(mockClient.getLastRequestPath()).toContain('phase=Phase%202%3A%20Core%20Operations');
    });
  });

  describe('AC-2.2.d: Multiple filters with AND logic', () => {
    it('should apply multiple filters simultaneously', async () => {
      const mockIssues: Issue[] = [
        createMockIssue({
          id: 'issue-1',
          title: 'Filtered Issue',
          status: 'in_progress',
        }),
      ];
      mockClient.setIssuesResponse(mockIssues);

      const tool = createListIssuesTool(mockClient);
      const params: ListIssuesParams = {
        projectNumber: 72,
        status: 'in_progress',
        phase: 'Phase 2',
        assignee: 'testuser',
      };
      const result = await tool.handler(params);

      // Verify all query parameters are included
      const requestPath = mockClient.getLastRequestPath();
      expect(requestPath).toContain('status=in_progress');
      expect(requestPath).toContain('phase=Phase%202');
      expect(requestPath).toContain('assignee=testuser');

      const response = extractResponse(result);
      expect(response.filters.status).toBe('in_progress');
      expect(response.filters.phase).toBe('Phase 2');
      expect(response.filters.assignee).toBe('testuser');
    });

    it('should combine status and phase filters', async () => {
      mockClient.setIssuesResponse([]);

      const tool = createListIssuesTool(mockClient);
      await tool.handler({ projectNumber: 72, status: 'todo', phase: 'Phase 1' });

      const requestPath = mockClient.getLastRequestPath();
      expect(requestPath).toContain('status=todo');
      expect(requestPath).toContain('phase=Phase%201');
    });

    it('should combine status and assignee filters', async () => {
      mockClient.setIssuesResponse([]);

      const tool = createListIssuesTool(mockClient);
      await tool.handler({ projectNumber: 72, status: 'done', assignee: 'developer1' });

      const requestPath = mockClient.getLastRequestPath();
      expect(requestPath).toContain('status=done');
      expect(requestPath).toContain('assignee=developer1');
    });
  });

  describe('AC-2.2.e: Empty results with filters', () => {
    it('should return empty array when no issues match filters', async () => {
      mockClient.setIssuesResponse([]);

      const tool = createListIssuesTool(mockClient);
      const params: ListIssuesParams = {
        projectNumber: 72,
        status: 'done',
        phase: 'Nonexistent Phase',
      };
      const result = await tool.handler(params);

      const response = extractResponse(result);
      expect(response.issueCount).toBe(0);
      expect(response.issues).toEqual([]);
      expect(result.isError).toBeUndefined();
    });

    it('should include filter information even with empty results', async () => {
      mockClient.setIssuesResponse([]);

      const tool = createListIssuesTool(mockClient);
      const result = await tool.handler({ projectNumber: 72, status: 'backlog' });

      const response = extractResponse(result);
      expect(response.filters.status).toBe('backlog');
      expect(response.issueCount).toBe(0);
    });
  });

  describe('AC-2.2.f: Performance with 100+ issues', () => {
    it('should complete in <2 seconds for 100+ issues', async () => {
      // Setup: Mock 150 issues
      const mockIssues: Issue[] = Array.from({ length: 150 }, (_, i) =>
        createMockIssue({
          id: `issue-${i}`,
          title: `Issue ${i}`,
          status: i % 2 === 0 ? 'open' : 'closed',
        })
      );
      mockClient.setIssuesResponse(mockIssues);

      const tool = createListIssuesTool(mockClient);
      const startTime = Date.now();
      const result = await tool.handler({ projectNumber: 72 });
      const endTime = Date.now();

      const response = extractResponse(result);

      // Verify all issues are returned
      expect(response.issueCount).toBe(150);
      expect(response.issues).toHaveLength(150);

      // Verify response time is under 2 seconds
      const totalTime = endTime - startTime;
      expect(totalTime).toBeLessThan(2000);

      // Verify tool reports reasonable response time
      expect(response.responseTimeMs).toBeLessThan(2000);
    });

    it('should include responseTimeMs in all responses', async () => {
      mockClient.setIssuesResponse([createMockIssue()]);

      const tool = createListIssuesTool(mockClient);
      const result = await tool.handler({ projectNumber: 72 });

      const response = extractResponse(result);
      expect(response.responseTimeMs).toBeDefined();
      expect(typeof response.responseTimeMs).toBe('number');
      expect(response.responseTimeMs).toBeGreaterThanOrEqual(0);
    });
  });

  describe('Tool definition and registration', () => {
    it('should have correct tool name', () => {
      const tool = createListIssuesTool(mockClient);
      expect(tool.name).toBe('list_issues');
    });

    it('should have descriptive description', () => {
      const tool = createListIssuesTool(mockClient);
      expect(tool.description).toContain('GitHub Project');
      expect(tool.description).toContain('filtering');
      expect(tool.description).toContain('status');
    });

    it('should have correct input schema with required fields', () => {
      const tool = createListIssuesTool(mockClient);
      expect(tool.inputSchema.type).toBe('object');
      expect(tool.inputSchema.required).toEqual(['projectNumber']);
      expect(tool.inputSchema.properties.projectNumber).toBeDefined();
      expect(tool.inputSchema.properties.status).toBeDefined();
      expect(tool.inputSchema.properties.phase).toBeDefined();
      expect(tool.inputSchema.properties.assignee).toBeDefined();
    });

    it('should have valid status enum values', () => {
      const tool = createListIssuesTool(mockClient);
      expect(tool.inputSchema.properties.status?.enum).toEqual([
        'backlog',
        'todo',
        'in_progress',
        'done',
      ]);
    });

    it('should return valid MCP tool result format', async () => {
      mockClient.setIssuesResponse([]);

      const tool = createListIssuesTool(mockClient);
      const result = await tool.handler({ projectNumber: 72 });

      // Verify MCP ToolResult format
      expect(result).toHaveProperty('content');
      expect(Array.isArray(result.content)).toBe(true);
      expect(result.content[0]).toHaveProperty('type');
      expect(result.content[0]).toHaveProperty('text');
    });
  });

  describe('Error handling', () => {
    it('should handle API errors gracefully', async () => {
      mockClient.setError('HTTP 500: Internal Server Error');

      const tool = createListIssuesTool(mockClient);
      const result = await tool.handler({ projectNumber: 72 });

      expect(result.isError).toBe(true);
      const response = extractResponse(result);
      expect(response.error).toContain('Failed to list issues');
      expect(response.error).toContain('Internal Server Error');
    });

    it('should handle network errors', async () => {
      mockClient.setError('Network error: ECONNREFUSED');

      const tool = createListIssuesTool(mockClient);
      const result = await tool.handler({ projectNumber: 72 });

      expect(result.isError).toBe(true);
      const response = extractResponse(result);
      expect(response.error).toContain('ECONNREFUSED');
    });

    it('should include project number in error response', async () => {
      mockClient.setError('API error');

      const tool = createListIssuesTool(mockClient);
      const result = await tool.handler({ projectNumber: 99 });

      const response = extractResponse(result);
      expect(response.projectNumber).toBe(99);
    });

    it('should return valid JSON in all error scenarios', async () => {
      const errorScenarios = [
        'HTTP 404: Not Found',
        'HTTP 401: Unauthorized',
        'Timeout error',
        'Unknown error',
      ];

      for (const errorMessage of errorScenarios) {
        mockClient.setError(errorMessage);

        const tool = createListIssuesTool(mockClient);
        const result = await tool.handler({ projectNumber: 72 });

        // Should always return valid JSON
        const textContent = result.content[0];
        if (textContent.type !== 'text') throw new Error('Expected text content');
        expect(() => JSON.parse(textContent.text || '{}')).not.toThrow();
      }
    });
  });

  describe('Response format validation', () => {
    it('should include all required issue fields in response', async () => {
      const mockIssue = createMockIssue({
        id: 'test-id',
        title: 'Test Title',
        status: 'open',
        projectId: 'proj-123',
        labels: ['bug', 'urgent'],
        createdAt: '2026-01-01T00:00:00Z',
        updatedAt: '2026-01-20T00:00:00Z',
      });
      mockClient.setIssuesResponse([mockIssue]);

      const tool = createListIssuesTool(mockClient);
      const result = await tool.handler({ projectNumber: 72 });

      const response = extractResponse(result);
      const issue = response.issues[0];

      expect(issue.id).toBe('test-id');
      expect(issue.title).toBe('Test Title');
      expect(issue.status).toBe('open');
      expect(issue.projectId).toBe('proj-123');
      expect(issue.labels).toEqual(['bug', 'urgent']);
      expect(issue.createdAt).toBe('2026-01-01T00:00:00Z');
      expect(issue.updatedAt).toBe('2026-01-20T00:00:00Z');
    });

    it('should handle issues with empty labels array', async () => {
      const mockIssue = createMockIssue({ labels: [] });
      mockClient.setIssuesResponse([mockIssue]);

      const tool = createListIssuesTool(mockClient);
      const result = await tool.handler({ projectNumber: 72 });

      const response = extractResponse(result);
      expect(response.issues[0].labels).toEqual([]);
    });

    it('should preserve issue order from API response', async () => {
      const mockIssues = [
        createMockIssue({ id: 'issue-3', title: 'Third' }),
        createMockIssue({ id: 'issue-1', title: 'First' }),
        createMockIssue({ id: 'issue-2', title: 'Second' }),
      ];
      mockClient.setIssuesResponse(mockIssues);

      const tool = createListIssuesTool(mockClient);
      const result = await tool.handler({ projectNumber: 72 });

      const response = extractResponse(result);
      expect(response.issues[0].id).toBe('issue-3');
      expect(response.issues[1].id).toBe('issue-1');
      expect(response.issues[2].id).toBe('issue-2');
    });
  });
});
