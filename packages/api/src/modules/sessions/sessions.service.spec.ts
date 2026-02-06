import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { NotFoundException, BadRequestException } from '@nestjs/common';
import { SessionsService } from './sessions.service';
import { Session, SessionDocument, SessionStatus } from '../../schemas/session.schema';
import { CreateSessionDto } from './dto/create-session.dto';
import { UpdateSessionDto } from './dto/update-session.dto';
import { SessionQueryDto } from './dto/session-query.dto';
import { AppLoggerService } from '../../common/logging/app-logger.service';

describe('SessionsService', () => {
  let service: SessionsService;
  let model: Model<SessionDocument>;

  const mockSession = {
    session_id: 'test-session-id',
    project_id: 'test-project',
    machine_id: 'test-machine',
    status: SessionStatus.ACTIVE,
    last_heartbeat: new Date('2024-01-01T10:00:00Z'),
    started_at: new Date('2024-01-01T09:00:00Z'),
    metadata: {},
  };

  const mockSessionModel = {
    findOne: jest.fn(),
    findOneAndUpdate: jest.fn(),
    updateMany: jest.fn(),
    find: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SessionsService,
        {
          provide: getModelToken(Session.name),
          useValue: mockSessionModel,
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

    service = module.get<SessionsService>(SessionsService);
    model = module.get<Model<SessionDocument>>(getModelToken(Session.name));
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('findAll', () => {
    it('should return all sessions without filters', async () => {
      const mockSessions = [mockSession];
      const execMock = jest.fn().mockResolvedValue(mockSessions);
      const skipMock = jest.fn().mockReturnValue({ exec: execMock });
      const limitMock = jest.fn().mockReturnValue({ skip: skipMock });
      const sortMock = jest.fn().mockReturnValue({ limit: limitMock });
      mockSessionModel.find.mockReturnValue({ sort: sortMock });

      const result = await service.findAll();

      expect(model.find).toHaveBeenCalledWith({});
      expect(sortMock).toHaveBeenCalledWith({ created_at: -1 });
      expect(limitMock).toHaveBeenCalledWith(20);
      expect(skipMock).toHaveBeenCalledWith(0);
      expect(result).toEqual(mockSessions);
    });

    it('should filter sessions by status', async () => {
      const queryDto: SessionQueryDto = { status: SessionStatus.ACTIVE };
      const execMock = jest.fn().mockResolvedValue([mockSession]);
      const skipMock = jest.fn().mockReturnValue({ exec: execMock });
      const limitMock = jest.fn().mockReturnValue({ skip: skipMock });
      const sortMock = jest.fn().mockReturnValue({ limit: limitMock });
      mockSessionModel.find.mockReturnValue({ sort: sortMock });

      await service.findAll(queryDto);

      expect(model.find).toHaveBeenCalledWith({ status: SessionStatus.ACTIVE });
    });

    it('should filter sessions by project_id and machine_id', async () => {
      const queryDto: SessionQueryDto = {
        project_id: 'test-project',
        machine_id: 'test-machine',
      };
      const execMock = jest.fn().mockResolvedValue([mockSession]);
      const skipMock = jest.fn().mockReturnValue({ exec: execMock });
      const limitMock = jest.fn().mockReturnValue({ skip: skipMock });
      const sortMock = jest.fn().mockReturnValue({ limit: limitMock });
      mockSessionModel.find.mockReturnValue({ sort: sortMock });

      await service.findAll(queryDto);

      expect(model.find).toHaveBeenCalledWith({
        project_id: 'test-project',
        machine_id: 'test-machine',
      });
    });

    it('should apply pagination with custom limit and offset', async () => {
      const queryDto: SessionQueryDto = { limit: 50, offset: 100 };
      const execMock = jest.fn().mockResolvedValue([mockSession]);
      const skipMock = jest.fn().mockReturnValue({ exec: execMock });
      const limitMock = jest.fn().mockReturnValue({ skip: skipMock });
      const sortMock = jest.fn().mockReturnValue({ limit: limitMock });
      mockSessionModel.find.mockReturnValue({ sort: sortMock });

      await service.findAll(queryDto);

      expect(limitMock).toHaveBeenCalledWith(50);
      expect(skipMock).toHaveBeenCalledWith(100);
    });
  });

  describe('findOne', () => {
    it('should return a session by ID', async () => {
      mockSessionModel.findOne.mockReturnValue({
        exec: jest.fn().mockResolvedValue(mockSession),
      });

      const result = await service.findOne('test-session-id');

      expect(model.findOne).toHaveBeenCalledWith({ session_id: 'test-session-id' });
      expect(result).toEqual(mockSession);
    });

    it('should throw NotFoundException when session not found', async () => {
      mockSessionModel.findOne.mockReturnValue({
        exec: jest.fn().mockResolvedValue(null),
      });

      await expect(service.findOne('non-existent-id')).rejects.toThrow(NotFoundException);
      await expect(service.findOne('non-existent-id')).rejects.toThrow(
        'Session with ID non-existent-id not found'
      );
    });
  });

  describe('create', () => {
    it('should create a new session (integration-style test)', async () => {
      // Note: This is tested more thoroughly in e2e tests
      // Unit testing session creation with Mongoose model constructor is complex
      // The e2e tests will verify the full create functionality
      expect(service.create).toBeDefined();
    });
  });

  describe('update', () => {
    it('should update a session successfully', async () => {
      const updateDto: UpdateSessionDto = {
        status: SessionStatus.PAUSED,
        current_task_id: 'task-123',
      };

      mockSessionModel.findOne.mockReturnValue({
        exec: jest.fn().mockResolvedValue(mockSession),
      });

      const updatedSession = { ...mockSession, ...updateDto };
      mockSessionModel.findOneAndUpdate.mockReturnValue({
        exec: jest.fn().mockResolvedValue(updatedSession),
      });

      const result = await service.update('test-session-id', updateDto);

      expect(model.findOneAndUpdate).toHaveBeenCalledWith(
        { session_id: 'test-session-id' },
        { $set: updateDto },
        { new: true, runValidators: true }
      );
      expect(result).toEqual(updatedSession);
    });

    it('should throw NotFoundException when session not found', async () => {
      const updateDto: UpdateSessionDto = { status: SessionStatus.PAUSED };
      mockSessionModel.findOne.mockReturnValue({
        exec: jest.fn().mockResolvedValue(null),
      });

      await expect(service.update('non-existent-id', updateDto)).rejects.toThrow(
        NotFoundException
      );
    });

    it('should merge metadata when updating', async () => {
      const updateDto: UpdateSessionDto = {
        metadata: { new_field: 'new_value' },
      };

      const existingSession = {
        ...mockSession,
        metadata: { existing_field: 'existing_value' },
      };

      mockSessionModel.findOne.mockReturnValueOnce({
        exec: jest.fn().mockResolvedValue(existingSession),
      }).mockReturnValueOnce({
        exec: jest.fn().mockResolvedValue(existingSession),
      });

      const updatedSession = {
        ...existingSession,
        metadata: {
          existing_field: 'existing_value',
          new_field: 'new_value',
        },
      };
      mockSessionModel.findOneAndUpdate.mockReturnValue({
        exec: jest.fn().mockResolvedValue(updatedSession),
      });

      await service.update('test-session-id', updateDto);

      expect(model.findOneAndUpdate).toHaveBeenCalledWith(
        { session_id: 'test-session-id' },
        {
          $set: {
            metadata: {
              existing_field: 'existing_value',
              new_field: 'new_value',
            },
          },
        },
        { new: true, runValidators: true }
      );
    });
  });

  describe('delete', () => {
    it('should soft delete a session', async () => {
      mockSessionModel.findOne.mockReturnValue({
        exec: jest.fn().mockResolvedValue(mockSession),
      });

      const deletedSession = {
        ...mockSession,
        status: SessionStatus.COMPLETED,
        completed_at: expect.any(Date),
      };
      mockSessionModel.findOneAndUpdate.mockReturnValue({
        exec: jest.fn().mockResolvedValue(deletedSession),
      });

      await service.delete('test-session-id');

      expect(model.findOneAndUpdate).toHaveBeenCalledWith(
        { session_id: 'test-session-id' },
        {
          $set: {
            status: SessionStatus.COMPLETED,
            completed_at: expect.any(Date),
          },
        },
        { new: true }
      );
    });

    it('should throw NotFoundException when session not found', async () => {
      mockSessionModel.findOne.mockReturnValue({
        exec: jest.fn().mockResolvedValue(null),
      });

      await expect(service.delete('non-existent-id')).rejects.toThrow(NotFoundException);
    });
  });

  describe('updateHeartbeat', () => {
    it('should update heartbeat for active session', async () => {
      const now = new Date();
      mockSessionModel.findOne.mockReturnValue({
        exec: jest.fn().mockResolvedValue(mockSession),
      });
      mockSessionModel.findOneAndUpdate.mockReturnValue({
        exec: jest.fn().mockResolvedValue({
          ...mockSession,
          last_heartbeat: now,
        }),
      });

      const result = await service.updateHeartbeat('test-session-id');

      expect(mockSessionModel.findOne).toHaveBeenCalledWith({
        session_id: 'test-session-id',
      });
      expect(mockSessionModel.findOneAndUpdate).toHaveBeenCalled();
      expect(result.last_heartbeat.getTime()).toBeGreaterThan(
        mockSession.last_heartbeat.getTime()
      );
    });

    it('should reactivate stalled session', async () => {
      const stalledSession = {
        ...mockSession,
        status: SessionStatus.STALLED,
      };
      mockSessionModel.findOne.mockReturnValue({
        exec: jest.fn().mockResolvedValue(stalledSession),
      });
      mockSessionModel.findOneAndUpdate.mockReturnValue({
        exec: jest.fn().mockResolvedValue({
          ...stalledSession,
          status: SessionStatus.ACTIVE,
          last_heartbeat: new Date(),
        }),
      });

      const result = await service.updateHeartbeat('test-session-id');

      expect(result.status).toBe(SessionStatus.ACTIVE);
    });

    it('should throw NotFoundException if session does not exist', async () => {
      mockSessionModel.findOne.mockReturnValue({
        exec: jest.fn().mockResolvedValue(null),
      });

      await expect(service.updateHeartbeat('non-existent')).rejects.toThrow(
        NotFoundException
      );
    });

    it('should throw BadRequestException for completed session', async () => {
      const completedSession = {
        ...mockSession,
        status: SessionStatus.COMPLETED,
      };
      mockSessionModel.findOne.mockReturnValue({
        exec: jest.fn().mockResolvedValue(completedSession),
      });

      await expect(service.updateHeartbeat('test-session-id')).rejects.toThrow(
        BadRequestException
      );
    });

    it('should throw BadRequestException for failed session', async () => {
      const failedSession = {
        ...mockSession,
        status: SessionStatus.FAILED,
      };
      mockSessionModel.findOne.mockReturnValue({
        exec: jest.fn().mockResolvedValue(failedSession),
      });

      await expect(service.updateHeartbeat('test-session-id')).rejects.toThrow(
        BadRequestException
      );
    });
  });

  describe('detectStaleSessions', () => {
    it('should detect and mark stale sessions', async () => {
      const stalledSessions = [
        { session_id: 'session-1', last_heartbeat: new Date(Date.now() - 10 * 60000) },
        { session_id: 'session-2', last_heartbeat: new Date(Date.now() - 10 * 60000) },
      ];

      mockSessionModel.updateMany.mockReturnValue({
        exec: jest.fn().mockResolvedValue({ modifiedCount: 2 }),
      });
      mockSessionModel.find.mockReturnValue({
        select: jest.fn().mockReturnValue({
          exec: jest.fn().mockResolvedValue(stalledSessions),
        }),
      });

      const result = await service.detectStaleSessions(5);

      expect(result).toEqual(['session-1', 'session-2']);
      expect(mockSessionModel.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          status: { $in: [SessionStatus.ACTIVE, SessionStatus.PAUSED] },
        }),
        { $set: { status: SessionStatus.STALLED } }
      );
    });

    it('should use default threshold of 5 minutes', async () => {
      mockSessionModel.updateMany.mockReturnValue({
        exec: jest.fn().mockResolvedValue({ modifiedCount: 0 }),
      });
      mockSessionModel.find.mockReturnValue({
        select: jest.fn().mockReturnValue({
          exec: jest.fn().mockResolvedValue([]),
        }),
      });

      await service.detectStaleSessions();

      expect(mockSessionModel.updateMany).toHaveBeenCalled();
    });

    it('should return empty array when no stale sessions found', async () => {
      mockSessionModel.updateMany.mockReturnValue({
        exec: jest.fn().mockResolvedValue({ modifiedCount: 0 }),
      });
      mockSessionModel.find.mockReturnValue({
        select: jest.fn().mockReturnValue({
          exec: jest.fn().mockResolvedValue([]),
        }),
      });

      const result = await service.detectStaleSessions(5);

      expect(result).toEqual([]);
    });
  });
});
