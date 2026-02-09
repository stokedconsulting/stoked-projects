import { ApiProperty } from '@nestjs/swagger';
import { RecoveryAttemptDto } from './recovery-attempt.dto';

/**
 * Response DTO for recovery history endpoint
 */
export class RecoveryHistoryDto {
  @ApiProperty({
    description: 'Session identifier',
    example: '550e8400-e29b-41d4-a716-446655440000',
  })
  session_id: string;

  @ApiProperty({
    description: 'Total number of recovery attempts',
    example: 2,
  })
  total_attempts: number;

  @ApiProperty({
    description: 'Number of successful recoveries',
    example: 1,
  })
  successful_attempts: number;

  @ApiProperty({
    description: 'Number of failed recovery attempts',
    example: 1,
  })
  failed_attempts: number;

  @ApiProperty({
    description: 'List of all recovery attempts',
    type: [RecoveryAttemptDto],
  })
  attempts: RecoveryAttemptDto[];

  @ApiProperty({
    description: 'Timestamp of last recovery attempt',
    example: '2024-01-19T12:00:00.000Z',
    required: false,
  })
  last_recovery_at?: Date;

  @ApiProperty({
    description: 'Current session status',
    example: 'active',
  })
  current_status: string;
}
