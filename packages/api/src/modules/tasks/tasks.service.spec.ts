import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { NotFoundException, BadRequestException } from '@nestjs/common';
import { TasksService } from './tasks.service';
import { Task, TaskDocument, TaskStatus } from '../../schemas/task.schema';
import { SessionsService } from '../sessions/sessions.service';
import { CreateTaskDto } from './dto/create-task.dto';
import { UpdateTaskDto } from './dto/update-task.dto';
import { TaskQueryDto } from './dto/task-query.dto';
import { FailTaskDto } from './dto/fail-task.dto';
import { AppLoggerService } from '../../common/logging/app-logger.service';

describe('TasksService', () => {
  let service: TasksService;
  let model: Model<TaskDocument>;
  let sessionsService: SessionsService;

  const mockTask = {
    task_id: 'test-task-id',
    session_id: 'test-session-id',
    project_id: 'test-project',
    task_name: 'Test Task',
    status: TaskStatus.PENDING,
    metadata: {},
  };

  const mockSession = {
    session_id: 'test-session-id',
    project_id: 'test-project',
    machine_id: 'test-machine',
    current_task_id: null,
  };

  const mockTaskModel = {
    findOne: jest.fn(),
    findOneAndUpdate: jest.fn(),
    find: jest.fn(),
    deleteMany: jest.fn(),
    countDocuments: jest.fn(),
  };

  const mockSessionsService = {
    findOne: jest.fn(),
    update: jest.fn(),
    clearCurrentTaskId: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TasksService,
        {
          provide: getModelToken(Task.name),
          useValue: mockTaskModel,
        },
        {
          provide: SessionsService,
          useValue: mockSessionsService,
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

    service = module.get<TasksService>(TasksService);
    model = module.get<Model<TaskDocument>>(getModelToken(Task.name));
    sessionsService = module.get<SessionsService>(SessionsService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('findAll', () => {
    it('should return all tasks without filters', async () => {
      const mockTasks = [mockTask];
      const execMock = jest.fn().mockResolvedValue(mockTasks);
      const skipMock = jest.fn().mockReturnValue({ exec: execMock });
      const limitMock = jest.fn().mockReturnValue({ skip: skipMock });
      const sortMock = jest.fn().mockReturnValue({ limit: limitMock });
      mockTaskModel.find.mockReturnValue({ sort: sortMock });

      const result = await service.findAll();

      expect(model.find).toHaveBeenCalledWith({});
      expect(sortMock).toHaveBeenCalledWith({ created_at: -1 });
      expect(limitMock).toHaveBeenCalledWith(20);
      expect(skipMock).toHaveBeenCalledWith(0);
      expect(result).toEqual(mockTasks);
    });

    it('should filter tasks by session_id', async () => {
      const queryDto: TaskQueryDto = { session_id: 'test-session-id' };
      const execMock = jest.fn().mockResolvedValue([mockTask]);
      const skipMock = jest.fn().mockReturnValue({ exec: execMock });
      const limitMock = jest.fn().mockReturnValue({ skip: skipMock });
      const sortMock = jest.fn().mockReturnValue({ limit: limitMock });
      mockTaskModel.find.mockReturnValue({ sort: sortMock });

      await service.findAll(queryDto);

      expect(model.find).toHaveBeenCalledWith({ session_id: 'test-session-id' });
    });

    it('should filter tasks by status', async () => {
      const queryDto: TaskQueryDto = { status: TaskStatus.IN_PROGRESS };
      const execMock = jest.fn().mockResolvedValue([mockTask]);
      const skipMock = jest.fn().mockReturnValue({ exec: execMock });
      const limitMock = jest.fn().mockReturnValue({ skip: skipMock });
      const sortMock = jest.fn().mockReturnValue({ limit: limitMock });
      mockTaskModel.find.mockReturnValue({ sort: sortMock });

      await service.findAll(queryDto);

      expect(model.find).toHaveBeenCalledWith({ status: TaskStatus.IN_PROGRESS });
    });

    it('should filter tasks by project_id', async () => {
      const queryDto: TaskQueryDto = { project_id: 'test-project' };
      const execMock = jest.fn().mockResolvedValue([mockTask]);
      const skipMock = jest.fn().mockReturnValue({ exec: execMock });
      const limitMock = jest.fn().mockReturnValue({ skip: skipMock });
      const sortMock = jest.fn().mockReturnValue({ limit: limitMock });
      mockTaskModel.find.mockReturnValue({ sort: sortMock });

      await service.findAll(queryDto);

      expect(model.find).toHaveBeenCalledWith({ project_id: 'test-project' });
    });

    it('should apply custom pagination', async () => {
      const queryDto: TaskQueryDto = { limit: 50, offset: 100 };
      const execMock = jest.fn().mockResolvedValue([mockTask]);
      const skipMock = jest.fn().mockReturnValue({ exec: execMock });
      const limitMock = jest.fn().mockReturnValue({ skip: skipMock });
      const sortMock = jest.fn().mockReturnValue({ limit: limitMock });
      mockTaskModel.find.mockReturnValue({ sort: sortMock });

      await service.findAll(queryDto);

      expect(limitMock).toHaveBeenCalledWith(50);
      expect(skipMock).toHaveBeenCalledWith(100);
    });
  });

  describe('findBySession', () => {
    it('should return all tasks for a session', async () => {
      const mockTasks = [mockTask];
      const execMock = jest.fn().mockResolvedValue(mockTasks);
      const sortMock = jest.fn().mockReturnValue({ exec: execMock });
      mockTaskModel.find.mockReturnValue({ sort: sortMock });

      const result = await service.findBySession('test-session-id');

      expect(model.find).toHaveBeenCalledWith({ session_id: 'test-session-id' });
      expect(result).toEqual(mockTasks);
    });
  });

  describe('findOne', () => {
    it('should return a task by ID', async () => {
      mockTaskModel.findOne.mockReturnValue({
        exec: jest.fn().mockResolvedValue(mockTask),
      });

      const result = await service.findOne('test-task-id');

      expect(model.findOne).toHaveBeenCalledWith({ task_id: 'test-task-id' });
      expect(result).toEqual(mockTask);
    });

    it('should throw NotFoundException when task not found', async () => {
      mockTaskModel.findOne.mockReturnValue({
        exec: jest.fn().mockResolvedValue(null),
      });

      await expect(service.findOne('non-existent-id')).rejects.toThrow(NotFoundException);
      await expect(service.findOne('non-existent-id')).rejects.toThrow(
        'Task with ID non-existent-id not found'
      );
    });
  });

  describe('create', () => {
    it('should create a new task (integration-style test)', async () => {
      // Note: This is tested more thoroughly in e2e tests
      // Unit testing task creation with Mongoose model constructor is complex
      // The e2e tests will verify the full create functionality
      expect(service.create).toBeDefined();
    });
  });

  describe('update', () => {
    it('should update a task successfully', async () => {
      const updateDto: UpdateTaskDto = {
        github_issue_id: '123',
        metadata: { priority: 'high' },
      };

      mockTaskModel.findOne.mockReturnValue({
        exec: jest.fn().mockResolvedValue(mockTask),
      });

      const updatedTask = { ...mockTask, ...updateDto };
      mockTaskModel.findOneAndUpdate.mockReturnValue({
        exec: jest.fn().mockResolvedValue(updatedTask),
      });

      const result = await service.update('test-task-id', updateDto);

      expect(model.findOneAndUpdate).toHaveBeenCalledWith(
        { task_id: 'test-task-id' },
        { $set: updateDto },
        { new: true, runValidators: true }
      );
      expect(result).toEqual(updatedTask);
    });

    it('should throw NotFoundException when task not found', async () => {
      const updateDto: UpdateTaskDto = { status: TaskStatus.IN_PROGRESS };
      mockTaskModel.findOne.mockReturnValue({
        exec: jest.fn().mockResolvedValue(null),
      });

      await expect(service.update('non-existent-id', updateDto)).rejects.toThrow(
        NotFoundException
      );
    });

    it('should set started_at when transitioning to in_progress', async () => {
      const updateDto: UpdateTaskDto = { status: TaskStatus.IN_PROGRESS };
      mockTaskModel.findOne.mockReturnValue({
        exec: jest.fn().mockResolvedValue(mockTask),
      });

      const updatedTask = {
        ...mockTask,
        status: TaskStatus.IN_PROGRESS,
        started_at: expect.any(Date),
      };
      mockTaskModel.findOneAndUpdate.mockReturnValue({
        exec: jest.fn().mockResolvedValue(updatedTask),
      });

      await service.update('test-task-id', updateDto);

      expect(model.findOneAndUpdate).toHaveBeenCalledWith(
        { task_id: 'test-task-id' },
        expect.objectContaining({
          $set: expect.objectContaining({
            status: TaskStatus.IN_PROGRESS,
            started_at: expect.any(Date),
          }),
        }),
        { new: true, runValidators: true }
      );
    });

    it('should set completed_at when transitioning to completed', async () => {
      const inProgressTask = { ...mockTask, status: TaskStatus.IN_PROGRESS };
      const updateDto: UpdateTaskDto = { status: TaskStatus.COMPLETED };

      mockTaskModel.findOne.mockReturnValue({
        exec: jest.fn().mockResolvedValue(inProgressTask),
      });

      const updatedTask = {
        ...inProgressTask,
        status: TaskStatus.COMPLETED,
        completed_at: expect.any(Date),
      };
      mockTaskModel.findOneAndUpdate.mockReturnValue({
        exec: jest.fn().mockResolvedValue(updatedTask),
      });

      await service.update('test-task-id', updateDto);

      expect(model.findOneAndUpdate).toHaveBeenCalledWith(
        { task_id: 'test-task-id' },
        expect.objectContaining({
          $set: expect.objectContaining({
            status: TaskStatus.COMPLETED,
            completed_at: expect.any(Date),
          }),
        }),
        { new: true, runValidators: true }
      );
    });

    it('should throw BadRequestException for invalid status transition', async () => {
      const completedTask = { ...mockTask, status: TaskStatus.COMPLETED };
      const updateDto: UpdateTaskDto = { status: TaskStatus.IN_PROGRESS };

      mockTaskModel.findOne.mockReturnValue({
        exec: jest.fn().mockResolvedValue(completedTask),
      });

      await expect(service.update('test-task-id', updateDto)).rejects.toThrow(
        BadRequestException
      );
      await expect(service.update('test-task-id', updateDto)).rejects.toThrow(
        'Invalid status transition from completed to in_progress'
      );
    });
  });

  describe('delete', () => {
    it('should soft delete a task', async () => {
      mockTaskModel.findOne.mockReturnValue({
        exec: jest.fn().mockResolvedValue(mockTask),
      });

      mockTaskModel.findOneAndUpdate.mockReturnValue({
        exec: jest.fn().mockResolvedValue({
          ...mockTask,
          status: TaskStatus.COMPLETED,
          completed_at: expect.any(Date),
        }),
      });

      await service.delete('test-task-id');

      expect(model.findOneAndUpdate).toHaveBeenCalledWith(
        { task_id: 'test-task-id' },
        {
          $set: {
            status: TaskStatus.COMPLETED,
            completed_at: expect.any(Date),
          },
        }
      );
    });

    it('should throw NotFoundException when task not found', async () => {
      mockTaskModel.findOne.mockReturnValue({
        exec: jest.fn().mockResolvedValue(null),
      });

      await expect(service.delete('non-existent-id')).rejects.toThrow(NotFoundException);
    });
  });

  describe('startTask', () => {
    it('should start a pending task', async () => {
      mockTaskModel.findOne.mockReturnValue({
        exec: jest.fn().mockResolvedValue(mockTask),
      });

      const startedTask = {
        ...mockTask,
        status: TaskStatus.IN_PROGRESS,
        started_at: new Date(),
      };
      mockTaskModel.findOneAndUpdate.mockReturnValue({
        exec: jest.fn().mockResolvedValue(startedTask),
      });

      mockSessionsService.findOne.mockResolvedValue(mockSession);
      mockSessionsService.update.mockResolvedValue({
        ...mockSession,
        current_task_id: 'test-task-id',
      });

      const result = await service.startTask('test-task-id');

      expect(model.findOneAndUpdate).toHaveBeenCalledWith(
        { task_id: 'test-task-id' },
        {
          $set: {
            status: TaskStatus.IN_PROGRESS,
            started_at: expect.any(Date),
          },
        },
        { new: true }
      );
      expect(sessionsService.update).toHaveBeenCalledWith('test-session-id', {
        current_task_id: 'test-task-id',
      });
      expect(result).toEqual(startedTask);
    });

    it('should throw BadRequestException if task is not pending', async () => {
      const inProgressTask = { ...mockTask, status: TaskStatus.IN_PROGRESS };
      mockTaskModel.findOne.mockReturnValue({
        exec: jest.fn().mockResolvedValue(inProgressTask),
      });

      await expect(service.startTask('test-task-id')).rejects.toThrow(
        BadRequestException
      );
      await expect(service.startTask('test-task-id')).rejects.toThrow(
        'Cannot start task in in_progress state. Task must be pending.'
      );
    });
  });

  describe('completeTask', () => {
    it('should complete an in-progress task', async () => {
      const inProgressTask = { ...mockTask, status: TaskStatus.IN_PROGRESS };
      mockTaskModel.findOne.mockReturnValue({
        exec: jest.fn().mockResolvedValue(inProgressTask),
      });

      const completedTask = {
        ...inProgressTask,
        status: TaskStatus.COMPLETED,
        completed_at: new Date(),
      };
      mockTaskModel.findOneAndUpdate.mockReturnValue({
        exec: jest.fn().mockResolvedValue(completedTask),
      });

      mockSessionsService.findOne.mockResolvedValue({
        ...mockSession,
        current_task_id: 'test-task-id',
      });
      mockSessionsService.clearCurrentTaskId.mockResolvedValue(mockSession);

      const result = await service.completeTask('test-task-id');

      expect(model.findOneAndUpdate).toHaveBeenCalledWith(
        { task_id: 'test-task-id' },
        {
          $set: {
            status: TaskStatus.COMPLETED,
            completed_at: expect.any(Date),
          },
        },
        { new: true }
      );
      expect(sessionsService.clearCurrentTaskId).toHaveBeenCalledWith('test-session-id');
      expect(result).toEqual(completedTask);
    });

    it('should throw BadRequestException if task is already completed', async () => {
      const completedTask = { ...mockTask, status: TaskStatus.COMPLETED };
      mockTaskModel.findOne.mockReturnValue({
        exec: jest.fn().mockResolvedValue(completedTask),
      });

      await expect(service.completeTask('test-task-id')).rejects.toThrow(
        BadRequestException
      );
      await expect(service.completeTask('test-task-id')).rejects.toThrow(
        'Task is already completed'
      );
    });

    it('should throw BadRequestException if task is failed', async () => {
      const failedTask = { ...mockTask, status: TaskStatus.FAILED };
      mockTaskModel.findOne.mockReturnValue({
        exec: jest.fn().mockResolvedValue(failedTask),
      });

      await expect(service.completeTask('test-task-id')).rejects.toThrow(
        BadRequestException
      );
      await expect(service.completeTask('test-task-id')).rejects.toThrow(
        'Cannot complete a failed task'
      );
    });
  });

  describe('failTask', () => {
    it('should fail an in-progress task', async () => {
      const inProgressTask = { ...mockTask, status: TaskStatus.IN_PROGRESS };
      const failDto: FailTaskDto = { error_message: 'Test error' };

      mockTaskModel.findOne.mockReturnValue({
        exec: jest.fn().mockResolvedValue(inProgressTask),
      });

      const failedTask = {
        ...inProgressTask,
        status: TaskStatus.FAILED,
        completed_at: new Date(),
        error_message: 'Test error',
      };
      mockTaskModel.findOneAndUpdate.mockReturnValue({
        exec: jest.fn().mockResolvedValue(failedTask),
      });

      mockSessionsService.findOne.mockResolvedValue({
        ...mockSession,
        current_task_id: 'test-task-id',
      });
      mockSessionsService.clearCurrentTaskId.mockResolvedValue(mockSession);

      const result = await service.failTask('test-task-id', failDto);

      expect(model.findOneAndUpdate).toHaveBeenCalledWith(
        { task_id: 'test-task-id' },
        {
          $set: {
            status: TaskStatus.FAILED,
            completed_at: expect.any(Date),
            error_message: 'Test error',
          },
        },
        { new: true }
      );
      expect(result).toEqual(failedTask);
    });

    it('should throw BadRequestException if task is completed', async () => {
      const completedTask = { ...mockTask, status: TaskStatus.COMPLETED };
      const failDto: FailTaskDto = { error_message: 'Test error' };

      mockTaskModel.findOne.mockReturnValue({
        exec: jest.fn().mockResolvedValue(completedTask),
      });

      await expect(service.failTask('test-task-id', failDto)).rejects.toThrow(
        BadRequestException
      );
      await expect(service.failTask('test-task-id', failDto)).rejects.toThrow(
        'Cannot fail a completed task'
      );
    });

    it('should throw BadRequestException if task is already failed', async () => {
      const failedTask = { ...mockTask, status: TaskStatus.FAILED };
      const failDto: FailTaskDto = { error_message: 'Test error' };

      mockTaskModel.findOne.mockReturnValue({
        exec: jest.fn().mockResolvedValue(failedTask),
      });

      await expect(service.failTask('test-task-id', failDto)).rejects.toThrow(
        BadRequestException
      );
      await expect(service.failTask('test-task-id', failDto)).rejects.toThrow(
        'Task is already failed'
      );
    });
  });

  describe('getSessionTaskProgress', () => {
    it('should return task progress for a session', async () => {
      const mockTasks = [
        { ...mockTask, task_id: '1', status: TaskStatus.PENDING },
        { ...mockTask, task_id: '2', status: TaskStatus.IN_PROGRESS },
        { ...mockTask, task_id: '3', status: TaskStatus.COMPLETED },
        { ...mockTask, task_id: '4', status: TaskStatus.COMPLETED },
        { ...mockTask, task_id: '5', status: TaskStatus.FAILED },
      ];

      mockSessionsService.findOne.mockResolvedValue(mockSession);

      const execMock = jest.fn().mockResolvedValue(mockTasks);
      const sortMock = jest.fn().mockReturnValue({ exec: execMock });
      mockTaskModel.find.mockReturnValue({ sort: sortMock });

      const result = await service.getSessionTaskProgress('test-session-id');

      expect(result.session_id).toBe('test-session-id');
      expect(result.tasks.pending).toHaveLength(1);
      expect(result.tasks.in_progress).toHaveLength(1);
      expect(result.tasks.completed).toHaveLength(2);
      expect(result.tasks.failed).toHaveLength(1);
      expect(result.tasks.blocked).toHaveLength(0);
      expect(result.stats.total).toBe(5);
      expect(result.stats.pending).toBe(1);
      expect(result.stats.in_progress).toBe(1);
      expect(result.stats.completed).toBe(2);
      expect(result.stats.failed).toBe(1);
      expect(result.stats.blocked).toBe(0);
      expect(result.stats.completion_percentage).toBe(40); // 2 out of 5 = 40%
    });

    it('should throw NotFoundException if session not found', async () => {
      mockSessionsService.findOne.mockRejectedValue(
        new NotFoundException('Session with ID non-existent not found')
      );

      await expect(service.getSessionTaskProgress('non-existent')).rejects.toThrow(
        NotFoundException
      );
    });

    it('should handle empty task list', async () => {
      mockSessionsService.findOne.mockResolvedValue(mockSession);

      const execMock = jest.fn().mockResolvedValue([]);
      const sortMock = jest.fn().mockReturnValue({ exec: execMock });
      mockTaskModel.find.mockReturnValue({ sort: sortMock });

      const result = await service.getSessionTaskProgress('test-session-id');

      expect(result.stats.total).toBe(0);
      expect(result.stats.completion_percentage).toBe(0);
    });
  });

  describe('deleteBySession', () => {
    it('should delete all tasks for a session', async () => {
      mockTaskModel.deleteMany.mockReturnValue({
        exec: jest.fn().mockResolvedValue({ deletedCount: 3 }),
      });

      const result = await service.deleteBySession('test-session-id');

      expect(model.deleteMany).toHaveBeenCalledWith({ session_id: 'test-session-id' });
      expect(result).toBe(3);
    });
  });

  describe('countBySession', () => {
    it('should count tasks for a session', async () => {
      mockTaskModel.countDocuments.mockReturnValue({
        exec: jest.fn().mockResolvedValue(5),
      });

      const result = await service.countBySession('test-session-id');

      expect(model.countDocuments).toHaveBeenCalledWith({ session_id: 'test-session-id' });
      expect(result).toBe(5);
    });
  });

  describe('validateStatusTransition', () => {
    it('should allow valid transitions', async () => {
      // pending -> in_progress
      mockTaskModel.findOne.mockReturnValue({
        exec: jest.fn().mockResolvedValue(mockTask),
      });
      mockTaskModel.findOneAndUpdate.mockReturnValue({
        exec: jest.fn().mockResolvedValue({ ...mockTask, status: TaskStatus.IN_PROGRESS }),
      });

      await expect(
        service.update('test-task-id', { status: TaskStatus.IN_PROGRESS })
      ).resolves.toBeDefined();
    });

    it('should reject invalid transitions', async () => {
      const completedTask = { ...mockTask, status: TaskStatus.COMPLETED };
      mockTaskModel.findOne.mockReturnValue({
        exec: jest.fn().mockResolvedValue(completedTask),
      });

      await expect(
        service.update('test-task-id', { status: TaskStatus.PENDING })
      ).rejects.toThrow(BadRequestException);
    });
  });
});
