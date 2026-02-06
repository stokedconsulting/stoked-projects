import { IsString, IsOptional, IsNumber, IsObject, IsEnum } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { SessionStatus } from '../../../schemas/session.schema';

export class UpdateSessionDto {
  @ApiPropertyOptional({
    enum: SessionStatus,
    description: 'Current session state',
    example: SessionStatus.ACTIVE,
  })
  @IsOptional()
  @IsEnum(SessionStatus)
  status?: SessionStatus;

  @ApiPropertyOptional({
    description: 'Docker slot number (if using containerized execution)',
    example: 1,
  })
  @IsOptional()
  @IsNumber()
  docker_slot?: number;

  @ApiPropertyOptional({
    description: 'Reference to current task being executed',
    example: 'task-uuid-123',
  })
  @IsOptional()
  @IsString()
  current_task_id?: string;

  @ApiPropertyOptional({
    description: 'Additional session context',
    example: { notes: 'Updated with new information' },
  })
  @IsOptional()
  @IsObject()
  metadata?: Record<string, any>;
}
