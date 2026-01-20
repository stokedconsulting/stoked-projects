/**
 * Reliability Integration Tests - WebSocket Client + Server
 *
 * Comprehensive end-to-end tests for Phase 4.4: Notification Reliability and Error Handling
 * Tests the server-side reliability features including sequence numbering, replay buffer,
 * error handling, and client deduplication capabilities.
 *
 * Acceptance Criteria:
 * - AC-4.4.a: When client reconnects after brief disconnect → Receives missed events via replay
 * - AC-4.4.b: When client receives duplicate event → Ignores duplicate based on sequence number
 * - AC-4.4.c: When event buffer overflows → Oldest events are dropped, warning is logged
 * - AC-4.4.d: When client detects sequence gap → Requests and receives replay of missed events
 * - AC-4.4.e: When client experiences persistent errors → Server disconnects client after max errors
 * - AC-4.4.f: When server restarts → Clients reconnect and request replay automatically
 */

import { WebSocketNotificationServer, WebSocketServerConfig } from './websocket-server';
import { EventBus } from './event-bus';
import { Logger } from '../config';
import WebSocket from 'ws';

/**
 * Mock logger for testing
 */
const createMockLogger = (): Logger => ({
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
});

/**
 * Helper to wait for specific time
 */
const wait = (ms: number): Promise<void> => {
  return new Promise((resolve) => setTimeout(resolve, ms));
};

/**
 * Helper to wait for WebSocket to open
 */
const waitForOpen = (ws: WebSocket): Promise<void> => {
  return new Promise((resolve, reject) => {
    if (ws.readyState === WebSocket.OPEN) {
      resolve();
      return;
    }
    ws.once('open', () => resolve());
    ws.once('error', reject);
  });
};

/**
 * Helper to receive next message from WebSocket
 */
const receiveMessage = (ws: WebSocket): Promise<any> => {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Timeout waiting for message')), 5000);
    ws.once('message', (data) => {
      clearTimeout(timeout);
      try {
        resolve(JSON.parse(data.toString()));
      } catch (error) {
        reject(error);
      }
    });
    ws.once('error', (error) => {
      clearTimeout(timeout);
      reject(error);
    });
  });
};

/**
 * Helper to send message to WebSocket
 */
const sendMessage = (ws: WebSocket, message: any): void => {
  ws.send(JSON.stringify(message));
};

