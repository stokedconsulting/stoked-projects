import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';
import { ApiProperty } from '@nestjs/swagger';

export type TaskDocument = Task & Document;

export enum TaskStatus {
  PENDING = 'pending',
  IN_PROGRESS = 'in_progress',
  COMPLETED = 'completed',
  FAILED = 'failed',
  BLOCKED = 'blocked',
}

@Schema({
  timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
  collection: 'tasks'
})
export class Task {
  @ApiProperty({ description: 'Unique task identifier (UUID)' })
  @Prop({ required: true, unique: true, index: true })
  task_id: string;

  @ApiProperty({ description: 'Parent session reference' })
  @Prop({ required: true, index: true })
  session_id: string;

  @ApiProperty({ description: 'GitHub Project ID' })
  @Prop({ required: true, index: true })
  project_id: string;

  @ApiProperty({ description: 'Corresponding GitHub issue ID', required: false })
  @Prop({ required: false })
  github_issue_id?: string;

  @ApiProperty({ description: 'Human-readable task description' })
  @Prop({ required: true })
  task_name: string;

  @ApiProperty({ enum: TaskStatus, description: 'Task state' })
  @Prop({ required: true, enum: Object.values(TaskStatus), index: true })
  status: TaskStatus;

  @ApiProperty({ description: 'Task execution start time', required: false })
  @Prop({ required: false })
  started_at?: Date;

  @ApiProperty({ description: 'Task completion time', required: false })
  @Prop({ required: false })
  completed_at?: Date;

  @ApiProperty({ description: 'Failure reason if status is failed', required: false })
  @Prop({ required: false })
  error_message?: string;

  @ApiProperty({ description: 'Document creation timestamp' })
  created_at?: Date;

  @ApiProperty({ description: 'Document last update timestamp' })
  updated_at?: Date;
}

export const TaskSchema = SchemaFactory.createForClass(Task);

// Compound indexes for optimized queries
TaskSchema.index({ session_id: 1, status: 1 });
TaskSchema.index({ project_id: 1, status: 1 });

// TTL index: automatically delete completed/failed tasks after 30 days
// Only applies to tasks with completed_at set
TaskSchema.index(
  { completed_at: 1 },
  {
    expireAfterSeconds: 30 * 24 * 60 * 60, // 30 days
    partialFilterExpression: {
      completed_at: { $exists: true },
      status: { $in: [TaskStatus.COMPLETED, TaskStatus.FAILED] }
    }
  }
);
