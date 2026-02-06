import { ApiProperty } from '@nestjs/swagger';
import { SessionStatus } from '../../../schemas/session.schema';

export class ActiveSessionDto {
  @ApiProperty({ description: 'Unique session identifier (UUID)' })
  session_id: string;

  @ApiProperty({ description: 'GitHub Project ID this session is working on' })
  project_id: string;

  @ApiProperty({ description: 'Machine identifier running this session' })
  machine_id: string;

  @ApiProperty({ description: 'Docker slot number (if using containerized execution)', required: false })
  docker_slot?: number;

  @ApiProperty({ enum: SessionStatus, description: 'Current session state' })
  status: SessionStatus;

  @ApiProperty({ description: 'Last successful heartbeat timestamp' })
  last_heartbeat: Date;

  @ApiProperty({ description: 'Reference to current task being executed', required: false })
  current_task_id?: string;

  @ApiProperty({ description: 'Session start time' })
  started_at: Date;

  @ApiProperty({ description: 'Time since last heartbeat in seconds' })
  time_since_heartbeat: number;
}
