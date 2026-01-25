import * as vscode from 'vscode';
import WebSocket from 'ws';

/**
 * WebSocket event types from the notification server
 */
export interface WebSocketEvent {
  type: 'issue.created' | 'issue.updated' | 'issue.deleted' | 'project.updated' | 'phase.updated';
  data: any;
  timestamp: string;
  sequence?: number; // Sequence number for reliability
}

/**
 * Configuration for the WebSocket client
 */
export interface WebSocketClientConfig {
  url: string;
  apiKey: string;
  projectNumbers: number[];
}

/**
 * Event handler callback type
 */
export type EventHandler = (event: WebSocketEvent) => void;

/**
 * WebSocket client for receiving real-time notifications from the MCP notification server
 *
 * Features:
 * - Automatic connection on extension activation
 * - Authentication with API key
 * - Automatic reconnection with exponential backoff
 * - Event batching to prevent excessive UI updates
 * - Graceful cleanup on extension deactivation
 */
export class WebSocketNotificationClient {
  private ws?: WebSocket;
  private reconnectTimer?: NodeJS.Timeout;
  private reconnectAttempts = 0;
  private maxReconnectDelay = 30000; // 30 seconds
  private baseReconnectDelay = 1000; // 1 second
  private isConnecting = false;
  private isClosing = false;
  private eventHandlers: Map<string, EventHandler[]> = new Map();
  private eventBatchTimer?: NodeJS.Timeout;
  private eventBatchQueue: WebSocketEvent[] = [];
  private batchWindow = 500; // 500ms batching window
  private outputChannel: vscode.OutputChannel;
  private config?: WebSocketClientConfig;

  // Reliability features
  private lastReceivedSequence = 0;
  private processedSequences = new Set<number>();
  private maxProcessedSequences = 1000; // Limit memory usage

  constructor(outputChannel: vscode.OutputChannel) {
    this.outputChannel = outputChannel;
  }

  /**
   * Initialize and connect to the WebSocket server
   */
  public async connect(config: WebSocketClientConfig): Promise<void> {
    if (this.isConnecting || this.ws?.readyState === WebSocket.OPEN) {
      this.outputChannel.appendLine('[WebSocket] Already connected or connecting');
      return;
    }

    this.config = config;
    this.isConnecting = true;
    this.isClosing = false;

    try {
      this.outputChannel.appendLine(`[WebSocket] Connecting to ${config.url}...`);

      this.ws = new WebSocket(config.url, {
        headers: {
          'Authorization': `Bearer ${config.apiKey}`,
        },
      });

      this.ws.on('open', () => this.handleOpen());
      this.ws.on('message', (data: WebSocket.Data) => this.handleMessage(data));
      this.ws.on('error', (error: Error) => this.handleError(error));
      this.ws.on('close', (code: number, reason: Buffer) => this.handleClose(code, reason.toString()));

    } catch (error) {
      this.isConnecting = false;
      this.outputChannel.appendLine(`[WebSocket] Connection error: ${error}`);
      throw error;
    }
  }

  /**
   * Handle successful connection
   */
  private handleOpen(): void {
    this.isConnecting = false;
    this.reconnectAttempts = 0;
    this.outputChannel.appendLine('[WebSocket] Connected successfully');
    vscode.window.showInformationMessage('Connected to notification server');

    // Request replay of missed events if this is a reconnection
    if (this.lastReceivedSequence > 0) {
      this.outputChannel.appendLine(`[WebSocket] Requesting replay since sequence ${this.lastReceivedSequence}`);
      this.requestReplay(this.lastReceivedSequence);
    }

    // Subscribe to project updates
    if (this.config?.projectNumbers && this.config.projectNumbers.length > 0) {
      this.subscribe(this.config.projectNumbers);
    }
  }

  /**
   * Handle incoming messages
   */
  private handleMessage(data: WebSocket.Data): void {
    try {
      const message = JSON.parse(data.toString());
      this.outputChannel.appendLine(`[WebSocket] Received: ${JSON.stringify(message)}`);

      // Handle subscription confirmation
      if (message.type === 'subscribed') {
        this.outputChannel.appendLine(`[WebSocket] Subscribed to projects: ${message.projects?.join(', ')}`);
        return;
      }

      // Handle error messages
      if (message.type === 'error') {
        this.outputChannel.appendLine(`[WebSocket] Server error: ${message.message}`);
        return;
      }

      // Handle replay response
      if (message.type === 'replay') {
        this.handleReplayResponse(message.events || []);
        return;
      }

      // Handle events
      if (message.type === 'event' && message.event) {
        const event: WebSocketEvent = {
          type: message.event.type,
          data: message.event.data,
          timestamp: message.event.timestamp,
          sequence: message.sequence,
        };

        this.processEvent(event);
      }
    } catch (error) {
      this.outputChannel.appendLine(`[WebSocket] Error parsing message: ${error}`);
    }
  }

