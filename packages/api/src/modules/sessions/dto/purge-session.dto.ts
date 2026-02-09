import { IsBoolean, IsNotEmpty } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

/**
 * Request DTO for permanently purging/deleting a session
 * Requires explicit confirmation to prevent accidental deletion
 */
export class PurgeSessionDto {
  @ApiProperty({
    description: 'Explicit confirmation to permanently delete the session and its associated tasks',
    example: true,
  })
  @IsNotEmpty()
  @IsBoolean()
  confirm: boolean;
}

/**
 * Response DTO for session purge operation
 */
export class PurgeSessionResponseDto {
  @ApiProperty({
    description: 'Unique session identifier that was deleted',
    example: 'uuid-session-id',
  })
  session_id: string;

  @ApiProperty({
    description: 'Number of associated tasks that were also deleted',
    example: 5,
  })
  tasks_deleted: number;

  @ApiProperty({
    description: 'Confirmation that the session was permanently deleted',
    example: true,
  })
  purged: boolean;

  @ApiProperty({
    description: 'Timestamp when session was purged',
    example: new Date(),
  })
  purged_at: Date;
}
