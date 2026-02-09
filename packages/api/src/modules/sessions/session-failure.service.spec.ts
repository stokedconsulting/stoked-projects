import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { NotFoundException, BadRequestException } from '@nestjs/common';
import { SessionFailureService } from './session-failure.service';
import { Session, SessionDocument, SessionStatus } from '../../schemas/session.schema';
import { Task, TaskDocument, TaskStatus } from '../../schemas/task.schema';
import { MarkFailedDto } from './dto/mark-failed.dto';
import { MarkStalledDto } from './dto/mark-stalled.dto';
import { FailedSessionQueryDto } from './dto/failed-session-query.dto';
import { AppLoggerService } from '../../common/logging/app-logger.service';

describe('SessionFailureService', () => {
  let service: SessionFailureService;
  let sessionModel: Model<SessionDocument>;
  let taskModel: Model<TaskDocument>;

  const mockSession = {
    session_id: 'test-session-id',
    project_id: 'test-project',
    machine_id: 'test-machine',
    docker_slot: 1,
    status: SessionStatus.ACTIVE,
    last_heartbeat: new Date('2024-01-01T10:00:00Z'),
    started_at: new Date('2024-01-01T09:00:00Z'),
    metadata: {},
    toObject: jest.fn().mockReturnThis(),
  };

  const mockTask = {
    task_id: 'test-task-id',
    session_id: 'test-session-id',
    project_id: 'test-project',
    task_name: 'Test Task',
    status: TaskStatus.COMPLETED,
    completed_at: new Date('2024-01-01T09:30:00Z'),
  };

  const mockSessionModel = {
    findOne: jest.fn(),
    findOneAndUpdate: jest.fn(),
    find: jest.fn(),
  };

  const mockTaskModel = {
    findOne: jest.fn(),
    find: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SessionFailureService,
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
            logSessionFailed: jest.fn(),
            logSessionStalled: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get<SessionFailureService>(SessionFailureService);
    sessionModel = module.get<Model<SessionDocument>>(getModelToken(Session.name));
    taskModel = module.get<Model<TaskDocument>>(getModelToken(Task.name));
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('markSessionFailed', () => {
    it('should mark an active session as failed', async () => {
      const markFailedDto: MarkFailedDto = {
        reason: 'Claude crashed',
        error_details: { error_code: 'ERR_CRASH', exit_code: 1 },
      };

      mockSessionModel.findOne.mockReturnValue({
        exec: jest.fn().mockResolvedValue(mockSession),
      });

      const failedSession = {
        ...mockSession,
        status: SessionStatus.FAILED,
        completed_at: expect.any(Date),
        metadata: {
          failure_reason: 'Claude crashed',
          failure_timestamp: expect.any(String),
          error_details: { error_code: 'ERR_CRASH', exit_code: 1 },
        },
      };

      mockSessionModel.findOneAndUpdate.mockReturnValue({
        exec: jest.fn().mockResolvedValue(failedSession),
      });

      const result = await service.markSessionFailed('test-session-id', markFailedDto);

      expect(mockSessionModel.findOne).toHaveBeenCalledWith({
        session_id: 'test-session-id',
      });
      expect(mockSessionModel.findOneAndUpdate).toHaveBeenCalledWith(
        { session_id: 'test-session-id' },
        {
          $set: expect.objectContaining({
            status: SessionStatus.FAILED,
            completed_at: expect.any(Date),
            metadata: expect.objectContaining({
              failure_reason: 'Claude crashed',
              error_details: { error_code: 'ERR_CRASH', exit_code: 1 },
            }),
          }),
        },
        { new: true }
      );
      expect(result.status).toBe(SessionStatus.FAILED);
    });

    it('should throw NotFoundException when session not found', async () => {
      mockSessionModel.findOne.mockReturnValue({
        exec: jest.fn().mockResolvedValue(null),
      });

      const markFailedDto: MarkFailedDto = { reason: 'Test failure' };

      await expect(
        service.markSessionFailed('non-existent', markFailedDto)
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw BadRequestException when marking completed session as failed', async () => {
      const completedSession = {
        ...mockSession,
        status: SessionStatus.COMPLETED,
      };

      mockSessionModel.findOne.mockReturnValue({
        exec: jest.fn().mockResolvedValue(completedSession),
      });

      const markFailedDto: MarkFailedDto = { reason: 'Test failure' };

      await expect(
        service.markSessionFailed('test-session-id', markFailedDto)
      ).rejects.toThrow(BadRequestException);
      await expect(
        service.markSessionFailed('test-session-id', markFailedDto)
      ).rejects.toThrow('Cannot mark completed session as failed');
    });

    it('should allow updating already failed session with new failure info', async () => {
      const failedSession = {
        ...mockSession,
        status: SessionStatus.FAILED,
        completed_at: new Date('2024-01-01T10:00:00Z'),
        metadata: {
          failure_reason: 'Old reason',
        },
      };

      mockSessionModel.findOne.mockReturnValue({
        exec: jest.fn().mockResolvedValue(failedSession),
      });

      const updatedFailedSession = {
        ...failedSession,
        metadata: {
          failure_reason: 'New reason',
          failure_timestamp: expect.any(String),
        },
      };

      mockSessionModel.findOneAndUpdate.mockReturnValue({
        exec: jest.fn().mockResolvedValue(updatedFailedSession),
      });

      const markFailedDto: MarkFailedDto = { reason: 'New reason' };
      const result = await service.markSessionFailed('test-session-id', markFailedDto);

      expect(result.metadata.failure_reason).toBe('New reason');
    });
  });

  describe('markSessionStalled', () => {
    it('should mark an active session as stalled', async () => {
      const markStalledDto: MarkStalledDto = {
        reason: 'No heartbeat for 15 minutes',
      };

      mockSessionModel.findOne.mockReturnValue({
        exec: jest.fn().mockResolvedValue(mockSession),
      });

      const stalledSession = {
        ...mockSession,
        status: SessionStatus.STALLED,
        metadata: {
          stalled_reason: 'No heartbeat for 15 minutes',
          stalled_timestamp: expect.any(String),
        },
      };

      mockSessionModel.findOneAndUpdate.mockReturnValue({
        exec: jest.fn().mockResolvedValue(stalledSession),
      });

      const result = await service.markSessionStalled('test-session-id', markStalledDto);

      expect(mockSessionModel.findOneAndUpdate).toHaveBeenCalledWith(
        { session_id: 'test-session-id' },
        {
          $set: expect.objectContaining({
            status: SessionStatus.STALLED,
            metadata: expect.objectContaining({
              stalled_reason: 'No heartbeat for 15 minutes',
            }),
          }),
        },
        { new: true }
      );
      expect(result.status).toBe(SessionStatus.STALLED);
    });

    it('should throw NotFoundException when session not found', async () => {
      mockSessionModel.findOne.mockReturnValue({
        exec: jest.fn().mockResolvedValue(null),
      });

      const markStalledDto: MarkStalledDto = { reason: 'Test stall' };

      await expect(
        service.markSessionStalled('non-existent', markStalledDto)
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw BadRequestException when marking completed session as stalled', async () => {
      const completedSession = {
        ...mockSession,
        status: SessionStatus.COMPLETED,
      };

      mockSessionModel.findOne.mockReturnValue({
        exec: jest.fn().mockResolvedValue(completedSession),
      });

      const markStalledDto: MarkStalledDto = { reason: 'Test stall' };

      await expect(
        service.markSessionStalled('test-session-id', markStalledDto)
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException when marking failed session as stalled', async () => {
      const failedSession = {
        ...mockSession,
        status: SessionStatus.FAILED,
      };

      mockSessionModel.findOne.mockReturnValue({
        exec: jest.fn().mockResolvedValue(failedSession),
      });

      const markStalledDto: MarkStalledDto = { reason: 'Test stall' };

      await expect(
        service.markSessionStalled('test-session-id', markStalledDto)
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('findFailedSessions', () => {
    it('should return failed sessions without filters', async () => {
      const failedSessions = [
        { ...mockSession, status: SessionStatus.FAILED },
      ];

      const execMock = jest.fn().mockResolvedValue(failedSessions);
      const skipMock = jest.fn().mockReturnValue({ exec: execMock });
      const limitMock = jest.fn().mockReturnValue({ skip: skipMock });
      const sortMock = jest.fn().mockReturnValue({ limit: limitMock });
      mockSessionModel.find.mockReturnValue({ sort: sortMock });

      const queryDto: FailedSessionQueryDto = {};
      const result = await service.findFailedSessions(queryDto);

      expect(mockSessionModel.find).toHaveBeenCalledWith({
        status: SessionStatus.FAILED,
      });
      expect(sortMock).toHaveBeenCalledWith({ completed_at: -1 });
      expect(result).toEqual(failedSessions);
    });

    it('should filter failed sessions by project_id', async () => {
      const execMock = jest.fn().mockResolvedValue([]);
      const skipMock = jest.fn().mockReturnValue({ exec: execMock });
      const limitMock = jest.fn().mockReturnValue({ skip: skipMock });
      const sortMock = jest.fn().mockReturnValue({ limit: limitMock });
      mockSessionModel.find.mockReturnValue({ sort: sortMock });

      const queryDto: FailedSessionQueryDto = { project_id: 'test-project' };
      await service.findFailedSessions(queryDto);

      expect(mockSessionModel.find).toHaveBeenCalledWith({
        status: SessionStatus.FAILED,
        project_id: 'test-project',
      });
    });

    it('should filter failed sessions by machine_id', async () => {
      const execMock = jest.fn().mockResolvedValue([]);
      const skipMock = jest.fn().mockReturnValue({ exec: execMock });
      const limitMock = jest.fn().mockReturnValue({ skip: skipMock });
      const sortMock = jest.fn().mockReturnValue({ limit: limitMock });
      mockSessionModel.find.mockReturnValue({ sort: sortMock });

      const queryDto: FailedSessionQueryDto = { machine_id: 'test-machine' };
      await service.findFailedSessions(queryDto);

      expect(mockSessionModel.find).toHaveBeenCalledWith({
        status: SessionStatus.FAILED,
        machine_id: 'test-machine',
      });
    });

    it('should apply pagination', async () => {
      const execMock = jest.fn().mockResolvedValue([]);
      const skipMock = jest.fn().mockReturnValue({ exec: execMock });
      const limitMock = jest.fn().mockReturnValue({ skip: skipMock });
      const sortMock = jest.fn().mockReturnValue({ limit: limitMock });
      mockSessionModel.find.mockReturnValue({ sort: sortMock });

      const queryDto: FailedSessionQueryDto = { limit: 50, offset: 100 };
      await service.findFailedSessions(queryDto);

      expect(limitMock).toHaveBeenCalledWith(50);
      expect(skipMock).toHaveBeenCalledWith(100);
    });
  });

  describe('getFailureInfo', () => {
    it('should return comprehensive failure information', async () => {
      const failedSession = {
        ...mockSession,
        status: SessionStatus.FAILED,
        completed_at: new Date('2024-01-01T10:00:00Z'),
        current_task_id: 'task-123',
        metadata: {
          failure_reason: 'Claude crashed',
          error_details: { error_code: 'ERR_CRASH' },
        },
        toObject: jest.fn().mockReturnValue({
          ...mockSession,
          status: SessionStatus.FAILED,
        }),
      };

      mockSessionModel.findOne.mockReturnValue({
        exec: jest.fn().mockResolvedValue(failedSession),
      });

      const sortMock = jest.fn().mockReturnValue({
        exec: jest.fn().mockResolvedValue(mockTask),
      });
      mockTaskModel.findOne.mockReturnValue({ sort: sortMock });

      const execMock = jest.fn().mockResolvedValue([]);
      mockTaskModel.find.mockReturnValue({ exec: execMock });

      const result = await service.getFailureInfo('test-session-id');

      expect(result.session_id).toBe('test-session-id');
      expect(result.status).toBe(SessionStatus.FAILED);
      expect(result.failure_reason).toBe('Claude crashed');
      expect(result.error_details).toEqual({ error_code: 'ERR_CRASH' });
      expect(result.last_successful_task_id).toBe('test-task-id');
      expect(result.last_successful_task_name).toBe('Test Task');
      expect(result.current_task_id).toBe('task-123');
      expect(result.analysis).toBeDefined();
      expect(result.analysis.recovery_recommendations).toBeDefined();
    });

    it('should throw NotFoundException when session not found', async () => {
      mockSessionModel.findOne.mockReturnValue({
        exec: jest.fn().mockResolvedValue(null),
      });

      await expect(service.getFailureInfo('non-existent')).rejects.toThrow(
        NotFoundException
      );
    });

    it('should throw BadRequestException when session is not failed', async () => {
      mockSessionModel.findOne.mockReturnValue({
        exec: jest.fn().mockResolvedValue(mockSession),
      });

      await expect(service.getFailureInfo('test-session-id')).rejects.toThrow(
        BadRequestException
      );
      await expect(service.getFailureInfo('test-session-id')).rejects.toThrow(
        'Session is not in failed state'
      );
    });

    it('should handle session with no last successful task', async () => {
      const failedSession = {
        ...mockSession,
        status: SessionStatus.FAILED,
        completed_at: new Date('2024-01-01T10:00:00Z'),
        metadata: { failure_reason: 'Unknown' },
        toObject: jest.fn().mockReturnValue({
          ...mockSession,
          status: SessionStatus.FAILED,
        }),
      };

      mockSessionModel.findOne.mockReturnValue({
        exec: jest.fn().mockResolvedValue(failedSession),
      });

      const sortMock = jest.fn().mockReturnValue({
        exec: jest.fn().mockResolvedValue(null),
      });
      mockTaskModel.findOne.mockReturnValue({ sort: sortMock });

      const execMock = jest.fn().mockResolvedValue([]);
      mockTaskModel.find.mockReturnValue({ exec: execMock });

      const result = await service.getFailureInfo('test-session-id');

      expect(result.last_successful_task_id).toBeUndefined();
      expect(result.last_successful_task_name).toBeUndefined();
    });
  });

  describe('analyzeFailure', () => {
    it('should detect very stale session (>15 minutes)', async () => {
      const staleSession = {
        ...mockSession,
        status: SessionStatus.FAILED,
        last_heartbeat: new Date(Date.now() - 20 * 60 * 1000), // 20 minutes ago
      };

      const execMock = jest.fn().mockResolvedValue([]);
      mockTaskModel.find.mockReturnValue({ exec: execMock });

      const result = await service.analyzeFailure(staleSession);

      expect(result.is_very_stale).toBe(true);
      expect(result.minutes_since_heartbeat).toBeGreaterThanOrEqual(19);
    });

    it('should detect stuck tasks', async () => {
      const stuckTasks = [
        { ...mockTask, status: TaskStatus.IN_PROGRESS },
        { ...mockTask, status: TaskStatus.IN_PROGRESS },
      ];

      const execMock = jest.fn().mockResolvedValue(stuckTasks);
      mockTaskModel.find.mockReturnValue({ exec: execMock });

      const result = await service.analyzeFailure(mockSession);

      expect(result.has_stuck_tasks).toBe(true);
      expect(result.stuck_task_count).toBe(2);
      expect(result.recovery_recommendations.some(r =>
        r.includes('Found 2 task(s) stuck in in_progress state')
      )).toBe(true);
    });

    it('should include docker slot in recommendations', async () => {
      const sessionWithDocker = {
        ...mockSession,
        docker_slot: 3,
      };

      const execMock = jest.fn().mockResolvedValue([]);
      mockTaskModel.find.mockReturnValue({ exec: execMock });

      const result = await service.analyzeFailure(sessionWithDocker);

      expect(result.recovery_recommendations.some(r =>
        r.includes('Docker slot 3')
      )).toBe(true);
    });
  });

  describe('getFailureStatistics', () => {
    it('should calculate failure statistics', async () => {
      const failedSessions = [
        {
          ...mockSession,
          machine_id: 'machine-1',
          status: SessionStatus.FAILED,
          started_at: new Date('2024-01-01T09:00:00Z'),
          completed_at: new Date('2024-01-01T10:00:00Z'),
        },
        {
          ...mockSession,
          machine_id: 'machine-1',
          status: SessionStatus.FAILED,
          started_at: new Date('2024-01-01T11:00:00Z'),
          completed_at: new Date('2024-01-01T12:00:00Z'),
        },
        {
          ...mockSession,
          machine_id: 'machine-2',
          status: SessionStatus.FAILED,
          started_at: new Date('2024-01-01T13:00:00Z'),
          completed_at: new Date('2024-01-01T14:00:00Z'),
        },
      ];

      const execMock = jest.fn().mockResolvedValue(failedSessions);
      mockSessionModel.find.mockReturnValue({ exec: execMock });

      const result = await service.getFailureStatistics();

      expect(result.total_failed).toBe(3);
      expect(result.failed_by_machine['machine-1']).toBe(2);
      expect(result.failed_by_machine['machine-2']).toBe(1);
      expect(result.average_duration_minutes).toBe(60); // All sessions are 1 hour
      expect(result.most_recent_failure).toEqual(new Date('2024-01-01T14:00:00Z'));
    });

    it('should filter statistics by project_id', async () => {
      const execMock = jest.fn().mockResolvedValue([]);
      mockSessionModel.find.mockReturnValue({ exec: execMock });

      await service.getFailureStatistics('test-project');

      expect(mockSessionModel.find).toHaveBeenCalledWith({
        status: SessionStatus.FAILED,
        project_id: 'test-project',
      });
    });

    it('should handle no failed sessions', async () => {
      const execMock = jest.fn().mockResolvedValue([]);
      mockSessionModel.find.mockReturnValue({ exec: execMock });

      const result = await service.getFailureStatistics();

      expect(result.total_failed).toBe(0);
      expect(result.failed_by_machine).toEqual({});
      expect(result.average_duration_minutes).toBe(0);
      expect(result.most_recent_failure).toBeUndefined();
    });
  });
});
