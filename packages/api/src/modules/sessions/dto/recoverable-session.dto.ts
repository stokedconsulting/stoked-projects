import { ApiProperty } from '@nestjs/swagger';

/**
 * DTO for a recoverable session
 */
export class RecoverableSessionDto {
  @ApiProperty({
    description: 'Session identifier',
    example: '550e8400-e29b-41d4-a716-446655440000',
  })
  session_id: string;

  @ApiProperty({
    description: 'GitHub Project ID',
    example: '123',
  })
  project_id: string;

  @ApiProperty({
    description: 'Current session status',
    example: 'failed',
  })
  status: string;

  @ApiProperty({
    description: 'Machine ID the session was running on',
    example: 'macbook-pro-m1',
  })
  machine_id: string;

  @ApiProperty({
    description: 'Docker slot assignment',
    example: 1,
    required: false,
  })
  docker_slot?: number;

  @ApiProperty({
    description: 'Last task that was being executed',
    example: 'task-uuid-123',
    required: false,
  })
  current_task_id?: string;

  @ApiProperty({
    description: 'Number of recovery attempts',
    example: 1,
  })
  recovery_attempts: number;

  @ApiProperty({
    description: 'Last heartbeat timestamp',
    example: '2024-01-19T11:55:00.000Z',
  })
  last_heartbeat: Date;

  @ApiProperty({
    description: 'When the session failed/stalled',
    example: '2024-01-19T12:00:00.000Z',
    required: false,
  })
  failed_at?: Date;

  @ApiProperty({
    description: 'Minutes since last heartbeat',
    example: 15,
  })
  minutes_since_heartbeat: number;

  @ApiProperty({
    description: 'Whether session can be recovered',
    example: true,
  })
  can_recover: boolean;

  @ApiProperty({
    description: 'Reason why recovery is blocked if not recoverable',
    example: 'Maximum recovery attempts reached',
    required: false,
  })
  recovery_blocked_reason?: string;
}
