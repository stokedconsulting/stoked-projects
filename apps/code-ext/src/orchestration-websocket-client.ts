import * as vscode from 'vscode';
import { io, Socket } from 'socket.io-client';

/**
 * Orchestration update event from server
 */
export interface OrchestrationUpdate {
  workspace?: {
    workspace_id: string;
    running: number;
    desired: number;
  };
  global: {
    running: number;
    desired: number;
  };
}

/**
 * Project event received from Socket.io gateway
 */
export interface ProjectEvent {
  type: string;
  data: Record<string, any>;
  timestamp?: string;
}

/**
 * Configuration for the orchestration WebSocket client
 */
export interface OrchestrationWebSocketConfig {
  url: string; // Base URL (e.g., 'https://claude-projects.truapi.com' or 'http://localhost:3000')
  apiKey?: string; // Optional for localhost connections
  workspaceId: string;
  projectNumbers?: number[]; // Projects to subscribe to for real-time events
}

/**
 * Event handler callback types
 */
export type GlobalUpdateHandler = (global: { running: number; desired: number }) => void;
export type WorkspaceUpdateHandler = (workspace: {
  workspaceId: string;
  running: number;
  desired: number;
}) => void;
export type ProjectEventHandler = (event: ProjectEvent) => void;

/**
 * WebSocket client for receiving real-time orchestration updates
 *
 * This client connects to the /orchestration WebSocket endpoint and:
 * - Subscribes to workspace-specific updates
 * - Receives global orchestration state changes
 * - Automatically reconnects on disconnection
 * - Synchronizes running/desired counts across all IDE instances
 */
export class OrchestrationWebSocketClient {
  private socket?: Socket;
  private config?: OrchestrationWebSocketConfig;
  private globalHandlers: GlobalUpdateHandler[] = [];
  private workspaceHandlers: WorkspaceUpdateHandler[] = [];
  private projectEventHandlers: ProjectEventHandler[] = [];
  private outputChannel: vscode.OutputChannel;
  private isClosing = false;

  constructor(outputChannel: vscode.OutputChannel) {
    this.outputChannel = outputChannel;
  }

  /**
   * Connect to the orchestration WebSocket server
   */
  public async connect(config: OrchestrationWebSocketConfig): Promise<void> {
    if (this.socket?.connected) {
      this.outputChannel.appendLine('[OrchestrationWS] Already connected');
      return;
    }

    this.config = config;
    this.isClosing = false;

    try {
      this.outputChannel.appendLine(`[OrchestrationWS] Connecting to ${config.url}/orchestration...`);

      // Prepare auth options
      const auth: any = {};
      if (config.apiKey) {
        auth.token = config.apiKey;
      }

      // Connect to /orchestration path
      this.socket = io(`${config.url}/orchestration`, {
        transports: ['websocket', 'polling'],
        reconnection: true,
        reconnectionDelay: 1000,
        reconnectionDelayMax: 30000,
        reconnectionAttempts: Infinity,
        auth,
      });

      // Set up event handlers
      this.socket.on('connect', () => this.handleConnect());
      this.socket.on('disconnect', (reason: string) => this.handleDisconnect(reason));
      this.socket.on('connect_error', (error: Error) => this.handleError(error));
      this.socket.on('error', (error: any) => this.handleServerError(error));

      // Orchestration-specific events
      this.socket.on('orchestration.global', (data: { running: number; desired: number }) =>
        this.handleGlobalUpdate(data)
      );
      this.socket.on('orchestration.workspace', (data: {
        workspaceId: string;
        running: number;
        desired: number;
      }) => this.handleWorkspaceUpdate(data));

      this.socket.on('subscribed', (data: { workspaceId: string }) =>
        this.handleSubscribed(data)
      );

      // Project event listener
      this.socket.on('project.event', (event: ProjectEvent) =>
        this.handleProjectEvent(event)
      );
      this.socket.on('subscribedProjects', (data: { projectNumbers: number[] }) =>
        this.handleSubscribedProjects(data)
      );

    } catch (error) {
      this.outputChannel.appendLine(`[OrchestrationWS] Connection error: ${error}`);
      throw error;
    }
  }

  /**
   * Handle successful connection
   */
  private handleConnect(): void {
    this.outputChannel.appendLine('[OrchestrationWS] Connected successfully');

    // Subscribe to workspace updates
    if (this.config?.workspaceId) {
      this.outputChannel.appendLine(
        `[OrchestrationWS] Subscribing to workspace: ${this.config.workspaceId}`
      );
      this.socket?.emit('subscribe', { workspaceId: this.config.workspaceId });
    }

    // Subscribe to project events
    if (this.config?.projectNumbers && this.config.projectNumbers.length > 0) {
      this.outputChannel.appendLine(
        `[OrchestrationWS] Subscribing to ${this.config.projectNumbers.length} project(s)`
      );
      this.socket?.emit('subscribeProjects', { projectNumbers: this.config.projectNumbers });
    }
  }

  /**
   * Handle disconnection
   */
  private handleDisconnect(reason: string): void {
    if (this.isClosing) {
      this.outputChannel.appendLine('[OrchestrationWS] Disconnected gracefully');
      return;
    }

    this.outputChannel.appendLine(`[OrchestrationWS] Disconnected: ${reason}`);

    // Socket.io will automatically attempt to reconnect
    if (reason === 'io server disconnect') {
      // Server initiated disconnect, manually reconnect
      this.socket?.connect();
    }
  }

