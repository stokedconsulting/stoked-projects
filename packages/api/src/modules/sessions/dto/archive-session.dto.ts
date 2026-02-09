import { ApiProperty } from '@nestjs/swagger';
import { Session } from '../../../schemas/session.schema';

/**
 * Response DTO for archiving a session
 * Returns the archived session with updated status
 */
export class ArchiveSessionDto extends Session {
  @ApiProperty({
    description: 'Confirmation that session was archived',
    example: true,
  })
  archived: boolean;

  @ApiProperty({
    description: 'Timestamp when session was archived',
    example: new Date(),
  })
  archived_at: Date;
}
