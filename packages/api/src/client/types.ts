/**
 * TypeScript types for State Tracking API Client
 */

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
 * Machine status enum
 */
export enum MachineStatus {
  ONLINE = 'online',
  OFFLINE = 'offline',
  MAINTENANCE = 'maintenance',
}

/**
 * Docker slot information
 */
export interface DockerSlot {
  slot_number: number;
  status: 'available' | 'occupied';
  session_id?: string;
}

/**
 * Session interface
 */
export interface Session {
  session_id: string;
  project_id: string;
  machine_id: string;
  docker_slot?: number;
  status: SessionStatus;
  last_heartbeat: Date;
  current_task_id?: string;
  started_at: Date;
  completed_at?: Date;
  metadata?: Record<string, any>;
  created_at: Date;
  updated_at: Date;
}

/**
 * Task interface
 */
export interface Task {
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
 * Machine interface
 */
export interface Machine {
  machine_id: string;
  hostname: string;
  docker_slots: DockerSlot[];
  active_sessions: string[];
  status: MachineStatus;
  last_heartbeat: Date;
  metadata?: Record<string, any>;
  created_at: Date;
  updated_at: Date;
}

/**
 * Create session request
 */
export interface CreateSessionRequest {
  project_id: string;
  machine_id: string;
  docker_slot?: number;
  metadata?: Record<string, any>;
}

/**
 * Update session request
 */
export interface UpdateSessionRequest {
  status?: SessionStatus;
  docker_slot?: number;
  current_task_id?: string;
  metadata?: Record<string, any>;
}

/**
 * Create task request
 */
export interface CreateTaskRequest {
  session_id: string;
  project_id: string;
  task_name: string;
  github_issue_id?: string;
}

/**
 * Update task request
 */
export interface UpdateTaskRequest {
  status?: TaskStatus;
  github_issue_id?: string;
  error_message?: string;
}

/**
 * Fail task request
 */
export interface FailTaskRequest {
  error_message: string;
}

/**
 * Create machine request
 */
export interface CreateMachineRequest {
  machine_id: string;
  hostname: string;
  docker_slots: number[];
  metadata?: Record<string, any>;
}

/**
 * Update machine request
 */
export interface UpdateMachineRequest {
  docker_slots?: number[];
  status?: MachineStatus;
  metadata?: Record<string, any>;
}

/**
 * Heartbeat response
 */
export interface HeartbeatResponse {
  session_id: string;
  status: SessionStatus;
  last_heartbeat: Date;
  message: string;
}

/**
 * Machine heartbeat response
 */
export interface MachineHeartbeatResponse {
  machine_id: string;
  status: MachineStatus;
  last_heartbeat: Date;
  message: string;
}

/**
 * Task progress summary
 */
export interface TaskProgress {
  session_id: string;
  total_tasks: number;
  completed: number;
  in_progress: number;
  pending: number;
  failed: number;
  blocked: number;
  tasks: Task[];
}

/**
 * Session health information
 */
export interface SessionHealth {
  session_id: string;
  status: SessionStatus;
  is_stale: boolean;
  seconds_since_heartbeat: number;
  last_heartbeat: Date;
  current_task?: Task;
  recommendations: string[];
}

/**
 * Stale session information
 */
export interface StaleSession {
  session_id: string;
  project_id: string;
  machine_id: string;
  status: SessionStatus;
  last_heartbeat: Date;
  seconds_since_heartbeat: number;
  current_task_id?: string;
}

/**
 * Active session information
 */
export interface ActiveSession {
  session_id: string;
  project_id: string;
  machine_id: string;
  docker_slot?: number;
  last_heartbeat: Date;
  current_task_id?: string;
  started_at: Date;
}

/**
 * Machine availability information
 */
export interface MachineAvailability {
  machine_id: string;
  hostname: string;
  status: MachineStatus;
  total_slots: number;
  available_slots: number;
  occupied_slots: number;
  active_sessions: string[];
  last_heartbeat: Date;
}

/**
 * Mark session failed request
 */
export interface MarkFailedRequest {
  reason: string;
  error_details?: Record<string, any>;
}

/**
 * Mark session stalled request
 */
export interface MarkStalledRequest {
  reason: string;
}

/**
 * Recover session request
 */
export interface RecoverSessionRequest {
  new_machine_id?: string;
  new_docker_slot?: number;
  resume_from_task_id?: string;
}

/**
 * API client configuration
 */
export interface ApiClientConfig {
  baseUrl: string;
  apiKey: string;
  timeout?: number;
}

/**
 * API error response
 */
export interface ApiError {
  statusCode: number;
  message: string | string[];
  error?: string;
}

/**
 * Session query parameters
 */
export interface SessionQueryParams {
  status?: SessionStatus;
  project_id?: string;
  machine_id?: string;
  limit?: number;
  offset?: number;
}

/**
 * Task query parameters
 */
export interface TaskQueryParams {
  session_id?: string;
  project_id?: string;
  status?: TaskStatus;
  limit?: number;
  offset?: number;
}

/**
 * Machine query parameters
 */
export interface MachineQueryParams {
  status?: MachineStatus;
  hostname?: string;
}
