import { IsNumber, IsArray, IsEnum, IsOptional, IsBoolean, Min } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { SessionStatus } from '../../../schemas/session.schema';

/**
 * Request DTO for bulk cleanup of old sessions
 * Allows archiving or purging sessions matching specified criteria
 */
export class CleanupRequestDto {
  @ApiProperty({
    description: 'Delete sessions older than this many days. Must be >= 7 days.',
    example: 30,
    minimum: 7,
  })
  @IsNumber()
  @Min(7, { message: 'older_than_days must be at least 7' })
  older_than_days: number;

  @ApiProperty({
    description: 'Array of session statuses to include in cleanup',
    enum: SessionStatus,
    example: [SessionStatus.COMPLETED, SessionStatus.FAILED],
    isArray: true,
  })
  @IsArray()
  @IsEnum(SessionStatus, { each: true })
  statuses: SessionStatus[];

  @ApiPropertyOptional({
    description: 'If true, only report what would be deleted without actually deleting',
    example: true,
    default: false,
  })
  @IsOptional()
  @IsBoolean()
  dry_run?: boolean;

  @ApiPropertyOptional({
    description: 'If true, archive sessions instead of permanently deleting them',
    example: true,
    default: true,
  })
  @IsOptional()
  @IsBoolean()
  archive?: boolean;
}

/**
 * Response DTO for cleanup operation summary
 */
export class CleanupSummaryDto {
  @ApiProperty({
    description: 'Number of sessions affected by cleanup operation',
    example: 42,
  })
  sessions_affected: number;

  @ApiProperty({
    description: 'Total number of tasks deleted during cascade deletion',
    example: 128,
  })
  tasks_deleted: number;

  @ApiProperty({
    description: 'Breakdown of sessions by status that were processed',
    example: {
      completed: 25,
      failed: 17,
    },
  })
  breakdown_by_status: Record<string, number>;

  @ApiProperty({
    description: 'Operation type that was performed',
    example: 'archive',
    enum: ['archive', 'delete', 'dry_run'],
  })
  operation: 'archive' | 'delete' | 'dry_run';

  @ApiProperty({
    description: 'Estimated size of data freed (in bytes)',
    example: 1048576,
  })
  estimated_space_freed_bytes: number;

  @ApiProperty({
    description: 'Timestamp when cleanup was completed',
    example: new Date(),
  })
  completed_at: Date;
}
