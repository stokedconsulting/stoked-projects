import { IsString, IsOptional, IsObject } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateTaskDto {
  @ApiProperty({
    description: 'Session ID this task belongs to',
    example: '550e8400-e29b-41d4-a716-446655440000',
  })
  @IsString()
  session_id: string;

  @ApiProperty({
    description: 'GitHub Project ID this task is associated with',
    example: '123',
  })
  @IsString()
  project_id: string;

  @ApiPropertyOptional({
    description: 'Corresponding GitHub issue ID',
    example: '456',
  })
  @IsOptional()
  @IsString()
  github_issue_id?: string;

  @ApiProperty({
    description: 'Human-readable task description',
    example: 'Implement user authentication',
  })
  @IsString()
  task_name: string;

  @ApiPropertyOptional({
    description: 'Additional task metadata',
    example: { priority: 'high', tags: ['backend', 'security'] },
  })
  @IsOptional()
  @IsObject()
  metadata?: Record<string, any>;
}
