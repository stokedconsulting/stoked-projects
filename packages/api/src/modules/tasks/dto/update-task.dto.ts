import { IsString, IsOptional, IsEnum, IsObject } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { TaskStatus } from '../../../schemas/task.schema';

export class UpdateTaskDto {
  @ApiPropertyOptional({
    enum: TaskStatus,
    description: 'Update task status',
    example: TaskStatus.IN_PROGRESS,
  })
  @IsOptional()
  @IsEnum(TaskStatus)
  status?: TaskStatus;

  @ApiPropertyOptional({
    description: 'Update GitHub issue ID',
    example: '456',
  })
  @IsOptional()
  @IsString()
  github_issue_id?: string;

  @ApiPropertyOptional({
    description: 'Update error message (for failed tasks)',
    example: 'Database connection timeout',
  })
  @IsOptional()
  @IsString()
  error_message?: string;

  @ApiPropertyOptional({
    description: 'Update task metadata',
    example: { priority: 'high', tags: ['backend'] },
  })
  @IsOptional()
  @IsObject()
  metadata?: Record<string, any>;
}