  /**
   * Handle connection errors
   */
  private handleError(error: Error): void {
    this.outputChannel.appendLine(`[OrchestrationWS] Connection error: ${error.message}`);
  }

  /**
   * Handle server errors
   */
  private handleServerError(error: any): void {
    this.outputChannel.appendLine(`[OrchestrationWS] Server error: ${JSON.stringify(error)}`);
  }

  /**
   * Handle subscription confirmation
   */
  private handleSubscribed(data: { workspaceId: string }): void {
    this.outputChannel.appendLine(
      `[OrchestrationWS] Subscribed to workspace: ${data.workspaceId}`
    );
  }

  /**
   * Handle project subscription confirmation
   */
  private handleSubscribedProjects(data: { projectNumbers: number[] }): void {
    this.outputChannel.appendLine(
      `[OrchestrationWS] Subscribed to projects: ${data.projectNumbers.join(', ')}`
    );
  }

  /**
   * Handle project event from gateway
   */
  private handleProjectEvent(event: ProjectEvent): void {
    this.outputChannel.appendLine(
      `[OrchestrationWS] Project event: type=${event.type}, data=${JSON.stringify(event.data)}`
    );

    for (const handler of this.projectEventHandlers) {
      try {
        handler(event);
      } catch (error) {
        this.outputChannel.appendLine(`[OrchestrationWS] Error in project event handler: ${error}`);
      }
    }
  }

  /**
   * Handle global orchestration update
   * Broadcasts to ALL connected clients when ANY workspace changes
   */
  private handleGlobalUpdate(data: { running: number; desired: number }): void {
    this.outputChannel.appendLine(
      `[OrchestrationWS] Global update: running=${data.running}, desired=${data.desired}`
    );

    // Notify all registered handlers
    for (const handler of this.globalHandlers) {
      try {
        handler(data);
      } catch (error) {
        this.outputChannel.appendLine(`[OrchestrationWS] Error in global handler: ${error}`);
      }
    }
  }

  /**
   * Handle workspace-specific orchestration update
   * Only sent to clients subscribed to this workspace
   */
  private handleWorkspaceUpdate(data: {
    workspaceId: string;
    running: number;
    desired: number;
  }): void {
    this.outputChannel.appendLine(
      `[OrchestrationWS] Workspace update: workspace=${data.workspaceId}, running=${data.running}, desired=${data.desired}`
    );

    // Notify all registered handlers
    for (const handler of this.workspaceHandlers) {
      try {
        handler(data);
      } catch (error) {
        this.outputChannel.appendLine(`[OrchestrationWS] Error in workspace handler: ${error}`);
      }
    }
  }

  /**
   * Register a handler for global orchestration updates
   */
  public onGlobalUpdate(handler: GlobalUpdateHandler): void {
    this.globalHandlers.push(handler);
  }

  /**
   * Register a handler for workspace orchestration updates
   */
  public onWorkspaceUpdate(handler: WorkspaceUpdateHandler): void {
    this.workspaceHandlers.push(handler);
  }

  /**
   * Unregister a global update handler
   */
  public offGlobalUpdate(handler: GlobalUpdateHandler): void {
    const index = this.globalHandlers.indexOf(handler);
    if (index >= 0) {
      this.globalHandlers.splice(index, 1);
    }
  }

  /**
   * Unregister a workspace update handler
   */
  public offWorkspaceUpdate(handler: WorkspaceUpdateHandler): void {
    const index = this.workspaceHandlers.indexOf(handler);
    if (index >= 0) {
      this.workspaceHandlers.splice(index, 1);
    }
  }

  /**
   * Register a handler for project events
   */
  public onProjectEvent(handler: ProjectEventHandler): void {
    this.projectEventHandlers.push(handler);
  }

  /**
   * Unregister a project event handler
   */
  public offProjectEvent(handler: ProjectEventHandler): void {
    const index = this.projectEventHandlers.indexOf(handler);
    if (index >= 0) {
      this.projectEventHandlers.splice(index, 1);
    }
  }

  /**
   * Subscribe to additional projects (after initial connection)
   */
  public subscribeProjects(projectNumbers: number[]): void {
    if (this.socket?.connected && projectNumbers.length > 0) {
      this.socket.emit('subscribeProjects', { projectNumbers });
    }
  }

  /**
   * Disconnect and cleanup
   */
  public disconnect(): void {
    this.isClosing = true;

    if (this.socket) {
      this.outputChannel.appendLine('[OrchestrationWS] Disconnecting...');

      // Unsubscribe from workspace if connected
      if (this.config?.workspaceId && this.socket.connected) {
        this.socket.emit('unsubscribe', { workspaceId: this.config.workspaceId });
      }

      this.socket.disconnect();
      this.socket = undefined;
    }

    // Clear handlers
    this.globalHandlers = [];
    this.workspaceHandlers = [];
    this.projectEventHandlers = [];

    this.outputChannel.appendLine('[OrchestrationWS] Disconnected');
  }

  /**
   * Check if connected
   */
  public isConnected(): boolean {
    return this.socket?.connected ?? false;
  }

  /**
   * Get connection state
   */
  public getState(): string {
    if (!this.socket) return 'disconnected';
    return this.socket.connected ? 'connected' : 'disconnected';
  }
}
