import { ApiProperty } from '@nestjs/swagger';

/**
 * DTO representing a single recovery attempt
 */
export class RecoveryAttemptDto {
  @ApiProperty({
    description: 'Timestamp of the recovery attempt',
    example: '2024-01-19T12:00:00.000Z',
  })
  attempted_at: Date;

  @ApiProperty({
    description: 'Whether the recovery attempt was successful',
    example: true,
  })
  success: boolean;

  @ApiProperty({
    description: 'Machine ID the session was recovered to',
    example: 'macbook-air-m2',
    required: false,
  })
  new_machine_id?: string;

  @ApiProperty({
    description: 'Docker slot assigned during recovery',
    example: 2,
    required: false,
  })
  new_docker_slot?: number;

  @ApiProperty({
    description: 'Task ID resumed from',
    example: 'task-uuid-456',
    required: false,
  })
  resumed_from_task_id?: string;

  @ApiProperty({
    description: 'Error message if recovery failed',
    example: 'New machine not available',
    required: false,
  })
  error?: string;
}
