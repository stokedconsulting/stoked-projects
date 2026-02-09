import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, FilterQuery } from 'mongoose';
import { Task, TaskDocument, TaskStatus } from '../../schemas/task.schema';
import { CreateTaskDto } from './dto/create-task.dto';
import { UpdateTaskDto } from './dto/update-task.dto';
import { TaskQueryDto } from './dto/task-query.dto';
import { FailTaskDto } from './dto/fail-task.dto';
import { TaskProgressDto, TasksByStatus, TaskProgressStats } from './dto/task-progress.dto';
import { SessionsService } from '../sessions/sessions.service';
import { randomUUID } from 'crypto';
import { AppLoggerService } from '../../common/logging/app-logger.service';

@Injectable()
export class TasksService {
  constructor(
    @InjectModel(Task.name) private taskModel: Model<TaskDocument>,
    private sessionsService: SessionsService,
    private readonly logger: AppLoggerService,
  ) {
    this.logger.setContext('TasksService');
  }

  /**
   * Find all tasks with optional filtering and pagination
   * @param queryDto - Query parameters for filtering
   * @returns Array of tasks matching the query
   */
  async findAll(queryDto?: TaskQueryDto): Promise<Task[]> {
    const filter: FilterQuery<TaskDocument> = {};

    if (queryDto?.session_id) {
      filter.session_id = queryDto.session_id;
    }
    if (queryDto?.status) {
      filter.status = queryDto.status;
    }
    if (queryDto?.project_id) {
      filter.project_id = queryDto.project_id;
    }

    const limit = queryDto?.limit || 20;
    const offset = queryDto?.offset || 0;

    return this.taskModel
      .find(filter)
      .sort({ created_at: -1 })
      .limit(limit)
      .skip(offset)
      .exec();
  }

  /**
   * Find tasks by session ID
   * @param sessionId - The session ID to filter by
   * @returns Array of tasks for the session
   */
  async findBySession(sessionId: string): Promise<Task[]> {
    return this.taskModel
      .find({ session_id: sessionId })
      .sort({ created_at: -1 })
      .exec();
  }

  /**
   * Find a single task by ID
   * @param taskId - The task ID to find
   * @returns Task if found
   * @throws NotFoundException if task not found
   */
  async findOne(taskId: string): Promise<Task> {
    const task = await this.taskModel
      .findOne({ task_id: taskId })
      .exec();

    if (!task) {
      throw new NotFoundException(`Task with ID ${taskId} not found`);
    }

    return task;
  }

  /**
   * Create a new task
   * @param createTaskDto - The task data to create
   * @returns Created task
   * @throws NotFoundException if session not found
   */
  async create(createTaskDto: CreateTaskDto): Promise<Task> {
    // Verify session exists
    await this.sessionsService.findOne(createTaskDto.session_id);

    const taskData = {
      task_id: randomUUID(),
      ...createTaskDto,
      status: TaskStatus.PENDING,
      metadata: createTaskDto.metadata || {},
    };

    const createdTask = new this.taskModel(taskData);
    return createdTask.save();
  }

  /**
   * Update a task
   * @param taskId - The task ID to update
   * @param updateTaskDto - The fields to update
   * @returns Updated task
   * @throws NotFoundException if task not found
   * @throws BadRequestException if invalid status transition
   */
  async update(taskId: string, updateTaskDto: UpdateTaskDto): Promise<Task> {
    const task = await this.findOne(taskId);

    // Validate status transition if status is being updated
    if (updateTaskDto.status) {
      this.validateStatusTransition(task.status, updateTaskDto.status);
    }

    const updateData: any = { ...updateTaskDto };

    // Handle metadata merging if metadata is being updated
    if (updateTaskDto.metadata) {
      updateData.metadata = {
        ...(task.metadata || {}),
        ...updateTaskDto.metadata,
      };
    }

    // Handle status-specific updates
    if (updateTaskDto.status === TaskStatus.IN_PROGRESS && task.status === TaskStatus.PENDING) {
      updateData.started_at = new Date();
    }

    if (updateTaskDto.status === TaskStatus.COMPLETED || updateTaskDto.status === TaskStatus.FAILED) {
      updateData.completed_at = new Date();
    }

    const updatedTask = await this.taskModel
      .findOneAndUpdate(
        { task_id: taskId },
        { $set: updateData },
        { new: true, runValidators: true }
      )
      .exec();

    if (!updatedTask) {
      throw new NotFoundException(`Task with ID ${taskId} not found`);
    }

    // Log task state change if status changed
    if (updateTaskDto.status && updateTaskDto.status !== task.status) {
      this.logger.logTaskStateChange(taskId, task.status, updateTaskDto.status, {
        session_id: task.session_id,
        project_id: task.project_id,
      });
    }

    return updatedTask;
  }

