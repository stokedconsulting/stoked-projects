/**
 * TypeScript client for State Tracking API
 *
 * Provides type-safe methods for interacting with all API endpoints
 */

import {
  ApiClientConfig,
  ApiError,
  Session,
  Task,
  Machine,
  CreateSessionRequest,
  UpdateSessionRequest,
  CreateTaskRequest,
  UpdateTaskRequest,
  FailTaskRequest,
  CreateMachineRequest,
  UpdateMachineRequest,
  HeartbeatResponse,
  MachineHeartbeatResponse,
  TaskProgress,
  SessionHealth,
  StaleSession,
  ActiveSession,
  MachineAvailability,
  MarkFailedRequest,
  MarkStalledRequest,
  RecoverSessionRequest,
  SessionQueryParams,
  TaskQueryParams,
  MachineQueryParams,
} from './types';

/**
 * State Tracking API Client
 */
export class StateTrackingApiClient {
  private baseUrl: string;
  private apiKey: string;
  private timeout: number;

  constructor(config: ApiClientConfig) {
    this.baseUrl = config.baseUrl.replace(/\/$/, ''); // Remove trailing slash
    this.apiKey = config.apiKey;
    this.timeout = config.timeout || 10000; // Default 10 second timeout
  }

  /**
   * Make HTTP request to API
   */
  private async request<T>(
    method: string,
    path: string,
    body?: any,
    queryParams?: Record<string, any>
  ): Promise<T> {
    const url = new URL(`${this.baseUrl}${path}`);

    // Add query parameters
    if (queryParams) {
      Object.entries(queryParams).forEach(([key, value]) => {
        if (value !== undefined && value !== null) {
          url.searchParams.append(key, String(value));
        }
      });
    }

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'x-api-key': this.apiKey,
    };

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeout);

    try {
      const response = await fetch(url.toString(), {
        method,
        headers,
        body: body ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const error = await response.json() as ApiError;
        throw new Error(
          `API Error (${error.statusCode}): ${
            Array.isArray(error.message) ? error.message.join(', ') : error.message
          }`
        );
      }

      // Handle 204 No Content
      if (response.status === 204) {
        return undefined as unknown as T;
      }

      return await response.json() as T;
    } catch (error) {
      clearTimeout(timeoutId);
      if (error instanceof Error && error.name === 'AbortError') {
        throw new Error(`Request timeout after ${this.timeout}ms`);
      }
      throw error;
    }
  }

  // ==================== SESSION ENDPOINTS ====================

  /**
   * Create a new session
   */
  async createSession(data: CreateSessionRequest): Promise<Session> {
    return this.request<Session>('POST', '/sessions', data);
  }

  /**
   * Get session by ID
   */
  async getSession(sessionId: string): Promise<Session> {
    return this.request<Session>('GET', `/sessions/${sessionId}`);
  }

  /**
   * List all sessions with optional filtering
   */
  async listSessions(query?: SessionQueryParams): Promise<Session[]> {
    return this.request<Session[]>('GET', '/sessions', undefined, query);
  }

  /**
   * Update session
   */
  async updateSession(sessionId: string, data: UpdateSessionRequest): Promise<Session> {
    return this.request<Session>('PUT', `/sessions/${sessionId}`, data);
  }

  /**
   * Delete session (soft delete)
   */
  async deleteSession(sessionId: string): Promise<void> {
    return this.request<void>('DELETE', `/sessions/${sessionId}`);
  }

  /**
   * Update session heartbeat
   */
  async updateSessionHeartbeat(sessionId: string): Promise<HeartbeatResponse> {
    return this.request<HeartbeatResponse>('POST', `/sessions/${sessionId}/heartbeat`);
  }

  /**
   * Get session health status
   */
  async getSessionHealth(sessionId: string, threshold?: number): Promise<SessionHealth> {
    return this.request<SessionHealth>(
      'GET',
      `/sessions/${sessionId}/health`,
      undefined,
      { threshold }
    );
  }

  /**
   * Find stale sessions
   */
  async findStaleSessions(threshold?: number): Promise<StaleSession[]> {
    return this.request<StaleSession[]>('GET', '/sessions/stale', undefined, { threshold });
  }

  /**
   * Find active sessions
   */
  async findActiveSessions(projectId?: string, machineId?: string): Promise<ActiveSession[]> {
    return this.request<ActiveSession[]>('GET', '/sessions/active', undefined, {
      project_id: projectId,
      machine_id: machineId,
    });
  }

  /**
   * Mark session as failed
   */
  async markSessionFailed(sessionId: string, data: MarkFailedRequest): Promise<Session> {
    return this.request<Session>('POST', `/sessions/${sessionId}/mark-failed`, data);
  }

  /**
   * Mark session as stalled
   */
  async markSessionStalled(sessionId: string, data: MarkStalledRequest): Promise<Session> {
    return this.request<Session>('POST', `/sessions/${sessionId}/mark-stalled`, data);
  }

  /**
   * Recover a failed or stalled session
   */
  async recoverSession(sessionId: string, data?: RecoverSessionRequest): Promise<Session> {
    return this.request<Session>('POST', `/sessions/${sessionId}/recover`, data);
  }

  /**
   * Archive a session
   */
  async archiveSession(sessionId: string): Promise<Session> {
    return this.request<Session>('POST', `/sessions/${sessionId}/archive`);
  }

  // ==================== TASK ENDPOINTS ====================

  /**
   * Create a new task
   */
  async createTask(data: CreateTaskRequest): Promise<Task> {
    return this.request<Task>('POST', '/tasks', data);
  }

  /**
   * Get task by ID
   */
  async getTask(taskId: string): Promise<Task> {
    return this.request<Task>('GET', `/tasks/${taskId}`);
  }

  /**
   * List all tasks with optional filtering
   */
  async listTasks(query?: TaskQueryParams): Promise<Task[]> {
    return this.request<Task[]>('GET', '/tasks', undefined, query);
  }

  /**
   * Update task
   */
  async updateTask(taskId: string, data: UpdateTaskRequest): Promise<Task> {
    return this.request<Task>('PUT', `/tasks/${taskId}`, data);
  }

  /**
   * Delete task (soft delete)
   */
  async deleteTask(taskId: string): Promise<void> {
    return this.request<void>('DELETE', `/tasks/${taskId}`);
  }

  /**
   * Start a task
   */
  async startTask(taskId: string): Promise<Task> {
    return this.request<Task>('POST', `/tasks/${taskId}/start`);
  }

  /**
   * Complete a task
   */
  async completeTask(taskId: string): Promise<Task> {
    return this.request<Task>('POST', `/tasks/${taskId}/complete`);
  }

  /**
   * Fail a task
   */
  async failTask(taskId: string, data: FailTaskRequest): Promise<Task> {
    return this.request<Task>('POST', `/tasks/${taskId}/fail`, data);
  }

  /**
   * Get task progress for a session
   */
  async getSessionTaskProgress(sessionId: string): Promise<TaskProgress> {
    return this.request<TaskProgress>('GET', `/sessions/${sessionId}/tasks`);
  }

  // ==================== MACHINE ENDPOINTS ====================

  /**
   * Register a new machine
   */
  async createMachine(data: CreateMachineRequest): Promise<Machine> {
    return this.request<Machine>('POST', '/machines', data);
  }

  /**
   * Get machine by ID
   */
  async getMachine(machineId: string): Promise<Machine> {
    return this.request<Machine>('GET', `/machines/${machineId}`);
  }

  /**
   * List all machines with optional filtering
   */
  async listMachines(query?: MachineQueryParams): Promise<Machine[]> {
    return this.request<Machine[]>('GET', '/machines', undefined, query);
  }

  /**
   * Update machine
   */
  async updateMachine(machineId: string, data: UpdateMachineRequest): Promise<Machine> {
    return this.request<Machine>('PUT', `/machines/${machineId}`, data);
  }

  /**
   * Delete machine (set to offline)
   */
  async deleteMachine(machineId: string): Promise<void> {
    return this.request<void>('DELETE', `/machines/${machineId}`);
  }

  /**
   * Update machine heartbeat
   */
  async updateMachineHeartbeat(machineId: string): Promise<MachineHeartbeatResponse> {
    return this.request<MachineHeartbeatResponse>('POST', `/machines/${machineId}/heartbeat`);
  }

  /**
   * Find available machines
   */
  async findAvailableMachines(): Promise<MachineAvailability[]> {
    return this.request<MachineAvailability[]>('GET', '/machines/available');
  }

  /**
   * Assign session to machine
   */
  async assignSessionToMachine(
    machineId: string,
    sessionId: string,
    dockerSlot?: number
  ): Promise<Machine> {
    return this.request<Machine>('POST', `/machines/${machineId}/assign-session`, {
      session_id: sessionId,
      docker_slot: dockerSlot,
    });
  }

  /**
   * Release session from machine
   */
  async releaseSessionFromMachine(machineId: string, sessionId: string): Promise<Machine> {
    return this.request<Machine>('POST', `/machines/${machineId}/release-session`, {
      session_id: sessionId,
    });
  }

  // ==================== HEALTH ENDPOINT ====================

  /**
   * Check API health
   */
  async checkHealth(): Promise<{ status: string; timestamp: string }> {
    return this.request<{ status: string; timestamp: string }>('GET', '/health');
  }
}
