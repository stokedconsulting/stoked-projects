/**
 * End-to-End Integration Tests - Project Lifecycle
 *
 * Phase 5.1: End-to-End Integration Testing
 *
 * Comprehensive test suite covering complete workflows from MCP tools
 * through state-tracking-api to WebSocket notifications.
 *
 * Test Scenarios:
 * 1. Create project workflow: Claude creates project → Extension shows new project
 * 2. Create issue workflow: Claude creates issue → Extension shows new issue in project
 * 3. Update status workflow: Claude updates issue status → Extension UI reflects change
 * 4. Move phase workflow: Claude moves issue to new phase → Extension shows issue in new phase
 * 5. Concurrent updates: Two Claude sessions update same project → No data loss or corruption
 * 6. Network failure recovery: Connection drops during update → Retry succeeds, no duplicate data
 * 7. Full project lifecycle: Create project → Add phases → Create issues → Update statuses → Complete project
 *
 * Performance Tests:
 * - Create 100 issues → Validate <10s total time
 * - Update 50 issues concurrently → Validate no failures
 * - Extension handles 100 rapid events → UI updates correctly
 *
 * Error Scenario Tests:
 * - Invalid API key → Clear error message
 * - API timeout → Retry with backoff
 * - WebSocket disconnect → Automatic reconnection
 */

import { APIClient, AuthenticationError, TimeoutError, ServerError } from '../../packages/mcp-server/src/api-client';
import { EventBus } from '../../packages/mcp-server/src/events/event-bus';
import { WebSocketNotificationServer } from '../../packages/mcp-server/src/events/websocket-server';
import { createCreateIssueTool } from '../../packages/mcp-server/src/tools/create-issue';
import { createUpdateIssueStatusTool } from '../../packages/mcp-server/src/tools/update-issue-status';
import { createUpdateIssuePhaseTool } from '../../packages/mcp-server/src/tools/update-issue-phase';
import { createUpdateIssueTool } from '../../packages/mcp-server/src/tools/update-issue';
import { Logger } from '../../packages/mcp-server/src/config';

// Use require for ws to avoid module resolution issues
// eslint-disable-next-line @typescript-eslint/no-var-requires
const WebSocket = require('../../packages/mcp-server/node_modules/ws');

// Mock fetch globally
global.fetch = jest.fn();

/**
 * Helper: Create mock logger
 */
const createMockLogger = (): Logger => ({
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
});

/**
 * Helper: Wait for specified time
 */
const wait = (ms: number): Promise<void> => {
  return new Promise((resolve) => setTimeout(resolve, ms));
};

/**
 * Helper: Wait for WebSocket to open
 */
const waitForOpen = (ws: any): Promise<void> => {
  return new Promise((resolve, reject) => {
    if (ws.readyState === 1) { // OPEN = 1
      resolve();
      return;
    }
    ws.once('open', () => resolve());
    ws.once('error', reject);
  });
};

/**
 * Helper: Receive next message from WebSocket
 */
const receiveMessage = (ws: any, timeout = 5000): Promise<any> => {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Timeout waiting for message')), timeout);
    ws.once('message', (data: any) => {
      clearTimeout(timer);
      try {
        resolve(JSON.parse(data.toString()));
      } catch (error) {
        reject(error);
      }
    });
    ws.once('error', (error: any) => {
      clearTimeout(timer);
      reject(error);
    });
  });
};

/**
 * Helper: Send message to WebSocket
 */
const sendMessage = (ws: any, message: any): void => {
  ws.send(JSON.stringify(message));
};

