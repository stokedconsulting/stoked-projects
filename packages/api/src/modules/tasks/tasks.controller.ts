import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  Query,
  HttpCode,
  HttpStatus,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth, ApiSecurity } from '@nestjs/swagger';
import { TasksService } from './tasks.service';
import { Task } from '../../schemas/task.schema';
import { ApiKeyGuard } from '../auth/guards/api-key.guard';
import {
  CreateTaskDto,
  UpdateTaskDto,
  TaskQueryDto,
  FailTaskDto,
  TaskProgressDto,
} from './dto';

@ApiTags('tasks')
@Controller('tasks')
@UseGuards(ApiKeyGuard)
@ApiBearerAuth('bearer')
@ApiSecurity('api-key')
export class TasksController {
  constructor(private readonly tasksService: TasksService) {}

  /**
   * POST /tasks - Create new task
   */
  @Post()
  @ApiOperation({
    summary: 'Create new task',
    description: 'Creates a new task with pending status and generates a unique task_id'
  })
  @ApiResponse({
    status: 201,
    description: 'Task created successfully',
    type: Task
  })
  @ApiResponse({
    status: 400,
    description: 'Bad request - validation error'
  })
  @ApiResponse({
    status: 404,
    description: 'Session not found'
  })
  @HttpCode(HttpStatus.CREATED)
  async create(@Body() createTaskDto: CreateTaskDto): Promise<Task> {
    return this.tasksService.create(createTaskDto);
  }

  /**
   * GET /tasks - List tasks with optional filtering and pagination
   */
  @Get()
  @ApiOperation({
    summary: 'List tasks',
    description: 'Get all tasks with optional filtering by session, status, or project. Supports pagination.'
  })
  @ApiResponse({
    status: 200,
    description: 'Return tasks matching query',
    type: [Task]
  })
  async findAll(@Query() queryDto: TaskQueryDto): Promise<Task[]> {
    return this.tasksService.findAll(queryDto);
  }

  /**
   * GET /tasks/:id - Get task by ID
   */
  @Get(':id')
  @ApiOperation({
    summary: 'Get task by ID',
    description: 'Retrieve a single task by its task_id'
  })
  @ApiResponse({
    status: 200,
    description: 'Return task',
    type: Task
  })
  @ApiResponse({
    status: 404,
    description: 'Task not found'
  })
  async findOne(@Param('id') id: string): Promise<Task> {
    return this.tasksService.findOne(id);
  }

  /**
   * PUT /tasks/:id - Update task
   */
  @Put(':id')
  @ApiOperation({
    summary: 'Update task',
    description: 'Update task fields including status, github_issue_id, error_message, or metadata. Validates status transitions.'
  })
  @ApiResponse({
    status: 200,
    description: 'Task updated successfully',
    type: Task
  })
  @ApiResponse({
    status: 400,
    description: 'Bad request - invalid status transition or validation error'
  })
  @ApiResponse({
    status: 404,
    description: 'Task not found'
  })
  async update(
    @Param('id') id: string,
    @Body() updateTaskDto: UpdateTaskDto,
  ): Promise<Task> {
    return this.tasksService.update(id, updateTaskDto);
  }

  /**
   * DELETE /tasks/:id - Soft delete task
   */
  @Delete(':id')
  @ApiOperation({
    summary: 'Delete task',
    description: 'Soft delete a task by marking it as completed'
  })
  @ApiResponse({
    status: 204,
    description: 'Task deleted successfully'
  })
  @ApiResponse({
    status: 404,
    description: 'Task not found'
  })
  @HttpCode(HttpStatus.NO_CONTENT)
  async delete(@Param('id') id: string): Promise<void> {
    return this.tasksService.delete(id);
  }

  /**
   * POST /tasks/:id/start - Start task
   */
  @Post(':id/start')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Start task',
    description: 'Transition task from pending to in_progress, set started_at timestamp, and update session current_task_id'
  })
  @ApiResponse({
    status: 200,
    description: 'Task started successfully',
    type: Task
  })
  @ApiResponse({
    status: 400,
    description: 'Bad request - task is not in pending state'
  })
  @ApiResponse({
    status: 404,
    description: 'Task not found'
  })
  async startTask(@Param('id') id: string): Promise<Task> {
    return this.tasksService.startTask(id);
  }

  /**
   * POST /tasks/:id/complete - Complete task
   */
  @Post(':id/complete')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Complete task',
    description: 'Mark task as completed, set completed_at timestamp, and clear session current_task_id if applicable'
  })
  @ApiResponse({
    status: 200,
    description: 'Task completed successfully',
    type: Task
  })
  @ApiResponse({
    status: 400,
    description: 'Bad request - task is already completed or failed'
  })
  @ApiResponse({
    status: 404,
    description: 'Task not found'
  })
  async completeTask(@Param('id') id: string): Promise<Task> {
    return this.tasksService.completeTask(id);
  }

  /**
   * POST /tasks/:id/fail - Fail task
   */
  @Post(':id/fail')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Fail task',
    description: 'Mark task as failed with error message, set completed_at timestamp, and clear session current_task_id if applicable'
  })
  @ApiResponse({
    status: 200,
    description: 'Task marked as failed',
    type: Task
  })
  @ApiResponse({
    status: 400,
    description: 'Bad request - task is already completed or failed, or missing error_message'
  })
  @ApiResponse({
    status: 404,
    description: 'Task not found'
  })
  async failTask(
    @Param('id') id: string,
    @Body() failTaskDto: FailTaskDto,
  ): Promise<Task> {
    return this.tasksService.failTask(id, failTaskDto);
  }
}

/**
 * Session-related task endpoints
 */
@ApiTags('sessions')
@Controller('sessions')
@UseGuards(ApiKeyGuard)
@ApiBearerAuth('bearer')
@ApiSecurity('api-key')
export class SessionTasksController {
  constructor(private readonly tasksService: TasksService) {}

  /**
   * GET /sessions/:id/tasks - Get tasks for session
   */
  @Get(':id/tasks')
  @ApiOperation({
    summary: 'Get tasks for session',
    description: 'Returns all tasks for a session grouped by status with progress statistics'
  })
  @ApiResponse({
    status: 200,
    description: 'Session tasks with progress information',
    type: TaskProgressDto
  })
  @ApiResponse({
    status: 404,
    description: 'Session not found'
  })
  async getSessionTasks(@Param('id') sessionId: string): Promise<TaskProgressDto> {
    return this.tasksService.getSessionTaskProgress(sessionId);
  }
}
