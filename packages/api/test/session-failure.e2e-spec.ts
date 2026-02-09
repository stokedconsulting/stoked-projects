import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { LoggingModule } from '../src/common/logging/logging.module';
import { SessionStatus } from '../src/schemas/session.schema';

describe('Session Failure Detection Endpoints (e2e)', () => {
  let app: INestApplication;
  const validApiKey = 'test-valid-api-key-12345678';
  let testSessionId: string;
  let failedSessionId: string;

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

    // Create test sessions
    const createResponse = await request(app.getHttpServer())
      .post('/sessions')
      .set('X-API-Key', validApiKey)
      .send({
        project_id: 'test-project-failure',
        machine_id: 'test-machine-failure',
        docker_slot: 1,
      })
      .expect(201);

    testSessionId = createResponse.body.session_id;
  });

  afterAll(async () => {
    // Clean up test sessions
    if (testSessionId) {
      await request(app.getHttpServer())
        .delete(`/sessions/${testSessionId}`)
        .set('X-API-Key', validApiKey);
    }
    if (failedSessionId) {
      await request(app.getHttpServer())
        .delete(`/sessions/${failedSessionId}`)
        .set('X-API-Key', validApiKey);
    }
    await app.close();
  });

  describe('POST /sessions/:id/mark-failed - Mark Session as Failed', () => {
    it('should mark an active session as failed with reason and error details', async () => {
      const markFailedDto = {
        reason: 'Claude process crashed unexpectedly',
        error_details: {
          error_code: 'ERR_CLAUDE_CRASH',
          exit_code: 1,
          stack_trace: 'Error: Process exited with code 1',
        },
      };

      const response = await request(app.getHttpServer())
        .post(`/sessions/${testSessionId}/mark-failed`)
        .set('X-API-Key', validApiKey)
        .send(markFailedDto)
        .expect(200);

      expect(response.body.status).toBe(SessionStatus.FAILED);
      expect(response.body.completed_at).toBeDefined();
      expect(response.body.metadata.failure_reason).toBe(markFailedDto.reason);
      expect(response.body.metadata.error_details).toEqual(markFailedDto.error_details);
      expect(response.body.metadata.failure_timestamp).toBeDefined();

      // Save for further tests
      failedSessionId = testSessionId;
      testSessionId = null; // Don't clean up in afterAll since it's now failed
    });

    it('should return 404 for non-existent session', async () => {
      const markFailedDto = {
        reason: 'Test failure',
      };

      await request(app.getHttpServer())
        .post('/sessions/non-existent-id/mark-failed')
        .set('X-API-Key', validApiKey)
        .send(markFailedDto)
        .expect(404);
    });

    it('should return 400 for missing required reason field', async () => {
      // Create a new session for this test
      const createResponse = await request(app.getHttpServer())
        .post('/sessions')
        .set('X-API-Key', validApiKey)
        .send({
          project_id: 'test-project-validation',
          machine_id: 'test-machine-validation',
        })
        .expect(201);

      const sessionId = createResponse.body.session_id;

      await request(app.getHttpServer())
        .post(`/sessions/${sessionId}/mark-failed`)
        .set('X-API-Key', validApiKey)
        .send({}) // Missing reason
        .expect(400);

      // Clean up
      await request(app.getHttpServer())
        .delete(`/sessions/${sessionId}`)
        .set('X-API-Key', validApiKey);
    });

    it('should return 400 when marking completed session as failed', async () => {
      // Create and immediately complete a session
      const createResponse = await request(app.getHttpServer())
        .post('/sessions')
        .set('X-API-Key', validApiKey)
        .send({
          project_id: 'test-project-completed',
          machine_id: 'test-machine-completed',
        })
        .expect(201);

      const sessionId = createResponse.body.session_id;

      // Mark as completed
      await request(app.getHttpServer())
        .delete(`/sessions/${sessionId}`)
        .set('X-API-Key', validApiKey)
        .expect(204);

      // Try to mark as failed
      await request(app.getHttpServer())
        .post(`/sessions/${sessionId}/mark-failed`)
        .set('X-API-Key', validApiKey)
        .send({ reason: 'Test failure' })
        .expect(400);
    });
  });

  describe('POST /sessions/:id/mark-stalled - Mark Session as Stalled', () => {
    it('should mark an active session as stalled', async () => {
      // Create a new session for this test
      const createResponse = await request(app.getHttpServer())
        .post('/sessions')
        .set('X-API-Key', validApiKey)
        .send({
          project_id: 'test-project-stalled',
          machine_id: 'test-machine-stalled',
        })
        .expect(201);

      const sessionId = createResponse.body.session_id;

      const markStalledDto = {
        reason: 'No heartbeat received for 15 minutes',
      };

      const response = await request(app.getHttpServer())
        .post(`/sessions/${sessionId}/mark-stalled`)
        .set('X-API-Key', validApiKey)
        .send(markStalledDto)
        .expect(200);

      expect(response.body.status).toBe(SessionStatus.STALLED);
      expect(response.body.metadata.stalled_reason).toBe(markStalledDto.reason);
      expect(response.body.metadata.stalled_timestamp).toBeDefined();

      // Clean up
      await request(app.getHttpServer())
        .delete(`/sessions/${sessionId}`)
        .set('X-API-Key', validApiKey);
    });

    it('should return 404 for non-existent session', async () => {
      await request(app.getHttpServer())
        .post('/sessions/non-existent-id/mark-stalled')
        .set('X-API-Key', validApiKey)
        .send({ reason: 'Test stall' })
        .expect(404);
    });

    it('should return 400 when marking failed session as stalled', async () => {
      // Use the already failed session from earlier test
      if (failedSessionId) {
        await request(app.getHttpServer())
          .post(`/sessions/${failedSessionId}/mark-stalled`)
          .set('X-API-Key', validApiKey)
          .send({ reason: 'Test stall' })
          .expect(400);
      }
    });
  });

  describe('GET /sessions/failed - Query Failed Sessions', () => {
    beforeAll(async () => {
      // Create multiple failed sessions for testing
      for (let i = 0; i < 3; i++) {
        const createResponse = await request(app.getHttpServer())
          .post('/sessions')
          .set('X-API-Key', validApiKey)
          .send({
            project_id: `test-project-${i}`,
            machine_id: i === 0 ? 'machine-A' : 'machine-B',
          })
          .expect(201);

        await request(app.getHttpServer())
          .post(`/sessions/${createResponse.body.session_id}/mark-failed`)
          .set('X-API-Key', validApiKey)
          .send({ reason: `Test failure ${i}` });
      }
    });

    it('should return all failed sessions', async () => {
      const response = await request(app.getHttpServer())
        .get('/sessions/failed')
        .set('X-API-Key', validApiKey)
        .expect(200);

      expect(Array.isArray(response.body)).toBe(true);
      expect(response.body.length).toBeGreaterThanOrEqual(4); // At least 4 from our tests
      response.body.forEach((session: any) => {
        expect(session.status).toBe(SessionStatus.FAILED);
      });
    });

    it('should filter failed sessions by project_id', async () => {
      const response = await request(app.getHttpServer())
        .get('/sessions/failed?project_id=test-project-0')
        .set('X-API-Key', validApiKey)
        .expect(200);

      expect(Array.isArray(response.body)).toBe(true);
      response.body.forEach((session: any) => {
        expect(session.project_id).toBe('test-project-0');
        expect(session.status).toBe(SessionStatus.FAILED);
      });
    });

    it('should filter failed sessions by machine_id', async () => {
      const response = await request(app.getHttpServer())
        .get('/sessions/failed?machine_id=machine-A')
        .set('X-API-Key', validApiKey)
        .expect(200);

      expect(Array.isArray(response.body)).toBe(true);
      response.body.forEach((session: any) => {
        expect(session.machine_id).toBe('machine-A');
        expect(session.status).toBe(SessionStatus.FAILED);
      });
    });

    it('should apply pagination with limit and offset', async () => {
      const response = await request(app.getHttpServer())
        .get('/sessions/failed?limit=2&offset=0')
        .set('X-API-Key', validApiKey)
        .expect(200);

      expect(Array.isArray(response.body)).toBe(true);
      expect(response.body.length).toBeLessThanOrEqual(2);
    });
  });

  describe('GET /sessions/:id/failure-info - Get Failure Information', () => {
    it('should return comprehensive failure information for failed session', async () => {
      // Use the failed session from earlier
      if (failedSessionId) {
        const response = await request(app.getHttpServer())
          .get(`/sessions/${failedSessionId}/failure-info`)
          .set('X-API-Key', validApiKey)
          .expect(200);

        expect(response.body).toHaveProperty('session_id', failedSessionId);
        expect(response.body).toHaveProperty('status', SessionStatus.FAILED);
        expect(response.body).toHaveProperty('failure_reason');
        expect(response.body).toHaveProperty('failed_at');
        expect(response.body).toHaveProperty('last_heartbeat');
        expect(response.body).toHaveProperty('started_at');
        expect(response.body).toHaveProperty('duration_minutes');
        expect(response.body).toHaveProperty('analysis');

        // Check analysis structure
        expect(response.body.analysis).toHaveProperty('is_very_stale');
        expect(response.body.analysis).toHaveProperty('has_stuck_tasks');
        expect(response.body.analysis).toHaveProperty('stuck_task_count');
        expect(response.body.analysis).toHaveProperty('minutes_since_heartbeat');
        expect(response.body.analysis).toHaveProperty('recovery_recommendations');
        expect(Array.isArray(response.body.analysis.recovery_recommendations)).toBe(true);
        expect(response.body.analysis.recovery_recommendations.length).toBeGreaterThan(0);

        // Check error details are present
        if (response.body.error_details) {
          expect(response.body.error_details).toHaveProperty('error_code');
        }
      }
    });

    it('should return 404 for non-existent session', async () => {
      await request(app.getHttpServer())
        .get('/sessions/non-existent-id/failure-info')
        .set('X-API-Key', validApiKey)
        .expect(404);
    });

    it('should return 400 for session that is not failed', async () => {
      // Create a new active session
      const createResponse = await request(app.getHttpServer())
        .post('/sessions')
        .set('X-API-Key', validApiKey)
        .send({
          project_id: 'test-project-active',
          machine_id: 'test-machine-active',
        })
        .expect(201);

      const sessionId = createResponse.body.session_id;

      await request(app.getHttpServer())
        .get(`/sessions/${sessionId}/failure-info`)
        .set('X-API-Key', validApiKey)
        .expect(400);

      // Clean up
      await request(app.getHttpServer())
        .delete(`/sessions/${sessionId}`)
        .set('X-API-Key', validApiKey);
    });
  });

  describe('Authentication', () => {
    it('should require API key for all failure endpoints', async () => {
      // Create a session for testing
      const createResponse = await request(app.getHttpServer())
        .post('/sessions')
        .set('X-API-Key', validApiKey)
        .send({
          project_id: 'test-auth',
          machine_id: 'test-auth',
        })
        .expect(201);

      const sessionId = createResponse.body.session_id;

      // Test all endpoints without API key
      await request(app.getHttpServer())
        .post(`/sessions/${sessionId}/mark-failed`)
        .send({ reason: 'Test' })
        .expect(401);

      await request(app.getHttpServer())
        .post(`/sessions/${sessionId}/mark-stalled`)
        .send({ reason: 'Test' })
        .expect(401);

      await request(app.getHttpServer())
        .get('/sessions/failed')
        .expect(401);

      await request(app.getHttpServer())
        .get(`/sessions/${sessionId}/failure-info`)
        .expect(401);

      // Clean up
      await request(app.getHttpServer())
        .delete(`/sessions/${sessionId}`)
        .set('X-API-Key', validApiKey);
    });
  });
});
