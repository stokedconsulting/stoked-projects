import { createGetIssueDetailsTool, IssueDetails, GetIssueDetailsParams } from './get-issue-details';
import { APIClient, NotFoundError, WorkItem } from '../api-client';

/**
 * Mock API client for testing get-issue-details tool
 */
class MockAPIClient extends APIClient {
  private mockResponses: Map<string, any> = new Map();
  private mockErrors: Map<string, Error> = new Map();

  constructor() {
    // Override parent constructor to avoid requiring API key
    super({ apiKey: 'test-key', baseUrl: 'https://test.example.com' });
  }

  /**
   * Set mock response for a specific path
   */
  setResponse(path: string, response: any) {
    this.mockResponses.set(path, response);
    this.mockErrors.delete(path);
  }

  /**
   * Set mock error for a specific path
   */
  setError(path: string, error: Error) {
    this.mockErrors.set(path, error);
    this.mockResponses.delete(path);
  }

  /**
   * Override get method to return mock data
   */
  async get<T>(path: string): Promise<T> {
    // Check if error should be thrown
    if (this.mockErrors.has(path)) {
      throw this.mockErrors.get(path);
    }

    // Check if mock response exists
    if (this.mockResponses.has(path)) {
      return this.mockResponses.get(path) as T;
    }

    // Default: throw NotFoundError
    throw new NotFoundError(`No mock configured for path: ${path}`);
  }

  /**
   * Clear all mock data
   */
  clear() {
    this.mockResponses.clear();
    this.mockErrors.clear();
  }
}