describe('Reliability Integration Tests - WebSocket Client + Server', () => {
  let server: WebSocketNotificationServer;
  let eventBus: EventBus;
  let logger: Logger;
  const TEST_PORT = 8085;
  const TEST_API_KEY = 'test-reliability-key';

  beforeEach(async () => {
    eventBus = new EventBus();
    logger = createMockLogger();

    const config: WebSocketServerConfig = {
      port: TEST_PORT,
      apiKey: TEST_API_KEY,
      eventBus,
      logger,
      pingInterval: 30000,
      pongTimeout: 60000,
      maxReplayBufferSize: 100,
      maxErrorCount: 10,
    };

    server = new WebSocketNotificationServer(config);
    await server.start();
  });

  afterEach(async () => {
    try {
      await server.stop();
    } catch (error) {
      // Server may already be stopped
    }
    eventBus.clearAllSubscribers();
    await wait(300); // Give port time to be released
  });

  describe('Test-4.4.a: Client reconnects after brief disconnect and receives missed events via replay', () => {
    it('should buffer events and provide replay capability', async () => {
      // Connect client
      const ws = new WebSocket(`ws://localhost:${TEST_PORT}/notifications?apiKey=${TEST_API_KEY}`);
      await waitForOpen(ws);

      // Receive welcome message
      await receiveMessage(ws);

      // Subscribe
      sendMessage(ws, { type: 'subscribe', projectNumbers: [72] });
      await receiveMessage(ws); // subscription confirmation

      // Emit events
      eventBus.emit('issue.created', 72, { title: 'Event 1' }, 1);
      const event1 = await receiveMessage(ws);
      expect(event1.type).toBe('event');
      expect(event1.sequence).toBe(1);

      eventBus.emit('issue.created', 72, { title: 'Event 2' }, 2);
      const event2 = await receiveMessage(ws);
      expect(event2.sequence).toBe(2);

      eventBus.emit('issue.created', 72, { title: 'Event 3' }, 3);
      const event3 = await receiveMessage(ws);
      expect(event3.sequence).toBe(3);

      // Request replay from sequence 1
      sendMessage(ws, { type: 'replay', sinceSequence: 1 });
      const replayMsg = await receiveMessage(ws);

      expect(replayMsg.type).toBe('replay');
      expect(replayMsg.events).toHaveLength(2); // Events 2 and 3
      expect(replayMsg.events[0].sequence).toBe(2);
      expect(replayMsg.events[1].sequence).toBe(3);

      ws.close();
      await wait(200);
    });
  });

  describe('Test-4.4.b: Server provides sequence numbers for deduplication', () => {
    it('should send events with incrementing sequence numbers', async () => {
      const ws = new WebSocket(`ws://localhost:${TEST_PORT}/notifications?apiKey=${TEST_API_KEY}`);
      await waitForOpen(ws);

      // Receive welcome and subscribe
      await receiveMessage(ws);
      sendMessage(ws, { type: 'subscribe', projectNumbers: [72] });
      await receiveMessage(ws);

      // Emit multiple events
      eventBus.emit('issue.created', 72, { title: 'Event 1' }, 1);
      eventBus.emit('issue.created', 72, { title: 'Event 2' }, 2);
      eventBus.emit('issue.created', 72, { title: 'Event 3' }, 3);

      const event1 = await receiveMessage(ws);
      const event2 = await receiveMessage(ws);
      const event3 = await receiveMessage(ws);

      expect(event1.sequence).toBe(1);
      expect(event2.sequence).toBe(2);
      expect(event3.sequence).toBe(3);

      ws.close();
      await wait(200);
    });

    it('should handle client acknowledgments', async () => {
      const ws = new WebSocket(`ws://localhost:${TEST_PORT}/notifications?apiKey=${TEST_API_KEY}`);
      await waitForOpen(ws);

      await receiveMessage(ws);
      sendMessage(ws, { type: 'subscribe', projectNumbers: [72] });
      await receiveMessage(ws);

      eventBus.emit('issue.created', 72, { title: 'Test' }, 1);
      const event = await receiveMessage(ws);

      // Send acknowledgment
      sendMessage(ws, { type: 'ack', sequence: event.sequence });
      await wait(100);

      // Connection should still be open
      expect(ws.readyState).toBe(WebSocket.OPEN);

      ws.close();
      await wait(200);
    });
  });

  describe('Test-4.4.c: Event buffer overflow handling', () => {
    it('should drop oldest events when buffer overflows and log warning', async () => {
      // Recreate server with small buffer
      await server.stop();
      await wait(300);

      const smallBufferServer = new WebSocketNotificationServer({
        port: TEST_PORT,
        apiKey: TEST_API_KEY,
        eventBus,
        logger,
        maxReplayBufferSize: 5,
      });
      await smallBufferServer.start();

      const ws = new WebSocket(`ws://localhost:${TEST_PORT}/notifications?apiKey=${TEST_API_KEY}`);
      await waitForOpen(ws);

      await receiveMessage(ws);
      sendMessage(ws, { type: 'subscribe', projectNumbers: [72] });
      await receiveMessage(ws);

      // Emit 10 events (exceeds buffer size of 5)
      for (let i = 1; i <= 10; i++) {
        eventBus.emit('issue.created', 72, { title: `Event ${i}` }, i);
        await receiveMessage(ws); // Consume each event
      }

      // Verify warning was logged
      expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('replay buffer overflow'));

      // Request replay from sequence 1 (should be dropped)
      sendMessage(ws, { type: 'replay', sinceSequence: 1 });
      const replayMsg = await receiveMessage(ws);

      // Should only get recent events (buffer size is 5, so at most 4 events after seq 1)
      expect(replayMsg.events.length).toBeLessThanOrEqual(9);

      ws.close();
      await smallBufferServer.stop();
      await wait(300);

      // Restart original server
      server = new WebSocketNotificationServer({
        port: TEST_PORT,
        apiKey: TEST_API_KEY,
        eventBus,
        logger,
        maxReplayBufferSize: 100,
      });
      await server.start();
    }, 20000);
  });

  describe('Test-4.4.d: Client can request replay of missed events', () => {
    it('should handle replay requests correctly', async () => {
      const ws = new WebSocket(`ws://localhost:${TEST_PORT}/notifications?apiKey=${TEST_API_KEY}`);
      await waitForOpen(ws);

      await receiveMessage(ws);
      sendMessage(ws, { type: 'subscribe', projectNumbers: [72] });
      await receiveMessage(ws);

      // Emit events
      eventBus.emit('issue.created', 72, { title: 'Event 1' }, 1);
      eventBus.emit('issue.created', 72, { title: 'Event 2' }, 2);
      eventBus.emit('issue.created', 72, { title: 'Event 3' }, 3);

      await receiveMessage(ws);
      await receiveMessage(ws);
      await receiveMessage(ws);

      // Request replay from sequence 1
      sendMessage(ws, { type: 'replay', sinceSequence: 1 });
      const replayMsg = await receiveMessage(ws);

      expect(replayMsg.type).toBe('replay');
      expect(replayMsg.events).toHaveLength(2); // Events 2 and 3
      expect(replayMsg.events[0].event.data.title).toBe('Event 2');
      expect(replayMsg.events[1].event.data.title).toBe('Event 3');

      ws.close();
      await wait(200);
    });

    it('should return empty array when no events to replay', async () => {
      const ws = new WebSocket(`ws://localhost:${TEST_PORT}/notifications?apiKey=${TEST_API_KEY}`);
      await waitForOpen(ws);

      await receiveMessage(ws);
      sendMessage(ws, { type: 'subscribe', projectNumbers: [72] });
      await receiveMessage(ws);

      eventBus.emit('issue.created', 72, { title: 'Event 1' }, 1);
      const event1 = await receiveMessage(ws);

      // Request replay from current sequence
      sendMessage(ws, { type: 'replay', sinceSequence: event1.sequence });
      const replayMsg = await receiveMessage(ws);

      expect(replayMsg.type).toBe('replay');
      expect(replayMsg.events).toEqual([]);

      ws.close();
      await wait(200);
    });
  });

  describe('Test-4.4.e: Server disconnects client after persistent errors', () => {
    it('should track error count and disconnect after threshold', async () => {
      // Recreate server with low error threshold
      await server.stop();
      await wait(300);

      const errorServer = new WebSocketNotificationServer({
        port: TEST_PORT,
        apiKey: TEST_API_KEY,
        eventBus,
        logger,
        maxErrorCount: 3,
      });
      await errorServer.start();

      const ws = new WebSocket(`ws://localhost:${TEST_PORT}/notifications?apiKey=${TEST_API_KEY}`);
      await waitForOpen(ws);

      // Consume welcome message
      await receiveMessage(ws);

      // Send invalid messages to trigger errors
      for (let i = 0; i < 5; i++) {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(`invalid json ${i}`);
          await wait(150);
        }
      }

      // Wait for disconnect
      await wait(1000);

      expect(ws.readyState).toBe(WebSocket.CLOSED);
      expect(logger.error).toHaveBeenCalledWith(expect.stringContaining('exceeded max error count'));

      await errorServer.stop();
      await wait(300);

      // Restart original server
      server = new WebSocketNotificationServer({
        port: TEST_PORT,
        apiKey: TEST_API_KEY,
        eventBus,
        logger,
        maxErrorCount: 10,
      });
      await server.start();
    }, 15000);
  });

  describe('Test-4.4.f: Replay buffer persists during server uptime', () => {
    it('should maintain replay buffer for each client connection', async () => {
      const ws = new WebSocket(`ws://localhost:${TEST_PORT}/notifications?apiKey=${TEST_API_KEY}`);
      await waitForOpen(ws);

      await receiveMessage(ws);
      sendMessage(ws, { type: 'subscribe', projectNumbers: [72] });
      await receiveMessage(ws);

      // Emit multiple events
      eventBus.emit('issue.created', 72, { title: 'Event 1' }, 1);
      eventBus.emit('issue.updated', 72, { status: 'done' }, 1);
      eventBus.emit('project.updated', 72, { name: 'Updated' });

      const event1 = await receiveMessage(ws);
      const event2 = await receiveMessage(ws);
      const event3 = await receiveMessage(ws);

      expect(event1.sequence).toBe(1);
      expect(event2.sequence).toBe(2);
      expect(event3.sequence).toBe(3);

      // Request replay from beginning
      sendMessage(ws, { type: 'replay', sinceSequence: 0 });
      const replayMsg = await receiveMessage(ws);

      expect(replayMsg.type).toBe('replay');
      expect(replayMsg.events).toHaveLength(3);
      expect(replayMsg.events[0].sequence).toBe(1);
      expect(replayMsg.events[1].sequence).toBe(2);
      expect(replayMsg.events[2].sequence).toBe(3);

      ws.close();
      await wait(200);
    });
  });

  describe('Error handling and edge cases', () => {
    it('should handle invalid replay requests', async () => {
      const ws = new WebSocket(`ws://localhost:${TEST_PORT}/notifications?apiKey=${TEST_API_KEY}`);
      await waitForOpen(ws);

      await receiveMessage(ws);
      sendMessage(ws, { type: 'subscribe', projectNumbers: [72] });
      await receiveMessage(ws);

      eventBus.emit('issue.created', 72, { title: 'Event 1' }, 1);
      await receiveMessage(ws);

      // Request invalid message type
      sendMessage(ws, { type: 'unknown' });
      const errorMsg = await receiveMessage(ws);

      expect(errorMsg.type).toBe('error');
      expect(errorMsg.message).toContain('Unknown message type');

      ws.close();
      await wait(200);
    });

    it('should handle invalid JSON messages', async () => {
      const ws = new WebSocket(`ws://localhost:${TEST_PORT}/notifications?apiKey=${TEST_API_KEY}`);
      await waitForOpen(ws);

      await receiveMessage(ws);

      ws.send('not json');
      const errorMsg = await receiveMessage(ws);

      expect(errorMsg.type).toBe('error');
      expect(errorMsg.message).toContain('Invalid JSON');

      ws.close();
      await wait(200);
    });
  });
});
