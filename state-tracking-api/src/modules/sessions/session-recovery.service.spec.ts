import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { NotFoundException, BadRequestException } from '@nestjs/common';
import { SessionRecoveryService } from './session-recovery.service';
import { Session, SessionStatus } from '../../schemas/session.schema';
import { Task, TaskStatus } from '../../schemas/task.schema';
import { AppLoggerService } from '../../common/logging/app-logger.service';

describe('SessionRecoveryService', () => {
  let service: SessionRecoveryService;
  let sessionModel: Model<Session>;
  let taskModel: Model<Task>;

  const mockSession = {
    session_id: 'test-session-123',
    project_id: 'proj-456',
    machine_id: 'machine-1',
    docker_slot: 1,
    status: SessionStatus.FAILED,
    last_heartbeat: new Date(),
    started_at: new Date(),
    metadata: {},
  };

  const mockTask = {
    task_id: 'task-123',
    session_id: 'test-session-123',
    project_id: 'proj-456',
    task_name: 'Test Task',
    status: TaskStatus.PENDING,
  };

  const mockSessionModel = {
    findOne: jest.fn(),
    findOneAndUpdate: jest.fn(),
    find: jest.fn(),
  };

  const mockTaskModel = {
    findOne: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SessionRecoveryService,
        {
          provide: getModelToken(Session.name),
          useValue: mockSessionModel,
        },
        {
          provide: getModelToken(Task.name),
          useValue: mockTaskModel,
        },
        {
          provide: AppLoggerService,
          useValue: {
            setContext: jest.fn(),
            log: jest.fn(),
            error: jest.fn(),
            warn: jest.fn(),
            debug: jest.fn(),
            verbose: jest.fn(),
            logSessionCreated: jest.fn(),
            logSessionUpdated: jest.fn(),
            logSessionCompleted: jest.fn(),
            logSessionFailed: jest.fn(),
            logHeartbeat: jest.fn(),
            logHeartbeatFailure: jest.fn(),
            logRecovery: jest.fn(),
            logRecoverySuccess: jest.fn(),
            logRecoveryFailure: jest.fn(),
            logStalledSession: jest.fn(),
            logTaskStateChange: jest.fn(),
            logBackgroundJob: jest.fn(),
            logDatabaseError: jest.fn(),
            logValidationError: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get<SessionRecoveryService>(SessionRecoveryService);
    sessionModel = module.get<Model<Session>>(getModelToken(Session.name));
    taskModel = module.get<Model<Task>>(getModelToken(Task.name));

    jest.clearAllMocks();
  });

  describe('prepareRecovery', () => {
    it('should create recovery checkpoint for a failed session', async () => {
      const session = { ...mockSession };
      mockSessionModel.findOne.mockReturnValue({
        exec: jest.fn().mockResolvedValue(session),
      });

      mockSessionModel.findOneAndUpdate.mockReturnValue({
        exec: jest.fn().mockResolvedValue({ ...session, metadata: { recovery: {} } }),
      });

      const result = await service.prepareRecovery('test-session-123');

      expect(result).toBeDefined();
      expect(result.session_id).toBe('test-session-123');
      expect(result.recovery_attempts).toBe(0);
      expect(mockSessionModel.findOne).toHaveBeenCalled();
      expect(mockSessionModel.findOneAndUpdate).toHaveBeenCalled();
    });

    it('should throw NotFoundException for non-existent session', async () => {
      mockSessionModel.findOne.mockReturnValue({
        exec: jest.fn().mockResolvedValue(null),
      });

      await expect(service.prepareRecovery('non-existent')).rejects.toThrow(NotFoundException);
    });

    it('should throw BadRequestException for completed sessions', async () => {
      const completedSession = { ...mockSession, status: SessionStatus.COMPLETED };
      mockSessionModel.findOne.mockReturnValue({
        exec: jest.fn().mockResolvedValue(completedSession),
      });

      await expect(service.prepareRecovery('test-session-123')).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException if max recovery attempts reached', async () => {
      const session = {
        ...mockSession,
        metadata: { recovery: { recovery_attempts: 3 } },
      };
      mockSessionModel.findOne.mockReturnValue({
        exec: jest.fn().mockResolvedValue(session),
      });

      await expect(service.prepareRecovery('test-session-123')).rejects.toThrow(BadRequestException);
    });
  });

  describe('recoverSession', () => {
    it('should recover a failed session with default settings', async () => {
      const session = { ...mockSession };
      mockSessionModel.findOne.mockReturnValue({
        exec: jest.fn().mockResolvedValue(session),
      });

      const recoveredSession = { ...session, status: SessionStatus.ACTIVE };
      mockSessionModel.findOneAndUpdate.mockReturnValue({
        exec: jest.fn().mockResolvedValue(recoveredSession),
      });

      const result = await service.recoverSession('test-session-123', {});

      expect(result.status).toBe(SessionStatus.ACTIVE);
      expect(mockSessionModel.findOneAndUpdate).toHaveBeenCalled();
    });

    it('should recover session with new machine assignment', async () => {
      const session = { ...mockSession };
      mockSessionModel.findOne.mockReturnValue({
        exec: jest.fn().mockResolvedValue(session),
      });

      const recoveredSession = { ...session, machine_id: 'machine-2' };
      mockSessionModel.findOneAndUpdate.mockReturnValue({
        exec: jest.fn().mockResolvedValue(recoveredSession),
      });

      const result = await service.recoverSession('test-session-123', {
        new_machine_id: 'machine-2',
      });

      expect(mockSessionModel.findOneAndUpdate).toHaveBeenCalled();
    });

    it('should recover session with task resume', async () => {
      const session = { ...mockSession };
      mockSessionModel.findOne.mockReturnValue({
        exec: jest.fn().mockResolvedValue(session),
      });

      mockTaskModel.findOne.mockReturnValue({
        exec: jest.fn().mockResolvedValue(mockTask),
      });

      mockSessionModel.findOneAndUpdate.mockReturnValue({
        exec: jest.fn().mockResolvedValue({ ...session, current_task_id: 'task-123' }),
      });

      const result = await service.recoverSession('test-session-123', {
        resume_from_task_id: 'task-123',
      });

      expect(mockTaskModel.findOne).toHaveBeenCalled();
      expect(mockSessionModel.findOneAndUpdate).toHaveBeenCalled();
    });

    it('should throw NotFoundException for non-existent task', async () => {
      const session = { ...mockSession };
      mockSessionModel.findOne.mockReturnValue({
        exec: jest.fn().mockResolvedValue(session),
      });

      mockTaskModel.findOne.mockReturnValue({
        exec: jest.fn().mockResolvedValue(null),
      });

      await expect(
        service.recoverSession('test-session-123', {
          resume_from_task_id: 'non-existent-task',
        })
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw BadRequestException for task from different session', async () => {
      const session = { ...mockSession };
      mockSessionModel.findOne.mockReturnValue({
        exec: jest.fn().mockResolvedValue(session),
      });

      const differentTask = { ...mockTask, session_id: 'different-session' };
      mockTaskModel.findOne.mockReturnValue({
        exec: jest.fn().mockResolvedValue(differentTask),
      });

      await expect(
        service.recoverSession('test-session-123', {
          resume_from_task_id: 'task-123',
        })
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException for completed sessions', async () => {
      const completedSession = { ...mockSession, status: SessionStatus.COMPLETED };
      mockSessionModel.findOne.mockReturnValue({
        exec: jest.fn().mockResolvedValue(completedSession),
      });

      await expect(service.recoverSession('test-session-123', {})).rejects.toThrow(
        BadRequestException
      );
    });

    it('should throw BadRequestException if max recovery attempts reached', async () => {
      const session = {
        ...mockSession,
        metadata: { recovery: { recovery_attempts: 3 } },
      };
      mockSessionModel.findOne.mockReturnValue({
        exec: jest.fn().mockResolvedValue(session),
      });

      await expect(service.recoverSession('test-session-123', {})).rejects.toThrow(
        BadRequestException
      );
    });
  });

  describe('getRecoveryHistory', () => {
    it('should return recovery history for a session', async () => {
      const session = {
        ...mockSession,
        metadata: {
          recovery: {
            recovery_attempts: 2,
            recovery_history: [
              {
                attempted_at: new Date(),
                success: true,
                new_machine_id: 'machine-2',
              },
              {
                attempted_at: new Date(),
                success: false,
                error: 'Machine not available',
              },
            ],
            last_recovery_at: new Date(),
          },
        },
      };

      mockSessionModel.findOne.mockReturnValue({
        exec: jest.fn().mockResolvedValue(session),
      });

      const result = await service.getRecoveryHistory('test-session-123');

      expect(result.session_id).toBe('test-session-123');
      expect(result.total_attempts).toBe(2);
      expect(result.successful_attempts).toBe(1);
      expect(result.failed_attempts).toBe(1);
      expect(result.attempts).toHaveLength(2);
    });

    it('should return empty history for session with no recovery attempts', async () => {
      const session = { ...mockSession };
      mockSessionModel.findOne.mockReturnValue({
        exec: jest.fn().mockResolvedValue(session),
      });

      const result = await service.getRecoveryHistory('test-session-123');

      expect(result.total_attempts).toBe(0);
      expect(result.successful_attempts).toBe(0);
      expect(result.failed_attempts).toBe(0);
      expect(result.attempts).toHaveLength(0);
    });

    it('should throw NotFoundException for non-existent session', async () => {
      mockSessionModel.findOne.mockReturnValue({
        exec: jest.fn().mockResolvedValue(null),
      });

      await expect(service.getRecoveryHistory('non-existent')).rejects.toThrow(NotFoundException);
    });
  });

  describe('findRecoverableSessions', () => {
    it('should return failed and stalled sessions eligible for recovery', async () => {
      const sessions = [
        { ...mockSession, status: SessionStatus.FAILED },
        { ...mockSession, session_id: 'test-session-456', status: SessionStatus.STALLED },
      ];

      mockSessionModel.find.mockReturnValue({
        sort: jest.fn().mockReturnValue({
          exec: jest.fn().mockResolvedValue(sessions),
        }),
      });

      const result = await service.findRecoverableSessions({});

      expect(result).toHaveLength(2);
      expect(result[0].can_recover).toBe(true);
      expect(result[1].can_recover).toBe(true);
    });

    it('should filter by project_id', async () => {
      mockSessionModel.find.mockReturnValue({
        sort: jest.fn().mockReturnValue({
          exec: jest.fn().mockResolvedValue([mockSession]),
        }),
      });

      await service.findRecoverableSessions({ project_id: 'proj-456' });

      expect(mockSessionModel.find).toHaveBeenCalledWith(
        expect.objectContaining({ project_id: 'proj-456' })
      );
    });

    it('should filter by machine_id', async () => {
      mockSessionModel.find.mockReturnValue({
        sort: jest.fn().mockReturnValue({
          exec: jest.fn().mockResolvedValue([mockSession]),
        }),
      });

      await service.findRecoverableSessions({ machine_id: 'machine-1' });

      expect(mockSessionModel.find).toHaveBeenCalledWith(
        expect.objectContaining({ machine_id: 'machine-1' })
      );
    });

    it('should mark sessions with max recovery attempts as not recoverable', async () => {
      const session = {
        ...mockSession,
        metadata: { recovery: { recovery_attempts: 3 } },
      };

      mockSessionModel.find.mockReturnValue({
        sort: jest.fn().mockReturnValue({
          exec: jest.fn().mockResolvedValue([session]),
        }),
      });

      const result = await service.findRecoverableSessions({});

      expect(result[0].can_recover).toBe(false);
      expect(result[0].recovery_blocked_reason).toBe('Maximum recovery attempts reached');
    });
  });

  describe('checkRecoverability', () => {
    it('should return recoverable true for failed session', async () => {
      mockSessionModel.findOne.mockReturnValue({
        exec: jest.fn().mockResolvedValue(mockSession),
      });

      const result = await service.checkRecoverability('test-session-123');

      expect(result.recoverable).toBe(true);
      expect(result.reason).toBeUndefined();
    });

    it('should return recoverable false for completed session', async () => {
      const completedSession = { ...mockSession, status: SessionStatus.COMPLETED };
      mockSessionModel.findOne.mockReturnValue({
        exec: jest.fn().mockResolvedValue(completedSession),
      });

      const result = await service.checkRecoverability('test-session-123');

      expect(result.recoverable).toBe(false);
      expect(result.reason).toBe('Session is already completed');
    });

    it('should return recoverable false for active session', async () => {
      const activeSession = { ...mockSession, status: SessionStatus.ACTIVE };
      mockSessionModel.findOne.mockReturnValue({
        exec: jest.fn().mockResolvedValue(activeSession),
      });

      const result = await service.checkRecoverability('test-session-123');

      expect(result.recoverable).toBe(false);
      expect(result.reason).toBe('Session must be in failed or stalled state');
    });

    it('should return recoverable false if max attempts reached', async () => {
      const session = {
        ...mockSession,
        metadata: { recovery: { recovery_attempts: 3 } },
      };
      mockSessionModel.findOne.mockReturnValue({
        exec: jest.fn().mockResolvedValue(session),
      });

      const result = await service.checkRecoverability('test-session-123');

      expect(result.recoverable).toBe(false);
      expect(result.reason).toContain('Maximum recovery attempts');
    });

    it('should throw NotFoundException for non-existent session', async () => {
      mockSessionModel.findOne.mockReturnValue({
        exec: jest.fn().mockResolvedValue(null),
      });

      await expect(service.checkRecoverability('non-existent')).rejects.toThrow(NotFoundException);
    });
  });

  describe('trackFailedRecoveryAttempt', () => {
    it('should track a failed recovery attempt', async () => {
      const session = { ...mockSession };
      mockSessionModel.findOne.mockReturnValue({
        exec: jest.fn().mockResolvedValue(session),
      });

      mockSessionModel.findOneAndUpdate.mockReturnValue({
        exec: jest.fn().mockResolvedValue(session),
      });

      await service.trackFailedRecoveryAttempt('test-session-123', 'Test error');

      expect(mockSessionModel.findOneAndUpdate).toHaveBeenCalledWith(
        { session_id: 'test-session-123' },
        expect.objectContaining({
          $set: expect.objectContaining({
            'metadata.recovery': expect.objectContaining({
              recovery_attempts: 1,
            }),
          }),
        })
      );
    });

    it('should throw NotFoundException for non-existent session', async () => {
      mockSessionModel.findOne.mockReturnValue({
        exec: jest.fn().mockResolvedValue(null),
      });

      await expect(
        service.trackFailedRecoveryAttempt('non-existent', 'Error')
      ).rejects.toThrow(NotFoundException);
    });
  });
});
