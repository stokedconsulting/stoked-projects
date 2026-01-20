import {
  createUpdateIssuePhaseTool,
  UpdateIssuePhaseParams,
  UpdatedIssue,
} from './update-issue-phase';
import { APIClient, NotFoundError, Issue } from '../api-client';

/**
 * Phase interface for mock responses
 */
interface Phase {
  id: string;
  projectId: string;
  name: string;
  description?: string;
  order: number;
  status: 'pending' | 'in_progress' | 'completed';
  createdAt: string;
  updatedAt: string;
}

/**
 * Mock API client for testing
 */
class MockAPIClient extends APIClient {
  private mockPhasesResponse: Phase[] = [];
  private mockUpdateResponse: UpdatedIssue | null = null;
  private shouldThrowError: boolean = false;
  private errorToThrow: Error | null = null;
  private lastPutPath: string = '';
  private lastPutBody: any = null;

  constructor() {
    // Override parent constructor to avoid requiring API key
    super({ apiKey: 'test-key', baseUrl: 'https://test.example.com' });
  }

  setPhasesResponse(phases: Phase[]) {
    this.mockPhasesResponse = phases;
    this.shouldThrowError = false;
    this.errorToThrow = null;
  }

  setUpdateResponse(issue: UpdatedIssue) {
    this.mockUpdateResponse = issue;
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

    // Match pattern: /api/projects/{number}/phases
    const phasePathRegex = /^\/api\/projects\/\d+\/phases$/;
    if (phasePathRegex.test(path)) {
      return this.mockPhasesResponse as T;
    }

    throw new Error(`Unexpected GET path: ${path}`);
  }

  async put<T>(path: string, body?: unknown): Promise<T> {
    this.lastPutPath = path;
    this.lastPutBody = body;

    if (this.shouldThrowError && this.errorToThrow) {
      throw this.errorToThrow;
    }

    // Match pattern: /api/projects/{number}/issues/{number}/phase
    const updatePhasePathRegex = /^\/api\/projects\/\d+\/issues\/\d+\/phase$/;
    if (updatePhasePathRegex.test(path)) {
      if (!this.mockUpdateResponse) {
        throw new Error('Mock update response not set');
      }
      return this.mockUpdateResponse as T;
    }

    throw new Error(`Unexpected PUT path: ${path}`);
  }

  getLastPutRequest() {
    return {
      path: this.lastPutPath,
      body: this.lastPutBody,
    };
  }

  reset() {
    this.mockPhasesResponse = [];
    this.mockUpdateResponse = null;
    this.shouldThrowError = false;
    this.errorToThrow = null;
    this.lastPutPath = '';
    this.lastPutBody = null;
  }
}

