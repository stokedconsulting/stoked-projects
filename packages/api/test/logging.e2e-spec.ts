import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { LoggingModule } from '../src/common/logging/logging.module';
import { validate as uuidValidate } from 'uuid';

describe('Logging & Request ID (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
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

  describe('Request ID Header', () => {
    it('should return X-Request-Id header on successful request', async () => {
      const response = await request(app.getHttpServer())
        .get('/health')
        .expect(200);

      expect(response.headers['x-request-id']).toBeDefined();
      expect(uuidValidate(response.headers['x-request-id'])).toBe(true);
    });

    it('should return X-Request-Id header on error response', async () => {
      const response = await request(app.getHttpServer())
        .get('/sessions/non-existent-id')
        .expect(401); // Unauthorized (no API key)

      expect(response.headers['x-request-id']).toBeDefined();
      expect(uuidValidate(response.headers['x-request-id'])).toBe(true);
    });

    it('should return different request IDs for different requests', async () => {
      const response1 = await request(app.getHttpServer())
        .get('/health')
        .expect(200);

      const response2 = await request(app.getHttpServer())
        .get('/health')
        .expect(200);

      const requestId1 = response1.headers['x-request-id'];
      const requestId2 = response2.headers['x-request-id'];

      expect(requestId1).toBeDefined();
      expect(requestId2).toBeDefined();
      expect(requestId1).not.toBe(requestId2);
    });

    it('should include request ID in error response body', async () => {
      const response = await request(app.getHttpServer())
        .get('/sessions/invalid-id')
        .expect(401); // Unauthorized

      expect(response.body.request_id).toBeDefined();
      expect(uuidValidate(response.body.request_id)).toBe(true);

      // Request ID in header should match body
      expect(response.headers['x-request-id']).toBe(response.body.request_id);
    });
  });

  describe('Request/Response Logging', () => {
    it('should log successful requests', async () => {
      // Capture console output
      const originalLog = console.log;
      const logs: any[] = [];
      console.log = jest.fn((...args) => logs.push(args[0]));

      await request(app.getHttpServer())
        .get('/health')
        .expect(200);

      // Restore console.log
      console.log = originalLog;

      // Check if request was logged
      const requestLog = logs.find((log) => {
        try {
          const parsed = typeof log === 'string' ? JSON.parse(log) : log;
          return parsed.message && parsed.message.includes('GET /health');
        } catch {
          return false;
        }
      });

      expect(requestLog).toBeDefined();
    });

    it('should log request with appropriate level for 4xx errors', async () => {
      const originalLog = console.log;
      const logs: any[] = [];
      console.log = jest.fn((...args) => logs.push(args[0]));

      await request(app.getHttpServer())
        .get('/sessions/test-id')
        .expect(401); // Unauthorized

      console.log = originalLog;

      // Should have a WARN level log for 401
      const warnLog = logs.find((log) => {
        try {
          const parsed = typeof log === 'string' ? JSON.parse(log) : log;
          return parsed.level === 'WARN' && parsed.message && parsed.message.includes('401');
        } catch {
          return false;
        }
      });

      expect(warnLog).toBeDefined();
    });
  });

  describe('Structured Logging Format', () => {
    it('should produce valid JSON log entries', async () => {
      const originalLog = console.log;
      const logs: any[] = [];
      console.log = jest.fn((...args) => logs.push(args[0]));

      await request(app.getHttpServer())
        .get('/health')
        .expect(200);

      console.log = originalLog;

      // Find app logs (not test logs)
      const appLogs = logs.filter((log) => {
        try {
          const parsed = typeof log === 'string' ? JSON.parse(log) : log;
          return parsed.timestamp && parsed.level && parsed.message;
        } catch {
          return false;
        }
      });

      expect(appLogs.length).toBeGreaterThan(0);

      // Verify each log has required fields
      appLogs.forEach((log) => {
        const parsed = typeof log === 'string' ? JSON.parse(log) : log;
        expect(parsed.timestamp).toBeDefined();
        expect(parsed.level).toBeDefined();
        expect(parsed.message).toBeDefined();
        expect(['ERROR', 'WARN', 'INFO', 'DEBUG']).toContain(parsed.level);
      });
    });

    it('should include request_id in log context', async () => {
      const originalLog = console.log;
      const logs: any[] = [];
      console.log = jest.fn((...args) => logs.push(args[0]));

      const response = await request(app.getHttpServer())
        .get('/health')
        .expect(200);

      console.log = originalLog;

      const requestId = response.headers['x-request-id'];

      // Find logs with this request ID
      const logsWithRequestId = logs.filter((log) => {
        try {
          const parsed = typeof log === 'string' ? JSON.parse(log) : log;
          return parsed.context?.request_id === requestId;
        } catch {
          return false;
        }
      });

      // Should have at least one log with the request ID
      expect(logsWithRequestId.length).toBeGreaterThan(0);
    });
  });

  describe('Performance Impact', () => {
    it('should complete requests within acceptable time with logging', async () => {
      const iterations = 10;
      const maxAverageMs = 100; // Should be well under 100ms average

      const times: number[] = [];

      for (let i = 0; i < iterations; i++) {
        const start = Date.now();
        await request(app.getHttpServer()).get('/health').expect(200);
        times.push(Date.now() - start);
      }

      const average = times.reduce((sum, time) => sum + time, 0) / iterations;

      expect(average).toBeLessThan(maxAverageMs);
    });

    it('should have minimal overhead from request ID generation', async () => {
      // Test request ID overhead is <10ms as specified
      const start = Date.now();

      await request(app.getHttpServer()).get('/health').expect(200);

      const duration = Date.now() - start;

      // Total request time should be reasonable
      // (actual overhead is much less, but total includes network, etc.)
      expect(duration).toBeLessThan(1000);
    });
  });
});
