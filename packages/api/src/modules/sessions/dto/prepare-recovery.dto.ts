import { ApiProperty } from '@nestjs/swagger';

/**
 * Response DTO for prepare-recovery endpoint
 */
export class PrepareRecoveryDto {
  @ApiProperty({
    description: 'Session identifier',
    example: '550e8400-e29b-41d4-a716-446655440000',
  })
  session_id: string;

  @ApiProperty({
    description: 'Current session status',
    example: 'failed',
  })
  status: string;

  @ApiProperty({
    description: 'Last task that was being executed',
    example: 'task-uuid-123',
    required: false,
  })
  last_task_id?: string;

  @ApiProperty({
    description: 'Machine the session was running on',
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
    description: 'Number of previous recovery attempts',
    example: 0,
  })
  recovery_attempts: number;

  @ApiProperty({
    description: 'Timestamp when recovery checkpoint was created',
    example: '2024-01-19T12:00:00.000Z',
  })
  recovery_checkpoint_at: Date;

  @ApiProperty({
    description: 'Additional metadata about the session state',
    example: { vscode_version: '1.85.0', last_error: 'Connection timeout' },
  })
  metadata: Record<string, any>;
}