describe('Get Issue Details Tool', () => {
  let mockClient: MockAPIClient;

  beforeEach(() => {
    mockClient = new MockAPIClient();
  });

  /**
   * Helper function to extract IssueDetails from tool result
   */
  function extractIssueDetails(result: any): IssueDetails {
    expect(result.content).toHaveLength(1);
    expect(result.content[0].type).toBe('text');

    const textContent = result.content[0];
    if (textContent.type !== 'text') throw new Error('Expected text content');
    return JSON.parse(textContent.text || '{}');
  }

  /**
   * Helper function to extract error message from tool result
   */
  function extractError(result: any): { error: string; projectNumber?: number; issueNumber?: number } {
    expect(result.content).toHaveLength(1);
    expect(result.content[0].type).toBe('text');

    const textContent = result.content[0];
    if (textContent.type !== 'text') throw new Error('Expected text content');
    return JSON.parse(textContent.text || '{}');
  }

  describe('AC-2.4.a: Valid issue returns complete Issue object', () => {
    it('should return complete issue details when issue exists', async () => {
      // Setup: Mock successful issue response
      const mockIssue: IssueDetails = {
        id: 'issue-123',
        projectId: 'project-72',
        number: 42,
        title: 'Implement get_issue_details tool',
        description: 'Add MCP tool for fetching complete issue details',
        status: 'in_progress',
        labels: ['mcp', 'phase-2', 'enhancement'],
        phase: 'Phase 2 - Core Read Operations',
        createdAt: '2024-01-15T10:00:00Z',
        updatedAt: '2024-01-20T14:30:00Z',
      };

      mockClient.setResponse('/api/projects/72/issues/42', mockIssue);

      const tool = createGetIssueDetailsTool(mockClient);
      const params: GetIssueDetailsParams = { projectNumber: 72, issueNumber: 42 };
      const result = await tool.handler(params);

      const issueDetails = extractIssueDetails(result);

      // Verify all fields are returned
      expect(issueDetails.id).toBe('issue-123');
      expect(issueDetails.title).toBe('Implement get_issue_details tool');
      expect(issueDetails.description).toBe('Add MCP tool for fetching complete issue details');
      expect(issueDetails.status).toBe('in_progress');
      expect(issueDetails.number).toBe(42);
      expect(issueDetails.phase).toBe('Phase 2 - Core Read Operations');

      // Verify result is not an error
      expect(result.isError).toBeUndefined();
    });

    it('should include all issue metadata fields', async () => {
      const mockIssue: IssueDetails = {
        id: 'issue-456',
        projectId: 'project-72',
        title: 'Test Issue',
        status: 'open',
        labels: ['bug', 'high-priority'],
        createdAt: '2024-01-10T08:00:00Z',
        updatedAt: '2024-01-18T16:45:00Z',
      };

      mockClient.setResponse('/api/projects/72/issues/456', mockIssue);

      const tool = createGetIssueDetailsTool(mockClient);
      const result = await tool.handler({ projectNumber: 72, issueNumber: 456 });

      const issueDetails = extractIssueDetails(result);
      expect(issueDetails.createdAt).toBe('2024-01-10T08:00:00Z');
      expect(issueDetails.updatedAt).toBe('2024-01-18T16:45:00Z');
    });
  });

  describe('AC-2.4.b: Issue with work items returns populated work items array', () => {
    it('should return issue with work items when work items exist', async () => {
      // Setup: Mock issue with work items
      const mockWorkItems: WorkItem[] = [
        {
          id: 'wi-1',
          phaseId: 'phase-2',
          projectId: 'project-72',
          name: 'Create tool file',
          description: 'Create get-issue-details.ts',
          status: 'completed',
          priority: 'high',
          order: 1,
          createdAt: '2024-01-15T10:00:00Z',
          updatedAt: '2024-01-20T12:00:00Z',
        },
        {
          id: 'wi-2',
          phaseId: 'phase-2',
          projectId: 'project-72',
          name: 'Register tool',
          description: 'Register in server.ts',
          status: 'in_progress',
          priority: 'high',
          order: 2,
          createdAt: '2024-01-15T10:00:00Z',
          updatedAt: '2024-01-20T14:00:00Z',
        },
        {
          id: 'wi-3',
          phaseId: 'phase-2',
          projectId: 'project-72',
          name: 'Write tests',
          description: 'Create comprehensive test suite',
          status: 'pending',
          priority: 'medium',
          order: 3,
          createdAt: '2024-01-15T10:00:00Z',
          updatedAt: '2024-01-15T10:00:00Z',
        },
      ];

      const mockIssue: IssueDetails = {
        id: 'issue-789',
        projectId: 'project-72',
        title: 'Issue with work items',
        status: 'in_progress',
        labels: ['feature'],
        workItems: mockWorkItems,
        createdAt: '2024-01-15T10:00:00Z',
        updatedAt: '2024-01-20T14:30:00Z',
      };

      mockClient.setResponse('/api/projects/72/issues/789', mockIssue);

      const tool = createGetIssueDetailsTool(mockClient);
      const result = await tool.handler({ projectNumber: 72, issueNumber: 789 });

      const issueDetails = extractIssueDetails(result);

      // Verify work items array is present
      expect(issueDetails.workItems).toBeDefined();
      expect(Array.isArray(issueDetails.workItems)).toBe(true);
      expect(issueDetails.workItems).toHaveLength(3);

      // Verify work item details
      expect(issueDetails.workItems![0].id).toBe('wi-1');
      expect(issueDetails.workItems![0].status).toBe('completed');
      expect(issueDetails.workItems![1].status).toBe('in_progress');
      expect(issueDetails.workItems![2].status).toBe('pending');
    });

    it('should handle issue with empty work items array', async () => {
      const mockIssue: IssueDetails = {
        id: 'issue-empty-wi',
        projectId: 'project-72',
        title: 'Issue with no work items',
        status: 'open',
        labels: [],
        workItems: [],
        createdAt: '2024-01-15T10:00:00Z',
        updatedAt: '2024-01-15T10:00:00Z',
      };

      mockClient.setResponse('/api/projects/72/issues/100', mockIssue);

      const tool = createGetIssueDetailsTool(mockClient);
      const result = await tool.handler({ projectNumber: 72, issueNumber: 100 });

      const issueDetails = extractIssueDetails(result);
      expect(issueDetails.workItems).toEqual([]);
    });
  });

  describe('AC-2.4.c: Issue does not exist returns 404 error with issue number', () => {
    it('should return 404 error when issue does not exist', async () => {
      // Setup: Mock NotFoundError
      mockClient.setError(
        '/api/projects/72/issues/999',
        new NotFoundError('Issue not found')
      );

      const tool = createGetIssueDetailsTool(mockClient);
      const result = await tool.handler({ projectNumber: 72, issueNumber: 999 });

      const errorResponse = extractError(result);

      // Verify error response
      expect(result.isError).toBe(true);
      expect(errorResponse.error).toContain('Issue #999 not found in Project #72');
      expect(errorResponse.projectNumber).toBe(72);
      expect(errorResponse.issueNumber).toBe(999);
    });

    it('should include both project and issue numbers in error message', async () => {
      mockClient.setError(
        '/api/projects/50/issues/25',
        new NotFoundError('Issue #25 not found')
      );

      const tool = createGetIssueDetailsTool(mockClient);
      const result = await tool.handler({ projectNumber: 50, issueNumber: 25 });

      const errorResponse = extractError(result);
      expect(errorResponse.error).toContain('#25');
      expect(errorResponse.error).toContain('#50');
      expect(errorResponse.projectNumber).toBe(50);
      expect(errorResponse.issueNumber).toBe(25);
    });
  });

  describe('AC-2.4.d: Issue exists but not in project returns 404 with clarification', () => {
    it('should return 404 with project mismatch error when issue not in project', async () => {
      // Setup: Mock NotFoundError with project mismatch message
      mockClient.setError(
        '/api/projects/72/issues/123',
        new NotFoundError('Issue #123 not found in project #72')
      );

      const tool = createGetIssueDetailsTool(mockClient);
      const result = await tool.handler({ projectNumber: 72, issueNumber: 123 });

      const errorResponse = extractError(result);

      // Verify error clarifies issue-project mismatch
      expect(result.isError).toBe(true);
      expect(errorResponse.error).toContain('exists but is not part of Project #72');
      expect(errorResponse.error).toContain('Issue #123');
    });

    it('should detect project mismatch from "not part of project" message', async () => {
      mockClient.setError(
        '/api/projects/10/issues/50',
        new NotFoundError('Issue is not part of project')
      );

      const tool = createGetIssueDetailsTool(mockClient);
      const result = await tool.handler({ projectNumber: 10, issueNumber: 50 });

      const errorResponse = extractError(result);
      expect(errorResponse.error).toContain('exists but is not part of Project #10');
    });
  });

  describe('AC-2.4.e: Issue with labels returns labels array', () => {
    it('should return issue with labels array when labels exist', async () => {
      const mockIssue: IssueDetails = {
        id: 'issue-with-labels',
        projectId: 'project-72',
        title: 'Issue with multiple labels',
        status: 'open',
        labels: ['bug', 'high-priority', 'backend', 'api'],
        createdAt: '2024-01-15T10:00:00Z',
        updatedAt: '2024-01-15T10:00:00Z',
      };

      mockClient.setResponse('/api/projects/72/issues/200', mockIssue);

      const tool = createGetIssueDetailsTool(mockClient);
      const result = await tool.handler({ projectNumber: 72, issueNumber: 200 });

      const issueDetails = extractIssueDetails(result);

      // Verify labels array
      expect(issueDetails.labels).toBeDefined();
      expect(Array.isArray(issueDetails.labels)).toBe(true);
      expect(issueDetails.labels).toHaveLength(4);
      expect(issueDetails.labels).toContain('bug');
      expect(issueDetails.labels).toContain('high-priority');
      expect(issueDetails.labels).toContain('backend');
      expect(issueDetails.labels).toContain('api');
    });

    it('should handle issue with empty labels array', async () => {
      const mockIssue: IssueDetails = {
        id: 'issue-no-labels',
        projectId: 'project-72',
        title: 'Issue without labels',
        status: 'open',
        labels: [],
        createdAt: '2024-01-15T10:00:00Z',
        updatedAt: '2024-01-15T10:00:00Z',
      };

      mockClient.setResponse('/api/projects/72/issues/300', mockIssue);

      const tool = createGetIssueDetailsTool(mockClient);
      const result = await tool.handler({ projectNumber: 72, issueNumber: 300 });

      const issueDetails = extractIssueDetails(result);
      expect(issueDetails.labels).toEqual([]);
    });
  });

  describe('Tool definition and schema validation', () => {
    it('should have correct tool name', () => {
      const tool = createGetIssueDetailsTool(mockClient);
      expect(tool.name).toBe('get_issue_details');
    });

    it('should have descriptive description', () => {
      const tool = createGetIssueDetailsTool(mockClient);
      expect(tool.description).toContain('complete details');
      expect(tool.description).toContain('GitHub issue');
      expect(tool.description).toContain('work items');
      expect(tool.description).toContain('labels');
    });

    it('should require projectNumber parameter', () => {
      const tool = createGetIssueDetailsTool(mockClient);
      expect(tool.inputSchema.required).toContain('projectNumber');
      expect(tool.inputSchema.properties.projectNumber.type).toBe('number');
    });

    it('should require issueNumber parameter', () => {
      const tool = createGetIssueDetailsTool(mockClient);
      expect(tool.inputSchema.required).toContain('issueNumber');
      expect(tool.inputSchema.properties.issueNumber.type).toBe('number');
    });

    it('should return valid MCP tool result format', async () => {
      const mockIssue: IssueDetails = {
        id: 'test',
        projectId: 'project-72',
        title: 'Test',
        status: 'open',
        labels: [],
        createdAt: '2024-01-15T10:00:00Z',
        updatedAt: '2024-01-15T10:00:00Z',
      };

      mockClient.setResponse('/api/projects/72/issues/1', mockIssue);

      const tool = createGetIssueDetailsTool(mockClient);
      const result = await tool.handler({ projectNumber: 72, issueNumber: 1 });

      // Verify MCP ToolResult format
      expect(result).toHaveProperty('content');
      expect(Array.isArray(result.content)).toBe(true);
      expect(result.content[0]).toHaveProperty('type');
      expect(result.content[0]).toHaveProperty('text');
    });
  });

  describe('Edge cases and error handling', () => {
    it('should handle issue with all optional fields missing', async () => {
      const mockIssue: IssueDetails = {
        id: 'minimal-issue',
        projectId: 'project-72',
        title: 'Minimal issue',
        status: 'open',
        labels: [],
        createdAt: '2024-01-15T10:00:00Z',
        updatedAt: '2024-01-15T10:00:00Z',
      };

      mockClient.setResponse('/api/projects/72/issues/400', mockIssue);

      const tool = createGetIssueDetailsTool(mockClient);
      const result = await tool.handler({ projectNumber: 72, issueNumber: 400 });

      const issueDetails = extractIssueDetails(result);
      expect(issueDetails.id).toBe('minimal-issue');
      expect(issueDetails.description).toBeUndefined();
      expect(issueDetails.workItems).toBeUndefined();
      expect(issueDetails.phase).toBeUndefined();
    });

    it('should return valid JSON in all error scenarios', async () => {
      const errorScenarios = [
        {
          path: '/api/projects/72/issues/404',
          error: new NotFoundError('Issue not found'),
        },
        {
          path: '/api/projects/72/issues/500',
          error: new NotFoundError('Issue not found in project'),
        },
      ];

      for (const scenario of errorScenarios) {
        mockClient.clear();
        mockClient.setError(scenario.path, scenario.error);

        const tool = createGetIssueDetailsTool(mockClient);
        const issueNumber = parseInt(scenario.path.split('/').pop() || '0', 10);
        const result = await tool.handler({ projectNumber: 72, issueNumber });

        // Should always return valid JSON
        const textContent = result.content[0];
        if (textContent.type !== 'text') throw new Error('Expected text content');
        expect(() => JSON.parse(textContent.text || '{}')).not.toThrow();
      }
    });

    it('should handle large project and issue numbers', async () => {
      const mockIssue: IssueDetails = {
        id: 'large-numbers',
        projectId: 'project-999999',
        title: 'Large numbers test',
        status: 'open',
        labels: [],
        createdAt: '2024-01-15T10:00:00Z',
        updatedAt: '2024-01-15T10:00:00Z',
      };

      mockClient.setResponse('/api/projects/999999/issues/888888', mockIssue);

      const tool = createGetIssueDetailsTool(mockClient);
      const result = await tool.handler({ projectNumber: 999999, issueNumber: 888888 });

      const issueDetails = extractIssueDetails(result);
      expect(issueDetails.id).toBe('large-numbers');
    });

    it('should correctly construct API path with parameters', async () => {
      // This test verifies the path construction is correct
      const mockIssue: IssueDetails = {
        id: 'path-test',
        projectId: 'project-15',
        title: 'Path construction test',
        status: 'open',
        labels: [],
        createdAt: '2024-01-15T10:00:00Z',
        updatedAt: '2024-01-15T10:00:00Z',
      };

      // Set response for specific path
      mockClient.setResponse('/api/projects/15/issues/25', mockIssue);

      const tool = createGetIssueDetailsTool(mockClient);
      const result = await tool.handler({ projectNumber: 15, issueNumber: 25 });

      // Should succeed (not throw NotFoundError for wrong path)
      expect(result.isError).toBeUndefined();
      const issueDetails = extractIssueDetails(result);
      expect(issueDetails.id).toBe('path-test');
    });
  });
});
