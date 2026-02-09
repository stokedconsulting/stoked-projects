import { ApiProperty } from '@nestjs/swagger';
import { SessionStatus } from '../../../schemas/session.schema';

export class HeartbeatResponseDto {
  @ApiProperty({ description: 'Session ID' })
  session_id: string;

  @ApiProperty({ enum: SessionStatus, description: 'Current session status' })
  status: SessionStatus;

  @ApiProperty({ description: 'Last heartbeat timestamp' })
  last_heartbeat: Date;

  @ApiProperty({ description: 'Message describing the heartbeat result' })
  message: string;
}