  /**
   * Soft delete a task by marking it as completed
   * @param taskId - The task ID to delete
   * @throws NotFoundException if task not found
   */
  async delete(taskId: string): Promise<void> {
    const task = await this.findOne(taskId);

    await this.taskModel
      .findOneAndUpdate(
        { task_id: taskId },
        {
          $set: {
            status: TaskStatus.COMPLETED,
            completed_at: new Date(),
          }
        }
      )
      .exec();
  }

  /**
   * Start a task (transition from pending to in_progress)
   * @param taskId - The task ID to start
   * @returns Updated task
   * @throws NotFoundException if task not found
   * @throws BadRequestException if task cannot be started
   */
  async startTask(taskId: string): Promise<Task> {
    const task = await this.findOne(taskId);

    if (task.status !== TaskStatus.PENDING) {
      throw new BadRequestException(
        `Cannot start task in ${task.status} state. Task must be pending.`
      );
    }

    const now = new Date();
    const updatedTask = await this.taskModel
      .findOneAndUpdate(
        { task_id: taskId },
        {
          $set: {
            status: TaskStatus.IN_PROGRESS,
            started_at: now,
          }
        },
        { new: true }
      )
      .exec();

    if (!updatedTask) {
      throw new NotFoundException(`Task with ID ${taskId} not found`);
    }

    // Update session's current_task_id
    await this.sessionsService.update(task.session_id, {
      current_task_id: taskId,
    });

    return updatedTask;
  }

  /**
   * Complete a task (transition to completed)
   * @param taskId - The task ID to complete
   * @returns Updated task
   * @throws NotFoundException if task not found
   * @throws BadRequestException if task cannot be completed
   */
  async completeTask(taskId: string): Promise<Task> {
    const task = await this.findOne(taskId);

    if (task.status === TaskStatus.COMPLETED) {
      throw new BadRequestException('Task is already completed');
    }

    if (task.status === TaskStatus.FAILED) {
      throw new BadRequestException('Cannot complete a failed task');
    }

    const now = new Date();
    const updatedTask = await this.taskModel
      .findOneAndUpdate(
        { task_id: taskId },
        {
          $set: {
            status: TaskStatus.COMPLETED,
            completed_at: now,
          }
        },
        { new: true }
      )
      .exec();

    if (!updatedTask) {
      throw new NotFoundException(`Task with ID ${taskId} not found`);
    }

    // Clear session's current_task_id if this is the current task
    const session = await this.sessionsService.findOne(task.session_id);
    if (session.current_task_id === taskId) {
      await this.sessionsService.clearCurrentTaskId(task.session_id);
    }

    return updatedTask;
  }