  /**
   * Process a single event with deduplication and sequencing
   */
  private processEvent(event: WebSocketEvent): void {
    // Check for duplicate (already processed)
    if (event.sequence && this.processedSequences.has(event.sequence)) {
      this.outputChannel.appendLine(`[WebSocket] Ignoring duplicate event sequence ${event.sequence}`);
      return;
    }

    // Detect sequence gap
    if (event.sequence) {
      if (this.lastReceivedSequence > 0 && event.sequence > this.lastReceivedSequence + 1) {
        const gap = event.sequence - this.lastReceivedSequence - 1;
        this.outputChannel.appendLine(
          `[WebSocket] Sequence gap detected! Expected ${this.lastReceivedSequence + 1}, got ${event.sequence} (gap of ${gap})`
        );
        // Request replay to fill the gap
        this.requestReplay(this.lastReceivedSequence);
      }

      // Update last received sequence
      this.lastReceivedSequence = event.sequence;

      // Track processed sequence (with memory limit)
      this.processedSequences.add(event.sequence);
      if (this.processedSequences.size > this.maxProcessedSequences) {
        // Remove oldest sequences (convert to array, sort, remove first 100)
        const sorted = Array.from(this.processedSequences).sort((a, b) => a - b);
        for (let i = 0; i < 100; i++) {
          this.processedSequences.delete(sorted[i]);
        }
      }

      // Send acknowledgment
      this.sendAcknowledgment(event.sequence);
    }

    // Add to batch queue for processing
    this.eventBatchQueue.push(event);

    // Start or reset batch timer
    if (this.eventBatchTimer) {
      clearTimeout(this.eventBatchTimer);
    }

    this.eventBatchTimer = setTimeout(() => {
      this.processBatchedEvents();
    }, this.batchWindow);
  }

  /**
   * Handle replay response from server
   */
  private handleReplayResponse(events: Array<{ event: any; sequence: number }>): void {
    if (events.length === 0) {
      this.outputChannel.appendLine('[WebSocket] Replay response: no missed events');
      return;
    }

    this.outputChannel.appendLine(`[WebSocket] Replay response: ${events.length} events`);

    // Process each replayed event
    for (const { event, sequence } of events) {
      const webSocketEvent: WebSocketEvent = {
        type: event.type,
        data: event.data,
        timestamp: event.timestamp,
        sequence,
      };

      this.processEvent(webSocketEvent);
    }
  }

  /**
   * Process batched events to prevent excessive UI updates
   */
  private processBatchedEvents(): void {
    if (this.eventBatchQueue.length === 0) {
      return;
    }

    this.outputChannel.appendLine(`[WebSocket] Processing ${this.eventBatchQueue.length} batched events`);

    // Group events by type for efficient processing
    const eventsByType = new Map<string, WebSocketEvent[]>();
    for (const event of this.eventBatchQueue) {
      const events = eventsByType.get(event.type) || [];
      events.push(event);
      eventsByType.set(event.type, events);
    }

    // Dispatch events to handlers
    for (const [type, events] of eventsByType) {
      const handlers = this.eventHandlers.get(type) || [];
      for (const handler of handlers) {
        for (const event of events) {
          try {
            handler(event);
          } catch (error) {
            this.outputChannel.appendLine(`[WebSocket] Error in event handler: ${error}`);
          }
        }
      }

      // Also call wildcard handlers
      const wildcardHandlers = this.eventHandlers.get('*') || [];
      for (const handler of wildcardHandlers) {
        for (const event of events) {
          try {
            handler(event);
          } catch (error) {
            this.outputChannel.appendLine(`[WebSocket] Error in wildcard handler: ${error}`);
          }
        }
      }
    }

    // Clear the batch queue
    this.eventBatchQueue = [];
  }

  /**
   * Handle WebSocket errors
   */
  private handleError(error: Error): void {
    this.outputChannel.appendLine(`[WebSocket] Error: ${error.message}`);
  }

  /**
   * Handle connection close and attempt reconnection
   */
  private handleClose(code: number, reason: string): void {
    this.isConnecting = false;

    if (this.isClosing) {
      this.outputChannel.appendLine('[WebSocket] Connection closed gracefully');
      return;
    }

    this.outputChannel.appendLine(`[WebSocket] Connection closed (code: ${code}, reason: ${reason})`);
    vscode.window.showWarningMessage('Disconnected from notification server. Reconnecting...');

    // Attempt reconnection with exponential backoff
    this.scheduleReconnect();
  }

