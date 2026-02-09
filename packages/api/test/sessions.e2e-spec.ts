import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { LoggingModule } from '../src/common/logging/logging.module';
import { SessionStatus } from '../src/schemas/session.schema';

describe('Sessions CRUD Endpoints (e2e)', () => {
  let app: INestApplication;
  const validApiKey = 'test-valid-api-key-12345678';
  let createdSessionId: string;

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
  });

  afterAll(async () => {
    // Clean up created session
    if (createdSessionId) {
      await request(app.getHttpServer())
        .delete(`/sessions/${createdSessionId}`)
        .set('X-API-Key', validApiKey);
    }
    await app.close();
  });

  describe('POST /sessions - Create Session', () => {
    it('should create a new session with valid data', async () => {
      const createDto = {
        project_id: '123',
        machine_id: 'test-machine-e2e',
        docker_slot: 1,
        metadata: {
          vscode_version: '1.85.0',
          extension_version: '0.1.0',
        },
      };

      const response = await request(app.getHttpServer())
        .post('/sessions')
        .set('X-API-Key', validApiKey)
        .send(createDto)
        .expect(201);

      expect(response.body).toHaveProperty('session_id');
      expect(response.body.project_id).toBe(createDto.project_id);
      expect(response.body.machine_id).toBe(createDto.machine_id);
      expect(response.body.docker_slot).toBe(createDto.docker_slot);
      expect(response.body.status).toBe(SessionStatus.ACTIVE);
      expect(response.body).toHaveProperty('started_at');
      expect(response.body).toHaveProperty('last_heartbeat');
      expect(response.body.metadata).toEqual(createDto.metadata);

      // Save for cleanup and further tests
      createdSessionId = response.body.session_id;
    });

    it('should create a session without optional fields', async () => {
      const createDto = {
        project_id: '456',
        machine_id: 'test-machine-minimal',
      };

      const response = await request(app.getHttpServer())
        .post('/sessions')
        .set('X-API-Key', validApiKey)
        .send(createDto)
        .expect(201);

      expect(response.body).toHaveProperty('session_id');
      expect(response.body.project_id).toBe(createDto.project_id);
      expect(response.body.machine_id).toBe(createDto.machine_id);
      expect(response.body.metadata).toEqual({});

      // Clean up
      await request(app.getHttpServer())
        .delete(`/sessions/${response.body.session_id}`)
        .set('X-API-Key', validApiKey);
    });

    it('should return 400 for missing required fields', async () => {
      const invalidDto = {
        project_id: '123',
        // missing machine_id
      };

      const response = await request(app.getHttpServer())
        .post('/sessions')
        .set('X-API-Key', validApiKey)
        .send(invalidDto)
        .expect(400);

      expect(response.body).toHaveProperty('message');
      expect(Array.isArray(response.body.message)).toBe(true);
    });

    it('should return 400 for invalid data types', async () => {
      const invalidDto = {
        project_id: '123',
        machine_id: 'test-machine',
        docker_slot: 'not-a-number', // should be number
      };

      const response = await request(app.getHttpServer())
        .post('/sessions')
        .set('X-API-Key', validApiKey)
        .send(invalidDto)
        .expect(400);

      expect(response.body).toHaveProperty('message');
    });

    it('should return 401 without authentication', async () => {
      const createDto = {
        project_id: '123',
        machine_id: 'test-machine',
      };

      await request(app.getHttpServer())
        .post('/sessions')
        .send(createDto)
        .expect(401);
    });
  });

  describe('GET /sessions - List Sessions', () => {
    it('should return all sessions', async () => {
      const response = await request(app.getHttpServer())
        .get('/sessions')
        .set('X-API-Key', validApiKey)
        .expect(200);

      expect(Array.isArray(response.body)).toBe(true);
      expect(response.body.length).toBeGreaterThan(0);
    });

    it('should filter sessions by status', async () => {
      const response = await request(app.getHttpServer())
        .get('/sessions')
        .query({ status: SessionStatus.ACTIVE })
        .set('X-API-Key', validApiKey)
        .expect(200);

      expect(Array.isArray(response.body)).toBe(true);
      response.body.forEach((session: any) => {
        expect(session.status).toBe(SessionStatus.ACTIVE);
      });
    });

    it('should filter sessions by project_id', async () => {
      const response = await request(app.getHttpServer())
        .get('/sessions')
        .query({ project_id: '123' })
        .set('X-API-Key', validApiKey)
        .expect(200);

      expect(Array.isArray(response.body)).toBe(true);
      if (response.body.length > 0) {
        response.body.forEach((session: any) => {
          expect(session.project_id).toBe('123');
        });
      }
    });

    it('should filter sessions by machine_id', async () => {
      const response = await request(app.getHttpServer())
        .get('/sessions')
        .query({ machine_id: 'test-machine-e2e' })
        .set('X-API-Key', validApiKey)
        .expect(200);

      expect(Array.isArray(response.body)).toBe(true);
      if (response.body.length > 0) {
        response.body.forEach((session: any) => {
          expect(session.machine_id).toBe('test-machine-e2e');
        });
      }
    });

    it('should apply pagination with limit and offset', async () => {
      const response = await request(app.getHttpServer())
        .get('/sessions')
        .query({ limit: 5, offset: 0 })
        .set('X-API-Key', validApiKey)
        .expect(200);

      expect(Array.isArray(response.body)).toBe(true);
      expect(response.body.length).toBeLessThanOrEqual(5);
    });

    it('should return 401 without authentication', async () => {
      await request(app.getHttpServer())
        .get('/sessions')
        .expect(401);
    });
  });

  describe('GET /sessions/:id - Get Session by ID', () => {
    it('should return a specific session', async () => {
      const response = await request(app.getHttpServer())
        .get(`/sessions/${createdSessionId}`)
        .set('X-API-Key', validApiKey)
        .expect(200);

      expect(response.body.session_id).toBe(createdSessionId);
      expect(response.body).toHaveProperty('project_id');
      expect(response.body).toHaveProperty('machine_id');
      expect(response.body).toHaveProperty('status');
    });

    it('should return 404 for non-existent session', async () => {
      const fakeId = '550e8400-e29b-41d4-a716-446655440000';
      const response = await request(app.getHttpServer())
        .get(`/sessions/${fakeId}`)
        .set('X-API-Key', validApiKey)
        .expect(404);

      expect(response.body).toHaveProperty('message');
      expect(response.body.message).toContain('not found');
    });

    it('should return 401 without authentication', async () => {
      await request(app.getHttpServer())
        .get(`/sessions/${createdSessionId}`)
        .expect(401);
    });
  });

  describe('PUT /sessions/:id - Update Session', () => {
    it('should update session status', async () => {
      const updateDto = {
        status: SessionStatus.PAUSED,
      };

      const response = await request(app.getHttpServer())
        .put(`/sessions/${createdSessionId}`)
        .set('X-API-Key', validApiKey)
        .send(updateDto)
        .expect(200);

      expect(response.body.session_id).toBe(createdSessionId);
      expect(response.body.status).toBe(SessionStatus.PAUSED);
    });

    it('should update current_task_id', async () => {
      const updateDto = {
        current_task_id: 'task-uuid-123',
      };

      const response = await request(app.getHttpServer())
        .put(`/sessions/${createdSessionId}`)
        .set('X-API-Key', validApiKey)
        .send(updateDto)
        .expect(200);

      expect(response.body.current_task_id).toBe(updateDto.current_task_id);
    });

    it('should merge metadata when updating', async () => {
      const updateDto = {
        metadata: {
          new_field: 'new_value',
        },
      };

      const response = await request(app.getHttpServer())
        .put(`/sessions/${createdSessionId}`)
        .set('X-API-Key', validApiKey)
        .send(updateDto)
        .expect(200);

      expect(response.body.metadata).toHaveProperty('vscode_version', '1.85.0');
      expect(response.body.metadata).toHaveProperty('new_field', 'new_value');
    });

    it('should update docker_slot', async () => {
      const updateDto = {
        docker_slot: 2,
      };

      const response = await request(app.getHttpServer())
        .put(`/sessions/${createdSessionId}`)
        .set('X-API-Key', validApiKey)
        .send(updateDto)
        .expect(200);

      expect(response.body.docker_slot).toBe(2);
    });

    it('should return 404 for non-existent session', async () => {
      const fakeId = '550e8400-e29b-41d4-a716-446655440000';
      const updateDto = {
        status: SessionStatus.PAUSED,
      };

      const response = await request(app.getHttpServer())
        .put(`/sessions/${fakeId}`)
        .set('X-API-Key', validApiKey)
        .send(updateDto)
        .expect(404);

      expect(response.body).toHaveProperty('message');
    });

    it('should return 400 for invalid status value', async () => {
      const updateDto = {
        status: 'invalid-status',
      };

      await request(app.getHttpServer())
        .put(`/sessions/${createdSessionId}`)
        .set('X-API-Key', validApiKey)
        .send(updateDto)
        .expect(400);
    });

    it('should return 401 without authentication', async () => {
      const updateDto = {
        status: SessionStatus.PAUSED,
      };

      await request(app.getHttpServer())
        .put(`/sessions/${createdSessionId}`)
        .send(updateDto)
        .expect(401);
    });
  });

  describe('DELETE /sessions/:id - Delete Session (Soft Delete)', () => {
    it('should soft delete a session', async () => {
      await request(app.getHttpServer())
        .delete(`/sessions/${createdSessionId}`)
        .set('X-API-Key', validApiKey)
        .expect(204);

      // Verify the session still exists but is marked as completed
      const response = await request(app.getHttpServer())
        .get(`/sessions/${createdSessionId}`)
        .set('X-API-Key', validApiKey)
        .expect(200);

      expect(response.body.status).toBe(SessionStatus.COMPLETED);
      expect(response.body).toHaveProperty('completed_at');
    });

    it('should return 404 for non-existent session', async () => {
      const fakeId = '550e8400-e29b-41d4-a716-446655440000';
      const response = await request(app.getHttpServer())
        .delete(`/sessions/${fakeId}`)
        .set('X-API-Key', validApiKey)
        .expect(404);

      expect(response.body).toHaveProperty('message');
    });

    it('should return 401 without authentication', async () => {
      await request(app.getHttpServer())
        .delete(`/sessions/${createdSessionId}`)
        .expect(401);
    });
  });

  describe('Query Parameter Validation', () => {
    it('should reject invalid limit value (too high)', async () => {
      await request(app.getHttpServer())
        .get('/sessions')
        .query({ limit: 200 }) // Max is 100
        .set('X-API-Key', validApiKey)
        .expect(400);
    });

    it('should reject invalid limit value (negative)', async () => {
      await request(app.getHttpServer())
        .get('/sessions')
        .query({ limit: -1 })
        .set('X-API-Key', validApiKey)
        .expect(400);
    });

    it('should reject invalid offset value (negative)', async () => {
      await request(app.getHttpServer())
        .get('/sessions')
        .query({ offset: -1 })
        .set('X-API-Key', validApiKey)
        .expect(400);
    });

    it('should reject invalid status enum value', async () => {
      await request(app.getHttpServer())
        .get('/sessions')
        .query({ status: 'invalid-status' })
        .set('X-API-Key', validApiKey)
        .expect(400);
    });
  });
});
