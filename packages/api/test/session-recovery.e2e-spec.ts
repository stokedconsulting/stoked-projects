import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { LoggingModule } from '../src/common/logging/logging.module';
import { SessionStatus } from '../src/schemas/session.schema';
import { TaskStatus } from '../src/schemas/task.schema';

describe('Session Recovery Endpoints (e2e)', () => {
  let app: INestApplication;
  const validApiKey = 'test-valid-api-key-12345678';
  let createdSessionId: string;
  let createdTaskId: string;

  beforeAll(async () => {
    process.env.API_KEYS = validApiKey;
    process.env.NODE_ENV = 'test';
    process.env.MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/claude-projects-test';

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [LoggingModule, AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();

    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        transform: true,
        forbidNonWhitelisted: true,
      }),
    );

    await app.init();

    // Create a test session
    const sessionResponse = await request(app.getHttpServer())
      .post('/sessions')
      .set('X-API-Key', validApiKey)
      .send({
        project_id: 'recovery-test-project',
        machine_id: 'test-machine-recovery',
        docker_slot: 1,
        metadata: {
          test: true,
        },
      });

    createdSessionId = sessionResponse.body.session_id;

    // Create a test task
    const taskResponse = await request(app.getHttpServer())
      .post('/tasks')
      .set('X-API-Key', validApiKey)
      .send({
        session_id: createdSessionId,
        project_id: 'recovery-test-project',
        task_name: 'Test Task for Recovery',
      });

    createdTaskId = taskResponse.body.task_id;
  });

  afterAll(async () => {
    // Cleanup
    if (createdSessionId) {
      try {
        await request(app.getHttpServer())
          .delete(`/sessions/${createdSessionId}/purge`)
          .set('X-API-Key', validApiKey)
          .send({ confirm: true });
      } catch (e) {
        // Ignore cleanup errors
      }
    }
    await app.close();
  });

  describe('POST /sessions/:id/prepare-recovery', () => {
    beforeEach(async () => {
      // Mark session as failed
      await request(app.getHttpServer())
        .post(`/sessions/${createdSessionId}/mark-failed`)
        .set('X-API-Key', validApiKey)
        .send({
          reason: 'Test failure',
        });
    });

    it('should prepare recovery for a failed session', async () => {
      const response = await request(app.getHttpServer())
        .post(`/sessions/${createdSessionId}/prepare-recovery`)
        .set('X-API-Key', validApiKey)
        .expect(200);

      expect(response.body).toHaveProperty('session_id', createdSessionId);
      expect(response.body).toHaveProperty('status', SessionStatus.FAILED);
      expect(response.body).toHaveProperty('recovery_attempts', 0);
      expect(response.body).toHaveProperty('recovery_checkpoint_at');
      expect(response.body).toHaveProperty('machine_id');
    });

    it('should return 404 for non-existent session', async () => {
      const fakeId = '550e8400-e29b-41d4-a716-446655440000';
      await request(app.getHttpServer())
        .post(`/sessions/${fakeId}/prepare-recovery`)
        .set('X-API-Key', validApiKey)
        .expect(404);
    });

    it('should return 401 without authentication', async () => {
      await request(app.getHttpServer())
        .post(`/sessions/${createdSessionId}/prepare-recovery`)
        .expect(401);
    });
  });

  describe('POST /sessions/:id/recover', () => {
    beforeEach(async () => {
      // Ensure session is in failed state
      await request(app.getHttpServer())
        .post(`/sessions/${createdSessionId}/mark-failed`)
        .set('X-API-Key', validApiKey)
        .send({
          reason: 'Test failure for recovery',
        });
    });

    it('should recover a failed session with default settings', async () => {
      const response = await request(app.getHttpServer())
        .post(`/sessions/${createdSessionId}/recover`)
        .set('X-API-Key', validApiKey)
        .send({})
        .expect(200);

      expect(response.body.session_id).toBe(createdSessionId);
      expect(response.body.status).toBe(SessionStatus.ACTIVE);
      expect(response.body).toHaveProperty('last_heartbeat');
    });

    it('should recover session with new machine assignment', async () => {
      // Mark as failed again
      await request(app.getHttpServer())
        .post(`/sessions/${createdSessionId}/mark-failed`)
        .set('X-API-Key', validApiKey)
        .send({ reason: 'Test' });

      const response = await request(app.getHttpServer())
        .post(`/sessions/${createdSessionId}/recover`)
        .set('X-API-Key', validApiKey)
        .send({
          new_machine_id: 'test-machine-2',
        })
        .expect(200);

      expect(response.body.machine_id).toBe('test-machine-2');
      expect(response.body.status).toBe(SessionStatus.ACTIVE);
    });

    it('should recover session with new docker slot', async () => {
      // Mark as failed again
      await request(app.getHttpServer())
        .post(`/sessions/${createdSessionId}/mark-failed`)
        .set('X-API-Key', validApiKey)
        .send({ reason: 'Test' });

      const response = await request(app.getHttpServer())
        .post(`/sessions/${createdSessionId}/recover`)
        .set('X-API-Key', validApiKey)
        .send({
          new_docker_slot: 3,
        })
        .expect(200);

      expect(response.body.docker_slot).toBe(3);
      expect(response.body.status).toBe(SessionStatus.ACTIVE);
    });

    it('should recover session and resume from specific task', async () => {
      // Mark as failed again
      await request(app.getHttpServer())
        .post(`/sessions/${createdSessionId}/mark-failed`)
        .set('X-API-Key', validApiKey)
        .send({ reason: 'Test' });

      const response = await request(app.getHttpServer())
        .post(`/sessions/${createdSessionId}/recover`)
        .set('X-API-Key', validApiKey)
        .send({
          resume_from_task_id: createdTaskId,
        })
        .expect(200);

      expect(response.body.current_task_id).toBe(createdTaskId);
      expect(response.body.status).toBe(SessionStatus.ACTIVE);
    });

    it('should return 404 for non-existent task', async () => {
      const fakeTaskId = '550e8400-e29b-41d4-a716-446655440000';
      await request(app.getHttpServer())
        .post(`/sessions/${createdSessionId}/recover`)
        .set('X-API-Key', validApiKey)
        .send({
          resume_from_task_id: fakeTaskId,
        })
        .expect(404);
    });

    it('should return 404 for non-existent session', async () => {
      const fakeId = '550e8400-e29b-41d4-a716-446655440000';
      await request(app.getHttpServer())
        .post(`/sessions/${fakeId}/recover`)
        .set('X-API-Key', validApiKey)
        .send({})
        .expect(404);
    });

    it('should return 401 without authentication', async () => {
      await request(app.getHttpServer())
        .post(`/sessions/${createdSessionId}/recover`)
        .send({})
        .expect(401);
    });
  });

  describe('GET /sessions/:id/recovery-history', () => {
    beforeEach(async () => {
      // Create recovery history by recovering multiple times
      await request(app.getHttpServer())
        .post(`/sessions/${createdSessionId}/mark-failed`)
        .set('X-API-Key', validApiKey)
        .send({ reason: 'Test failure 1' });

      await request(app.getHttpServer())
        .post(`/sessions/${createdSessionId}/recover`)
        .set('X-API-Key', validApiKey)
        .send({});
    });

    it('should return recovery history for a session', async () => {
      const response = await request(app.getHttpServer())
        .get(`/sessions/${createdSessionId}/recovery-history`)
        .set('X-API-Key', validApiKey)
        .expect(200);

      expect(response.body).toHaveProperty('session_id', createdSessionId);
      expect(response.body).toHaveProperty('total_attempts');
      expect(response.body).toHaveProperty('successful_attempts');
      expect(response.body).toHaveProperty('failed_attempts');
      expect(response.body).toHaveProperty('attempts');
      expect(response.body).toHaveProperty('current_status');
      expect(Array.isArray(response.body.attempts)).toBe(true);
    });

    it('should show multiple recovery attempts', async () => {
      // Create another recovery attempt
      await request(app.getHttpServer())
        .post(`/sessions/${createdSessionId}/mark-failed`)
        .set('X-API-Key', validApiKey)
        .send({ reason: 'Test failure 2' });

      await request(app.getHttpServer())
        .post(`/sessions/${createdSessionId}/recover`)
        .set('X-API-Key', validApiKey)
        .send({ new_machine_id: 'machine-3' });

      const response = await request(app.getHttpServer())
        .get(`/sessions/${createdSessionId}/recovery-history`)
        .set('X-API-Key', validApiKey)
        .expect(200);

      expect(response.body.total_attempts).toBeGreaterThanOrEqual(2);
      expect(response.body.attempts.length).toBeGreaterThanOrEqual(2);
    });

    it('should return 404 for non-existent session', async () => {
      const fakeId = '550e8400-e29b-41d4-a716-446655440000';
      await request(app.getHttpServer())
        .get(`/sessions/${fakeId}/recovery-history`)
        .set('X-API-Key', validApiKey)
        .expect(404);
    });

    it('should return 401 without authentication', async () => {
      await request(app.getHttpServer())
        .get(`/sessions/${createdSessionId}/recovery-history`)
        .expect(401);
    });
  });

  describe('GET /sessions/recoverable', () => {
    let failedSessionId: string;
    let stalledSessionId: string;

    beforeAll(async () => {
      // Create a failed session
      const failedSession = await request(app.getHttpServer())
        .post('/sessions')
        .set('X-API-Key', validApiKey)
        .send({
          project_id: 'recovery-test-project',
          machine_id: 'machine-failed',
        });
      failedSessionId = failedSession.body.session_id;

      await request(app.getHttpServer())
        .post(`/sessions/${failedSessionId}/mark-failed`)
        .set('X-API-Key', validApiKey)
        .send({ reason: 'Test failure' });

      // Create a stalled session
      const stalledSession = await request(app.getHttpServer())
        .post('/sessions')
        .set('X-API-Key', validApiKey)
        .send({
          project_id: 'recovery-test-project',
          machine_id: 'machine-stalled',
        });
      stalledSessionId = stalledSession.body.session_id;

      await request(app.getHttpServer())
        .post(`/sessions/${stalledSessionId}/mark-stalled`)
        .set('X-API-Key', validApiKey)
        .send({ reason: 'Test stall' });
    });

    afterAll(async () => {
      // Cleanup
      try {
        await request(app.getHttpServer())
          .delete(`/sessions/${failedSessionId}/purge`)
          .set('X-API-Key', validApiKey)
          .send({ confirm: true });
        await request(app.getHttpServer())
          .delete(`/sessions/${stalledSessionId}/purge`)
          .set('X-API-Key', validApiKey)
          .send({ confirm: true });
      } catch (e) {
        // Ignore cleanup errors
      }
    });

    it('should return recoverable sessions', async () => {
      const response = await request(app.getHttpServer())
        .get('/sessions/recoverable')
        .set('X-API-Key', validApiKey)
        .expect(200);

      expect(Array.isArray(response.body)).toBe(true);
      expect(response.body.length).toBeGreaterThan(0);

      // Check that each session has required fields
      response.body.forEach((session: any) => {
        expect(session).toHaveProperty('session_id');
        expect(session).toHaveProperty('project_id');
        expect(session).toHaveProperty('status');
        expect(session).toHaveProperty('recovery_attempts');
        expect(session).toHaveProperty('can_recover');
        expect(session).toHaveProperty('minutes_since_heartbeat');
      });
    });

    it('should filter by project_id', async () => {
      const response = await request(app.getHttpServer())
        .get('/sessions/recoverable')
        .query({ project_id: 'recovery-test-project' })
        .set('X-API-Key', validApiKey)
        .expect(200);

      expect(Array.isArray(response.body)).toBe(true);
      if (response.body.length > 0) {
        response.body.forEach((session: any) => {
          expect(session.project_id).toBe('recovery-test-project');
        });
      }
    });

    it('should filter by machine_id', async () => {
      const response = await request(app.getHttpServer())
        .get('/sessions/recoverable')
        .query({ machine_id: 'machine-failed' })
        .set('X-API-Key', validApiKey)
        .expect(200);

      expect(Array.isArray(response.body)).toBe(true);
      if (response.body.length > 0) {
        response.body.forEach((session: any) => {
          expect(session.machine_id).toBe('machine-failed');
        });
      }
    });

    it('should return 401 without authentication', async () => {
      await request(app.getHttpServer())
        .get('/sessions/recoverable')
        .expect(401);
    });
  });

  describe('Recovery Attempt Limits', () => {
    let limitTestSessionId: string;

    beforeAll(async () => {
      const response = await request(app.getHttpServer())
        .post('/sessions')
        .set('X-API-Key', validApiKey)
        .send({
          project_id: 'limit-test-project',
          machine_id: 'machine-limit',
        });
      limitTestSessionId = response.body.session_id;
    });

    afterAll(async () => {
      try {
        await request(app.getHttpServer())
          .delete(`/sessions/${limitTestSessionId}/purge`)
          .set('X-API-Key', validApiKey)
          .send({ confirm: true });
      } catch (e) {
        // Ignore cleanup errors
      }
    });

    it('should enforce maximum recovery attempts limit', async () => {
      // Attempt recovery 3 times (the maximum)
      for (let i = 0; i < 3; i++) {
        await request(app.getHttpServer())
          .post(`/sessions/${limitTestSessionId}/mark-failed`)
          .set('X-API-Key', validApiKey)
          .send({ reason: `Test failure ${i + 1}` });

        await request(app.getHttpServer())
          .post(`/sessions/${limitTestSessionId}/recover`)
          .set('X-API-Key', validApiKey)
          .send({})
          .expect(200);
      }

      // Fourth attempt should fail
      await request(app.getHttpServer())
        .post(`/sessions/${limitTestSessionId}/mark-failed`)
        .set('X-API-Key', validApiKey)
        .send({ reason: 'Test failure 4' });

      await request(app.getHttpServer())
        .post(`/sessions/${limitTestSessionId}/recover`)
        .set('X-API-Key', validApiKey)
        .send({})
        .expect(400);
    });
  });
});
