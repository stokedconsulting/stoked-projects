import { Document } from 'mongoose';

/**
 * Session status enum
 */
export enum SessionStatus {
  ACTIVE = 'active',
  PAUSED = 'paused',
  COMPLETED = 'completed',
  FAILED = 'failed',
  STALLED = 'stalled',
}

/**
 * Session metadata interface
 */
export interface SessionMetadata {
  [key: string]: any;
}

/**
 * Session document interface
 */
export interface ISession {
  session_id: string;
  project_id: string;
  machine_id: string;
  docker_slot?: number;
  status: SessionStatus;
  last_heartbeat: Date;
  current_task_id?: string;
  started_at: Date;
  completed_at?: Date;
  metadata?: SessionMetadata;
  created_at: Date;
  updated_at: Date;
}

/**
 * Session Mongoose document type
 */
export type SessionDocument = ISession & Document;
