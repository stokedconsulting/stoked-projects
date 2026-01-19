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
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth, ApiQuery } from '@nestjs/swagger';
import { TasksService } from './tasks.service';
import { Task } from '../../schemas/task.schema';
import { ApiKeyGuard } from '../auth/guards/api-key.guard';

@ApiTags('tasks')
@Controller('tasks')
@UseGuards(ApiKeyGuard)
@ApiBearerAuth()
export class TasksController {
  constructor(private readonly tasksService: TasksService) {}

  @Get()
  @ApiOperation({ summary: 'Get all tasks or filter by session' })
  @ApiQuery({ name: 'session_id', required: false, description: 'Filter by session ID' })
  @ApiResponse({ status: 200, description: 'Return all tasks', type: [Task] })
  async findAll(@Query('session_id') sessionId?: string): Promise<Task[]> {
    if (sessionId) {
      return this.tasksService.findBySession(sessionId);
    }
    return this.tasksService.findAll();
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get task by ID' })
  @ApiResponse({ status: 200, description: 'Return task', type: Task })
  @ApiResponse({ status: 404, description: 'Task not found' })
  async findOne(@Param('id') id: string): Promise<Task | null> {
    return this.tasksService.findOne(id);
  }

  @Post()
  @ApiOperation({ summary: 'Create new task' })
  @ApiResponse({ status: 201, description: 'Task created', type: Task })
  @HttpCode(HttpStatus.CREATED)
  async create(@Body() task: Partial<Task>): Promise<Task> {
    return this.tasksService.create(task);
  }

  @Put(':id')
  @ApiOperation({ summary: 'Update task' })
  @ApiResponse({ status: 200, description: 'Task updated', type: Task })
  @ApiResponse({ status: 404, description: 'Task not found' })
  async update(
    @Param('id') id: string,
    @Body() update: Partial<Task>,
  ): Promise<Task | null> {
    return this.tasksService.update(id, update);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete task' })
  @ApiResponse({ status: 200, description: 'Task deleted', type: Task })
  @ApiResponse({ status: 404, description: 'Task not found' })
  async delete(@Param('id') id: string): Promise<Task | null> {
    return this.tasksService.delete(id);
  }
}
