import { createCreateIssueTool, CreatedIssue, CreateIssueParams } from './create-issue';
import { APIClient, NotFoundError } from '../api-client';

/**
 * Mock API client for testing create-issue tool
 */
class MockAPIClient extends APIClient {
  private mockResponses: Map<string, any> = new Map();
  private mockErrors: Map<string, Error> = new Map();
  private postRequests: Array<{ path: string; body: any }> = [];

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
   * Get recorded POST requests for verification
   */
  getPostRequests() {
    return this.postRequests;
  }

  /**
   * Override post method to return mock data and record requests
   */
  async post<T>(path: string, body?: unknown): Promise<T> {
    // Record request for verification
    this.postRequests.push({ path, body });

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
    this.postRequests = [];
  }
}

describe('Create Issue Tool', () => {
  let mockClient: MockAPIClient;

  beforeEach(() => {
    mockClient = new MockAPIClient();
  });

  /**
   * Helper function to extract CreatedIssue from tool result
   */
  function extractCreatedIssue(result: any): CreatedIssue {
    expect(result.content).toHaveLength(1);
    expect(result.content[0].type).toBe('text');

    const textContent = result.content[0];
    if (textContent.type !== 'text') throw new Error('Expected text content');
    return JSON.parse(textContent.text || '{}');
  }

  /**
   * Helper function to extract error message from tool result
   */
  function extractError(result: any): { error: string; projectNumber?: number; phase?: string } {
    expect(result.content).toHaveLength(1);
    expect(result.content[0].type).toBe('text');

    const textContent = result.content[0];
    if (textContent.type !== 'text') throw new Error('Expected text content');
    return JSON.parse(textContent.text || '{}');
  }

  describe('AC-3.3.a: Title only creates issue with default status "backlog"', () => {
    it('should create issue with title only and default status', async () => {
      // Setup: Mock successful issue creation
      const mockCreatedIssue: CreatedIssue = {
        id: 'issue-new-1',
        projectId: 'project-72',
        number: 100,
        title: 'New feature request',
        status: 'open',
        labels: [],
        createdAt: '2024-01-20T10:00:00Z',
        updatedAt: '2024-01-20T10:00:00Z',
        url: 'https://github.com/org/repo/issues/100',
      };

      mockClient.setResponse('/api/projects/72/issues', mockCreatedIssue);

      const tool = createCreateIssueTool(mockClient);
      const params: CreateIssueParams = {
        projectNumber: 72,
        title: 'New feature request',
      };
      const result = await tool.handler(params);

      const createdIssue = extractCreatedIssue(result);

      // Verify issue was created with correct title
      expect(createdIssue.title).toBe('New feature request');
      expect(createdIssue.number).toBe(100);

      // Verify request was sent with default status (+ event notification POST)
      const requests = mockClient.getPostRequests();
      expect(requests.length).toBeGreaterThanOrEqual(1);
      expect(requests[0].path).toBe('/api/projects/72/issues');
      expect(requests[0].body).toMatchObject({
        title: 'New feature request',
        status: 'backlog',
      });

      // Verify result is not an error
      expect(result.isError).toBeUndefined();
    });

    it('should trim whitespace from title', async () => {
      const mockCreatedIssue: CreatedIssue = {
        id: 'issue-trimmed',
        projectId: 'project-72',
        number: 101,
        title: 'Trimmed title',
        status: 'open',
        labels: [],
        createdAt: '2024-01-20T10:00:00Z',
        updatedAt: '2024-01-20T10:00:00Z',
      };

      mockClient.setResponse('/api/projects/72/issues', mockCreatedIssue);

      const tool = createCreateIssueTool(mockClient);
      const result = await tool.handler({
        projectNumber: 72,
        title: '  Trimmed title  ',
      });

      const requests = mockClient.getPostRequests();
      expect(requests[0].body.title).toBe('Trimmed title');
    });
  });

  describe('AC-3.3.b: Includes body creates issue with provided markdown', () => {
    it('should include body in issue creation', async () => {
      const mockCreatedIssue: CreatedIssue = {
        id: 'issue-with-body',
        projectId: 'project-72',
        number: 102,
        title: 'Issue with description',
        description: '## Description\n\nThis is a detailed description with **markdown**.',
        status: 'open',
        labels: [],
        createdAt: '2024-01-20T10:00:00Z',
        updatedAt: '2024-01-20T10:00:00Z',
      };

      mockClient.setResponse('/api/projects/72/issues', mockCreatedIssue);

      const tool = createCreateIssueTool(mockClient);
      const params: CreateIssueParams = {
        projectNumber: 72,
        title: 'Issue with description',
        body: '## Description\n\nThis is a detailed description with **markdown**.',
      };
      const result = await tool.handler(params);

      const createdIssue = extractCreatedIssue(result);
      expect(createdIssue.description).toBe(
        '## Description\n\nThis is a detailed description with **markdown**.'
      );

      // Verify body was sent in request
      const requests = mockClient.getPostRequests();
      expect(requests[0].body).toHaveProperty('body');
      expect(requests[0].body.body).toBe(
        '## Description\n\nThis is a detailed description with **markdown**.'
      );
    });

    it('should handle markdown formatting in body', async () => {
      const markdownBody = `
# Main Heading

## Requirements
- [ ] Requirement 1
- [ ] Requirement 2

**Bold text** and *italic text*

\`\`\`typescript
const code = "example";
\`\`\`
`;

      const mockCreatedIssue: CreatedIssue = {
        id: 'issue-markdown',
        projectId: 'project-72',
        number: 103,
        title: 'Markdown test',
        description: markdownBody,
        status: 'open',
        labels: [],
        createdAt: '2024-01-20T10:00:00Z',
        updatedAt: '2024-01-20T10:00:00Z',
      };

      mockClient.setResponse('/api/projects/72/issues', mockCreatedIssue);

      const tool = createCreateIssueTool(mockClient);
      const result = await tool.handler({
        projectNumber: 72,
        title: 'Markdown test',
        body: markdownBody,
      });

      const createdIssue = extractCreatedIssue(result);
      expect(createdIssue.description).toBe(markdownBody);
    });
  });

  describe('AC-3.3.c: Includes status creates issue with specified status', () => {
    it('should create issue with status "todo"', async () => {
      const mockCreatedIssue: CreatedIssue = {
        id: 'issue-todo',
        projectId: 'project-72',
        number: 104,
        title: 'Todo issue',
        status: 'open',
        labels: [],
        createdAt: '2024-01-20T10:00:00Z',
        updatedAt: '2024-01-20T10:00:00Z',
      };

      mockClient.setResponse('/api/projects/72/issues', mockCreatedIssue);

      const tool = createCreateIssueTool(mockClient);
      const result = await tool.handler({
        projectNumber: 72,
        title: 'Todo issue',
        status: 'todo',
      });

      const requests = mockClient.getPostRequests();
      expect(requests[0].body.status).toBe('todo');
    });

    it('should create issue with status "in_progress"', async () => {
      const mockCreatedIssue: CreatedIssue = {
        id: 'issue-in-progress',
        projectId: 'project-72',
        number: 105,
        title: 'In progress issue',
        status: 'open',
        labels: [],
        createdAt: '2024-01-20T10:00:00Z',
        updatedAt: '2024-01-20T10:00:00Z',
      };

      mockClient.setResponse('/api/projects/72/issues', mockCreatedIssue);

      const tool = createCreateIssueTool(mockClient);
      const result = await tool.handler({
        projectNumber: 72,
        title: 'In progress issue',
        status: 'in_progress',
      });

      const requests = mockClient.getPostRequests();
      expect(requests[0].body.status).toBe('in_progress');
    });

    it('should create issue with status "done"', async () => {
      const mockCreatedIssue: CreatedIssue = {
        id: 'issue-done',
        projectId: 'project-72',
        number: 106,
        title: 'Done issue',
        status: 'closed',
        labels: [],
        createdAt: '2024-01-20T10:00:00Z',
        updatedAt: '2024-01-20T10:00:00Z',
      };

      mockClient.setResponse('/api/projects/72/issues', mockCreatedIssue);

      const tool = createCreateIssueTool(mockClient);
      const result = await tool.handler({
        projectNumber: 72,
        title: 'Done issue',
        status: 'done',
      });

      const requests = mockClient.getPostRequests();
      expect(requests[0].body.status).toBe('done');
    });
  });

  describe('AC-3.3.d: Includes phase assigns issue to specified phase', () => {
    it('should assign issue to phase when phase is provided', async () => {
      const mockCreatedIssue: CreatedIssue = {
        id: 'issue-with-phase',
        projectId: 'project-72',
        number: 107,
        title: 'Issue in phase',
        status: 'open',
        labels: [],
        phase: 'Phase 2 - Core Read Operations',
        createdAt: '2024-01-20T10:00:00Z',
        updatedAt: '2024-01-20T10:00:00Z',
      };

      mockClient.setResponse('/api/projects/72/issues', mockCreatedIssue);

      const tool = createCreateIssueTool(mockClient);
      const result = await tool.handler({
        projectNumber: 72,
        title: 'Issue in phase',
        phase: 'Phase 2 - Core Read Operations',
      });

      const createdIssue = extractCreatedIssue(result);
      expect(createdIssue.phase).toBe('Phase 2 - Core Read Operations');

      // Verify phase was sent in request
      const requests = mockClient.getPostRequests();
      expect(requests[0].body.phase).toBe('Phase 2 - Core Read Operations');
    });

    it('should handle invalid phase name with error', async () => {
      mockClient.setError(
        '/api/projects/72/issues',
        new NotFoundError('Phase "Invalid Phase" not found')
      );

      const tool = createCreateIssueTool(mockClient);
      const result = await tool.handler({
        projectNumber: 72,
        title: 'Issue with invalid phase',
        phase: 'Invalid Phase',
      });

      const errorResponse = extractError(result);
      expect(result.isError).toBe(true);
      expect(errorResponse.error).toContain('Phase "Invalid Phase" not found');
      expect(errorResponse.projectNumber).toBe(72);
      expect(errorResponse.phase).toBe('Invalid Phase');
    });
  });

  describe('AC-3.3.e: Includes assignee assigns issue to GitHub user', () => {
    it('should assign issue to user when assignee is provided', async () => {
      const mockCreatedIssue: CreatedIssue = {
        id: 'issue-assigned',
        projectId: 'project-72',
        number: 108,
        title: 'Assigned issue',
        status: 'open',
        labels: [],
        assignee: 'johndoe',
        createdAt: '2024-01-20T10:00:00Z',
        updatedAt: '2024-01-20T10:00:00Z',
      };

      mockClient.setResponse('/api/projects/72/issues', mockCreatedIssue);

      const tool = createCreateIssueTool(mockClient);
      const result = await tool.handler({
        projectNumber: 72,
        title: 'Assigned issue',
        assignee: 'johndoe',
      });

      const createdIssue = extractCreatedIssue(result);
      expect(createdIssue.assignee).toBe('johndoe');

      // Verify assignee was sent in request
      const requests = mockClient.getPostRequests();
      expect(requests[0].body.assignee).toBe('johndoe');
    });
  });

  describe('AC-3.3.f: Includes labels applies specified labels to issue', () => {
    it('should apply labels when labels array is provided', async () => {
      const mockCreatedIssue: CreatedIssue = {
        id: 'issue-with-labels',
        projectId: 'project-72',
        number: 109,
        title: 'Issue with labels',
        status: 'open',
        labels: ['bug', 'high-priority', 'backend'],
        createdAt: '2024-01-20T10:00:00Z',
        updatedAt: '2024-01-20T10:00:00Z',
      };

      mockClient.setResponse('/api/projects/72/issues', mockCreatedIssue);

      const tool = createCreateIssueTool(mockClient);
      const result = await tool.handler({
        projectNumber: 72,
        title: 'Issue with labels',
        labels: ['bug', 'high-priority', 'backend'],
      });

      const createdIssue = extractCreatedIssue(result);
      expect(createdIssue.labels).toEqual(['bug', 'high-priority', 'backend']);

      // Verify labels were sent in request
      const requests = mockClient.getPostRequests();
      expect(requests[0].body.labels).toEqual(['bug', 'high-priority', 'backend']);
    });

    it('should handle empty labels array', async () => {
      const mockCreatedIssue: CreatedIssue = {
        id: 'issue-no-labels',
        projectId: 'project-72',
        number: 110,
        title: 'Issue without labels',
        status: 'open',
        labels: [],
        createdAt: '2024-01-20T10:00:00Z',
        updatedAt: '2024-01-20T10:00:00Z',
      };

      mockClient.setResponse('/api/projects/72/issues', mockCreatedIssue);

      const tool = createCreateIssueTool(mockClient);
      const result = await tool.handler({
        projectNumber: 72,
        title: 'Issue without labels',
        labels: [],
      });

      // Empty labels array should not be sent
      const requests = mockClient.getPostRequests();
      expect(requests[0].body.labels).toBeUndefined();
    });
  });

  describe('AC-3.3.g: Empty title returns validation error', () => {
    it('should return error for empty title', async () => {
      const tool = createCreateIssueTool(mockClient);
      const result = await tool.handler({
        projectNumber: 72,
        title: '',
      });

      const errorResponse = extractError(result);
      expect(result.isError).toBe(true);
      expect(errorResponse.error).toContain('Title is required');
      expect(errorResponse.projectNumber).toBe(72);

      // Verify no API request was made
      const requests = mockClient.getPostRequests();
      expect(requests).toHaveLength(0);
    });

    it('should return error for whitespace-only title', async () => {
      const tool = createCreateIssueTool(mockClient);
      const result = await tool.handler({
        projectNumber: 72,
        title: '   ',
      });

      const errorResponse = extractError(result);
      expect(result.isError).toBe(true);
      expect(errorResponse.error).toContain('Title is required');

      // Verify no API request was made
      const requests = mockClient.getPostRequests();
      expect(requests).toHaveLength(0);
    });
  });

  describe('AC-3.3.h: Issue created returns Issue object with GitHub issue number and URL', () => {
    it('should return complete issue object with number and URL', async () => {
      const mockCreatedIssue: CreatedIssue = {
        id: 'issue-complete',
        projectId: 'project-72',
        number: 111,
        title: 'Complete issue',
        description: 'Full description',
        status: 'open',
        labels: ['feature', 'phase-3'],
        phase: 'Phase 3',
        assignee: 'alice',
        createdAt: '2024-01-20T10:00:00Z',
        updatedAt: '2024-01-20T10:00:00Z',
        url: 'https://github.com/org/repo/issues/111',
      };

      mockClient.setResponse('/api/projects/72/issues', mockCreatedIssue);

      const tool = createCreateIssueTool(mockClient);
      const result = await tool.handler({
        projectNumber: 72,
        title: 'Complete issue',
        body: 'Full description',
        status: 'todo',
        phase: 'Phase 3',
        assignee: 'alice',
        labels: ['feature', 'phase-3'],
      });

      const createdIssue = extractCreatedIssue(result);

      // Verify all fields are present
      expect(createdIssue.id).toBe('issue-complete');
      expect(createdIssue.number).toBe(111);
      expect(createdIssue.url).toBe('https://github.com/org/repo/issues/111');
      expect(createdIssue.title).toBe('Complete issue');
      expect(createdIssue.description).toBe('Full description');
      expect(createdIssue.phase).toBe('Phase 3');
      expect(createdIssue.assignee).toBe('alice');
      expect(createdIssue.labels).toEqual(['feature', 'phase-3']);
    });

    it('should handle project not found error', async () => {
      mockClient.setError(
        '/api/projects/999/issues',
        new NotFoundError('Project #999 not found')
      );

      const tool = createCreateIssueTool(mockClient);
      const result = await tool.handler({
        projectNumber: 999,
        title: 'Issue in missing project',
      });

      const errorResponse = extractError(result);
      expect(result.isError).toBe(true);
      expect(errorResponse.error).toBe('Project #999 not found');
      expect(errorResponse.projectNumber).toBe(999);
    });
  });

  describe('Tool definition and schema validation', () => {
    it('should have correct tool name', () => {
      const tool = createCreateIssueTool(mockClient);
      expect(tool.name).toBe('create_issue');
    });

    it('should have descriptive description', () => {
      const tool = createCreateIssueTool(mockClient);
      expect(tool.description).toContain('Create a new GitHub issue');
      expect(tool.description).toContain('project board');
      expect(tool.description).toContain('status');
      expect(tool.description).toContain('phase');
      expect(tool.description).toContain('assignee');
      expect(tool.description).toContain('labels');
    });

    it('should require projectNumber parameter', () => {
      const tool = createCreateIssueTool(mockClient);
      expect(tool.inputSchema.required).toContain('projectNumber');
      expect(tool.inputSchema.properties.projectNumber.type).toBe('number');
    });

    it('should require title parameter', () => {
      const tool = createCreateIssueTool(mockClient);
      expect(tool.inputSchema.required).toContain('title');
      expect(tool.inputSchema.properties.title.type).toBe('string');
      expect((tool.inputSchema.properties.title as any).minLength).toBe(1);
    });

    it('should have optional body parameter', () => {
      const tool = createCreateIssueTool(mockClient);
      expect(tool.inputSchema.properties.body).toBeDefined();
      expect(tool.inputSchema.properties.body.type).toBe('string');
      expect(tool.inputSchema.properties.body.nullable).toBe(true);
    });

    it('should have status enum with valid values', () => {
      const tool = createCreateIssueTool(mockClient);
      expect(tool.inputSchema.properties.status).toBeDefined();
      expect(tool.inputSchema.properties.status.enum).toEqual([
        'backlog',
        'todo',
        'in_progress',
        'done',
      ]);
    });

    it('should have optional labels array', () => {
      const tool = createCreateIssueTool(mockClient);
      expect(tool.inputSchema.properties.labels).toBeDefined();
      expect(tool.inputSchema.properties.labels.type).toBe('array');
      expect(tool.inputSchema.properties.labels.nullable).toBe(true);
    });

    it('should return valid MCP tool result format', async () => {
      const mockCreatedIssue: CreatedIssue = {
        id: 'test',
        projectId: 'project-72',
        number: 200,
        title: 'Test',
        status: 'open',
        labels: [],
        createdAt: '2024-01-20T10:00:00Z',
        updatedAt: '2024-01-20T10:00:00Z',
      };

      mockClient.setResponse('/api/projects/72/issues', mockCreatedIssue);

      const tool = createCreateIssueTool(mockClient);
      const result = await tool.handler({ projectNumber: 72, title: 'Test' });

      // Verify MCP ToolResult format
      expect(result).toHaveProperty('content');
      expect(Array.isArray(result.content)).toBe(true);
      expect(result.content[0]).toHaveProperty('type');
      expect(result.content[0]).toHaveProperty('text');
    });
  });

  describe('Edge cases and error handling', () => {
    it('should handle all optional parameters together', async () => {
      const mockCreatedIssue: CreatedIssue = {
        id: 'issue-all-params',
        projectId: 'project-72',
        number: 112,
        title: 'Issue with all parameters',
        description: 'Detailed description',
        status: 'open',
        labels: ['label1', 'label2', 'label3'],
        phase: 'Phase 1',
        assignee: 'bob',
        createdAt: '2024-01-20T10:00:00Z',
        updatedAt: '2024-01-20T10:00:00Z',
        url: 'https://github.com/org/repo/issues/112',
      };

      mockClient.setResponse('/api/projects/72/issues', mockCreatedIssue);

      const tool = createCreateIssueTool(mockClient);
      const result = await tool.handler({
        projectNumber: 72,
        title: 'Issue with all parameters',
        body: 'Detailed description',
        status: 'in_progress',
        phase: 'Phase 1',
        assignee: 'bob',
        labels: ['label1', 'label2', 'label3'],
      });

      const createdIssue = extractCreatedIssue(result);
      expect(createdIssue.number).toBe(112);

      // Verify all parameters were sent
      const requests = mockClient.getPostRequests();
      expect(requests[0].body).toMatchObject({
        title: 'Issue with all parameters',
        body: 'Detailed description',
        status: 'in_progress',
        phase: 'Phase 1',
        assignee: 'bob',
        labels: ['label1', 'label2', 'label3'],
      });
    });

    it('should return valid JSON in all error scenarios', async () => {
      const errorScenarios = [
        {
          path: '/api/projects/999/issues',
          error: new NotFoundError('Project not found'),
        },
        {
          path: '/api/projects/72/issues',
          error: new NotFoundError('Phase not found'),
        },
      ];

      for (const scenario of errorScenarios) {
        mockClient.clear();
        mockClient.setError(scenario.path, scenario.error);

        const tool = createCreateIssueTool(mockClient);
        const projectNumber = parseInt(scenario.path.split('/')[3], 10);
        const result = await tool.handler({ projectNumber, title: 'Test' });

        // Should always return valid JSON
        const textContent = result.content[0];
        if (textContent.type !== 'text') throw new Error('Expected text content');
        expect(() => JSON.parse(textContent.text || '{}')).not.toThrow();
      }
    });

    it('should correctly construct API path with project number', async () => {
      const mockCreatedIssue: CreatedIssue = {
        id: 'path-test',
        projectId: 'project-15',
        number: 50,
        title: 'Path test',
        status: 'open',
        labels: [],
        createdAt: '2024-01-20T10:00:00Z',
        updatedAt: '2024-01-20T10:00:00Z',
      };

      mockClient.setResponse('/api/projects/15/issues', mockCreatedIssue);

      const tool = createCreateIssueTool(mockClient);
      const result = await tool.handler({ projectNumber: 15, title: 'Path test' });

      // Verify correct path was called
      const requests = mockClient.getPostRequests();
      expect(requests[0].path).toBe('/api/projects/15/issues');

      // Should succeed (not throw NotFoundError for wrong path)
      expect(result.isError).toBeUndefined();
      const createdIssue = extractCreatedIssue(result);
      expect(createdIssue.id).toBe('path-test');
    });

    it('should handle special characters in title', async () => {
      const specialTitle = 'Issue with "quotes" & <tags> and emoji 🚀';
      const mockCreatedIssue: CreatedIssue = {
        id: 'special-chars',
        projectId: 'project-72',
        number: 113,
        title: specialTitle,
        status: 'open',
        labels: [],
        createdAt: '2024-01-20T10:00:00Z',
        updatedAt: '2024-01-20T10:00:00Z',
      };

      mockClient.setResponse('/api/projects/72/issues', mockCreatedIssue);

      const tool = createCreateIssueTool(mockClient);
      const result = await tool.handler({
        projectNumber: 72,
        title: specialTitle,
      });

      const createdIssue = extractCreatedIssue(result);
      expect(createdIssue.title).toBe(specialTitle);
    });
  });
});
