import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, HttpStatus } from '@nestjs/common';
import request from 'supertest';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { MongooseModule } from '@nestjs/mongoose';
import { ConfigModule } from '@nestjs/config';
import { SessionsModule } from '../src/modules/sessions/sessions.module';
import { MachinesModule } from '../src/modules/machines/machines.module';
import { AuthModule } from '../src/modules/auth/auth.module';
import { LoggingModule } from '../src/common/logging/logging.module';
import { SessionStatus } from '../src/schemas/session.schema';
import { MachineStatus } from '../src/schemas/machine.schema';

describe('Heartbeat Endpoints (e2e)', () => {
  let app: INestApplication;
  let mongoServer: MongoMemoryServer;
  const API_KEY = 'test-api-key-123';

  beforeAll(async () => {
    mongoServer = await MongoMemoryServer.create();
    const mongoUri = mongoServer.getUri();

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          load: [
            () => ({
              apiKey: API_KEY,
            }),
          ],
        }),
        LoggingModule,
        MongooseModule.forRoot(mongoUri),
        SessionsModule,
        MachinesModule,
        AuthModule,
      ],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
    await mongoServer.stop();
  });

  describe('POST /sessions/:id/heartbeat', () => {
    let sessionId: string;

    beforeEach(async () => {
      // Create a test session
      const response = await request(app.getHttpServer())
        .post('/sessions')
        .set('x-api-key', API_KEY)
        .send({
          project_id: 'test-project',
          machine_id: 'test-machine',
        });

      sessionId = response.body.session_id;
    });

    it('should update heartbeat for active session', async () => {
      const response = await request(app.getHttpServer())
        .post(`/sessions/${sessionId}/heartbeat`)
        .set('x-api-key', API_KEY)
        .expect(HttpStatus.OK);

      expect(response.body).toHaveProperty('session_id', sessionId);
      expect(response.body).toHaveProperty('status', SessionStatus.ACTIVE);
      expect(response.body).toHaveProperty('last_heartbeat');
      expect(response.body).toHaveProperty('message');
    });

    it('should reactivate stalled session', async () => {
      // Manually update session to stalled
      await request(app.getHttpServer())
        .put(`/sessions/${sessionId}`)
        .set('x-api-key', API_KEY)
        .send({
          status: SessionStatus.STALLED,
        });

      // Update heartbeat to reactivate
      const response = await request(app.getHttpServer())
        .post(`/sessions/${sessionId}/heartbeat`)
        .set('x-api-key', API_KEY)
        .expect(HttpStatus.OK);

      expect(response.body.status).toBe(SessionStatus.ACTIVE);
      expect(response.body.message).toContain('reactivated');
    });

    it('should return 404 for non-existent session', async () => {
      await request(app.getHttpServer())
        .post('/sessions/non-existent-id/heartbeat')
        .set('x-api-key', API_KEY)
        .expect(HttpStatus.NOT_FOUND);
    });

    it('should return 400 for completed session', async () => {
      // Mark session as completed
      await request(app.getHttpServer())
        .put(`/sessions/${sessionId}`)
        .set('x-api-key', API_KEY)
        .send({
          status: SessionStatus.COMPLETED,
          completed_at: new Date(),
        });

      await request(app.getHttpServer())
        .post(`/sessions/${sessionId}/heartbeat`)
        .set('x-api-key', API_KEY)
        .expect(HttpStatus.BAD_REQUEST);
    });

    it('should return 400 for failed session', async () => {
      // Mark session as failed
      await request(app.getHttpServer())
        .put(`/sessions/${sessionId}`)
        .set('x-api-key', API_KEY)
        .send({
          status: SessionStatus.FAILED,
          completed_at: new Date(),
        });

      await request(app.getHttpServer())
        .post(`/sessions/${sessionId}/heartbeat`)
        .set('x-api-key', API_KEY)
        .expect(HttpStatus.BAD_REQUEST);
    });

    it('should require API key', async () => {
      await request(app.getHttpServer())
        .post(`/sessions/${sessionId}/heartbeat`)
        .expect(HttpStatus.UNAUTHORIZED);
    });
  });

  describe('POST /machines/:id/heartbeat', () => {
    let machineId: string;

    beforeEach(async () => {
      // Create a test machine
      machineId = 'test-machine-' + Date.now();
      await request(app.getHttpServer())
        .post('/machines')
        .set('x-api-key', API_KEY)
        .send({
          machine_id: machineId,
          hostname: 'test-host',
          docker_slots: [1, 2, 3],
          metadata: {},
        });
    });

    it('should update heartbeat for online machine', async () => {
      const response = await request(app.getHttpServer())
        .post(`/machines/${machineId}/heartbeat`)
        .set('x-api-key', API_KEY)
        .expect(HttpStatus.OK);

      expect(response.body).toHaveProperty('machine_id', machineId);
      expect(response.body).toHaveProperty('status', MachineStatus.ONLINE);
      expect(response.body).toHaveProperty('last_heartbeat');
      expect(response.body).toHaveProperty('message');
    });

    it('should bring offline machine back online', async () => {
      // Manually update machine to offline
      await request(app.getHttpServer())
        .put(`/machines/${machineId}`)
        .set('x-api-key', API_KEY)
        .send({
          status: MachineStatus.OFFLINE,
        });

      // Update heartbeat to bring back online
      const response = await request(app.getHttpServer())
        .post(`/machines/${machineId}/heartbeat`)
        .set('x-api-key', API_KEY)
        .expect(HttpStatus.OK);

      expect(response.body.status).toBe(MachineStatus.ONLINE);
      expect(response.body.message).toContain('online');
    });

    it('should return 404 for non-existent machine', async () => {
      await request(app.getHttpServer())
        .post('/machines/non-existent-id/heartbeat')
        .set('x-api-key', API_KEY)
        .expect(HttpStatus.NOT_FOUND);
    });

    it('should require API key', async () => {
      await request(app.getHttpServer())
        .post(`/machines/${machineId}/heartbeat`)
        .expect(HttpStatus.UNAUTHORIZED);
    });

    it('should not change maintenance status', async () => {
      // Set machine to maintenance
      await request(app.getHttpServer())
        .put(`/machines/${machineId}`)
        .set('x-api-key', API_KEY)
        .send({
          status: MachineStatus.MAINTENANCE,
        });

      // Update heartbeat
      const response = await request(app.getHttpServer())
        .post(`/machines/${machineId}/heartbeat`)
        .set('x-api-key', API_KEY)
        .expect(HttpStatus.OK);

      // Status should still be maintenance
      expect(response.body.status).toBe(MachineStatus.MAINTENANCE);
    });
  });

  describe('Stale Session Detection', () => {
    it('should detect sessions with old heartbeat', async () => {
      // Create a session
      const response = await request(app.getHttpServer())
        .post('/sessions')
        .set('x-api-key', API_KEY)
        .send({
          project_id: 'test-project',
          machine_id: 'test-machine',
        });

      const sessionId = response.body.session_id;

      // Manually set old heartbeat (older than 5 minutes)
      const oldHeartbeat = new Date(Date.now() - 6 * 60 * 1000);
      await request(app.getHttpServer())
        .put(`/sessions/${sessionId}`)
        .set('x-api-key', API_KEY)
        .send({
          last_heartbeat: oldHeartbeat,
        });

      // Check stale sessions
      const staleResponse = await request(app.getHttpServer())
        .get('/sessions/stale')
        .set('x-api-key', API_KEY)
        .expect(HttpStatus.OK);

      expect(staleResponse.body).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            session_id: sessionId,
          }),
        ])
      );
    });
  });
});
