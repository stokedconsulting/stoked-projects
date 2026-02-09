import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { SessionHealthService } from './session-health.service';
import { Session, SessionDocument, SessionStatus } from '../../schemas/session.schema';

describe('SessionHealthService', () => {
  let service: SessionHealthService;
  let sessionModel: Model<SessionDocument>;

  const mockSessionModel = {
    find: jest.fn(),
    findOne: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SessionHealthService,
        {
          provide: getModelToken(Session.name),
          useValue: mockSessionModel,
        },
      ],
    }).compile();

    service = module.get<SessionHealthService>(SessionHealthService);
    sessionModel = module.get<Model<SessionDocument>>(getModelToken(Session.name));
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('findStaleSessions', () => {
    it('should find stale sessions with default threshold', async () => {
      const now = new Date();
      const staleHeartbeat = new Date(now.getTime() - 400 * 1000); // 400 seconds ago (> 5 min)

      const staleSessions = [
        {
          session_id: 'session-1',
          project_id: 'project-1',
          machine_id: 'machine-1',
          docker_slot: 1,
          status: SessionStatus.ACTIVE,
          last_heartbeat: staleHeartbeat,
          current_task_id: 'task-1',
          started_at: new Date(now.getTime() - 3600 * 1000),
        },
      ];

      mockSessionModel.find.mockReturnValue({
        sort: jest.fn().mockReturnValue({
          exec: jest.fn().mockResolvedValue(staleSessions),
        }),
      });

      const result = await service.findStaleSessions();

      expect(result).toHaveLength(1);
      expect(result[0].session_id).toBe('session-1');
      expect(result[0].time_since_heartbeat).toBeGreaterThan(300);
      expect(mockSessionModel.find).toHaveBeenCalledWith({
        last_heartbeat: expect.any(Object),
        status: { $in: [SessionStatus.ACTIVE, SessionStatus.PAUSED] },
      });
    });

    it('should find stale sessions with custom threshold', async () => {
      const now = new Date();
      const staleHeartbeat = new Date(now.getTime() - 700 * 1000); // 700 seconds ago

      const staleSessions = [
        {
          session_id: 'session-1',
          project_id: 'project-1',
          machine_id: 'machine-1',
          status: SessionStatus.ACTIVE,
          last_heartbeat: staleHeartbeat,
          started_at: now,
        },
      ];

      mockSessionModel.find.mockReturnValue({
        sort: jest.fn().mockReturnValue({
          exec: jest.fn().mockResolvedValue(staleSessions),
        }),
      });

      const result = await service.findStaleSessions(600);

      expect(result).toHaveLength(1);
      expect(result[0].time_since_heartbeat).toBeGreaterThan(600);
    });

    it('should return empty array when no stale sessions', async () => {
      mockSessionModel.find.mockReturnValue({
        sort: jest.fn().mockReturnValue({
          exec: jest.fn().mockResolvedValue([]),
        }),
      });

      const result = await service.findStaleSessions();

      expect(result).toHaveLength(0);
    });

    it('should only include active and paused sessions', async () => {
      mockSessionModel.find.mockReturnValue({
        sort: jest.fn().mockReturnValue({
          exec: jest.fn().mockResolvedValue([]),
        }),
      });

      await service.findStaleSessions();

      expect(mockSessionModel.find).toHaveBeenCalledWith(
        expect.objectContaining({
          status: { $in: [SessionStatus.ACTIVE, SessionStatus.PAUSED] },
        })
      );
    });
  });

  describe('findActiveSessions', () => {
    it('should find all active sessions without filters', async () => {
      const activeSessions = [
        {
          session_id: 'session-1',
          project_id: 'project-1',
          machine_id: 'machine-1',
          docker_slot: 1,
          status: SessionStatus.ACTIVE,
          last_heartbeat: new Date(),
          current_task_id: 'task-1',
          started_at: new Date(),
        },
        {
          session_id: 'session-2',
          project_id: 'project-2',
          machine_id: 'machine-2',
          docker_slot: 2,
          status: SessionStatus.ACTIVE,
          last_heartbeat: new Date(),
          started_at: new Date(),
        },
      ];

      mockSessionModel.find.mockReturnValue({
        sort: jest.fn().mockReturnValue({
          exec: jest.fn().mockResolvedValue(activeSessions),
        }),
      });

      const result = await service.findActiveSessions();

      expect(result).toHaveLength(2);
      expect(result[0].status).toBe(SessionStatus.ACTIVE);
      expect(mockSessionModel.find).toHaveBeenCalledWith({
        status: SessionStatus.ACTIVE,
      });
    });

    it('should filter by project_id', async () => {
      const activeSessions = [
        {
          session_id: 'session-1',
          project_id: 'project-1',
          machine_id: 'machine-1',
          status: SessionStatus.ACTIVE,
          last_heartbeat: new Date(),
          started_at: new Date(),
        },
      ];

      mockSessionModel.find.mockReturnValue({
        sort: jest.fn().mockReturnValue({
          exec: jest.fn().mockResolvedValue(activeSessions),
        }),
      });

      const result = await service.findActiveSessions('project-1');

      expect(result).toHaveLength(1);
      expect(mockSessionModel.find).toHaveBeenCalledWith({
        status: SessionStatus.ACTIVE,
        project_id: 'project-1',
      });
    });

    it('should filter by machine_id', async () => {
      const activeSessions = [
        {
          session_id: 'session-1',
          project_id: 'project-1',
          machine_id: 'machine-1',
          status: SessionStatus.ACTIVE,
          last_heartbeat: new Date(),
          started_at: new Date(),
        },
      ];

      mockSessionModel.find.mockReturnValue({
        sort: jest.fn().mockReturnValue({
          exec: jest.fn().mockResolvedValue(activeSessions),
        }),
      });

      const result = await service.findActiveSessions(undefined, 'machine-1');

      expect(result).toHaveLength(1);
      expect(mockSessionModel.find).toHaveBeenCalledWith({
        status: SessionStatus.ACTIVE,
        machine_id: 'machine-1',
      });
    });

    it('should filter by both project_id and machine_id', async () => {
      mockSessionModel.find.mockReturnValue({
        sort: jest.fn().mockReturnValue({
          exec: jest.fn().mockResolvedValue([]),
        }),
      });

      await service.findActiveSessions('project-1', 'machine-1');

      expect(mockSessionModel.find).toHaveBeenCalledWith({
        status: SessionStatus.ACTIVE,
        project_id: 'project-1',
        machine_id: 'machine-1',
      });
    });
  });

  describe('findSessionsByProject', () => {
    it('should group sessions by status', async () => {
      const sessions = [
        {
          session_id: 'session-1',
          project_id: 'project-1',
          machine_id: 'machine-1',
          status: SessionStatus.ACTIVE,
          last_heartbeat: new Date(),
          started_at: new Date(),
          toObject: jest.fn().mockReturnThis(),
        },
        {
          session_id: 'session-2',
          project_id: 'project-1',
          machine_id: 'machine-1',
          status: SessionStatus.COMPLETED,
          last_heartbeat: new Date(),
          started_at: new Date(),
          completed_at: new Date(),
          toObject: jest.fn().mockReturnThis(),
        },
        {
          session_id: 'session-3',
          project_id: 'project-1',
          machine_id: 'machine-2',
          status: SessionStatus.FAILED,
          last_heartbeat: new Date(),
          started_at: new Date(),
          completed_at: new Date(),
          toObject: jest.fn().mockReturnThis(),
        },
      ];

      mockSessionModel.find.mockReturnValue({
        sort: jest.fn().mockReturnValue({
          exec: jest.fn().mockResolvedValue(sessions),
        }),
      });

      const result = await service.findSessionsByProject('project-1');

      expect(result.project_id).toBe('project-1');
      expect(result.stats.total).toBe(3);
      expect(result.stats.active).toBe(1);
      expect(result.stats.completed).toBe(1);
      expect(result.stats.failed).toBe(1);
      expect(result.sessions.active).toHaveLength(1);
      expect(result.sessions.completed).toHaveLength(1);
      expect(result.sessions.failed).toHaveLength(1);
    });

    it('should return empty summary for project with no sessions', async () => {
      mockSessionModel.find.mockReturnValue({
        sort: jest.fn().mockReturnValue({
          exec: jest.fn().mockResolvedValue([]),
        }),
      });

      const result = await service.findSessionsByProject('project-1');

      expect(result.project_id).toBe('project-1');
      expect(result.stats.total).toBe(0);
      expect(result.stats.active).toBe(0);
    });
  });

  describe('findSessionsByMachine', () => {
    it('should find all sessions for a machine', async () => {
      const sessions = [
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
          status: SessionStatus.COMPLETED,
          last_heartbeat: new Date(),
          started_at: new Date(),
          completed_at: new Date(),
        },
      ];

      mockSessionModel.find.mockReturnValue({
        sort: jest.fn().mockReturnValue({
          exec: jest.fn().mockResolvedValue(sessions),
        }),
      });

      const result = await service.findSessionsByMachine('machine-1');

      expect(result).toHaveLength(2);
      expect(mockSessionModel.find).toHaveBeenCalledWith({
        machine_id: 'machine-1',
      });
    });
  });

  describe('getSessionHealth', () => {
    it('should return health info for active session', async () => {
      const now = new Date();
      const recentHeartbeat = new Date(now.getTime() - 60 * 1000); // 1 minute ago

      const session = {
        session_id: 'session-1',
        project_id: 'project-1',
        machine_id: 'machine-1',
        docker_slot: 1,
        status: SessionStatus.ACTIVE,
        last_heartbeat: recentHeartbeat,
        current_task_id: 'task-1',
        started_at: new Date(now.getTime() - 3600 * 1000),
      };

      mockSessionModel.findOne.mockReturnValue({
        exec: jest.fn().mockResolvedValue(session),
      });

      const result = await service.getSessionHealth('session-1');

      expect(result).not.toBeNull();
      expect(result?.session_id).toBe('session-1');
      expect(result?.is_stale).toBe(false);
      expect(result?.time_since_heartbeat).toBeLessThan(300);
      expect(result?.recommendations).toContain('Session is healthy and active');
    });

    it('should detect stale active session', async () => {
      const now = new Date();
      const staleHeartbeat = new Date(now.getTime() - 400 * 1000); // 400 seconds ago

      const session = {
        session_id: 'session-1',
        project_id: 'project-1',
        machine_id: 'machine-1',
        status: SessionStatus.ACTIVE,
        last_heartbeat: staleHeartbeat,
        started_at: new Date(now.getTime() - 3600 * 1000),
      };

      mockSessionModel.findOne.mockReturnValue({
        exec: jest.fn().mockResolvedValue(session),
      });

      const result = await service.getSessionHealth('session-1');

      expect(result?.is_stale).toBe(true);
      expect(result?.recommendations).toContain('Session may have crashed - no heartbeat received');
      expect(result?.recommendations).toContain('Consider marking session as stalled or failed');
    });

    it('should provide specific recommendation for very old heartbeat', async () => {
      const now = new Date();
      const veryStaleHeartbeat = new Date(now.getTime() - 700 * 1000); // 700 seconds ago

      const session = {
        session_id: 'session-1',
        project_id: 'project-1',
        machine_id: 'machine-1',
        status: SessionStatus.ACTIVE,
        last_heartbeat: veryStaleHeartbeat,
        started_at: new Date(now.getTime() - 3600 * 1000),
      };

      mockSessionModel.findOne.mockReturnValue({
        exec: jest.fn().mockResolvedValue(session),
      });

      const result = await service.getSessionHealth('session-1');

      expect(result?.recommendations).toContain('Session has been unresponsive for over 10 minutes');
    });

    it('should provide recommendations for stalled session', async () => {
      const session = {
        session_id: 'session-1',
        project_id: 'project-1',
        machine_id: 'machine-1',
        status: SessionStatus.STALLED,
        last_heartbeat: new Date(),
        started_at: new Date(),
      };

      mockSessionModel.findOne.mockReturnValue({
        exec: jest.fn().mockResolvedValue(session),
      });

      const result = await service.getSessionHealth('session-1');

      expect(result?.recommendations).toContain('Session is in stalled state');
      expect(result?.recommendations).toContain('Review session logs and consider recovery or cleanup');
    });

    it('should provide recommendations for failed session', async () => {
      const session = {
        session_id: 'session-1',
        project_id: 'project-1',
        machine_id: 'machine-1',
        status: SessionStatus.FAILED,
        last_heartbeat: new Date(),
        started_at: new Date(),
        completed_at: new Date(),
      };

      mockSessionModel.findOne.mockReturnValue({
        exec: jest.fn().mockResolvedValue(session),
      });

      const result = await service.getSessionHealth('session-1');

      expect(result?.recommendations).toContain('Session has failed');
      expect(result?.recommendations).toContain('Review error logs and failure reason');
    });

    it('should use custom threshold', async () => {
      const now = new Date();
      const heartbeat = new Date(now.getTime() - 400 * 1000); // 400 seconds ago

      const session = {
        session_id: 'session-1',
        project_id: 'project-1',
        machine_id: 'machine-1',
        status: SessionStatus.ACTIVE,
        last_heartbeat: heartbeat,
        started_at: new Date(),
      };

      mockSessionModel.findOne.mockReturnValue({
        exec: jest.fn().mockResolvedValue(session),
      });

      const result = await service.getSessionHealth('session-1', 600);

      expect(result?.is_stale).toBe(false); // 400 seconds < 600 seconds threshold
    });

    it('should return null for non-existent session', async () => {
      mockSessionModel.findOne.mockReturnValue({
        exec: jest.fn().mockResolvedValue(null),
      });

      const result = await service.getSessionHealth('non-existent');

      expect(result).toBeNull();
    });
  });
});
