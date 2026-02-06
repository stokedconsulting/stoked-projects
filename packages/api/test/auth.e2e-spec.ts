import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { LoggingModule } from '../src/common/logging/logging.module';

describe('Authentication (e2e)', () => {
  let app: INestApplication;
  const validApiKey = 'test-valid-api-key-12345678';
  const invalidApiKey = 'test-invalid-api-key';

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
    await app.close();
  });

  describe('Health endpoints (no auth required)', () => {
    it('GET /health should return 200 without authentication', async () => {
      const response = await request(app.getHttpServer())
        .get('/health')
        .expect(200);

      expect(response.body).toHaveProperty('status', 'ok');
    });

    it('GET /health/ready should return 200 without authentication', async () => {
      const response = await request(app.getHttpServer())
        .get('/health/ready')
        .expect(200);

      expect(response.body).toHaveProperty('ready');
    });
  });

  describe('Protected endpoints - Sessions', () => {
    it('GET /sessions should return 401 without API key', async () => {
      const response = await request(app.getHttpServer())
        .get('/sessions')
        .expect(401);

      expect(response.body).toHaveProperty('message', 'API key is missing');
    });

    it('GET /sessions should return 401 with invalid API key', async () => {
      const response = await request(app.getHttpServer())
        .get('/sessions')
        .set('X-API-Key', invalidApiKey)
        .expect(401);

      expect(response.body).toHaveProperty('message', 'Invalid API key');
    });

    it('GET /sessions should return 200 with valid API key in X-API-Key header', async () => {
      await request(app.getHttpServer())
        .get('/sessions')
        .set('X-API-Key', validApiKey)
        .expect(200);
    });

    it('GET /sessions should return 200 with valid API key in Authorization header', async () => {
      await request(app.getHttpServer())
        .get('/sessions')
        .set('Authorization', `Bearer ${validApiKey}`)
        .expect(200);
    });

    it('POST /sessions should require authentication', async () => {
      await request(app.getHttpServer())
        .post('/sessions')
        .send({ session_id: 'test-session' })
        .expect(401);
    });

    it('POST /sessions should work with valid API key', async () => {
      const response = await request(app.getHttpServer())
        .post('/sessions')
        .set('X-API-Key', validApiKey)
        .send({
          session_id: 'auth-test-session',
          project_id: 1,
          status: 'active',
        });

      // May return 201 if valid or 400 if validation fails
      expect([201, 400]).toContain(response.status);
    });
  });

  describe('Protected endpoints - Tasks', () => {
    it('GET /tasks should return 401 without API key', async () => {
      await request(app.getHttpServer())
        .get('/tasks')
        .expect(401);
    });

    it('GET /tasks should return 200 with valid API key', async () => {
      await request(app.getHttpServer())
        .get('/tasks')
        .set('X-API-Key', validApiKey)
        .expect(200);
    });

    it('POST /tasks should require authentication', async () => {
      await request(app.getHttpServer())
        .post('/tasks')
        .send({ task_id: 'test-task' })
        .expect(401);
    });
  });

  describe('Protected endpoints - Machines', () => {
    it('GET /machines should return 401 without API key', async () => {
      await request(app.getHttpServer())
        .get('/machines')
        .expect(401);
    });

    it('GET /machines should return 200 with valid API key', async () => {
      await request(app.getHttpServer())
        .get('/machines')
        .set('X-API-Key', validApiKey)
        .expect(200);
    });

    it('POST /machines should require authentication', async () => {
      await request(app.getHttpServer())
        .post('/machines')
        .send({ machine_id: 'test-machine' })
        .expect(401);
    });
  });

  describe('Header format support', () => {
    it('should accept X-API-Key header (lowercase)', async () => {
      await request(app.getHttpServer())
        .get('/sessions')
        .set('x-api-key', validApiKey)
        .expect(200);
    });

    it('should accept Authorization: Bearer header', async () => {
      await request(app.getHttpServer())
        .get('/sessions')
        .set('Authorization', `Bearer ${validApiKey}`)
        .expect(200);
    });

    it('should reject malformed Authorization header', async () => {
      const response = await request(app.getHttpServer())
        .get('/sessions')
        .set('Authorization', validApiKey) // Missing "Bearer " prefix
        .expect(401);

      expect(response.body).toHaveProperty('message', 'API key is missing');
    });

    it('should reject empty Authorization header', async () => {
      await request(app.getHttpServer())
        .get('/sessions')
        .set('Authorization', '')
        .expect(401);
    });
  });

  describe('Error messages', () => {
    it('should return clear error for missing key', async () => {
      const response = await request(app.getHttpServer())
        .get('/sessions')
        .expect(401);

      expect(response.body).toMatchObject({
        statusCode: 401,
        message: 'API key is missing',
        error: 'Unauthorized',
      });
    });

    it('should return clear error for invalid key', async () => {
      const response = await request(app.getHttpServer())
        .get('/sessions')
        .set('X-API-Key', 'definitely-not-valid')
        .expect(401);

      expect(response.body).toMatchObject({
        statusCode: 401,
        message: 'Invalid API key',
        error: 'Unauthorized',
      });
    });
  });
});
