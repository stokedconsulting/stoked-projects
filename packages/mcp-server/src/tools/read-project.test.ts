import { createReadProjectTool, ProjectDetails } from './read-project';
import { APIClient, NotFoundError, AuthenticationError } from '../api-client';

/**
 * Mock API client for testing read_project tool
 */
class MockAPIClient extends APIClient {
  private mockResponse: any;
  private shouldThrowError: boolean = false;
  private errorToThrow: Error | null = null;

  constructor() {
    // Override parent constructor to avoid requiring API key
    super({ apiKey: 'test-key', baseUrl: 'https://test.example.com' });
  }

  setResponse(response: any) {
    this.mockResponse = response;
    this.shouldThrowError = false;
    this.errorToThrow = null;
  }

  setError(error: Error) {
    this.errorToThrow = error;
    this.shouldThrowError = true;
  }

  async get<T>(path: string): Promise<T> {
    if (this.shouldThrowError && this.errorToThrow) {
      throw this.errorToThrow;
    }
    return this.mockResponse as T;
  }
}

describe('Read Project Tool', () => {
  let mockClient: MockAPIClient;

  beforeEach(() => {
    mockClient = new MockAPIClient();
  });

  /**
   * Helper function to extract result from tool response
   */
  function extractResult(result: any): any {
    expect(result.content).toHaveLength(1);
    expect(result.content[0].type).toBe('text');

    const textContent = result.content[0];
    if (textContent.type !== 'text') throw new Error('Expected text content');
    return JSON.parse(textContent.text || '{}');
  }

  /**
   * Helper function to create sample project details
   */
  function createSampleProject(projectNumber: number): ProjectDetails {
    return {
      projectNumber,
      id: `PVT_kwDOBW_6Ns4BNEBg`,
      title: `Test Project #${projectNumber}`,
      description: 'Test project description',
      url: `https://github.com/orgs/test-org/projects/${projectNumber}`,
      status: 'open',
      public: false,
      owner: 'test-org',
      fields: [
        {
          id: 'field-1',
          name: 'Status',
          dataType: 'single_select',
          options: ['Todo', 'In Progress', 'Done'],
        },
        {
          id: 'field-2',
          name: 'Priority',
          dataType: 'single_select',
          options: ['Low', 'Medium', 'High'],
        },
      ],
      phases: [
        {
          id: 'phase-1',
          name: 'Phase 1: Setup',
          description: 'Initial setup phase',
          order: 1,
          status: 'completed',
        },
        {
          id: 'phase-2',
          name: 'Phase 2: Implementation',
          description: 'Implementation phase',
          order: 2,
          status: 'in_progress',
        },
      ],
      stats: {
        totalItems: 25,
        openItems: 15,
        closedItems: 10,
        totalPhases: 2,
      },
      createdAt: '2024-01-15T10:00:00Z',
      updatedAt: '2024-01-20T15:30:00Z',
    };
  }

  describe('AC-2.1.a: Valid project number returns complete Project object with phases', () => {
    it('should return complete project details when project exists', async () => {
      // Setup: Mock successful response with complete project
      const sampleProject = createSampleProject(70);
      mockClient.setResponse(sampleProject);

      const tool = createReadProjectTool(mockClient);
      const result = await tool.handler({ projectNumber: 70 });

      const projectData = extractResult(result);

      // Verify complete project structure
      expect(projectData.projectNumber).toBe(70);
      expect(projectData.id).toBe('PVT_kwDOBW_6Ns4BNEBg');
      expect(projectData.title).toBe('Test Project #70');
      expect(projectData.description).toBe('Test project description');
      expect(projectData.url).toContain('/projects/70');
      expect(projectData.status).toBe('open');
      expect(projectData.owner).toBe('test-org');

      // Verify result is NOT an error
      expect(result.isError).toBeUndefined();
    });

    it('should include field definitions in response', async () => {
      const sampleProject = createSampleProject(70);
      mockClient.setResponse(sampleProject);

      const tool = createReadProjectTool(mockClient);
      const result = await tool.handler({ projectNumber: 70 });

      const projectData = extractResult(result);

      // Verify fields array exists and contains field definitions
      expect(projectData.fields).toBeDefined();
      expect(Array.isArray(projectData.fields)).toBe(true);
      expect(projectData.fields.length).toBeGreaterThan(0);
      expect(projectData.fields[0]).toHaveProperty('id');
      expect(projectData.fields[0]).toHaveProperty('name');
      expect(projectData.fields[0]).toHaveProperty('dataType');
    });

    it('should include phases array in response', async () => {
      const sampleProject = createSampleProject(70);
      mockClient.setResponse(sampleProject);

      const tool = createReadProjectTool(mockClient);
      const result = await tool.handler({ projectNumber: 70 });

      const projectData = extractResult(result);

      // Verify phases array exists
      expect(projectData.phases).toBeDefined();
      expect(Array.isArray(projectData.phases)).toBe(true);
      expect(projectData.phases.length).toBe(2);
      expect(projectData.phases[0]).toHaveProperty('id');
      expect(projectData.phases[0]).toHaveProperty('name');
      expect(projectData.phases[0]).toHaveProperty('status');
      expect(projectData.phases[0]).toHaveProperty('order');
    });

    it('should include summary statistics in response', async () => {
      const sampleProject = createSampleProject(70);
      mockClient.setResponse(sampleProject);

      const tool = createReadProjectTool(mockClient);
      const result = await tool.handler({ projectNumber: 70 });

      const projectData = extractResult(result);

      // Verify stats object exists
      expect(projectData.stats).toBeDefined();
      expect(projectData.stats.totalItems).toBe(25);
      expect(projectData.stats.openItems).toBe(15);
      expect(projectData.stats.closedItems).toBe(10);
      expect(projectData.stats.totalPhases).toBe(2);
    });
  });

  describe('AC-2.1.b: Non-existent project number returns error', () => {
    it('should return error "Project #999 not found" when project does not exist', async () => {
      // Setup: Mock 404 NotFoundError
      mockClient.setError(new NotFoundError('HTTP 404: Not Found'));

      const tool = createReadProjectTool(mockClient);
      const result = await tool.handler({ projectNumber: 999 });

      const errorData = extractResult(result);

      // Verify error message
      expect(errorData.error).toBe('Project #999 not found');
      expect(result.isError).toBe(true);
    });

    it('should return error for any non-existent project number', async () => {
      mockClient.setError(new NotFoundError('HTTP 404: Not Found'));

      const tool = createReadProjectTool(mockClient);
      const result = await tool.handler({ projectNumber: 12345 });

      const errorData = extractResult(result);

      expect(errorData.error).toBe('Project #12345 not found');
      expect(result.isError).toBe(true);
    });
  });

  describe('AC-2.1.c: Invalid parameter (string) returns validation error', () => {
    it('should reject string parameter via schema validation', async () => {
      const tool = createReadProjectTool(mockClient);

      // TypeScript would catch this at compile time, but JSON schema validates at runtime
      // The registry handles validation, so we test the schema definition
      expect(tool.inputSchema.properties.projectNumber.type).toBe('number');
      expect(tool.inputSchema.required).toContain('projectNumber');
    });

    it('should require projectNumber parameter', () => {
      const tool = createReadProjectTool(mockClient);

      // Verify schema requires projectNumber
      expect(tool.inputSchema.required).toEqual(['projectNumber']);
    });

    it('should not allow additional properties in schema', () => {
      const tool = createReadProjectTool(mockClient);

      // Verify strict schema
      expect(tool.inputSchema.additionalProperties).toBe(false);
    });
  });

  describe('AC-2.1.d: Malformed JSON returns parse error', () => {
    it('should return parse error when API returns malformed JSON', async () => {
      // Simulate JSON parse error
      mockClient.setError(new Error('Unexpected token < in JSON at position 0'));

      const tool = createReadProjectTool(mockClient);
      const result = await tool.handler({ projectNumber: 70 });

      const errorData = extractResult(result);

      // Verify parse error is handled
      expect(errorData.error).toBe('Failed to parse API response');
      expect(errorData.details).toContain('Unexpected token');
      expect(result.isError).toBe(true);
    });

    it('should handle JSON.parse errors gracefully', async () => {
      mockClient.setError(new Error('JSON parse failed: Invalid format'));

      const tool = createReadProjectTool(mockClient);
      const result = await tool.handler({ projectNumber: 70 });

      const errorData = extractResult(result);

      expect(errorData.error).toBe('Failed to parse API response');
      expect(result.isError).toBe(true);
    });
  });

  describe('AC-2.1.e: Project with multiple phases shows all phases', () => {
    it('should return all phases when project has multiple phases', async () => {
      // Create project with 5 phases
      const projectWithManyPhases = createSampleProject(70);
      projectWithManyPhases.phases = [
        { id: 'p1', name: 'Phase 1', order: 1, status: 'completed' },
        { id: 'p2', name: 'Phase 2', order: 2, status: 'completed' },
        { id: 'p3', name: 'Phase 3', order: 3, status: 'in_progress' },
        { id: 'p4', name: 'Phase 4', order: 4, status: 'pending' },
        { id: 'p5', name: 'Phase 5', order: 5, status: 'pending' },
      ];
      projectWithManyPhases.stats.totalPhases = 5;

      mockClient.setResponse(projectWithManyPhases);

      const tool = createReadProjectTool(mockClient);
      const result = await tool.handler({ projectNumber: 70 });

      const projectData = extractResult(result);

      // Verify all 5 phases are returned
      expect(projectData.phases).toHaveLength(5);
      expect(projectData.phases[0].name).toBe('Phase 1');
      expect(projectData.phases[1].name).toBe('Phase 2');
      expect(projectData.phases[2].name).toBe('Phase 3');
      expect(projectData.phases[3].name).toBe('Phase 4');
      expect(projectData.phases[4].name).toBe('Phase 5');

      // Verify phases are in correct order
      expect(projectData.phases[0].order).toBe(1);
      expect(projectData.phases[4].order).toBe(5);
    });

    it('should handle project with no phases', async () => {
      const projectWithNoPhases = createSampleProject(70);
      projectWithNoPhases.phases = [];
      projectWithNoPhases.stats.totalPhases = 0;

      mockClient.setResponse(projectWithNoPhases);

      const tool = createReadProjectTool(mockClient);
      const result = await tool.handler({ projectNumber: 70 });

      const projectData = extractResult(result);

      // Verify empty phases array
      expect(projectData.phases).toHaveLength(0);
      expect(projectData.stats.totalPhases).toBe(0);
    });
  });

  describe('Authentication and network error handling', () => {
    it('should return authentication error for 401 status', async () => {
      mockClient.setError(new AuthenticationError('HTTP 401: Unauthorized'));

      const tool = createReadProjectTool(mockClient);
      const result = await tool.handler({ projectNumber: 70 });

      const errorData = extractResult(result);

      expect(errorData.error).toBe('Authentication failed. Check STATE_TRACKING_API_KEY');
      expect(result.isError).toBe(true);
    });

    it('should return authentication error for 403 status', async () => {
      mockClient.setError(new AuthenticationError('HTTP 403: Forbidden'));

      const tool = createReadProjectTool(mockClient);
      const result = await tool.handler({ projectNumber: 70 });

      const errorData = extractResult(result);

      expect(errorData.error).toBe('Authentication failed. Check STATE_TRACKING_API_KEY');
      expect(result.isError).toBe(true);
    });

    it('should handle network connection errors', async () => {
      mockClient.setError(new Error('Network error: ECONNREFUSED'));

      const tool = createReadProjectTool(mockClient);
      const result = await tool.handler({ projectNumber: 70 });

      const errorData = extractResult(result);

      expect(errorData.error).toBe('Failed to connect to state-tracking-api');
      expect(errorData.details).toContain('ECONNREFUSED');
      expect(result.isError).toBe(true);
    });

    it('should handle DNS resolution errors', async () => {
      mockClient.setError(new Error('Network error: ENOTFOUND'));

      const tool = createReadProjectTool(mockClient);
      const result = await tool.handler({ projectNumber: 70 });

      const errorData = extractResult(result);

      expect(errorData.error).toBe('Failed to connect to state-tracking-api');
      expect(result.isError).toBe(true);
    });

    it('should handle timeout errors', async () => {
      mockClient.setError(new Error('Request timeout after 10000ms'));

      const tool = createReadProjectTool(mockClient);
      const result = await tool.handler({ projectNumber: 70 });

      const errorData = extractResult(result);

      expect(errorData.error).toBe('Failed to connect to state-tracking-api');
      expect(result.isError).toBe(true);
    });
  });

  describe('Tool definition and schema validation', () => {
    it('should have correct tool name', () => {
      const tool = createReadProjectTool(mockClient);
      expect(tool.name).toBe('read_project');
    });

    it('should have descriptive description', () => {
      const tool = createReadProjectTool(mockClient);
      expect(tool.description).toContain('project details');
      expect(tool.description).toContain('GitHub Projects');
      expect(tool.description).toContain('project number');
    });

    it('should have valid input schema with projectNumber parameter', () => {
      const tool = createReadProjectTool(mockClient);
      expect(tool.inputSchema.type).toBe('object');
      expect(tool.inputSchema.properties.projectNumber).toBeDefined();
      expect(tool.inputSchema.properties.projectNumber.type).toBe('number');
      expect(tool.inputSchema.required).toEqual(['projectNumber']);
    });

    it('should return valid MCP tool result format', async () => {
      const sampleProject = createSampleProject(70);
      mockClient.setResponse(sampleProject);

      const tool = createReadProjectTool(mockClient);
      const result = await tool.handler({ projectNumber: 70 });

      // Verify MCP ToolResult format
      expect(result).toHaveProperty('content');
      expect(Array.isArray(result.content)).toBe(true);
      expect(result.content[0]).toHaveProperty('type');
      expect(result.content[0]).toHaveProperty('text');
      expect(result.content[0].type).toBe('text');
    });
  });

  describe('Edge cases', () => {
    it('should handle project with optional fields missing', async () => {
      const minimalProject: ProjectDetails = {
        projectNumber: 70,
        id: 'test-id',
        title: 'Minimal Project',
        // description is optional
        url: 'https://example.com',
        status: 'open',
        public: true,
        owner: 'test-owner',
        fields: [],
        phases: [],
        stats: {
          totalItems: 0,
          openItems: 0,
          closedItems: 0,
          totalPhases: 0,
        },
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-01T00:00:00Z',
      };

      mockClient.setResponse(minimalProject);

      const tool = createReadProjectTool(mockClient);
      const result = await tool.handler({ projectNumber: 70 });

      const projectData = extractResult(result);

      expect(projectData.projectNumber).toBe(70);
      expect(projectData.title).toBe('Minimal Project');
      expect(projectData.description).toBeUndefined();
    });

    it('should handle project with closed status', async () => {
      const closedProject = createSampleProject(70);
      closedProject.status = 'closed';

      mockClient.setResponse(closedProject);

      const tool = createReadProjectTool(mockClient);
      const result = await tool.handler({ projectNumber: 70 });

      const projectData = extractResult(result);

      expect(projectData.status).toBe('closed');
    });

    it('should return valid JSON in all error scenarios', async () => {
      const errorScenarios = [
        () => mockClient.setError(new NotFoundError('Not found')),
        () => mockClient.setError(new AuthenticationError('Unauthorized')),
        () => mockClient.setError(new Error('Network error')),
        () => mockClient.setError(new Error('JSON parse error')),
        () => mockClient.setError(new Error('Unknown error')),
      ];

      for (const setupError of errorScenarios) {
        mockClient = new MockAPIClient();
        setupError();

        const tool = createReadProjectTool(mockClient);
        const result = await tool.handler({ projectNumber: 70 });

        // Should always return valid JSON
        const textContent = result.content[0];
        if (textContent.type !== 'text') throw new Error('Expected text content');
        expect(() => JSON.parse(textContent.text || '{}')).not.toThrow();
        expect(result.isError).toBe(true);
      }
    });
  });
});