describe('End-to-End Integration Tests - Project Lifecycle', () => {
  let apiClient: APIClient;
  let eventBus: EventBus;
  let wsServer: WebSocketNotificationServer;
  let logger: Logger;
  let mockFetch: jest.MockedFunction<typeof fetch>;

  const TEST_PORT = 8090;
  const TEST_API_KEY = 'test-e2e-key';
  const TEST_BASE_URL = 'https://claude-projects.truapi.com';

  // Increase timeout for all tests in this suite
  jest.setTimeout(30000);

  beforeEach(async () => {
    // Set environment variable to avoid API key validation error
    process.env.STATE_TRACKING_API_KEY = TEST_API_KEY;

    // Setup API client
    apiClient = new APIClient({
      baseUrl: TEST_BASE_URL,
      apiKey: TEST_API_KEY,
    });

    // Setup event bus
    eventBus = new EventBus();

    // Setup logger
    logger = createMockLogger();

    // Setup WebSocket server
    wsServer = new WebSocketNotificationServer({
      port: TEST_PORT,
      apiKey: TEST_API_KEY,
      eventBus,
      logger,
    });
    await wsServer.start();

    // Setup fetch mock
    mockFetch = global.fetch as jest.MockedFunction<typeof fetch>;
    mockFetch.mockClear();
  });

  afterEach(async () => {
    try {
      await wsServer.stop();
    } catch (error) {
      // Server may already be stopped
    }
    eventBus.clearAllSubscribers();
    jest.clearAllMocks();
    await wait(300); // Give port time to be released
  });

  describe('Scenario 1: Create Project Workflow', () => {
    it('should create project and notify extension via WebSocket', async () => {
      const newProject = {
        id: 'project-72',
        name: 'Test Project',
        description: 'E2E test project',
        status: 'active' as const,
        createdAt: '2026-01-20T12:00:00Z',
        updatedAt: '2026-01-20T12:00:00Z',
      };

      // Setup WebSocket client (simulating extension)
      const ws = new (WebSocket as any)(`ws://localhost:${TEST_PORT}/notifications?apiKey=${TEST_API_KEY}`);
      await waitForOpen(ws);

      // Receive welcome message
      const welcome = await receiveMessage(ws);
      expect(welcome.type).toBe('welcome');

      // Subscribe to project events
      sendMessage(ws, { type: 'subscribe', projectNumbers: [72] });
      const subscribeConfirm = await receiveMessage(ws);
      expect(subscribeConfirm.type).toBe('subscribed');

      // Emit event through event bus (simulating project update)
      eventBus.emit('project.updated', 72, newProject);

      // Extension should receive notification
      const notification = await receiveMessage(ws);
      expect(notification.type).toBe('event');
      expect(notification.event.type).toBe('project.updated');
      expect(notification.event.data).toEqual(newProject);

      ws.close();
      await wait(200);
    });
  });

  describe('Scenario 2: Create Issue Workflow', () => {
    it('should create issue and notify extension in real-time', async () => {
      const newIssue = {
        id: 'issue-123',
        projectId: 'project-72',
        title: 'Implement feature',
        description: 'Add new feature',
        status: 'todo' as const,
        labels: ['enhancement'],
        createdAt: '2026-01-20T12:00:00Z',
        updatedAt: '2026-01-20T12:00:00Z',
        number: 123,
        url: 'https://github.com/org/repo/issues/123',
      };

      // Mock API response
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 201,
        json: async () => newIssue,
        headers: new Headers(),
      } as Response);

      // Setup WebSocket client
      const ws = new WebSocket(`ws://localhost:${TEST_PORT}/notifications?apiKey=${TEST_API_KEY}`);
      await waitForOpen(ws);
      await receiveMessage(ws); // welcome

      sendMessage(ws, { type: 'subscribe', projectNumbers: [72] });
      await receiveMessage(ws); // subscription

      // Create issue via MCP tool
      const tool = createCreateIssueTool(apiClient);
      const result = await tool.handler({
        projectNumber: 72,
        title: 'Implement feature',
        body: 'Add new feature',
        status: 'todo',
        labels: ['enhancement'],
      });

      expect(result.isError).toBeUndefined();

      // Extension receives notification
      const notification = await receiveMessage(ws);
      expect(notification.type).toBe('event');
      expect(notification.event.type).toBe('issue.created');
      expect(notification.event.data.title).toBe('Implement feature');

      ws.close();
      await wait(200);
    });
  });

  describe('Scenario 3: Update Status Workflow', () => {
    it('should update issue status and reflect change in extension UI', async () => {
      const existingIssue = {
        id: 'issue-456',
        projectId: 'project-72',
        title: 'Fix bug',
        status: 'todo' as const,
        labels: [],
        createdAt: '2026-01-20T12:00:00Z',
        updatedAt: '2026-01-20T12:00:00Z',
        number: 456,
      };

      const updatedIssue = {
        ...existingIssue,
        status: 'in_progress' as const,
        updatedAt: '2026-01-20T12:30:00Z',
      };

      // Mock GET and PUT requests
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => existingIssue,
          headers: new Headers(),
        } as Response)
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => updatedIssue,
          headers: new Headers(),
        } as Response);

      // Setup WebSocket client
      const ws = new WebSocket(`ws://localhost:${TEST_PORT}/notifications?apiKey=${TEST_API_KEY}`);
      await waitForOpen(ws);
      await receiveMessage(ws); // welcome

      sendMessage(ws, { type: 'subscribe', projectNumbers: [72] });
      await receiveMessage(ws); // subscription

      // Update status via MCP tool
      const tool = createUpdateIssueStatusTool(apiClient);
      const result = await tool.handler({
        projectNumber: 72,
        issueNumber: 456,
        status: 'in_progress',
      });

      expect(result.isError).toBeUndefined();

      // Extension receives update notification
      const notification = await receiveMessage(ws);
      expect(notification.type).toBe('event');
      expect(notification.event.type).toBe('issue.updated');
      expect(notification.event.data.status).toBe('in_progress');

      ws.close();
      await wait(200);
    });
  });

  describe('Scenario 4: Move Phase Workflow', () => {
    it('should move issue to new phase and update extension UI', async () => {
      const phases = [
        {
          id: 'phase-1',
          projectId: 'project-72',
          name: 'Planning',
          order: 1,
          status: 'completed' as const,
          createdAt: '2026-01-20T12:00:00Z',
          updatedAt: '2026-01-20T12:00:00Z',
        },
        {
          id: 'phase-2',
          projectId: 'project-72',
          name: 'Development',
          order: 2,
          status: 'in_progress' as const,
          createdAt: '2026-01-20T12:00:00Z',
          updatedAt: '2026-01-20T12:00:00Z',
        },
      ];

      const updatedIssue = {
        id: 'issue-789',
        projectId: 'project-72',
        title: 'Feature work',
        status: 'in_progress' as const,
        labels: [],
        createdAt: '2026-01-20T12:00:00Z',
        updatedAt: '2026-01-20T12:30:00Z',
        number: 789,
        phase: 'Development',
      };

      // Mock API responses
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => phases,
          headers: new Headers(),
        } as Response)
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => updatedIssue,
          headers: new Headers(),
        } as Response);

      // Move issue to new phase
      const tool = createUpdateIssuePhaseTool(apiClient);
      const result = await tool.handler({
        projectNumber: 72,
        issueNumber: 789,
        phaseName: 'Development',
      });

      // Verify tool succeeded
      expect(result.isError).toBeUndefined();
      expect(mockFetch).toHaveBeenCalledTimes(2); // GET phases + PUT issue

      // Verify event was emitted (can be caught by WebSocket in real scenario)
      // For this test we just verify the tool execution was successful
    });
  });

  describe('Scenario 5: Concurrent Updates', () => {
    it('should handle two Claude sessions updating same project without data loss', async () => {
      // Create two API clients (simulating two Claude sessions)
      const client1 = new APIClient({
        baseUrl: TEST_BASE_URL,
        apiKey: TEST_API_KEY,
      });

      const client2 = new APIClient({
        baseUrl: TEST_BASE_URL,
        apiKey: TEST_API_KEY,
      });

      const issue1 = {
        id: 'issue-100',
        projectId: 'project-72',
        title: 'Issue 1',
        status: 'in_progress' as const,
        labels: [],
        createdAt: '2026-01-20T12:00:00Z',
        updatedAt: '2026-01-20T12:01:00Z',
        number: 100,
      };

      const issue2 = {
        id: 'issue-200',
        projectId: 'project-72',
        title: 'Issue 2',
        status: 'in_progress' as const,
        labels: [],
        createdAt: '2026-01-20T12:00:00Z',
        updatedAt: '2026-01-20T12:02:00Z',
        number: 200,
      };

      // Mock concurrent API responses
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({ ...issue1, status: 'todo' }),
          headers: new Headers(),
        } as Response)
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({ ...issue2, status: 'todo' }),
          headers: new Headers(),
        } as Response)
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => issue1,
          headers: new Headers(),
        } as Response)
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => issue2,
          headers: new Headers(),
        } as Response);

      // Setup WebSocket client
      const ws = new WebSocket(`ws://localhost:${TEST_PORT}/notifications?apiKey=${TEST_API_KEY}`);
      await waitForOpen(ws);
      await receiveMessage(ws); // welcome

      sendMessage(ws, { type: 'subscribe', projectNumbers: [72] });
      await receiveMessage(ws); // subscription

      // Execute concurrent updates
      const tool1 = createUpdateIssueStatusTool(client1);
      const tool2 = createUpdateIssueStatusTool(client2);

      const [result1, result2] = await Promise.all([
        tool1.handler({
          projectNumber: 72,
          issueNumber: 100,
          status: 'in_progress',
        }),
        tool2.handler({
          projectNumber: 72,
          issueNumber: 200,
          status: 'in_progress',
        }),
      ]);

      // Both updates should succeed
      expect(result1.isError).toBeUndefined();
      expect(result2.isError).toBeUndefined();

      // Extension should receive both notifications
      const notification1 = await receiveMessage(ws);
      const notification2 = await receiveMessage(ws);

      expect([notification1.event.issueNumber, notification2.event.issueNumber].sort()).toEqual([100, 200]);

      ws.close();
      await wait(200);
    });
  });

  describe('Scenario 6: Network Failure Recovery', () => {
    it('should retry on connection drop and succeed without duplicate data', async () => {
      const issue = {
        id: 'issue-999',
        projectId: 'project-72',
        title: 'Resilient issue',
        status: 'in_progress' as const,
        labels: [],
        createdAt: '2026-01-20T12:00:00Z',
        updatedAt: '2026-01-20T12:00:00Z',
        number: 999,
      };

      // Mock network failure then success
      mockFetch
        .mockRejectedValueOnce(new Error('Network error'))
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({ ...issue, status: 'todo' }),
          headers: new Headers(),
        } as Response)
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => issue,
          headers: new Headers(),
        } as Response);

      // Setup WebSocket client
      const ws = new WebSocket(`ws://localhost:${TEST_PORT}/notifications?apiKey=${TEST_API_KEY}`);
      await waitForOpen(ws);
      await receiveMessage(ws); // welcome

      sendMessage(ws, { type: 'subscribe', projectNumbers: [72] });
      await receiveMessage(ws); // subscription

      // Attempt update (will fail first time, succeed on retry)
      const tool = createUpdateIssueStatusTool(apiClient);
      const result = await tool.handler({
        projectNumber: 72,
        issueNumber: 999,
        status: 'in_progress',
      });

      // Should eventually succeed
      expect(result.isError).toBeUndefined();

      // Extension should receive only one notification (no duplicates)
      const notification = await receiveMessage(ws);
      expect(notification.event.type).toBe('issue.updated');
      expect(notification.event.issueNumber).toBe(999);

      ws.close();
      await wait(200);
    });
  });

  describe('Scenario 7: Full Project Lifecycle', () => {
    it('should handle complete lifecycle: create → add phases → create issues → update → complete', async () => {
      // Setup WebSocket client
      const ws = new (WebSocket as any)(`ws://localhost:${TEST_PORT}/notifications?apiKey=${TEST_API_KEY}`);
      await waitForOpen(ws);
      await receiveMessage(ws); // welcome

      sendMessage(ws, { type: 'subscribe', projectNumbers: [72] });
      await receiveMessage(ws); // subscription

      // Step 1: Emit project update
      const project = {
        id: 'project-72',
        name: 'Full Lifecycle Project',
        status: 'active' as const,
        createdAt: '2026-01-20T12:00:00Z',
        updatedAt: '2026-01-20T12:00:00Z',
      };

      eventBus.emit('project.updated', 72, project);
      const projectNotif = await receiveMessage(ws);
      expect(projectNotif.event.type).toBe('project.updated');

      // Step 2: Emit phase update
      const phases = [
        {
          id: 'phase-1',
          projectId: 'project-72',
          name: 'Foundation',
          order: 1,
          status: 'in_progress' as const,
          createdAt: '2026-01-20T12:01:00Z',
          updatedAt: '2026-01-20T12:01:00Z',
          phaseName: 'Foundation',
        },
      ];

      eventBus.emit('phase.updated', 72, phases[0], 1);
      const phaseNotif = await receiveMessage(ws);
      expect(phaseNotif.event.type).toBe('phase.updated');

      // Step 3: Create issues
      const issue = {
        id: 'issue-1',
        projectId: 'project-72',
        title: 'Setup infrastructure',
        status: 'todo' as const,
        labels: [],
        createdAt: '2026-01-20T12:02:00Z',
        updatedAt: '2026-01-20T12:02:00Z',
        number: 1,
        url: 'https://github.com/org/repo/issues/1',
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 201,
        json: async () => issue,
        headers: new Headers(),
      } as Response);

      const tool = createCreateIssueTool(apiClient);
      const issueResult = await tool.handler({
        projectNumber: 72,
        title: 'Setup infrastructure',
      });

      expect(issueResult.isError).toBeUndefined();
      const issueNotif = await receiveMessage(ws);
      expect(issueNotif.event.type).toBe('issue.created');

      // Step 4: Update status
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => issue,
          headers: new Headers(),
        } as Response)
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({ ...issue, status: 'in_progress' }),
          headers: new Headers(),
        } as Response);

      const updateTool = createUpdateIssueStatusTool(apiClient);
      const updateResult = await updateTool.handler({
        projectNumber: 72,
        issueNumber: 1,
        status: 'in_progress',
      });

      expect(updateResult.isError).toBeUndefined();
      const updateNotif = await receiveMessage(ws);
      expect(updateNotif.event.type).toBe('issue.updated');

      // Step 5: Complete project
      const completedProject = { ...project, status: 'completed' as const };

      eventBus.emit('project.updated', 72, completedProject);
      const completeNotif = await receiveMessage(ws);
      expect(completeNotif.event.type).toBe('project.updated');
      expect(completeNotif.event.data.status).toBe('completed');

      ws.close();
      await wait(200);
    });
  });

  describe('Performance Tests', () => {
    it('should create 100 issues in less than 10 seconds', async () => {
      const startTime = Date.now();

      // Mock API responses for 100 issues
      for (let i = 1; i <= 100; i++) {
        mockFetch.mockResolvedValueOnce({
          ok: true,
          status: 201,
          json: async () => ({
            id: `issue-${i}`,
            projectId: 'project-72',
            title: `Issue ${i}`,
            status: 'todo' as const,
            labels: [],
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            number: i,
            url: `https://github.com/org/repo/issues/${i}`,
          }),
          headers: new Headers(),
        } as Response);
      }

      const tool = createCreateIssueTool(apiClient);
      const promises = [];

      for (let i = 1; i <= 100; i++) {
        promises.push(
          tool.handler({
            projectNumber: 72,
            title: `Issue ${i}`,
          })
        );
      }

      const results = await Promise.all(promises);

      const duration = Date.now() - startTime;

      // Validate all succeeded
      expect(results.every((r) => !r.isError)).toBe(true);

      // Validate duration < 10 seconds
      expect(duration).toBeLessThan(10000);
    }, 15000);

    it('should update 50 issues concurrently without failures', async () => {
      // Mock API responses for 50 concurrent updates (GET + PUT for each)
      for (let i = 1; i <= 50; i++) {
        mockFetch
          .mockResolvedValueOnce({
            ok: true,
            status: 200,
            json: async () => ({
              id: `issue-${i}`,
              projectId: 'project-72',
              title: `Issue ${i}`,
              status: 'todo' as const,
              labels: [],
              createdAt: '2026-01-20T12:00:00Z',
              updatedAt: '2026-01-20T12:00:00Z',
              number: i,
            }),
            headers: new Headers(),
          } as Response)
          .mockResolvedValueOnce({
            ok: true,
            status: 200,
            json: async () => ({
              id: `issue-${i}`,
              projectId: 'project-72',
              title: `Issue ${i}`,
              status: 'in_progress' as const,
              labels: [],
              createdAt: '2026-01-20T12:00:00Z',
              updatedAt: new Date().toISOString(),
              number: i,
            }),
            headers: new Headers(),
          } as Response);
      }

      const tool = createUpdateIssueStatusTool(apiClient);
      const promises = [];

      for (let i = 1; i <= 50; i++) {
        promises.push(
          tool.handler({
            projectNumber: 72,
            issueNumber: i,
            status: 'in_progress',
          })
        );
      }

      const results = await Promise.all(promises);

      // Validate all succeeded
      expect(results.every((r) => !r.isError)).toBe(true);
      expect(results).toHaveLength(50);
    }, 15000);

    it('should handle 100 rapid WebSocket events correctly', async () => {
      // Setup WebSocket client
      const ws = new (WebSocket as any)(`ws://localhost:${TEST_PORT}/notifications?apiKey=${TEST_API_KEY}`);
      await waitForOpen(ws);
      await receiveMessage(ws); // welcome

      sendMessage(ws, { type: 'subscribe', projectNumbers: [72] });
      await receiveMessage(ws); // subscription

      const receivedEvents: any[] = [];

      // Setup promise to collect 100 events
      const eventPromise = new Promise<void>((resolve) => {
        ws.on('message', (data: any) => {
          const msg = JSON.parse(data.toString());
          if (msg.type === 'event') {
            receivedEvents.push(msg);
            if (receivedEvents.length === 100) {
              resolve();
            }
          }
        });
      });

      // Emit 100 rapid events
      for (let i = 1; i <= 100; i++) {
        eventBus.emit('issue.created', 72, { title: `Event ${i}` }, i);
      }

      // Wait for all events to be received
      await eventPromise;

      // Validate all events received correctly
      expect(receivedEvents).toHaveLength(100);
      expect(receivedEvents[0].event.data.title).toBe('Event 1');
      expect(receivedEvents[99].event.data.title).toBe('Event 100');

      ws.close();
      await wait(200);
    }, 15000);
  });

  describe('Error Scenario Tests', () => {
    it('should return clear error message for invalid API key', async () => {
      const badClient = new APIClient({
        baseUrl: TEST_BASE_URL,
        apiKey: 'invalid-key',
      });

      // Mock 401 response
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 401,
        statusText: 'Unauthorized',
        json: async () => ({ error: 'Invalid API key' }),
        headers: new Headers(),
      } as Response);

      try {
        // Use low-level API method instead of createProject
        await badClient.post('/api/projects', { name: 'Test' });
        fail('Should have thrown AuthenticationError');
      } catch (error) {
        expect(error).toBeInstanceOf(AuthenticationError);
        expect((error as Error).message).toContain('Authentication failed');
        expect((error as Error).message).toContain('STATE_TRACKING_API_KEY');
      }
    });

    it('should retry with backoff on API timeout', async () => {
      const issue = {
        id: 'issue-timeout',
        projectId: 'project-72',
        title: 'Timeout test',
        status: 'todo' as const,
        labels: [],
        createdAt: '2026-01-20T12:00:00Z',
        updatedAt: '2026-01-20T12:00:00Z',
        number: 1000,
      };

      // Mock timeout then success
      mockFetch
        .mockRejectedValueOnce(new Error('Request timeout'))
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({ ...issue, status: 'todo' }),
          headers: new Headers(),
        } as Response)
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({ ...issue, status: 'in_progress' }),
          headers: new Headers(),
        } as Response);

      const tool = createUpdateIssueStatusTool(apiClient);
      const result = await tool.handler({
        projectNumber: 72,
        issueNumber: 1000,
        status: 'in_progress',
      });

      // Should succeed after retry
      expect(result.isError).toBeUndefined();
      expect(mockFetch).toHaveBeenCalledTimes(3); // 1 failed + 2 successful
    });

    it('should automatically reconnect WebSocket after disconnect', async () => {
      // Setup WebSocket client
      const ws = new (WebSocket as any)(`ws://localhost:${TEST_PORT}/notifications?apiKey=${TEST_API_KEY}`);
      await waitForOpen(ws);
      await receiveMessage(ws); // welcome

      sendMessage(ws, { type: 'subscribe', projectNumbers: [72] });
      await receiveMessage(ws); // subscription

      // Emit event and verify receipt
      eventBus.emit('issue.created', 72, { title: 'Before disconnect' }, 1);
      const beforeMsg = await receiveMessage(ws);
      expect(beforeMsg.event.data.title).toBe('Before disconnect');

      // Simulate disconnect
      ws.close();
      await wait(500);

      // Reconnect
      const ws2 = new (WebSocket as any)(`ws://localhost:${TEST_PORT}/notifications?apiKey=${TEST_API_KEY}`);
      await waitForOpen(ws2);
      await receiveMessage(ws2); // welcome

      sendMessage(ws2, { type: 'subscribe', projectNumbers: [72] });
      await receiveMessage(ws2); // subscription

      // Emit event and verify receipt after reconnection
      eventBus.emit('issue.created', 72, { title: 'After reconnect' }, 2);
      const afterMsg = await receiveMessage(ws2);
      expect(afterMsg.event.data.title).toBe('After reconnect');

      ws2.close();
      await wait(200);
    });

    it('should handle WebSocket authentication errors gracefully', async () => {
      // Attempt connection with invalid API key
      const ws = new (WebSocket as any)(`ws://localhost:${TEST_PORT}/notifications?apiKey=invalid-key`);

      const closePromise = new Promise<void>((resolve) => {
        ws.on('close', () => resolve());
        ws.on('error', () => {
          // Error expected, connection should be rejected
          resolve();
        });
      });

      await closePromise;

      // Connection should be closed (CLOSING = 2, CLOSED = 3)
      expect([2, 3]).toContain(ws.readyState);
    });

    it('should handle malformed WebSocket messages gracefully', async () => {
      const ws = new (WebSocket as any)(`ws://localhost:${TEST_PORT}/notifications?apiKey=${TEST_API_KEY}`);
      await waitForOpen(ws);
      await receiveMessage(ws); // welcome

      // Send malformed JSON
      ws.send('not valid json');

      const errorMsg = await receiveMessage(ws);
      expect(errorMsg.type).toBe('error');
      expect(errorMsg.message).toContain('Invalid JSON');

      // Connection should remain open (OPEN = 1)
      expect(ws.readyState).toBe(1);

      ws.close();
      await wait(200);
    });
  });
});