  /**
   * Fail a task (transition to failed)
   * @param taskId - The task ID to fail
   * @param failTaskDto - Failure details
   * @returns Updated task
   * @throws NotFoundException if task not found
   * @throws BadRequestException if task cannot be failed
   */
  async failTask(taskId: string, failTaskDto: FailTaskDto): Promise<Task> {
    const task = await this.findOne(taskId);

    if (task.status === TaskStatus.COMPLETED) {
      throw new BadRequestException('Cannot fail a completed task');
    }

    if (task.status === TaskStatus.FAILED) {
      throw new BadRequestException('Task is already failed');
    }

    const now = new Date();
    const updatedTask = await this.taskModel
      .findOneAndUpdate(
        { task_id: taskId },
        {
          $set: {
            status: TaskStatus.FAILED,
            completed_at: now,
            error_message: failTaskDto.error_message,
          }
        },
        { new: true }
      )
      .exec();

    if (!updatedTask) {
      throw new NotFoundException(`Task with ID ${taskId} not found`);
    }

    // Clear session's current_task_id if this is the current task
    const session = await this.sessionsService.findOne(task.session_id);
    if (session.current_task_id === taskId) {
      await this.sessionsService.clearCurrentTaskId(task.session_id);
    }

    return updatedTask;
  }

  /**
   * Get tasks for a session with progress statistics
   * @param sessionId - The session ID
   * @returns Task progress information
   * @throws NotFoundException if session not found
   */
  async getSessionTaskProgress(sessionId: string): Promise<TaskProgressDto> {
    // Verify session exists
    await this.sessionsService.findOne(sessionId);

    const tasks = await this.findBySession(sessionId);

    // Group tasks by status
    const tasksByStatus: TasksByStatus = {
      pending: tasks.filter(t => t.status === TaskStatus.PENDING),
      in_progress: tasks.filter(t => t.status === TaskStatus.IN_PROGRESS),
      completed: tasks.filter(t => t.status === TaskStatus.COMPLETED),
      failed: tasks.filter(t => t.status === TaskStatus.FAILED),
      blocked: tasks.filter(t => t.status === TaskStatus.BLOCKED),
    };

    // Calculate statistics
    const total = tasks.length;
    const completed = tasksByStatus.completed.length;
    const completionPercentage = total > 0 ? Math.round((completed / total) * 100) : 0;

    const stats: TaskProgressStats = {
      total,
      pending: tasksByStatus.pending.length,
      in_progress: tasksByStatus.in_progress.length,
      completed: tasksByStatus.completed.length,
      failed: tasksByStatus.failed.length,
      blocked: tasksByStatus.blocked.length,
      completion_percentage: completionPercentage,
    };

    return {
      session_id: sessionId,
      tasks: tasksByStatus,
      stats,
    };
  }

  /**
   * Delete all tasks associated with a session (cascade delete)
   * @param sessionId - The session ID
   * @returns Number of tasks deleted
   */
  async deleteBySession(sessionId: string): Promise<number> {
    const result = await this.taskModel
      .deleteMany({ session_id: sessionId })
      .exec();
    return result.deletedCount || 0;
  }

  /**
   * Count tasks associated with a session
   * @param sessionId - The session ID
   * @returns Count of tasks
   */
  async countBySession(sessionId: string): Promise<number> {
    return this.taskModel.countDocuments({ session_id: sessionId }).exec();
  }

  /**
   * Validate status transitions
   * @param currentStatus - Current task status
   * @param newStatus - Desired new status
   * @throws BadRequestException if transition is invalid
   */
  private validateStatusTransition(currentStatus: TaskStatus, newStatus: TaskStatus): void {
    const validTransitions: Record<TaskStatus, TaskStatus[]> = {
      [TaskStatus.PENDING]: [TaskStatus.IN_PROGRESS, TaskStatus.BLOCKED, TaskStatus.COMPLETED],
      [TaskStatus.IN_PROGRESS]: [TaskStatus.COMPLETED, TaskStatus.FAILED, TaskStatus.BLOCKED, TaskStatus.PENDING],
      [TaskStatus.BLOCKED]: [TaskStatus.PENDING, TaskStatus.IN_PROGRESS],
      [TaskStatus.COMPLETED]: [], // Terminal state
      [TaskStatus.FAILED]: [TaskStatus.PENDING], // Can retry failed tasks
    };

    const allowed = validTransitions[currentStatus];
    if (!allowed.includes(newStatus)) {
      throw new BadRequestException(
        `Invalid status transition from ${currentStatus} to ${newStatus}`
      );
    }
  }
}
