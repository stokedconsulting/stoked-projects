import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { NotFoundException, BadRequestException } from '@nestjs/common';
import { SessionCleanupService } from './session-cleanup.service';
import { TasksService } from '../tasks/tasks.service';
import { Session, SessionDocument, SessionStatus } from '../../schemas/session.schema';
import { CleanupRequestDto } from './dto/cleanup-request.dto';

describe('SessionCleanupService', () => {
  let service: SessionCleanupService;
  let model: Model<SessionDocument>;
  let tasksService: TasksService;

  const mockSession = {
    session_id: 'test-session-id',
    project_id: 'test-project',
    machine_id: 'test-machine',
    status: SessionStatus.COMPLETED,
    last_heartbeat: new Date('2024-01-01T10:00:00Z'),
    started_at: new Date('2024-01-01T09:00:00Z'),
    completed_at: new Date('2024-01-01T11:00:00Z'),
    metadata: {},
  };

  const mockSessionModel = {
    findOne: jest.fn(),
    findOneAndUpdate: jest.fn(),
    deleteOne: jest.fn(),
    deleteMany: jest.fn(),
    find: jest.fn(),
    countDocuments: jest.fn(),
  };

  const mockTasksService = {
    countBySession: jest.fn(),
    deleteBySession: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SessionCleanupService,
        {
          provide: getModelToken(Session.name),
          useValue: mockSessionModel,
        },
        {
          provide: TasksService,
          useValue: mockTasksService,
        },
      ],
    }).compile();

    service = module.get<SessionCleanupService>(SessionCleanupService);
    model = module.get<Model<SessionDocument>>(getModelToken(Session.name));
    tasksService = module.get<TasksService>(TasksService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('archiveSession', () => {
    it('should archive a completed session', async () => {
      const completedSession = { ...mockSession, status: SessionStatus.COMPLETED };
      mockSessionModel.findOne.mockReturnValue({
        exec: jest.fn().mockResolvedValue(completedSession),
      });

      const archivedSession = {
        ...completedSession,
        status: SessionStatus.ARCHIVED,
        updated_at: expect.any(Date),
      };
      mockSessionModel.findOneAndUpdate.mockReturnValue({
        exec: jest.fn().mockResolvedValue(archivedSession),
      });

      const result = await service.archiveSession('test-session-id');

      expect(model.findOne).toHaveBeenCalledWith({ session_id: 'test-session-id' });
      expect(model.findOneAndUpdate).toHaveBeenCalledWith(
        { session_id: 'test-session-id' },
        {
          $set: {
            status: SessionStatus.ARCHIVED,
            updated_at: expect.any(Date),
          }
        },
        { new: true }
      );
      expect(result.status).toBe(SessionStatus.ARCHIVED);
    });

    it('should archive a failed session', async () => {
      const failedSession = { ...mockSession, status: SessionStatus.FAILED };
      mockSessionModel.findOne.mockReturnValue({
        exec: jest.fn().mockResolvedValue(failedSession),
      });
      mockSessionModel.findOneAndUpdate.mockReturnValue({
        exec: jest.fn().mockResolvedValue({ ...failedSession, status: SessionStatus.ARCHIVED }),
      });

      const result = await service.archiveSession('test-session-id');

      expect(result.status).toBe(SessionStatus.ARCHIVED);
    });

    it('should throw BadRequestException for active session', async () => {
      const activeSession = { ...mockSession, status: SessionStatus.ACTIVE };
      mockSessionModel.findOne.mockReturnValue({
        exec: jest.fn().mockResolvedValue(activeSession),
      });

      await expect(service.archiveSession('test-session-id')).rejects.toThrow(BadRequestException);
      await expect(service.archiveSession('test-session-id')).rejects.toThrow(
        /Cannot archive session with status/
      );
    });

    it('should throw NotFoundException if session not found', async () => {
      mockSessionModel.findOne.mockReturnValue({
        exec: jest.fn().mockResolvedValue(null),
      });

      await expect(service.archiveSession('non-existent-id')).rejects.toThrow(NotFoundException);
    });
  });

  describe('purgeSession', () => {
    it('should purge a completed session with cascade delete', async () => {
      mockSessionModel.findOne.mockReturnValue({
        exec: jest.fn().mockResolvedValue(mockSession),
      });
      mockTasksService.countBySession.mockResolvedValue(5);
      mockTasksService.deleteBySession.mockResolvedValue(5);
      mockSessionModel.deleteOne.mockReturnValue({
        exec: jest.fn().mockResolvedValue({ deletedCount: 1 }),
      });

      const result = await service.purgeSession('test-session-id', true);

      expect(result.session_id).toBe('test-session-id');
      expect(result.tasks_deleted).toBe(5);
      expect(result.purged_at).toBeInstanceOf(Date);
      expect(tasksService.countBySession).toHaveBeenCalledWith('test-session-id');
      expect(tasksService.deleteBySession).toHaveBeenCalledWith('test-session-id');
      expect(model.deleteOne).toHaveBeenCalledWith({ session_id: 'test-session-id' });
    });

    it('should throw BadRequestException if confirmation is false', async () => {
      await expect(service.purgeSession('test-session-id', false)).rejects.toThrow(
        BadRequestException
      );
      await expect(service.purgeSession('test-session-id', false)).rejects.toThrow(
        /Confirmation required/
      );
    });

    it('should throw BadRequestException for active session', async () => {
      const activeSession = { ...mockSession, status: SessionStatus.ACTIVE };
      mockSessionModel.findOne.mockReturnValue({
        exec: jest.fn().mockResolvedValue(activeSession),
      });

      await expect(service.purgeSession('test-session-id', true)).rejects.toThrow(
        BadRequestException
      );
      await expect(service.purgeSession('test-session-id', true)).rejects.toThrow(
        /Cannot purge session with status/
      );
    });

    it('should throw NotFoundException if session not found', async () => {
      mockSessionModel.findOne.mockReturnValue({
        exec: jest.fn().mockResolvedValue(null),
      });

      await expect(service.purgeSession('non-existent-id', true)).rejects.toThrow(NotFoundException);
    });
  });

  describe('bulkCleanup', () => {
    it('should archive old sessions in dry-run mode', async () => {
      const oldSession1 = { ...mockSession, session_id: 'session-1', status: SessionStatus.COMPLETED };
      const oldSession2 = { ...mockSession, session_id: 'session-2', status: SessionStatus.FAILED };

      const query = jest.fn().mockReturnValue(Promise.resolve([oldSession1, oldSession2]));
      mockSessionModel.find.mockReturnValue({ exec: query });

      const request: CleanupRequestDto = {
        older_than_days: 30,
        statuses: [SessionStatus.COMPLETED, SessionStatus.FAILED],
        dry_run: true,
        archive: true,
      };

      const result = await service.bulkCleanup(request);

      expect(result.sessions_affected).toBe(2);
      expect(result.operation).toBe('dry_run');
      expect(result.breakdown_by_status).toEqual({
        completed: 1,
        failed: 1,
      });
    });

    it('should archive old sessions and delete associated tasks', async () => {
      const oldSession = { ...mockSession, session_id: 'session-1' };
      const query = jest.fn().mockReturnValue(Promise.resolve([oldSession]));
      mockSessionModel.find.mockReturnValue({ exec: query });

      jest.spyOn(service, 'archiveSession').mockResolvedValue(oldSession as any);
      mockTasksService.countBySession.mockResolvedValue(3);

      const request: CleanupRequestDto = {
        older_than_days: 30,
        statuses: [SessionStatus.COMPLETED],
        dry_run: false,
        archive: true,
      };

      const result = await service.bulkCleanup(request);

      expect(result.sessions_affected).toBe(1);
      expect(result.operation).toBe('archive');
      expect(result.tasks_deleted).toBe(3);
    });

    it('should purge old sessions and delete associated tasks', async () => {
      const oldSession = { ...mockSession, session_id: 'session-1' };
      const query = jest.fn().mockReturnValue(Promise.resolve([oldSession]));
      mockSessionModel.find.mockReturnValue({ exec: query });

      mockTasksService.countBySession.mockResolvedValue(2);
      mockTasksService.deleteBySession.mockResolvedValue(2);
      mockSessionModel.deleteOne.mockReturnValue({
        exec: jest.fn().mockResolvedValue({ deletedCount: 1 }),
      });

      const request: CleanupRequestDto = {
        older_than_days: 30,
        statuses: [SessionStatus.COMPLETED],
        dry_run: false,
        archive: false,
      };

      const result = await service.bulkCleanup(request);

      expect(result.sessions_affected).toBe(1);
      expect(result.operation).toBe('delete');
      expect(result.tasks_deleted).toBe(2);
    });

    it('should calculate estimated space freed', async () => {
      const oldSession1 = { ...mockSession, session_id: 'session-1' };
      const oldSession2 = { ...mockSession, session_id: 'session-2' };
      const query = jest.fn().mockReturnValue(Promise.resolve([oldSession1, oldSession2]));
      mockSessionModel.find.mockReturnValue({ exec: query });

      const request: CleanupRequestDto = {
        older_than_days: 30,
        statuses: [SessionStatus.COMPLETED],
        dry_run: true,
        archive: true,
      };

      const result = await service.bulkCleanup(request);

      // 2 sessions * 2048 bytes (no tasks counted in dry-run) = 4096 bytes
      expect(result.estimated_space_freed_bytes).toBe(4096);
    });
  });

  describe('findArchivedSessions', () => {
    it('should find archived sessions without filters', async () => {
      const archivedSessions = [
        { ...mockSession, status: SessionStatus.ARCHIVED, session_id: 'archived-1' },
        { ...mockSession, status: SessionStatus.ARCHIVED, session_id: 'archived-2' },
      ];

      const limitMock = jest.fn().mockReturnValue({
        skip: jest.fn().mockReturnValue({
          exec: jest.fn().mockResolvedValue(archivedSessions),
        }),
      });

      const sortMock = jest.fn().mockReturnValue({ limit: limitMock });
      mockSessionModel.find.mockReturnValue({ sort: sortMock });

      const result = await service.findArchivedSessions();

      expect(model.find).toHaveBeenCalledWith({ status: SessionStatus.ARCHIVED });
      expect(result).toEqual(archivedSessions);
    });

    it('should filter archived sessions by project_id', async () => {
      const limitMock = jest.fn().mockReturnValue({
        skip: jest.fn().mockReturnValue({
          exec: jest.fn().mockResolvedValue([]),
        }),
      });

      const sortMock = jest.fn().mockReturnValue({ limit: limitMock });
      mockSessionModel.find.mockReturnValue({ sort: sortMock });

      await service.findArchivedSessions('project-123');

      expect(model.find).toHaveBeenCalledWith({
        status: SessionStatus.ARCHIVED,
        project_id: 'project-123',
      });
    });

    it('should apply pagination', async () => {
      const limitMock = jest.fn().mockReturnValue({
        skip: jest.fn().mockReturnValue({
          exec: jest.fn().mockResolvedValue([]),
        }),
      });

      const sortMock = jest.fn().mockReturnValue({ limit: limitMock });
      mockSessionModel.find.mockReturnValue({ sort: sortMock });

      await service.findArchivedSessions(undefined, undefined, 50, 100);

      expect(limitMock).toHaveBeenCalledWith(50);
      expect(limitMock().skip).toHaveBeenCalledWith(100);
    });
  });

  describe('countArchived', () => {
    it('should count archived sessions', async () => {
      mockSessionModel.countDocuments.mockReturnValue({
        exec: jest.fn().mockResolvedValue(42),
      });

      const result = await service.countArchived();

      expect(model.countDocuments).toHaveBeenCalledWith({ status: SessionStatus.ARCHIVED });
      expect(result).toBe(42);
    });

    it('should count archived sessions by project_id', async () => {
      mockSessionModel.countDocuments.mockReturnValue({
        exec: jest.fn().mockResolvedValue(10),
      });

      const result = await service.countArchived('project-123');

      expect(model.countDocuments).toHaveBeenCalledWith({
        status: SessionStatus.ARCHIVED,
        project_id: 'project-123',
      });
      expect(result).toBe(10);
    });
  });

  describe('cleanupOldArchivedSessions', () => {
    it('should archive sessions older than 90 days', async () => {
      const oldSession = { ...mockSession, session_id: 'old-session' };
      const query = jest.fn().mockReturnValue(Promise.resolve([oldSession]));
      mockSessionModel.find.mockReturnValue({
        select: jest.fn().mockReturnValue({ exec: query }),
      });

      jest.spyOn(service, 'archiveSession').mockResolvedValue(oldSession as any);

      const result = await service.cleanupOldArchivedSessions();

      expect(result.archived_count).toBe(1);
      expect(result.details).toContain('Archived 1 sessions');
    });

    it('should handle empty cleanup results', async () => {
      const query = jest.fn().mockReturnValue(Promise.resolve([]));
      mockSessionModel.find.mockReturnValue({
        select: jest.fn().mockReturnValue({ exec: query }),
      });

      const result = await service.cleanupOldArchivedSessions();

      expect(result.archived_count).toBe(0);
      expect(result.details).toBe('No sessions matching cleanup criteria');
    });
  });

  describe('findSessionsApproachingTTL', () => {
    it('should find sessions approaching 30-day TTL', async () => {
      const sessionsApproaching = [
        { session_id: 'session-1' },
        { session_id: 'session-2' },
      ];

      const query = jest.fn().mockReturnValue(Promise.resolve(sessionsApproaching));
      mockSessionModel.find.mockReturnValue({
        select: jest.fn().mockReturnValue({ exec: query }),
      });

      const result = await service.findSessionsApproachingTTL();

      expect(result).toEqual(['session-1', 'session-2']);
    });

    it('should return empty array when no sessions approaching TTL', async () => {
      const query = jest.fn().mockReturnValue(Promise.resolve([]));
      mockSessionModel.find.mockReturnValue({
        select: jest.fn().mockReturnValue({ exec: query }),
      });

      const result = await service.findSessionsApproachingTTL();

      expect(result).toEqual([]);
    });
  });
});
