import { createGetProjectPhasesTool, PhaseWithStats } from './get-project-phases';
import { APIClient, NotFoundError } from '../api-client';

/**
 * Mock API client for testing
 */
class MockAPIClient extends APIClient {
  private mockPhasesResponse: any;
  private shouldThrowError: boolean = false;
  private errorToThrow: Error | null = null;

  constructor() {
    // Override parent constructor to avoid requiring API key
    super({ apiKey: 'test-key', baseUrl: 'https://test.example.com' });
  }

  setPhasesResponse(response: any) {
    this.mockPhasesResponse = response;
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

    throw new Error(`Unexpected path: ${path}`);
  }
}

describe('Get Project Phases Tool', () => {
  let mockClient: MockAPIClient;

  beforeEach(() => {
    mockClient = new MockAPIClient();
  });

  /**
   * Helper function to extract phases array from tool result
   */
  function extractPhasesResult(result: any): PhaseWithStats[] {
    expect(result.content).toHaveLength(1);
    expect(result.content[0].type).toBe('text');

    const textContent = result.content[0];
    if (textContent.type !== 'text') throw new Error('Expected text content');
    return JSON.parse(textContent.text || '[]');
  }

  /**
   * Helper function to extract error from tool result
   */
  function extractErrorResult(result: any): { error: string; message?: string } {
    expect(result.content).toHaveLength(1);
    expect(result.content[0].type).toBe('text');
    expect(result.isError).toBe(true);

    const textContent = result.content[0];
    if (textContent.type !== 'text') throw new Error('Expected text content');
    return JSON.parse(textContent.text || '{}');
  }

  describe('AC-2.3.a: Project with phases returns ordered array', () => {
    it('should return ordered array of Phase objects for project with phases', async () => {
      // Setup: Mock project with 3 phases
      const mockPhases: PhaseWithStats[] = [
        {
          id: 'phase-1',
          projectId: 'project-72',
          name: 'Planning',
          description: 'Initial planning phase',
          order: 1,
          status: 'completed',
          workItemCount: 5,
          completedCount: 5,
          inProgressCount: 0,
          pendingCount: 0,
          blockedCount: 0,
          createdAt: '2024-01-01T00:00:00Z',
          updatedAt: '2024-01-05T00:00:00Z',
        },
        {
          id: 'phase-2',
          projectId: 'project-72',
          name: 'Implementation',
          description: 'Core implementation phase',
          order: 2,
          status: 'in_progress',
          workItemCount: 10,
          completedCount: 3,
          inProgressCount: 4,
          pendingCount: 3,
          blockedCount: 0,
          createdAt: '2024-01-05T00:00:00Z',
          updatedAt: '2024-01-10T00:00:00Z',
        },
        {
          id: 'phase-3',
          projectId: 'project-72',
          name: 'Testing',
          description: 'Testing and QA phase',
          order: 3,
          status: 'pending',
          workItemCount: 8,
          completedCount: 0,
          inProgressCount: 0,
          pendingCount: 8,
          blockedCount: 0,
          createdAt: '2024-01-10T00:00:00Z',
          updatedAt: '2024-01-10T00:00:00Z',
        },
      ];

      mockClient.setPhasesResponse(mockPhases);

      const tool = createGetProjectPhasesTool(mockClient);
      const result = await tool.handler({ projectNumber: 72 });

      const phases = extractPhasesResult(result);

      // Verify array of Phase objects returned
      expect(Array.isArray(phases)).toBe(true);
      expect(phases).toHaveLength(3);
      expect(phases[0].name).toBe('Planning');
      expect(phases[1].name).toBe('Implementation');
      expect(phases[2].name).toBe('Testing');
    });

    it('should include all phase properties', async () => {
      const mockPhases: PhaseWithStats[] = [
        {
          id: 'phase-1',
          projectId: 'project-50',
          name: 'Phase 1',
          description: 'First phase',
          order: 1,
          status: 'in_progress',
          workItemCount: 12,
          completedCount: 4,
          inProgressCount: 6,
          pendingCount: 2,
          blockedCount: 0,
          createdAt: '2024-01-01T00:00:00Z',
          updatedAt: '2024-01-15T00:00:00Z',
        },
      ];

      mockClient.setPhasesResponse(mockPhases);

      const tool = createGetProjectPhasesTool(mockClient);
      const result = await tool.handler({ projectNumber: 50 });

      const phases = extractPhasesResult(result);

      // Verify all properties present
      expect(phases[0]).toHaveProperty('id');
      expect(phases[0]).toHaveProperty('projectId');
      expect(phases[0]).toHaveProperty('name');
      expect(phases[0]).toHaveProperty('description');
      expect(phases[0]).toHaveProperty('order');
      expect(phases[0]).toHaveProperty('status');
      expect(phases[0]).toHaveProperty('workItemCount');
      expect(phases[0]).toHaveProperty('completedCount');
      expect(phases[0]).toHaveProperty('inProgressCount');
      expect(phases[0]).toHaveProperty('pendingCount');
      expect(phases[0]).toHaveProperty('blockedCount');
      expect(phases[0]).toHaveProperty('createdAt');
      expect(phases[0]).toHaveProperty('updatedAt');
    });
  });

  describe('AC-2.3.b: Project without phases returns empty array', () => {
    it('should return empty array when project has no phases', async () => {
      // Setup: Mock empty phases response
      mockClient.setPhasesResponse([]);

      const tool = createGetProjectPhasesTool(mockClient);
      const result = await tool.handler({ projectNumber: 100 });

      const phases = extractPhasesResult(result);

      // Verify empty array returned
      expect(Array.isArray(phases)).toBe(true);
      expect(phases).toHaveLength(0);
    });

    it('should not return error for project with no phases', async () => {
      mockClient.setPhasesResponse([]);

      const tool = createGetProjectPhasesTool(mockClient);
      const result = await tool.handler({ projectNumber: 100 });

      // Verify no error flag
      expect(result.isError).toBeUndefined();
    });
  });

  describe('AC-2.3.c: Phases ordered by sequence number', () => {
    it('should sort phases by order field ascending', async () => {
      // Setup: Mock phases in random order
      const mockPhases: PhaseWithStats[] = [
        {
          id: 'phase-3',
          projectId: 'project-72',
          name: 'Phase 3',
          order: 3,
          status: 'pending',
          workItemCount: 0,
          completedCount: 0,
          inProgressCount: 0,
          pendingCount: 0,
          blockedCount: 0,
          createdAt: '2024-01-03T00:00:00Z',
          updatedAt: '2024-01-03T00:00:00Z',
        },
        {
          id: 'phase-1',
          projectId: 'project-72',
          name: 'Phase 1',
          order: 1,
          status: 'completed',
          workItemCount: 5,
          completedCount: 5,
          inProgressCount: 0,
          pendingCount: 0,
          blockedCount: 0,
          createdAt: '2024-01-01T00:00:00Z',
          updatedAt: '2024-01-01T00:00:00Z',
        },
        {
          id: 'phase-2',
          projectId: 'project-72',
          name: 'Phase 2',
          order: 2,
          status: 'in_progress',
          workItemCount: 3,
          completedCount: 1,
          inProgressCount: 2,
          pendingCount: 0,
          blockedCount: 0,
          createdAt: '2024-01-02T00:00:00Z',
          updatedAt: '2024-01-02T00:00:00Z',
        },
      ];

      mockClient.setPhasesResponse(mockPhases);

      const tool = createGetProjectPhasesTool(mockClient);
      const result = await tool.handler({ projectNumber: 72 });

      const phases = extractPhasesResult(result);

      // Verify phases are sorted by order
      expect(phases).toHaveLength(3);
      expect(phases[0].order).toBe(1);
      expect(phases[1].order).toBe(2);
      expect(phases[2].order).toBe(3);
      expect(phases[0].name).toBe('Phase 1');
      expect(phases[1].name).toBe('Phase 2');
      expect(phases[2].name).toBe('Phase 3');
    });

    it('should maintain order for phases with gaps in sequence numbers', async () => {
      // Setup: Phases with non-consecutive order numbers
      const mockPhases: PhaseWithStats[] = [
        {
          id: 'phase-10',
          projectId: 'project-72',
          name: 'Phase 10',
          order: 10,
          status: 'pending',
          workItemCount: 0,
          completedCount: 0,
          inProgressCount: 0,
          pendingCount: 0,
          blockedCount: 0,
          createdAt: '2024-01-03T00:00:00Z',
          updatedAt: '2024-01-03T00:00:00Z',
        },
        {
          id: 'phase-1',
          projectId: 'project-72',
          name: 'Phase 1',
          order: 1,
          status: 'completed',
          workItemCount: 2,
          completedCount: 2,
          inProgressCount: 0,
          pendingCount: 0,
          blockedCount: 0,
          createdAt: '2024-01-01T00:00:00Z',
          updatedAt: '2024-01-01T00:00:00Z',
        },
        {
          id: 'phase-5',
          projectId: 'project-72',
          name: 'Phase 5',
          order: 5,
          status: 'in_progress',
          workItemCount: 1,
          completedCount: 0,
          inProgressCount: 1,
          pendingCount: 0,
          blockedCount: 0,
          createdAt: '2024-01-02T00:00:00Z',
          updatedAt: '2024-01-02T00:00:00Z',
        },
      ];

      mockClient.setPhasesResponse(mockPhases);

      const tool = createGetProjectPhasesTool(mockClient);
      const result = await tool.handler({ projectNumber: 72 });

      const phases = extractPhasesResult(result);

      // Verify ascending order maintained
      expect(phases[0].order).toBe(1);
      expect(phases[1].order).toBe(5);
      expect(phases[2].order).toBe(10);
    });
  });

  describe('AC-2.3.d: Phase with work items includes count', () => {
    it('should include work item count when phase has work items', async () => {
      const mockPhases: PhaseWithStats[] = [
        {
          id: 'phase-1',
          projectId: 'project-72',
          name: 'Implementation',
          order: 1,
          status: 'in_progress',
          workItemCount: 15,
          completedCount: 5,
          inProgressCount: 7,
          pendingCount: 3,
          blockedCount: 0,
          createdAt: '2024-01-01T00:00:00Z',
          updatedAt: '2024-01-15T00:00:00Z',
        },
      ];

      mockClient.setPhasesResponse(mockPhases);

      const tool = createGetProjectPhasesTool(mockClient);
      const result = await tool.handler({ projectNumber: 72 });

      const phases = extractPhasesResult(result);

      // Verify work item count included
      expect(phases[0].workItemCount).toBe(15);
      expect(phases[0].completedCount).toBe(5);
      expect(phases[0].inProgressCount).toBe(7);
      expect(phases[0].pendingCount).toBe(3);
      expect(phases[0].blockedCount).toBe(0);
    });

    it('should include zero count when phase has no work items', async () => {
      const mockPhases: PhaseWithStats[] = [
        {
          id: 'phase-1',
          projectId: 'project-72',
          name: 'Planning',
          order: 1,
          status: 'pending',
          workItemCount: 0,
          completedCount: 0,
          inProgressCount: 0,
          pendingCount: 0,
          blockedCount: 0,
          createdAt: '2024-01-01T00:00:00Z',
          updatedAt: '2024-01-01T00:00:00Z',
        },
      ];

      mockClient.setPhasesResponse(mockPhases);

      const tool = createGetProjectPhasesTool(mockClient);
      const result = await tool.handler({ projectNumber: 72 });

      const phases = extractPhasesResult(result);

      // Verify zero counts included
      expect(phases[0].workItemCount).toBe(0);
      expect(phases[0].completedCount).toBe(0);
      expect(phases[0].inProgressCount).toBe(0);
      expect(phases[0].pendingCount).toBe(0);
      expect(phases[0].blockedCount).toBe(0);
    });
  });

  describe('AC-2.3.e: Non-existent project returns 404 error', () => {
    it('should return 404 error when project does not exist', async () => {
      // Setup: Mock 404 error
      mockClient.setError(new NotFoundError('Project not found'));

      const tool = createGetProjectPhasesTool(mockClient);
      const result = await tool.handler({ projectNumber: 999 });

      const errorResult = extractErrorResult(result);

      // Verify 404 error response
      expect(errorResult.error).toContain('Project 999 not found');
      expect(errorResult.message).toBeDefined();
    });

    it('should include helpful error message for non-existent project', async () => {
      mockClient.setError(new NotFoundError('Project not found'));

      const tool = createGetProjectPhasesTool(mockClient);
      const result = await tool.handler({ projectNumber: 999 });

      const errorResult = extractErrorResult(result);

      // Verify helpful message
      expect(errorResult.message).toContain('does not exist');
    });
  });

  describe('Tool definition and registration', () => {
    it('should have correct tool name', () => {
      const tool = createGetProjectPhasesTool(mockClient);
      expect(tool.name).toBe('get_project_phases');
    });

    it('should have descriptive description', () => {
      const tool = createGetProjectPhasesTool(mockClient);
      expect(tool.description).toContain('phases');
      expect(tool.description).toContain('sequential stages');
      expect(tool.description).toContain('GitHub Project');
      expect(tool.description).toContain('work item counts');
    });

    it('should have correct input schema with projectNumber', () => {
      const tool = createGetProjectPhasesTool(mockClient);
      expect(tool.inputSchema.type).toBe('object');
      expect(tool.inputSchema.required).toContain('projectNumber');
      expect(tool.inputSchema.properties.projectNumber.type).toBe('number');
    });

    it('should return valid MCP tool result format', async () => {
      mockClient.setPhasesResponse([]);

      const tool = createGetProjectPhasesTool(mockClient);
      const result = await tool.handler({ projectNumber: 72 });

      // Verify MCP ToolResult format
      expect(result).toHaveProperty('content');
      expect(Array.isArray(result.content)).toBe(true);
      expect(result.content[0]).toHaveProperty('type');
      expect(result.content[0]).toHaveProperty('text');
    });
  });

  describe('Edge cases and error handling', () => {
    it('should handle phases without descriptions', async () => {
      const mockPhases: PhaseWithStats[] = [
        {
          id: 'phase-1',
          projectId: 'project-72',
          name: 'Phase 1',
          order: 1,
          status: 'pending',
          workItemCount: 0,
          completedCount: 0,
          inProgressCount: 0,
          pendingCount: 0,
          blockedCount: 0,
          createdAt: '2024-01-01T00:00:00Z',
          updatedAt: '2024-01-01T00:00:00Z',
        },
      ];

      mockClient.setPhasesResponse(mockPhases);

      const tool = createGetProjectPhasesTool(mockClient);
      const result = await tool.handler({ projectNumber: 72 });

      const phases = extractPhasesResult(result);

      // Should handle missing optional description
      expect(phases[0].description).toBeUndefined();
    });

    it('should return valid JSON in all scenarios', async () => {
      const scenarios = [
        () => mockClient.setPhasesResponse([]),
        () => mockClient.setPhasesResponse([
          {
            id: 'phase-1',
            projectId: 'project-72',
            name: 'Phase 1',
            order: 1,
            status: 'pending',
            workItemCount: 0,
            completedCount: 0,
            inProgressCount: 0,
            pendingCount: 0,
            blockedCount: 0,
            createdAt: '2024-01-01T00:00:00Z',
            updatedAt: '2024-01-01T00:00:00Z',
          },
        ]),
        () => mockClient.setError(new NotFoundError('Project not found')),
      ];

      for (const setupScenario of scenarios) {
        mockClient = new MockAPIClient();
        setupScenario();

        const tool = createGetProjectPhasesTool(mockClient);
        const result = await tool.handler({ projectNumber: 72 });

        // Should always return valid JSON
        const textContent = result.content[0];
        if (textContent.type !== 'text') throw new Error('Expected text content');
        expect(() => JSON.parse(textContent.text || '{}')).not.toThrow();
      }
    });
  });
});
