import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';
import { ApiProperty } from '@nestjs/swagger';

export type SessionDocument = Session & Document;

export enum SessionStatus {
  ACTIVE = 'active',
  PAUSED = 'paused',
  COMPLETED = 'completed',
  FAILED = 'failed',
  STALLED = 'stalled',
  ARCHIVED = 'archived',
}

@Schema({
  timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
  collection: 'sessions'
})
export class Session {
  @ApiProperty({ description: 'Unique session identifier (UUID)' })
  @Prop({ required: true, unique: true, index: true })
  session_id: string;

  @ApiProperty({ description: 'GitHub Project ID this session is working on' })
  @Prop({ required: true, index: true })
  project_id: string;

  @ApiProperty({ description: 'Machine identifier running this session' })
  @Prop({ required: true, index: true })
  machine_id: string;

  @ApiProperty({ description: 'Docker slot number (if using containerized execution)', required: false })
  @Prop({ required: false })
  docker_slot?: number;

  @ApiProperty({ enum: SessionStatus, description: 'Current session state' })
  @Prop({ required: true, enum: Object.values(SessionStatus), index: true })
  status: SessionStatus;

  @ApiProperty({ description: 'Last successful heartbeat timestamp' })
  @Prop({ required: true, index: true })
  last_heartbeat: Date;

  @ApiProperty({ description: 'Reference to current task being executed', required: false })
  @Prop({ required: false })
  current_task_id?: string;

  @ApiProperty({ description: 'Session start time' })
  @Prop({ required: true })
  started_at: Date;

  @ApiProperty({ description: 'Session completion or failure time', required: false })
  @Prop({ required: false })
  completed_at?: Date;

  @ApiProperty({ description: 'Additional session context (VSCode version, extension version, etc.)' })
  @Prop({ type: Object, default: {} })
  metadata: Record<string, any>;

  @ApiProperty({ description: 'Document creation timestamp' })
  created_at?: Date;

  @ApiProperty({ description: 'Document last update timestamp' })
  updated_at?: Date;
}

export const SessionSchema = SchemaFactory.createForClass(Session);

// Compound indexes for optimized queries
SessionSchema.index({ project_id: 1, status: 1 });
SessionSchema.index({ machine_id: 1, status: 1 });

// TTL index: automatically delete completed/failed sessions after 30 days
// Only applies to sessions with completed_at set and status not archived
SessionSchema.index(
  { completed_at: 1 },
  {
    expireAfterSeconds: 30 * 24 * 60 * 60, // 30 days
    partialFilterExpression: {
      completed_at: { $exists: true },
      status: { $in: [SessionStatus.COMPLETED, SessionStatus.FAILED] },
      $nor: [{ status: SessionStatus.ARCHIVED }]
    }
  }
);
