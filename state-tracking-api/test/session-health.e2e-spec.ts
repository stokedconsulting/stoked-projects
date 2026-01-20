import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { LoggingModule } from '../src/common/logging/logging.module';
import { getModelToken } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Session, SessionDocument, SessionStatus } from '../src/schemas/session.schema';
import { Machine, MachineDocument, MachineStatus } from '../src/schemas/machine.schema';

describe('Session Health Endpoints (e2e)', () => {
  let app: INestApplication;
  let sessionModel: Model<SessionDocument>;
  let machineModel: Model<MachineDocument>;
  const validApiKey = 'test-valid-api-key-12345678';

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

    sessionModel = moduleFixture.get<Model<SessionDocument>>(getModelToken(Session.name));
    machineModel = moduleFixture.get<Model<MachineDocument>>(getModelToken(Machine.name));
  });

  beforeEach(async () => {
    // Clean up database before each test
    await sessionModel.deleteMany({});
    await machineModel.deleteMany({});
  });

  afterAll(async () => {
    await sessionModel.deleteMany({});
    await machineModel.deleteMany({});
    await app.close();
  });

  describe('GET /sessions/stale', () => {
    it('should return stale sessions with default threshold', async () => {
      const now = new Date();
      const staleHeartbeat = new Date(now.getTime() - 400 * 1000); // 400 seconds ago
      const recentHeartbeat = new Date(now.getTime() - 60 * 1000); // 1 minute ago

      // Create one stale session and one recent session
      await sessionModel.create({
        session_id: 'stale-session',
        project_id: 'project-1',
        machine_id: 'machine-1',
        status: SessionStatus.ACTIVE,
        last_heartbeat: staleHeartbeat,
        started_at: new Date(now.getTime() - 3600 * 1000),
      });

      await sessionModel.create({
        session_id: 'active-session',
        project_id: 'project-1',
        machine_id: 'machine-1',
        status: SessionStatus.ACTIVE,
        last_heartbeat: recentHeartbeat,
        started_at: now,
      });

      const response = await request(app.getHttpServer())
        .get('/sessions/stale')
        .set('X-API-Key', validApiKey)
        .expect(200);

      expect(response.body).toHaveLength(1);
      expect(response.body[0].session_id).toBe('stale-session');
      expect(response.body[0].time_since_heartbeat).toBeGreaterThan(300);
    });

    it('should accept custom threshold', async () => {
      const now = new Date();
      const heartbeat = new Date(now.getTime() - 400 * 1000);

      await sessionModel.create({
        session_id: 'session-1',
        project_id: 'project-1',
        machine_id: 'machine-1',
        status: SessionStatus.ACTIVE,
        last_heartbeat: heartbeat,
        started_at: now,
      });

      // With threshold=600, this session should not be stale
      const response = await request(app.getHttpServer())
        .get('/sessions/stale?threshold=600')
        .set('X-API-Key', validApiKey)
        .expect(200);

      expect(response.body).toHaveLength(0);
    });

    it('should require authentication', async () => {
      await request(app.getHttpServer())
        .get('/sessions/stale')
        .expect(401);
    });
  });

  describe('GET /sessions/active', () => {
    it('should return all active sessions', async () => {
      await sessionModel.create([
        {
          session_id: 'session-1',
          project_id: 'project-1',
          machine_id: 'machine-1',
          status: SessionStatus.ACTIVE,
          last_heartbeat: new Date(),
          started_at: new Date(),
        },
        {
          session_id: 'session-2',
          project_id: 'project-2',
          machine_id: 'machine-2',
          status: SessionStatus.ACTIVE,
          last_heartbeat: new Date(),
          started_at: new Date(),
        },
        {
          session_id: 'session-3',
          project_id: 'project-1',
          machine_id: 'machine-1',
          status: SessionStatus.COMPLETED,
          last_heartbeat: new Date(),
          started_at: new Date(),
          completed_at: new Date(),
        },
      ]);

      const response = await request(app.getHttpServer())
        .get('/sessions/active')
        .set('X-API-Key', validApiKey)
        .expect(200);

      expect(response.body).toHaveLength(2);
      expect(response.body.every((s: any) => s.status === SessionStatus.ACTIVE)).toBe(true);
    });

    it('should filter by project_id', async () => {
      await sessionModel.create([
        {
          session_id: 'session-1',
          project_id: 'project-1',
          machine_id: 'machine-1',
          status: SessionStatus.ACTIVE,
          last_heartbeat: new Date(),
          started_at: new Date(),
        },
        {
          session_id: 'session-2',
          project_id: 'project-2',
          machine_id: 'machine-1',
          status: SessionStatus.ACTIVE,
          last_heartbeat: new Date(),
          started_at: new Date(),
        },
      ]);

      const response = await request(app.getHttpServer())
        .get('/sessions/active?project_id=project-1')
        .set('X-API-Key', validApiKey)
        .expect(200);

      expect(response.body).toHaveLength(1);
      expect(response.body[0].project_id).toBe('project-1');
    });

    it('should filter by machine_id', async () => {
      await sessionModel.create([
        {
          session_id: 'session-1',
          project_id: 'project-1',
          machine_id: 'machine-1',
          status: SessionStatus.ACTIVE,
          last_heartbeat: new Date(),
          started_at: new Date(),
        },
        {
          session_id: 'session-2',
          project_id: 'project-1',
          machine_id: 'machine-2',
          status: SessionStatus.ACTIVE,
          last_heartbeat: new Date(),
          started_at: new Date(),
        },
      ]);

      const response = await request(app.getHttpServer())
        .get('/sessions/active?machine_id=machine-1')
        .set('X-API-Key', validApiKey)
        .expect(200);

      expect(response.body).toHaveLength(1);
      expect(response.body[0].machine_id).toBe('machine-1');
    });

    it('should require authentication', async () => {
      await request(app.getHttpServer())
        .get('/sessions/active')
        .expect(401);
    });
  });

  describe('GET /sessions/by-project/:projectId', () => {
    it('should return sessions grouped by status', async () => {
      await sessionModel.create([
        {
          session_id: 'session-1',
          project_id: 'project-1',
          machine_id: 'machine-1',
          status: SessionStatus.ACTIVE,
          last_heartbeat: new Date(),
          started_at: new Date(),
        },
        {
          session_id: 'session-2',
          project_id: 'project-1',
          machine_id: 'machine-1',
          status: SessionStatus.COMPLETED,
          last_heartbeat: new Date(),
          started_at: new Date(),
          completed_at: new Date(),
        },
        {
          session_id: 'session-3',
          project_id: 'project-1',
          machine_id: 'machine-1',
          status: SessionStatus.FAILED,
          last_heartbeat: new Date(),
          started_at: new Date(),
          completed_at: new Date(),
        },
        {
          session_id: 'session-4',
          project_id: 'project-2',
          machine_id: 'machine-1',
          status: SessionStatus.ACTIVE,
          last_heartbeat: new Date(),
          started_at: new Date(),
        },
      ]);

      const response = await request(app.getHttpServer())
        .get('/sessions/by-project/project-1')
        .set('X-API-Key', validApiKey)
        .expect(200);

      expect(response.body.project_id).toBe('project-1');
      expect(response.body.stats.total).toBe(3);
      expect(response.body.stats.active).toBe(1);
      expect(response.body.stats.completed).toBe(1);
      expect(response.body.stats.failed).toBe(1);
      expect(response.body.sessions.active).toHaveLength(1);
      expect(response.body.sessions.completed).toHaveLength(1);
      expect(response.body.sessions.failed).toHaveLength(1);
    });

    it('should return empty summary for project with no sessions', async () => {
      const response = await request(app.getHttpServer())
        .get('/sessions/by-project/nonexistent-project')
        .set('X-API-Key', validApiKey)
        .expect(200);

      expect(response.body.project_id).toBe('nonexistent-project');
      expect(response.body.stats.total).toBe(0);
    });

    it('should require authentication', async () => {
      await request(app.getHttpServer())
        .get('/sessions/by-project/project-1')
        .expect(401);
    });
  });

  describe('GET /sessions/by-machine/:machineId', () => {
    it('should return all sessions for a machine', async () => {
      await sessionModel.create([
        {
          session_id: 'session-1',
          project_id: 'project-1',
          machine_id: 'machine-1',
          status: SessionStatus.ACTIVE,
          last_heartbeat: new Date(),
          started_at: new Date(),
          docker_slot: 1,
        },
        {
          session_id: 'session-2',
          project_id: 'project-2',
          machine_id: 'machine-1',
          status: SessionStatus.COMPLETED,
          last_heartbeat: new Date(),
          started_at: new Date(),
          completed_at: new Date(),
          docker_slot: 2,
        },
        {
          session_id: 'session-3',
          project_id: 'project-1',
          machine_id: 'machine-2',
          status: SessionStatus.ACTIVE,
          last_heartbeat: new Date(),
          started_at: new Date(),
        },
      ]);

      const response = await request(app.getHttpServer())
        .get('/sessions/by-machine/machine-1')
        .set('X-API-Key', validApiKey)
        .expect(200);

      expect(response.body).toHaveLength(2);
      expect(response.body.every((s: any) => s.machine_id === 'machine-1')).toBe(true);
    });

    it('should require authentication', async () => {
      await request(app.getHttpServer())
        .get('/sessions/by-machine/machine-1')
        .expect(401);
    });
  });

  describe('GET /sessions/:id/health', () => {
    it('should return health info for a session', async () => {
      const now = new Date();
      const recentHeartbeat = new Date(now.getTime() - 60 * 1000);

      await sessionModel.create({
        session_id: 'session-1',
        project_id: 'project-1',
        machine_id: 'machine-1',
        docker_slot: 1,
        status: SessionStatus.ACTIVE,
        last_heartbeat: recentHeartbeat,
        current_task_id: 'task-1',
        started_at: new Date(now.getTime() - 3600 * 1000),
      });

      const response = await request(app.getHttpServer())
        .get('/sessions/session-1/health')
        .set('X-API-Key', validApiKey)
        .expect(200);

      expect(response.body.session_id).toBe('session-1');
      expect(response.body.is_stale).toBe(false);
      expect(response.body.time_since_heartbeat).toBeLessThan(300);
      expect(response.body.recommendations).toContain('Session is healthy and active');
    });

    it('should detect stale session', async () => {
      const now = new Date();
      const staleHeartbeat = new Date(now.getTime() - 400 * 1000);

      await sessionModel.create({
        session_id: 'session-1',
        project_id: 'project-1',
        machine_id: 'machine-1',
        status: SessionStatus.ACTIVE,
        last_heartbeat: staleHeartbeat,
        started_at: now,
      });

      const response = await request(app.getHttpServer())
        .get('/sessions/session-1/health')
        .set('X-API-Key', validApiKey)
        .expect(200);

      expect(response.body.is_stale).toBe(true);
      expect(response.body.recommendations).toContain('Session may have crashed - no heartbeat received');
    });

    it('should accept custom threshold', async () => {
      const now = new Date();
      const heartbeat = new Date(now.getTime() - 400 * 1000);

      await sessionModel.create({
        session_id: 'session-1',
        project_id: 'project-1',
        machine_id: 'machine-1',
        status: SessionStatus.ACTIVE,
        last_heartbeat: heartbeat,
        started_at: now,
      });

      const response = await request(app.getHttpServer())
        .get('/sessions/session-1/health?threshold=600')
        .set('X-API-Key', validApiKey)
        .expect(200);

      expect(response.body.is_stale).toBe(false);
    });

    it('should return 404 for non-existent session', async () => {
      await request(app.getHttpServer())
        .get('/sessions/nonexistent/health')
        .set('X-API-Key', validApiKey)
        .expect(404);
    });

    it('should require authentication', async () => {
      await request(app.getHttpServer())
        .get('/sessions/session-1/health')
        .expect(401);
    });
  });

  describe('GET /machines/available', () => {
    it('should return available machines with slot info', async () => {
      const now = new Date();

      await machineModel.create([
        {
          machine_id: 'machine-1',
          hostname: 'host1',
          status: MachineStatus.ONLINE,
          docker_slots: [1, 2, 3, 4],
          active_sessions: ['session-1'],
          last_heartbeat: now,
        },
        {
          machine_id: 'machine-2',
          hostname: 'host2',
          status: MachineStatus.ONLINE,
          docker_slots: [1, 2],
          active_sessions: [],
          last_heartbeat: now,
        },
        {
          machine_id: 'machine-3',
          hostname: 'host3',
          status: MachineStatus.OFFLINE,
          docker_slots: [1, 2, 3],
          active_sessions: [],
          last_heartbeat: now,
        },
      ]);

      await sessionModel.create({
        session_id: 'session-1',
        project_id: 'project-1',
        machine_id: 'machine-1',
        docker_slot: 1,
        status: SessionStatus.ACTIVE,
        last_heartbeat: now,
        started_at: now,
      });

      const response = await request(app.getHttpServer())
        .get('/machines/available')
        .set('X-API-Key', validApiKey)
        .expect(200);

      // Should only return online machines
      expect(response.body).toHaveLength(2);
      expect(response.body.every((m: any) => m.status === MachineStatus.ONLINE)).toBe(true);

      // Should be sorted by most available slots
      expect(response.body[0].available_slots).toBeGreaterThanOrEqual(response.body[1].available_slots);

      // Check machine-1 availability
      const machine1 = response.body.find((m: any) => m.machine_id === 'machine-1');
      expect(machine1.total_slots).toBe(4);
      expect(machine1.occupied_slots).toBe(1);
      expect(machine1.available_slots).toBe(3);
      expect(machine1.available_slot_numbers).toContain(2);
      expect(machine1.available_slot_numbers).not.toContain(1);
    });

    it('should require authentication', async () => {
      await request(app.getHttpServer())
        .get('/machines/available')
        .expect(401);
    });
  });
});