  /**
   * Schedule a reconnection attempt with exponential backoff
   */
  private scheduleReconnect(): void {
    if (this.isClosing || !this.config) {
      return;
    }

    // Calculate delay with exponential backoff: 1s, 2s, 4s, 8s, 16s, max 30s
    const delay = Math.min(
      this.baseReconnectDelay * Math.pow(2, this.reconnectAttempts),
      this.maxReconnectDelay
    );

    this.reconnectAttempts++;
    this.outputChannel.appendLine(`[WebSocket] Reconnecting in ${delay / 1000}s (attempt ${this.reconnectAttempts})...`);

    this.reconnectTimer = setTimeout(() => {
      if (!this.isClosing && this.config) {
        this.connect(this.config).catch(error => {
          this.outputChannel.appendLine(`[WebSocket] Reconnection failed: ${error}`);
        });
      }
    }, delay);
  }

  /**
   * Subscribe to project updates
   */
  public subscribe(projectNumbers: number[]): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      this.outputChannel.appendLine('[WebSocket] Cannot subscribe - not connected');
      return;
    }

    const message = {
      type: 'subscribe',
      projectNumbers,
    };

    this.ws.send(JSON.stringify(message));
    this.outputChannel.appendLine(`[WebSocket] Subscribing to projects: ${projectNumbers.join(', ')}`);
  }

  /**
   * Send acknowledgment for received event
   */
  private sendAcknowledgment(sequence: number): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      this.outputChannel.appendLine(`[WebSocket] Cannot send ack for sequence ${sequence} - not connected`);
      return;
    }

    const message = {
      type: 'ack',
      sequence,
    };

    this.ws.send(JSON.stringify(message));
    this.outputChannel.appendLine(`[WebSocket] Sent ack for sequence ${sequence}`);
  }

  /**
   * Request replay of events since a specific sequence number
   */
  private requestReplay(sinceSequence: number): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      this.outputChannel.appendLine(`[WebSocket] Cannot request replay - not connected`);
      return;
    }

    const message = {
      type: 'replay',
      sinceSequence,
    };

    this.ws.send(JSON.stringify(message));
    this.outputChannel.appendLine(`[WebSocket] Requested replay since sequence ${sinceSequence}`);
  }

  /**
   * Unsubscribe from project updates
   */
  public unsubscribe(projectNumbers: number[]): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      this.outputChannel.appendLine('[WebSocket] Cannot unsubscribe - not connected');
      return;
    }

    const message = {
      type: 'unsubscribe',
      projects: projectNumbers,
    };

    this.ws.send(JSON.stringify(message));
    this.outputChannel.appendLine(`[WebSocket] Unsubscribing from projects: ${projectNumbers.join(', ')}`);
  }

  /**
   * Register an event handler
   * @param eventType Event type to listen for, or '*' for all events
   * @param handler Event handler callback
   */
  public on(eventType: string, handler: EventHandler): void {
    const handlers = this.eventHandlers.get(eventType) || [];
    handlers.push(handler);
    this.eventHandlers.set(eventType, handlers);
  }

  /**
   * Unregister an event handler
   */
  public off(eventType: string, handler: EventHandler): void {
    const handlers = this.eventHandlers.get(eventType) || [];
    const index = handlers.indexOf(handler);
    if (index >= 0) {
      handlers.splice(index, 1);
      this.eventHandlers.set(eventType, handlers);
    }
  }

  /**
   * Disconnect and cleanup
   */
  public disconnect(): void {
    this.isClosing = true;

    // Clear reconnect timer
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = undefined;
    }

    // Clear batch timer
    if (this.eventBatchTimer) {
      clearTimeout(this.eventBatchTimer);
      this.eventBatchTimer = undefined;
    }

    // Process any pending batched events
    this.processBatchedEvents();

    // Close WebSocket connection
    if (this.ws) {
      if (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING) {
        this.ws.close(1000, 'Extension deactivated');
      }
      this.ws = undefined;
    }

    // Clear reliability state (but preserve lastReceivedSequence for potential reconnection)
    this.processedSequences.clear();

    this.outputChannel.appendLine('[WebSocket] Disconnected');
  }

  /**
   * Check if connected
   */
  public isConnected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  /**
   * Get connection state
   */
  public getState(): string {
    if (!this.ws) return 'disconnected';

    switch (this.ws.readyState) {
      case WebSocket.CONNECTING:
        return 'connecting';
      case WebSocket.OPEN:
        return 'connected';
      case WebSocket.CLOSING:
        return 'closing';
      case WebSocket.CLOSED:
        return 'closed';
      default:
        return 'unknown';
    }
  }
}
