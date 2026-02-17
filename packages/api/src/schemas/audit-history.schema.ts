import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';
import { ApiProperty } from '@nestjs/swagger';

export type AuditHistoryDocument = AuditHistory & Document;

export enum HttpMethod {
  POST = 'POST',
  PUT = 'PUT',
  PATCH = 'PATCH',
  DELETE = 'DELETE',
}

@Schema({
  timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
  collection: 'audit_history'
})
export class AuditHistory {
  @ApiProperty({ description: 'Unique audit record identifier (UUID)' })
  @Prop({ required: true, unique: true, index: true })
  audit_id: string;

  @ApiProperty({ description: 'Timestamp of the audited operation' })
  @Prop({ required: true, index: true, default: Date.now })
  timestamp: Date;

  @ApiProperty({ description: 'API endpoint that was called (e.g., "/api/tasks")' })
  @Prop({ required: true })
  api_endpoint: string;

  @ApiProperty({ enum: HttpMethod, description: 'HTTP method of the operation' })
  @Prop({ required: true, enum: Object.values(HttpMethod) })
  http_method: HttpMethod;

  @ApiProperty({ description: 'Workspace identifier this operation belongs to', required: false })
  @Prop({ required: false, index: true })
  workspace_id?: string;

  @ApiProperty({ description: 'Worktree path where the operation originated', required: false })
  @Prop({ required: false })
  worktree_path?: string;

  @ApiProperty({ description: 'GitHub Project number associated with this operation', required: false })
  @Prop({ required: false, index: true })
  project_number?: number;

  @ApiProperty({ description: 'Task identifier affected by this operation', required: false })
  @Prop({ required: false })
  task_id?: string;

  @ApiProperty({ description: 'Session identifier that initiated this operation', required: false })
  @Prop({ required: false })
  session_id?: string;

  @ApiProperty({ description: 'Type of operation (e.g., "task.started", "session.created")' })
  @Prop({ required: true, index: true })
  operation_type: string;

  @ApiProperty({ description: 'Sanitized request payload summary (max 4KB)', type: Object })
  @Prop({ type: Object, default: {} })
  request_summary: Record<string, any>;

  @ApiProperty({ description: 'HTTP response status code' })
  @Prop({ required: true })
  response_status: number;

  @ApiProperty({ description: 'Duration of the operation in milliseconds' })
  @Prop({ required: true })
  duration_ms: number;

  @ApiProperty({ description: 'Actor identifier (API key identifier or agent ID)', required: false })
  @Prop({ required: false })
  actor?: string;

  @ApiProperty({ description: 'Additional metadata about the operation', type: Object })
  @Prop({ type: Object, default: {} })
  metadata: Record<string, any>;

  @ApiProperty({ description: 'Request identifier for tracing', required: false })
  @Prop({ required: false })
  request_id?: string;

  @ApiProperty({ description: 'Document creation timestamp' })
  created_at?: Date;

  @ApiProperty({ description: 'Document last update timestamp' })
  updated_at?: Date;
}

export const AuditHistorySchema = SchemaFactory.createForClass(AuditHistory);

// TTL index: automatically delete audit records after 90 days (default).
// To change the retention period, set the AUDIT_RETENTION_DAYS environment variable.
// Note: Changing this value requires manually updating the MongoDB TTL index:
//   db.audit_history.dropIndex("timestamp_1")
//   db.audit_history.createIndex({ "timestamp": 1 }, { expireAfterSeconds: NEW_VALUE })
AuditHistorySchema.index(
  { timestamp: 1 },
  {
    expireAfterSeconds: 90 * 24 * 60 * 60, // 7776000 seconds = 90 days
  }
);

// Compound indexes for optimized queries
AuditHistorySchema.index({ workspace_id: 1, timestamp: -1 });
AuditHistorySchema.index({ project_number: 1, timestamp: -1 });
AuditHistorySchema.index({ operation_type: 1, timestamp: -1 });
