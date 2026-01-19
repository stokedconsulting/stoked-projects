import { Document } from 'mongoose';

/**
 * Task status enum
 */
export enum TaskStatus {
  PENDING = 'pending',
  IN_PROGRESS = 'in_progress',
  COMPLETED = 'completed',
  FAILED = 'failed',
  BLOCKED = 'blocked',
}

/**
 * Task document interface
 */
export interface ITask {
  task_id: string;
  session_id: string;
  project_id: string;
  github_issue_id?: string;
  task_name: string;
  status: TaskStatus;
  started_at?: Date;
  completed_at?: Date;
  error_message?: string;
  created_at: Date;
  updated_at: Date;
}

/**
 * Task Mongoose document type
 */
export type TaskDocument = ITask & Document;
