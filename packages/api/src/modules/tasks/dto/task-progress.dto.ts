import { ApiProperty } from '@nestjs/swagger';
import { Task, TaskStatus } from '../../../schemas/task.schema';

export class TasksByStatus {
  @ApiProperty({ description: 'Tasks in pending state', type: [Task] })
  pending: Task[];

  @ApiProperty({ description: 'Tasks in progress', type: [Task] })
  in_progress: Task[];

  @ApiProperty({ description: 'Completed tasks', type: [Task] })
  completed: Task[];

  @ApiProperty({ description: 'Failed tasks', type: [Task] })
  failed: Task[];

  @ApiProperty({ description: 'Blocked tasks', type: [Task] })
  blocked: Task[];
}

export class TaskProgressStats {
  @ApiProperty({ description: 'Total number of tasks' })
  total: number;

  @ApiProperty({ description: 'Number of pending tasks' })
  pending: number;

  @ApiProperty({ description: 'Number of tasks in progress' })
  in_progress: number;

  @ApiProperty({ description: 'Number of completed tasks' })
  completed: number;

  @ApiProperty({ description: 'Number of failed tasks' })
  failed: number;

  @ApiProperty({ description: 'Number of blocked tasks' })
  blocked: number;

  @ApiProperty({ description: 'Completion percentage (0-100)' })
  completion_percentage: number;
}

export class TaskProgressDto {
  @ApiProperty({ description: 'Session ID' })
  session_id: string;

  @ApiProperty({ description: 'Tasks grouped by status' })
  tasks: TasksByStatus;

  @ApiProperty({ description: 'Progress statistics' })
  stats: TaskProgressStats;
}
