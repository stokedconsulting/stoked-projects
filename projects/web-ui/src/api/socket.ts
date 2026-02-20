import { io, Socket } from 'socket.io-client';

type EventCallback = (data: unknown) => void;

class SocketManager {
  private socket: Socket | null = null;
  private baseUrl: string;
  private maxReconnectAttempts = 3;
  private subscribers = new Map<string, Set<EventCallback>>();
  private debounceTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private _isConnected = false;
  private _useFallbackPolling = false;

  constructor() {
    this.baseUrl = import.meta.env.VITE_API_URL || 'http://localhost:3000';
  }

  get isConnected() { return this._isConnected; }
  get useFallbackPolling() { return this._useFallbackPolling; }

  connect() {
    if (this.socket?.connected) return;

    this.socket = io(this.baseUrl, {
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 30000,
      reconnectionAttempts: this.maxReconnectAttempts,
    });

    this.socket.on('connect', () => {
      this._isConnected = true;
      this._useFallbackPolling = false;
    });

    this.socket.on('disconnect', () => {
      this._isConnected = false;
    });

    this.socket.on('reconnect_failed', () => {
      this._useFallbackPolling = true;
      this._isConnected = false;
    });

    // Listen for known events
    const events = ['workspace:update', 'global:update', 'project:event'];
    events.forEach(event => {
      this.socket?.on(event, (data: unknown) => {
        this.debouncedNotify(event, data);
      });
    });
  }

  disconnect() {
    this.socket?.disconnect();
    this.socket = null;
    this._isConnected = false;
  }

  subscribe(event: string, callback: EventCallback) {
    if (!this.subscribers.has(event)) {
      this.subscribers.set(event, new Set());
    }
    this.subscribers.get(event)!.add(callback);
    return () => this.unsubscribe(event, callback);
  }

  unsubscribe(event: string, callback: EventCallback) {
    this.subscribers.get(event)?.delete(callback);
  }

  private debouncedNotify(event: string, data: unknown) {
    const existing = this.debounceTimers.get(event);
    if (existing) clearTimeout(existing);

    this.debounceTimers.set(event, setTimeout(() => {
      this.subscribers.get(event)?.forEach(cb => cb(data));
      this.debounceTimers.delete(event);
    }, 500));
  }
}

export const socketManager = new SocketManager();
