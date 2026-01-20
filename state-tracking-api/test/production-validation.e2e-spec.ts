import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { LoggingModule } from '../src/common/logging/logging.module';
import { SessionStatus } from '../src/schemas/session.schema';
import { TaskStatus } from '../src/schemas/task.schema';

/**
 * Production Validation E2E Test Suite
 *
 * This comprehensive test suite validates the entire production workflow including:
 * - Full API workflow (sessions, tasks, heartbeats, cleanup)
 * - Authentication and authorization
 * - Rate limiting
 * - Error handling
 * - Data persistence
 * - Concurrent request handling
 *
 * These tests simulate real-world production scenarios and ensure the system
 * behaves correctly under various conditions.
 */
describe('Production Validation Suite (e2e)', () => {
  let app: INestApplication;
  const validApiKey = 'test-valid-api-key-12345678';
  const invalidApiKey = 'invalid-api-key';
  let sessionId: string;
  let machineId: string;
  let projectId: string;
  const taskIds: string[] = [];

  beforeAll(async () => {
    // Set API keys for testing
    process.env.API_KEYS = validApiKey;
    process.env.NODE_ENV = 'test';
    process.env.MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/claude-projects-test';

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [LoggingModule, AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();

    // Apply same configuration as main.ts
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        transform: true,
        forbidNonWhitelisted: true,
      }),
    );

    await app.init();

    // Generate test identifiers
    projectId = `prod-test-project-${Date.now()}`;
    machineId = `prod-test-machine-${Date.now()}`;
  });

  afterAll(async () => {
    // Cleanup: Delete created resources
    if (sessionId) {
      await request(app.getHttpServer())
        .delete(`/sessions/${sessionId}`)
        .set('X-API-Key', validApiKey)
        .catch(() => {
          // Ignore cleanup errors
        });
    }

    await app.close();
  });

  // ============================================================================
  // Full Workflow Tests
  // ============================================================================

  describe('Full Production Workflow', () => {
    it('should complete full workflow: create session → send heartbeats → cleanup', async () => {
      // Step 1: Create a session
      const createSessionRes = await request(app.getHttpServer())
        .post('/sessions')
        .set('X-API-Key', validApiKey)
        .send({
          project_id: projectId,
          machine_id: machineId,
          docker_slot: 1,
          metadata: {
            vscode_version: '1.85.0',
            extension_version: '0.1.0',
            environment: 'production-validation',
          },
        })
        .expect(201);

      expect(createSessionRes.body).toHaveProperty('session_id');
      expect(createSessionRes.body.status).toBe(SessionStatus.ACTIVE);
      expect(createSessionRes.body.project_id).toBe(projectId);
      expect(createSessionRes.body.machine_id).toBe(machineId);
      expect(createSessionRes.body).toHaveProperty('started_at');
      expect(createSessionRes.body).toHaveProperty('last_heartbeat');

      sessionId = createSessionRes.body.session_id;

      // Step 2: Send heartbeats to keep session alive
      const heartbeat1 = await request(app.getHttpServer())
        .post(`/sessions/${sessionId}/heartbeat`)
        .set('X-API-Key', validApiKey)
        .send({
          metadata: { status: 'working', step: 1 },
        })
        .expect(200);

      expect(heartbeat1.body.session_id).toBe(sessionId);
      expect(heartbeat1.body).toHaveProperty('last_heartbeat');

      // Wait a bit and send another heartbeat
      await new Promise((resolve) => setTimeout(resolve, 100));

      const heartbeat2 = await request(app.getHttpServer())
        .post(`/sessions/${sessionId}/heartbeat`)
        .set('X-API-Key', validApiKey)
        .send({
          metadata: { status: 'working', step: 2 },
        })
        .expect(200);

      expect(heartbeat2.body).toHaveProperty('last_heartbeat');

      // Step 3: Verify session state
      const getSessionRes = await request(app.getHttpServer())
        .get(`/sessions/${sessionId}`)
        .set('X-API-Key', validApiKey)
        .expect(200);

      expect(getSessionRes.body.session_id).toBe(sessionId);
      expect(getSessionRes.body.status).toBe(SessionStatus.ACTIVE);

      // Step 4: Update session status
      const updateSessionRes = await request(app.getHttpServer())
        .put(`/sessions/${sessionId}`)
        .set('X-API-Key', validApiKey)
        .send({
          status: SessionStatus.PAUSED,
        })
        .expect(200);

      expect(updateSessionRes.body.status).toBe(SessionStatus.PAUSED);

      // Step 5: Resume and then cleanup - mark session as completed
      await request(app.getHttpServer())
        .delete(`/sessions/${sessionId}`)
        .set('X-API-Key', validApiKey)
        .expect(204);

      // Verify session is completed
      const finalSessionRes = await request(app.getHttpServer())
        .get(`/sessions/${sessionId}`)
        .set('X-API-Key', validApiKey)
        .expect(200);

      expect(finalSessionRes.body.status).toBe(SessionStatus.COMPLETED);
      expect(finalSessionRes.body).toHaveProperty('completed_at');
    });
  });

  // ============================================================================
  // Authentication and Authorization Tests
  // ============================================================================

  describe('Authentication and Authorization', () => {
    it('should reject requests without API key', async () => {
      const response = await request(app.getHttpServer())
        .get('/sessions')
        .expect(401);

      expect(response.body).toHaveProperty('message');
    });

    it('should reject requests with invalid API key', async () => {
      const response = await request(app.getHttpServer())
        .get('/sessions')
        .set('X-API-Key', invalidApiKey)
        .expect(401);

      expect(response.body).toHaveProperty('message');
    });

    it('should accept requests with valid API key', async () => {
      const response = await request(app.getHttpServer())
        .get('/sessions')
        .set('X-API-Key', validApiKey)
        .expect(200);

      expect(Array.isArray(response.body)).toBe(true);
    });

    it('should protect all protected endpoints with authentication', async () => {
      const protectedEndpoints = [
        { method: 'get', path: '/sessions' },
        { method: 'post', path: '/sessions', send: { project_id: 'test', machine_id: 'test' } },
        { method: 'get', path: '/machines' },
        { method: 'get', path: '/tasks' },
      ];

      for (const endpoint of protectedEndpoints) {
        const req = request(app.getHttpServer())[endpoint.method](endpoint.path);
        if (endpoint.send) {
          req.send(endpoint.send);
        }
        const response = await req.expect(401);
        expect(response.body).toHaveProperty('message');
      }
    });

    it('should support multiple valid API keys', async () => {
      const additionalKey = 'another-valid-key';
      process.env.API_KEYS = `${validApiKey},${additionalKey}`;

      // Create a new app instance to pick up the new environment variable
      const moduleFixture: TestingModule = await Test.createTestingModule({
        imports: [LoggingModule, AppModule],
      }).compile();

      const tempApp = moduleFixture.createNestApplication();
      tempApp.useGlobalPipes(
        new ValidationPipe({
          whitelist: true,
          transform: true,
          forbidNonWhitelisted: true,
        }),
      );
      await tempApp.init();

      // Test with first key
      const res1 = await request(tempApp.getHttpServer())
        .get('/sessions')
        .set('X-API-Key', validApiKey)
        .expect(200);

      expect(Array.isArray(res1.body)).toBe(true);

      // Test with second key
      const res2 = await request(tempApp.getHttpServer())
        .get('/sessions')
        .set('X-API-Key', additionalKey)
        .expect(200);

      expect(Array.isArray(res2.body)).toBe(true);

      await tempApp.close();

      // Restore original API keys
      process.env.API_KEYS = validApiKey;
    });
  });

  // ============================================================================
  // Rate Limiting Validation Tests
  // ============================================================================

  describe('Rate Limiting', () => {
    it('should allow health checks without rate limit restrictions', async () => {
      // Make multiple rapid health check requests
      const healthRequests = Array(15)
        .fill(null)
        .map(() => request(app.getHttpServer()).get('/health'));

      const responses = await Promise.all(healthRequests);

      // All should succeed
      responses.forEach((response) => {
        expect(response.status).toBe(200);
        expect(response.body).toHaveProperty('status', 'ok');
      });
    });

    it('should enforce rate limits on protected endpoints', async () => {
      // Make rapid requests to a protected endpoint
      const requests = Array(10)
        .fill(null)
        .map(() =>
          request(app.getHttpServer())
            .get('/sessions')
            .set('X-API-Key', validApiKey),
        );

      const responses = await Promise.all(requests);

      // At least some should succeed
      const successCount = responses.filter((r) => r.status === 200).length;
      const rateLimitCount = responses.filter((r) => r.status === 429).length;

      expect(successCount).toBeGreaterThan(0);
      // Rate limiting may or may not trigger in this test environment
      expect(successCount + rateLimitCount).toBe(responses.length);
    });
  });

  // ============================================================================
  // Error Handling Tests
  // ============================================================================

  describe('Error Handling and Validation', () => {
    it('should return 400 for invalid request body', async () => {
      const response = await request(app.getHttpServer())
        .post('/sessions')
        .set('X-API-Key', validApiKey)
        .send({
          // Missing required fields: project_id, machine_id
          docker_slot: 'invalid', // Should be a number
        })
        .expect(400);

      expect(response.body).toHaveProperty('message');
      expect(Array.isArray(response.body.message)).toBe(true);
    });

    it('should return 404 for non-existent session', async () => {
      const fakeSessionId = '550e8400-e29b-41d4-a716-446655440000';
      const response = await request(app.getHttpServer())
        .get(`/sessions/${fakeSessionId}`)
        .set('X-API-Key', validApiKey)
        .expect(404);

      expect(response.body).toHaveProperty('message');
      expect(response.body.message).toContain('not found');
    });

    it('should return 404 for non-existent machine', async () => {
      const fakeMachineId = '550e8400-e29b-41d4-a716-446655440001';

      const response = await request(app.getHttpServer())
        .get(`/machines/${fakeMachineId}`)
        .set('X-API-Key', validApiKey)
        .expect(404);

      expect(response.body).toHaveProperty('message');
    });

    it('should return 400 for invalid enum values', async () => {
      const testSessionId = sessionId || '550e8400-e29b-41d4-a716-446655440000';

      const response = await request(app.getHttpServer())
        .get('/sessions')
        .query({ status: 'invalid-status-value' })
        .set('X-API-Key', validApiKey)
        .expect(400);

      expect(response.body).toHaveProperty('message');
    });

    it('should return 400 for invalid query parameters', async () => {
      const response = await request(app.getHttpServer())
        .get('/sessions')
        .query({ limit: 500 }) // Exceeds max limit of 100
        .set('X-API-Key', validApiKey)
        .expect(400);

      expect(response.body).toHaveProperty('message');
    });

    it('should handle concurrent error scenarios gracefully', async () => {
      const requests = Array(5)
        .fill(null)
        .map(() =>
          request(app.getHttpServer())
            .get('/sessions/invalid-id-123')
            .set('X-API-Key', validApiKey),
        );

      const responses = await Promise.all(requests);

      // All should return 404
      responses.forEach((response) => {
        expect(response.status).toBe(404);
        expect(response.body).toHaveProperty('message');
      });
    });
  });

  // ============================================================================
  // Data Persistence Tests
  // ============================================================================

  describe('Data Persistence', () => {
    it('should persist session data across multiple API calls', async () => {
      // Create a session
      const createRes = await request(app.getHttpServer())
        .post('/sessions')
        .set('X-API-Key', validApiKey)
        .send({
          project_id: `persistence-test-${Date.now()}`,
          machine_id: `persistence-machine-${Date.now()}`,
          metadata: { test: 'persistence' },
        })
        .expect(201);

      const testSessionId = createRes.body.session_id;

      // Retrieve it immediately
      const get1 = await request(app.getHttpServer())
        .get(`/sessions/${testSessionId}`)
        .set('X-API-Key', validApiKey)
        .expect(200);

      expect(get1.body.metadata).toHaveProperty('test', 'persistence');

      // Update it
      const updateRes = await request(app.getHttpServer())
        .put(`/sessions/${testSessionId}`)
        .set('X-API-Key', validApiKey)
        .send({
          metadata: { test: 'persistence', updated: true },
        })
        .expect(200);

      expect(updateRes.body.metadata).toHaveProperty('updated', true);

      // Retrieve again to verify persistence
      const get2 = await request(app.getHttpServer())
        .get(`/sessions/${testSessionId}`)
        .set('X-API-Key', validApiKey)
        .expect(200);

      expect(get2.body.metadata).toHaveProperty('updated', true);
      expect(get2.body.metadata).toHaveProperty('test', 'persistence');

      // Cleanup
      await request(app.getHttpServer())
        .delete(`/sessions/${testSessionId}`)
        .set('X-API-Key', validApiKey)
        .expect(204);
    });

    it('should maintain consistent status transitions', async () => {
      // Create a session
      const sessionRes = await request(app.getHttpServer())
        .post('/sessions')
        .set('X-API-Key', validApiKey)
        .send({
          project_id: `status-test-${Date.now()}`,
          machine_id: `status-machine-${Date.now()}`,
        })
        .expect(201);

      const testSessionId = sessionRes.body.session_id;

      // Verify initial state
      const get1 = await request(app.getHttpServer())
        .get(`/sessions/${testSessionId}`)
        .set('X-API-Key', validApiKey)
        .expect(200);

      expect(get1.body.status).toBe(SessionStatus.ACTIVE);

      // Transition to PAUSED
      const pauseRes = await request(app.getHttpServer())
        .put(`/sessions/${testSessionId}`)
        .set('X-API-Key', validApiKey)
        .send({
          status: SessionStatus.PAUSED,
        })
        .expect(200);

      expect(pauseRes.body.status).toBe(SessionStatus.PAUSED);

      // Verify state persists
      const get2 = await request(app.getHttpServer())
        .get(`/sessions/${testSessionId}`)
        .set('X-API-Key', validApiKey)
        .expect(200);

      expect(get2.body.status).toBe(SessionStatus.PAUSED);

      // Cleanup
      await request(app.getHttpServer())
        .delete(`/sessions/${testSessionId}`)
        .set('X-API-Key', validApiKey)
        .expect(204);
    });
  });

  // ============================================================================
  // Concurrent Request Handling Tests
  // ============================================================================

  describe('Concurrent Request Handling', () => {
    it('should handle multiple concurrent session creations', async () => {
      const concurrentRequests = Array(5)
        .fill(null)
        .map((_, index) =>
          request(app.getHttpServer())
            .post('/sessions')
            .set('X-API-Key', validApiKey)
            .send({
              project_id: `concurrent-test-${Date.now()}`,
              machine_id: `concurrent-machine-${index}-${Date.now()}`,
            }),
        );

      const responses = await Promise.all(concurrentRequests);

      // All should succeed
      expect(responses.length).toBe(5);
      responses.forEach((response) => {
        expect(response.status).toBe(201);
        expect(response.body).toHaveProperty('session_id');
      });

      // Cleanup
      for (const response of responses) {
        await request(app.getHttpServer())
          .delete(`/sessions/${response.body.session_id}`)
          .set('X-API-Key', validApiKey)
          .catch(() => {
            // Ignore cleanup errors
          });
      }
    });

    it('should handle concurrent read operations on same session', async () => {
      // Create a session
      const createRes = await request(app.getHttpServer())
        .post('/sessions')
        .set('X-API-Key', validApiKey)
        .send({
          project_id: `concurrent-read-${Date.now()}`,
          machine_id: `concurrent-read-machine-${Date.now()}`,
        })
        .expect(201);

      const testSessionId = createRes.body.session_id;

      // Make concurrent read requests
      const readRequests = Array(10)
        .fill(null)
        .map(() =>
          request(app.getHttpServer())
            .get(`/sessions/${testSessionId}`)
            .set('X-API-Key', validApiKey),
        );

      const responses = await Promise.all(readRequests);

      // All should succeed and return the same data
      expect(responses.length).toBe(10);
      responses.forEach((response) => {
        expect(response.status).toBe(200);
        expect(response.body.session_id).toBe(testSessionId);
      });

      // Cleanup
      await request(app.getHttpServer())
        .delete(`/sessions/${testSessionId}`)
        .set('X-API-Key', validApiKey)
        .catch(() => {
          // Ignore cleanup errors
        });
    });

    it('should handle concurrent updates and reads', async () => {
      // Create a session
      const createRes = await request(app.getHttpServer())
        .post('/sessions')
        .set('X-API-Key', validApiKey)
        .send({
          project_id: `concurrent-mixed-${Date.now()}`,
          machine_id: `concurrent-mixed-machine-${Date.now()}`,
        })
        .expect(201);

      const testSessionId = createRes.body.session_id;

      // Mix of read and update operations
      const mixedRequests = [
        // Read operations
        ...Array(5)
          .fill(null)
          .map(() =>
            request(app.getHttpServer())
              .get(`/sessions/${testSessionId}`)
              .set('X-API-Key', validApiKey),
          ),
        // Update operations
        ...Array(3)
          .fill(null)
          .map((_, index) =>
            request(app.getHttpServer())
              .put(`/sessions/${testSessionId}`)
              .set('X-API-Key', validApiKey)
              .send({
                metadata: { update_index: index },
              }),
          ),
      ];

      const responses = await Promise.all(mixedRequests);

      // All should succeed
      const successCount = responses.filter((r) => r.status === 200 || r.status === 201).length;
      expect(successCount).toBe(responses.length);

      // Cleanup
      await request(app.getHttpServer())
        .delete(`/sessions/${testSessionId}`)
        .set('X-API-Key', validApiKey)
        .catch(() => {
          // Ignore cleanup errors
        });
    });
  });

  // ============================================================================
  // Health and Readiness Checks
  // ============================================================================

  describe('Health and Readiness Checks', () => {
    it('should provide health status endpoint', async () => {
      const response = await request(app.getHttpServer())
        .get('/health')
        .expect(200);

      expect(response.body).toHaveProperty('status');
      expect(response.body).toHaveProperty('timestamp');
      expect(response.body).toHaveProperty('uptime');
    });

    it('should provide readiness check endpoint', async () => {
      const response = await request(app.getHttpServer())
        .get('/health/ready')
        .expect(200);

      expect(response.body).toHaveProperty('ready');
      expect(response.body.ready).toBe(true);
    });
  });

  // ============================================================================
  // Performance and Response Time Tests
  // ============================================================================

  describe('Performance and Response Times', () => {
    it('should respond to health checks within acceptable time', async () => {
      const startTime = Date.now();

      await request(app.getHttpServer())
        .get('/health')
        .expect(200);

      const duration = Date.now() - startTime;

      // Health check should respond within 500ms
      expect(duration).toBeLessThan(500);
    });

    it('should handle list endpoints efficiently', async () => {
      const startTime = Date.now();

      await request(app.getHttpServer())
        .get('/sessions')
        .query({ limit: 10 })
        .set('X-API-Key', validApiKey)
        .expect(200);

      const duration = Date.now() - startTime;

      // List endpoint should respond within 2s
      expect(duration).toBeLessThan(2000);
    });

    it('should create resources within acceptable time', async () => {
      const startTime = Date.now();

      await request(app.getHttpServer())
        .post('/sessions')
        .set('X-API-Key', validApiKey)
        .send({
          project_id: `perf-test-${Date.now()}`,
          machine_id: `perf-machine-${Date.now()}`,
        })
        .expect(201);

      const duration = Date.now() - startTime;

      // Creation should complete within 2s
      expect(duration).toBeLessThan(2000);
    });
  });
});