describe('Update Issue Phase Tool', () => {
  let mockClient: MockAPIClient;

  beforeEach(() => {
    mockClient = new MockAPIClient();
  });

  /**
   * Helper function to extract issue result from tool response
   */
  function extractIssueResult(result: any): UpdatedIssue {
    expect(result.content).toHaveLength(1);
    expect(result.content[0].type).toBe('text');

    const textContent = result.content[0];
    if (textContent.type !== 'text') throw new Error('Expected text content');
    return JSON.parse(textContent.text || '{}');
  }

  /**
   * Helper function to extract error from tool result
   */
  function extractErrorResult(result: any): any {
    expect(result.content).toHaveLength(1);
    expect(result.content[0].type).toBe('text');
    expect(result.isError).toBe(true);

    const textContent = result.content[0];
    if (textContent.type !== 'text') throw new Error('Expected text content');
    return JSON.parse(textContent.text || '{}');
  }

  /**
   * Helper to create mock phases
   */
  function createMockPhases(): Phase[] {
    return [
      {
        id: 'phase-1',
        projectId: 'project-72',
        name: 'Foundation',
        description: 'Foundation phase',
        order: 1,
        status: 'completed',
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-05T00:00:00Z',
      },
      {
        id: 'phase-2',
        projectId: 'project-72',
        name: 'Core Features',
        description: 'Core features phase',
        order: 2,
        status: 'in_progress',
        createdAt: '2024-01-05T00:00:00Z',
        updatedAt: '2024-01-10T00:00:00Z',
      },
      {
        id: 'phase-3',
        projectId: 'project-72',
        name: 'Advanced Features',
        description: 'Advanced features phase',
        order: 3,
        status: 'pending',
        createdAt: '2024-01-10T00:00:00Z',
        updatedAt: '2024-01-10T00:00:00Z',
      },
    ];
  }

  /**
   * Helper to create mock updated issue
   */
  function createMockUpdatedIssue(phaseName: string): UpdatedIssue {
    return {
      id: 'issue-123',
      projectId: 'project-72',
      title: 'Test Issue',
      description: 'Test issue description',
      status: 'in_progress',
      labels: ['feature'],
      phase: phaseName,
      number: 123,
      createdAt: '2024-01-01T00:00:00Z',
      updatedAt: new Date().toISOString(),
    };
  }

  describe('AC-3.2.a: Valid phase name moves issue to target phase', () => {
    it('should move issue to target phase when phase name is valid', async () => {
      const phases = createMockPhases();
      const updatedIssue = createMockUpdatedIssue('Core Features');

      mockClient.setPhasesResponse(phases);
      mockClient.setUpdateResponse(updatedIssue);

      const tool = createUpdateIssuePhaseTool(mockClient);
      const result = await tool.handler({
        projectNumber: 72,
        issueNumber: 123,
        phaseName: 'Core Features',
      });

      const issue = extractIssueResult(result);

      // Verify issue was updated
      expect(issue.phase).toBe('Core Features');
      expect(issue.number).toBe(123);
      expect(result.isError).toBeUndefined();
    });

    it('should make PUT request to correct endpoint with phase name', async () => {
      const phases = createMockPhases();
      const updatedIssue = createMockUpdatedIssue('Foundation');

      mockClient.setPhasesResponse(phases);
      mockClient.setUpdateResponse(updatedIssue);

      const tool = createUpdateIssuePhaseTool(mockClient);
      await tool.handler({
        projectNumber: 72,
        issueNumber: 456,
        phaseName: 'Foundation',
      });

      const lastRequest = mockClient.getLastPutRequest();

      // Verify PUT request details
      expect(lastRequest.path).toBe('/api/projects/72/issues/456/phase');
      expect(lastRequest.body).toEqual({ phaseName: 'Foundation' });
    });

    it('should return complete updated Issue object', async () => {
      const phases = createMockPhases();
      const updatedIssue = createMockUpdatedIssue('Advanced Features');

      mockClient.setPhasesResponse(phases);
      mockClient.setUpdateResponse(updatedIssue);

      const tool = createUpdateIssuePhaseTool(mockClient);
      const result = await tool.handler({
        projectNumber: 72,
        issueNumber: 789,
        phaseName: 'Advanced Features',
      });

      const issue = extractIssueResult(result);

      // Verify all Issue properties present
      expect(issue).toHaveProperty('id');
      expect(issue).toHaveProperty('projectId');
      expect(issue).toHaveProperty('title');
      expect(issue).toHaveProperty('status');
      expect(issue).toHaveProperty('labels');
      expect(issue).toHaveProperty('phase');
      expect(issue).toHaveProperty('number');
      expect(issue).toHaveProperty('createdAt');
      expect(issue).toHaveProperty('updatedAt');
    });
  });

  describe('AC-3.2.b: Phase name does not exist returns error with available phases', () => {
    it('should return error when phase name does not exist', async () => {
      const phases = createMockPhases();
      mockClient.setPhasesResponse(phases);

      const tool = createUpdateIssuePhaseTool(mockClient);
      const result = await tool.handler({
        projectNumber: 72,
        issueNumber: 123,
        phaseName: 'Nonexistent Phase',
      });

      const error = extractErrorResult(result);

      // Verify error response
      expect(error.error).toContain('does not exist');
      expect(error.error).toContain('Nonexistent Phase');
    });

    it('should include list of available phases in error', async () => {
      const phases = createMockPhases();
      mockClient.setPhasesResponse(phases);

      const tool = createUpdateIssuePhaseTool(mockClient);
      const result = await tool.handler({
        projectNumber: 72,
        issueNumber: 123,
        phaseName: 'Invalid Phase',
      });

      const error = extractErrorResult(result);

      // Verify available phases listed
      expect(error.availablePhases).toBeDefined();
      expect(error.availablePhases).toContain('Foundation');
      expect(error.availablePhases).toContain('Core Features');
      expect(error.availablePhases).toContain('Advanced Features');
    });

    it('should not make PUT request when phase does not exist', async () => {
      const phases = createMockPhases();
      mockClient.setPhasesResponse(phases);

      const tool = createUpdateIssuePhaseTool(mockClient);
      await tool.handler({
        projectNumber: 72,
        issueNumber: 123,
        phaseName: 'Invalid Phase',
      });

      const lastRequest = mockClient.getLastPutRequest();

      // Verify no PUT request was made
      expect(lastRequest.path).toBe('');
      expect(lastRequest.body).toBeNull();
    });
  });

  describe('AC-3.2.c: Issue does not exist returns 404 error', () => {
    it('should return 404 error when issue does not exist', async () => {
      const phases = createMockPhases();
      mockClient.setPhasesResponse(phases);

      // Set error to be thrown on PUT request
      mockClient.setError(new NotFoundError('Issue #999 not found'));

      const tool = createUpdateIssuePhaseTool(mockClient);
      const result = await tool.handler({
        projectNumber: 72,
        issueNumber: 999,
        phaseName: 'Foundation',
      });

      const error = extractErrorResult(result);

      // Verify 404 error
      expect(error.error).toContain('Issue #999 not found');
      expect(error.issueNumber).toBe(999);
    });

    it('should include project and issue numbers in error response', async () => {
      const phases = createMockPhases();
      mockClient.setPhasesResponse(phases);
      mockClient.setError(new NotFoundError('Issue not found'));

      const tool = createUpdateIssuePhaseTool(mockClient);
      const result = await tool.handler({
        projectNumber: 72,
        issueNumber: 999,
        phaseName: 'Foundation',
      });

      const error = extractErrorResult(result);

      // Verify context included
      expect(error.projectNumber).toBe(72);
      expect(error.issueNumber).toBe(999);
    });
  });

  describe('AC-3.2.d: Phase name typo returns error with fuzzy match suggestions', () => {
    it('should suggest correct phase for simple typo (single character)', async () => {
      const phases = createMockPhases();
      mockClient.setPhasesResponse(phases);

      const tool = createUpdateIssuePhaseTool(mockClient);
      const result = await tool.handler({
        projectNumber: 72,
        issueNumber: 123,
        phaseName: 'Foundaton', // Missing 'i'
      });

      const error = extractErrorResult(result);

      // Verify suggestion provided
      expect(error.suggestions).toBeDefined();
      expect(error.suggestions).toContain('Foundation');
      expect(error.message).toContain('Did you mean');
      expect(error.message).toContain('Foundation');
    });

    it('should suggest correct phase for multiple character typos', async () => {
      const phases = createMockPhases();
      mockClient.setPhasesResponse(phases);

      const tool = createUpdateIssuePhaseTool(mockClient);
      const result = await tool.handler({
        projectNumber: 72,
        issueNumber: 123,
        phaseName: 'Cor Fetures', // Missing 'e', space instead of nothing, missing 'a'
      });

      const error = extractErrorResult(result);

      // Verify suggestion provided
      expect(error.suggestions).toBeDefined();
      expect(error.suggestions).toContain('Core Features');
    });

    it('should handle case-insensitive mismatches with suggestion', async () => {
      const phases = createMockPhases();
      mockClient.setPhasesResponse(phases);

      const tool = createUpdateIssuePhaseTool(mockClient);
      const result = await tool.handler({
        projectNumber: 72,
        issueNumber: 123,
        phaseName: 'foundation', // Wrong case
      });

      const error = extractErrorResult(result);

      // Verify case-sensitive error with suggestion
      expect(error.error).toContain('case-sensitive');
      expect(error.suggestions).toContain('Foundation');
      expect(error.message).toContain('Did you mean "Foundation"?');
    });

    it('should suggest multiple close matches when available', async () => {
      const phases = createMockPhases();
      mockClient.setPhasesResponse(phases);

      const tool = createUpdateIssuePhaseTool(mockClient);
      const result = await tool.handler({
        projectNumber: 72,
        issueNumber: 123,
        phaseName: 'Features', // Could match both "Core Features" and "Advanced Features"
      });

      const error = extractErrorResult(result);

      // Verify multiple suggestions
      expect(error.suggestions).toBeDefined();
      expect(error.suggestions.length).toBeGreaterThan(0);
    });

    it('should provide available phases list when no close matches found', async () => {
      const phases = createMockPhases();
      mockClient.setPhasesResponse(phases);

      const tool = createUpdateIssuePhaseTool(mockClient);
      const result = await tool.handler({
        projectNumber: 72,
        issueNumber: 123,
        phaseName: 'XYZ123', // No match at all
      });

      const error = extractErrorResult(result);

      // Verify available phases provided
      expect(error.message).toContain('Available phases');
      expect(error.availablePhases).toHaveLength(3);
    });
  });

  describe('AC-3.2.e: Update succeeds and GitHub Projects board reflects change', () => {
    it('should return updated issue with new phase', async () => {
      const phases = createMockPhases();
      const updatedIssue = createMockUpdatedIssue('Advanced Features');

      mockClient.setPhasesResponse(phases);
      mockClient.setUpdateResponse(updatedIssue);

      const tool = createUpdateIssuePhaseTool(mockClient);
      const result = await tool.handler({
        projectNumber: 72,
        issueNumber: 123,
        phaseName: 'Advanced Features',
      });

      const issue = extractIssueResult(result);

      // Verify phase updated
      expect(issue.phase).toBe('Advanced Features');
      expect(issue.updatedAt).toBeDefined();
    });

    it('should have updated timestamp after phase change', async () => {
      const phases = createMockPhases();
      const beforeUpdate = new Date().toISOString();

      // Wait 1ms to ensure different timestamp
      await new Promise(resolve => setTimeout(resolve, 1));

      const updatedIssue = createMockUpdatedIssue('Core Features');

      mockClient.setPhasesResponse(phases);
      mockClient.setUpdateResponse(updatedIssue);

      const tool = createUpdateIssuePhaseTool(mockClient);
      const result = await tool.handler({
        projectNumber: 72,
        issueNumber: 123,
        phaseName: 'Core Features',
      });

      const issue = extractIssueResult(result);

      // Verify updatedAt is recent (within last few seconds)
      const updatedAt = new Date(issue.updatedAt);
      const now = new Date();
      const timeDiffSeconds = (now.getTime() - updatedAt.getTime()) / 1000;
      expect(timeDiffSeconds).toBeLessThan(5);
    });
  });

  describe('Tool definition and registration', () => {
    it('should have correct tool name', () => {
      const tool = createUpdateIssuePhaseTool(mockClient);
      expect(tool.name).toBe('update_issue_phase');
    });

    it('should have descriptive description mentioning phases', () => {
      const tool = createUpdateIssuePhaseTool(mockClient);
      expect(tool.description).toContain('phase');
      expect(tool.description).toContain('GitHub issue');
      expect(tool.description).toContain('get_project_phases');
    });

    it('should have correct input schema with all required fields', () => {
      const tool = createUpdateIssuePhaseTool(mockClient);
      expect(tool.inputSchema.type).toBe('object');
      expect(tool.inputSchema.required).toContain('projectNumber');
      expect(tool.inputSchema.required).toContain('issueNumber');
      expect(tool.inputSchema.required).toContain('phaseName');
      expect(tool.inputSchema.properties.projectNumber.type).toBe('number');
      expect(tool.inputSchema.properties.issueNumber.type).toBe('number');
      expect(tool.inputSchema.properties.phaseName.type).toBe('string');
    });

    it('should return valid MCP tool result format', async () => {
      const phases = createMockPhases();
      const updatedIssue = createMockUpdatedIssue('Foundation');

      mockClient.setPhasesResponse(phases);
      mockClient.setUpdateResponse(updatedIssue);

      const tool = createUpdateIssuePhaseTool(mockClient);
      const result = await tool.handler({
        projectNumber: 72,
        issueNumber: 123,
        phaseName: 'Foundation',
      });

      // Verify MCP ToolResult format
      expect(result).toHaveProperty('content');
      expect(Array.isArray(result.content)).toBe(true);
      expect(result.content[0]).toHaveProperty('type');
      expect(result.content[0]).toHaveProperty('text');
    });
  });

  describe('Edge cases and error handling', () => {
    it('should handle project not found error', async () => {
      mockClient.setError(new NotFoundError('Project #999 not found'));

      const tool = createUpdateIssuePhaseTool(mockClient);
      const result = await tool.handler({
        projectNumber: 999,
        issueNumber: 123,
        phaseName: 'Foundation',
      });

      const error = extractErrorResult(result);

      // Verify project not found error
      expect(error.error).toContain('Project #999 not found');
      expect(error.projectNumber).toBe(999);
    });

    it('should handle empty phases list gracefully', async () => {
      mockClient.setPhasesResponse([]);

      const tool = createUpdateIssuePhaseTool(mockClient);
      const result = await tool.handler({
        projectNumber: 72,
        issueNumber: 123,
        phaseName: 'Foundation',
      });

      const error = extractErrorResult(result);

      // Verify error for project with no phases
      expect(error.error).toContain('does not exist');
      expect(error.availablePhases).toHaveLength(0);
    });

    it('should return valid JSON in all scenarios', async () => {
      const scenarios = [
        // Success scenario
        () => {
          const phases = createMockPhases();
          const updatedIssue = createMockUpdatedIssue('Foundation');
          mockClient.setPhasesResponse(phases);
          mockClient.setUpdateResponse(updatedIssue);
        },
        // Phase not found scenario
        () => {
          mockClient.reset();
          mockClient.setPhasesResponse(createMockPhases());
        },
        // Issue not found scenario
        () => {
          mockClient.reset();
          mockClient.setPhasesResponse(createMockPhases());
          mockClient.setError(new NotFoundError('Issue not found'));
        },
      ];

      for (const setupScenario of scenarios) {
        setupScenario();

        const tool = createUpdateIssuePhaseTool(mockClient);
        const result = await tool.handler({
          projectNumber: 72,
          issueNumber: 123,
          phaseName: scenarios.indexOf(setupScenario) === 1 ? 'Invalid' : 'Foundation',
        });

        // Should always return valid JSON
        const textContent = result.content[0];
        if (textContent.type !== 'text') throw new Error('Expected text content');
        expect(() => JSON.parse(textContent.text || '{}')).not.toThrow();
      }
    });

    it('should handle phases with special characters in names', async () => {
      const phases: Phase[] = [
        {
          id: 'phase-1',
          projectId: 'project-72',
          name: 'Phase 1: Setup & Configuration',
          order: 1,
          status: 'completed',
          createdAt: '2024-01-01T00:00:00Z',
          updatedAt: '2024-01-01T00:00:00Z',
        },
      ];

      const updatedIssue = createMockUpdatedIssue('Phase 1: Setup & Configuration');

      mockClient.setPhasesResponse(phases);
      mockClient.setUpdateResponse(updatedIssue);

      const tool = createUpdateIssuePhaseTool(mockClient);
      const result = await tool.handler({
        projectNumber: 72,
        issueNumber: 123,
        phaseName: 'Phase 1: Setup & Configuration',
      });

      const issue = extractIssueResult(result);

      // Verify special characters handled correctly
      expect(issue.phase).toBe('Phase 1: Setup & Configuration');
    });
  });

  describe('Fuzzy matching algorithm', () => {
    it('should match transposed characters (typo)', async () => {
      const phases: Phase[] = [
        {
          id: 'phase-1',
          projectId: 'project-72',
          name: 'Implementation',
          order: 1,
          status: 'in_progress',
          createdAt: '2024-01-01T00:00:00Z',
          updatedAt: '2024-01-01T00:00:00Z',
        },
      ];

      mockClient.setPhasesResponse(phases);

      const tool = createUpdateIssuePhaseTool(mockClient);
      const result = await tool.handler({
        projectNumber: 72,
        issueNumber: 123,
        phaseName: 'Implmentation', // Missing 'e'
      });

      const error = extractErrorResult(result);

      // Verify fuzzy match found
      expect(error.suggestions).toContain('Implementation');
    });

    it('should limit suggestions to top 3 matches', async () => {
      const phases: Phase[] = [
        { id: '1', projectId: 'p1', name: 'Test', order: 1, status: 'pending', createdAt: '2024-01-01T00:00:00Z', updatedAt: '2024-01-01T00:00:00Z' },
        { id: '2', projectId: 'p1', name: 'Testing', order: 2, status: 'pending', createdAt: '2024-01-01T00:00:00Z', updatedAt: '2024-01-01T00:00:00Z' },
        { id: '3', projectId: 'p1', name: 'Tests', order: 3, status: 'pending', createdAt: '2024-01-01T00:00:00Z', updatedAt: '2024-01-01T00:00:00Z' },
        { id: '4', projectId: 'p1', name: 'Test Phase', order: 4, status: 'pending', createdAt: '2024-01-01T00:00:00Z', updatedAt: '2024-01-01T00:00:00Z' },
        { id: '5', projectId: 'p1', name: 'Test Run', order: 5, status: 'pending', createdAt: '2024-01-01T00:00:00Z', updatedAt: '2024-01-01T00:00:00Z' },
      ];

      mockClient.setPhasesResponse(phases);

      const tool = createUpdateIssuePhaseTool(mockClient);
      const result = await tool.handler({
        projectNumber: 72,
        issueNumber: 123,
        phaseName: 'Tst', // Partial match to all
      });

      const error = extractErrorResult(result);

      // Verify limited to 3 suggestions
      expect(error.suggestions).toBeDefined();
      expect(error.suggestions.length).toBeLessThanOrEqual(3);
    });
  });
});
