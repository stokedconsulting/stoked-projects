import { ApiProperty } from '@nestjs/swagger';
import { Session } from '../../../schemas/session.schema';

export class SessionsByStatus {
  @ApiProperty({ description: 'Active sessions', type: [Session] })
  active: Session[];

  @ApiProperty({ description: 'Paused sessions', type: [Session] })
  paused: Session[];

  @ApiProperty({ description: 'Stalled sessions', type: [Session] })
  stalled: Session[];

  @ApiProperty({ description: 'Completed sessions', type: [Session] })
  completed: Session[];

  @ApiProperty({ description: 'Failed sessions', type: [Session] })
  failed: Session[];
}

export class SessionStats {
  @ApiProperty({ description: 'Total number of sessions' })
  total: number;

  @ApiProperty({ description: 'Number of active sessions' })
  active: number;

  @ApiProperty({ description: 'Number of paused sessions' })
  paused: number;

  @ApiProperty({ description: 'Number of stalled sessions' })
  stalled: number;

  @ApiProperty({ description: 'Number of completed sessions' })
  completed: number;

  @ApiProperty({ description: 'Number of failed sessions' })
  failed: number;
}

export class ProjectSessionsSummaryDto {
  @ApiProperty({ description: 'GitHub Project ID' })
  project_id: string;

  @ApiProperty({ description: 'Sessions grouped by status' })
  sessions: SessionsByStatus;

  @ApiProperty({ description: 'Summary statistics' })
  stats: SessionStats;
}
