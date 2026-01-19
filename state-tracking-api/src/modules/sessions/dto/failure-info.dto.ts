import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Session } from '../../../schemas/session.schema';

export class FailureAnalysis {
  @ApiProperty({
    description: 'Whether the session is considered very stale (>15 minutes)',
  })
  is_very_stale: boolean;

  @ApiProperty({
    description: 'Whether there are tasks stuck in in_progress state',
  })
  has_stuck_tasks: boolean;

  @ApiProperty({
    description: 'Number of tasks in in_progress state',
  })
  stuck_task_count: number;

  @ApiProperty({
    description: 'Minutes since last heartbeat',
  })
  minutes_since_heartbeat: number;

  @ApiProperty({
    description: 'Recommended recovery actions',
    type: [String],
  })
  recovery_recommendations: string[];
}

export class FailureInfoDto {
  @ApiProperty({ description: 'Session ID' })
  session_id: string;

  @ApiProperty({ description: 'Project ID' })
  project_id: string;

  @ApiProperty({ description: 'Machine ID' })
  machine_id: string;

  @ApiPropertyOptional({ description: 'Docker slot number' })
  docker_slot?: number;

  @ApiProperty({ description: 'Session status (should be "failed")' })
  status: string;

  @ApiProperty({ description: 'Failure reason' })
  failure_reason: string;

  @ApiPropertyOptional({ description: 'Additional error details' })
  error_details?: Record<string, any>;

  @ApiProperty({ description: 'Time when session failed' })
  failed_at: Date;

  @ApiProperty({ description: 'Last heartbeat timestamp' })
  last_heartbeat: Date;

  @ApiPropertyOptional({ description: 'Last successful task ID' })
  last_successful_task_id?: string;

  @ApiPropertyOptional({ description: 'Last successful task name' })
  last_successful_task_name?: string;

  @ApiPropertyOptional({ description: 'Current task ID at time of failure' })
  current_task_id?: string;

  @ApiProperty({ description: 'Session start time' })
  started_at: Date;

  @ApiProperty({ description: 'Session duration in minutes before failure' })
  duration_minutes: number;

  @ApiProperty({
    description: 'Detailed failure analysis with recovery recommendations',
  })
  analysis: FailureAnalysis;

  @ApiProperty({ description: 'Full session object' })
  session: Session;
}
