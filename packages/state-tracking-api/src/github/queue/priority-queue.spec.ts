import { PriorityQueue } from './priority-queue';
import { QueuedRequest, RequestPriority } from './types';

describe('PriorityQueue', () => {
  let queue: PriorityQueue;

  beforeEach(() => {
    queue = new PriorityQueue();
  });

  const createMockRequest = (
    priority: RequestPriority,
    id: string,
  ): QueuedRequest => ({
    id,
    userId: 'test-user',
    priority,
    execute: async () => 'result',
    enqueuedAt: Date.now(),
    resolve: () => {},
    reject: () => {},
    resource: 'graphql',
  });

  describe('enqueue', () => {
    it('should add requests to appropriate priority queue', () => {
      queue.enqueue(createMockRequest(RequestPriority.HIGH, 'h1'));
      queue.enqueue(createMockRequest(RequestPriority.NORMAL, 'n1'));
      queue.enqueue(createMockRequest(RequestPriority.LOW, 'l1'));

      expect(queue.size()).toBe(3);
      expect(queue.sizeByPriority(RequestPriority.HIGH)).toBe(1);
      expect(queue.sizeByPriority(RequestPriority.NORMAL)).toBe(1);
      expect(queue.sizeByPriority(RequestPriority.LOW)).toBe(1);
    });

    it('should maintain FIFO order within same priority', () => {
      queue.enqueue(createMockRequest(RequestPriority.NORMAL, 'n1'));
      queue.enqueue(createMockRequest(RequestPriority.NORMAL, 'n2'));
      queue.enqueue(createMockRequest(RequestPriority.NORMAL, 'n3'));

      const req1 = queue.dequeue();
      const req2 = queue.dequeue();
      const req3 = queue.dequeue();

      expect(req1?.id).toBe('n1');
      expect(req2?.id).toBe('n2');
      expect(req3?.id).toBe('n3');
    });
  });

  describe('dequeue', () => {
    it('should return requests in priority order', () => {
      queue.enqueue(createMockRequest(RequestPriority.LOW, 'l1'));
      queue.enqueue(createMockRequest(RequestPriority.NORMAL, 'n1'));
      queue.enqueue(createMockRequest(RequestPriority.HIGH, 'h1'));

      const req1 = queue.dequeue();
      const req2 = queue.dequeue();
      const req3 = queue.dequeue();

      expect(req1?.id).toBe('h1'); // High priority first
      expect(req2?.id).toBe('n1'); // Normal priority second
      expect(req3?.id).toBe('l1'); // Low priority last
    });

    it('should return undefined when queue is empty', () => {
      const result = queue.dequeue();
      expect(result).toBeUndefined();
    });

    it('should process all high priority before moving to normal', () => {
      queue.enqueue(createMockRequest(RequestPriority.NORMAL, 'n1'));
      queue.enqueue(createMockRequest(RequestPriority.HIGH, 'h1'));
      queue.enqueue(createMockRequest(RequestPriority.HIGH, 'h2'));
      queue.enqueue(createMockRequest(RequestPriority.NORMAL, 'n2'));

      const req1 = queue.dequeue();
      const req2 = queue.dequeue();
      const req3 = queue.dequeue();
      const req4 = queue.dequeue();

      expect(req1?.id).toBe('h1');
      expect(req2?.id).toBe('h2');
      expect(req3?.id).toBe('n1');
      expect(req4?.id).toBe('n2');
    });
  });

  describe('peek', () => {
    it('should return highest priority request without removing it', () => {
      queue.enqueue(createMockRequest(RequestPriority.LOW, 'l1'));
      queue.enqueue(createMockRequest(RequestPriority.HIGH, 'h1'));

      const peeked = queue.peek();
      expect(peeked?.id).toBe('h1');
      expect(queue.size()).toBe(2); // Should not remove
    });

    it('should return undefined when queue is empty', () => {
      const result = queue.peek();
      expect(result).toBeUndefined();
    });
  });

  describe('size', () => {
    it('should return total number of requests', () => {
      expect(queue.size()).toBe(0);

      queue.enqueue(createMockRequest(RequestPriority.HIGH, 'h1'));
      expect(queue.size()).toBe(1);

      queue.enqueue(createMockRequest(RequestPriority.NORMAL, 'n1'));
      expect(queue.size()).toBe(2);

      queue.enqueue(createMockRequest(RequestPriority.LOW, 'l1'));
      expect(queue.size()).toBe(3);
    });

    it('should decrease after dequeue', () => {
      queue.enqueue(createMockRequest(RequestPriority.NORMAL, 'n1'));
      queue.enqueue(createMockRequest(RequestPriority.NORMAL, 'n2'));
      expect(queue.size()).toBe(2);

      queue.dequeue();
      expect(queue.size()).toBe(1);

      queue.dequeue();
      expect(queue.size()).toBe(0);
    });
  });

  describe('sizeByPriority', () => {
    it('should return count for specific priority level', () => {
      queue.enqueue(createMockRequest(RequestPriority.HIGH, 'h1'));
      queue.enqueue(createMockRequest(RequestPriority.HIGH, 'h2'));
      queue.enqueue(createMockRequest(RequestPriority.NORMAL, 'n1'));

      expect(queue.sizeByPriority(RequestPriority.HIGH)).toBe(2);
      expect(queue.sizeByPriority(RequestPriority.NORMAL)).toBe(1);
      expect(queue.sizeByPriority(RequestPriority.LOW)).toBe(0);
    });
  });

  describe('isEmpty', () => {
    it('should return true when queue is empty', () => {
      expect(queue.isEmpty()).toBe(true);
    });

    it('should return false when queue has items', () => {
      queue.enqueue(createMockRequest(RequestPriority.NORMAL, 'n1'));
      expect(queue.isEmpty()).toBe(false);
    });

    it('should return true after clearing all items', () => {
      queue.enqueue(createMockRequest(RequestPriority.NORMAL, 'n1'));
      queue.dequeue();
      expect(queue.isEmpty()).toBe(true);
    });
  });

  describe('clear', () => {
    it('should remove all requests from all priority queues', () => {
      queue.enqueue(createMockRequest(RequestPriority.HIGH, 'h1'));
      queue.enqueue(createMockRequest(RequestPriority.NORMAL, 'n1'));
      queue.enqueue(createMockRequest(RequestPriority.LOW, 'l1'));

      expect(queue.size()).toBe(3);

      queue.clear();

      expect(queue.size()).toBe(0);
      expect(queue.isEmpty()).toBe(true);
      expect(queue.sizeByPriority(RequestPriority.HIGH)).toBe(0);
      expect(queue.sizeByPriority(RequestPriority.NORMAL)).toBe(0);
      expect(queue.sizeByPriority(RequestPriority.LOW)).toBe(0);
    });
  });

  describe('getAll', () => {
    it('should return all requests in priority order', () => {
      queue.enqueue(createMockRequest(RequestPriority.LOW, 'l1'));
      queue.enqueue(createMockRequest(RequestPriority.HIGH, 'h1'));
      queue.enqueue(createMockRequest(RequestPriority.NORMAL, 'n1'));
      queue.enqueue(createMockRequest(RequestPriority.HIGH, 'h2'));

      const all = queue.getAll();

      expect(all.length).toBe(4);
      expect(all[0].id).toBe('h1');
      expect(all[1].id).toBe('h2');
      expect(all[2].id).toBe('n1');
      expect(all[3].id).toBe('l1');
    });

    it('should return empty array when queue is empty', () => {
      const all = queue.getAll();
      expect(all).toEqual([]);
    });
  });

  describe('removeWhere', () => {
    it('should remove requests matching predicate', () => {
      queue.enqueue(createMockRequest(RequestPriority.NORMAL, 'n1'));
      queue.enqueue(createMockRequest(RequestPriority.NORMAL, 'n2'));
      queue.enqueue(createMockRequest(RequestPriority.NORMAL, 'n3'));

      const removed = queue.removeWhere((req) => req.id === 'n2');

      expect(removed.length).toBe(1);
      expect(removed[0].id).toBe('n2');
      expect(queue.size()).toBe(2);
    });

    it('should remove from multiple priority queues', () => {
      const oldTime = Date.now() - 10000;

      const oldHigh = createMockRequest(RequestPriority.HIGH, 'h1');
      oldHigh.enqueuedAt = oldTime;

      const newHigh = createMockRequest(RequestPriority.HIGH, 'h2');

      const oldNormal = createMockRequest(RequestPriority.NORMAL, 'n1');
      oldNormal.enqueuedAt = oldTime;

      queue.enqueue(oldHigh);
      queue.enqueue(newHigh);
      queue.enqueue(oldNormal);

      const removed = queue.removeWhere((req) => req.enqueuedAt === oldTime);

      expect(removed.length).toBe(2);
      expect(queue.size()).toBe(1);
      expect(queue.peek()?.id).toBe('h2');
    });

    it('should return empty array if no matches', () => {
      queue.enqueue(createMockRequest(RequestPriority.NORMAL, 'n1'));
      const removed = queue.removeWhere((req) => req.id === 'nonexistent');

      expect(removed).toEqual([]);
      expect(queue.size()).toBe(1);
    });
  });

  describe('getOldestRequestAge', () => {
    it('should return age of oldest request', async () => {
      const oldRequest = createMockRequest(RequestPriority.NORMAL, 'n1');
      oldRequest.enqueuedAt = Date.now() - 5000; // 5 seconds ago

      queue.enqueue(oldRequest);

      await new Promise((resolve) => setTimeout(resolve, 100));

      const age = queue.getOldestRequestAge();
      expect(age).toBeGreaterThanOrEqual(5000);
      expect(age).toBeLessThan(6000);
    });

    it('should return 0 when queue is empty', () => {
      const age = queue.getOldestRequestAge();
      expect(age).toBe(0);
    });

    it('should find oldest across all priority queues', () => {
      const old = createMockRequest(RequestPriority.LOW, 'l1');
      old.enqueuedAt = Date.now() - 10000;

      const newer = createMockRequest(RequestPriority.HIGH, 'h1');
      newer.enqueuedAt = Date.now() - 5000;

      queue.enqueue(old);
      queue.enqueue(newer);

      const age = queue.getOldestRequestAge();
      expect(age).toBeGreaterThanOrEqual(10000);
    });
  });

  describe('stress test', () => {
    it('should handle large number of requests efficiently', () => {
      const startTime = Date.now();

      // Enqueue 1000 requests
      for (let i = 0; i < 1000; i++) {
        const priority =
          i % 3 === 0
            ? RequestPriority.HIGH
            : i % 3 === 1
              ? RequestPriority.NORMAL
              : RequestPriority.LOW;
        queue.enqueue(createMockRequest(priority, `req-${i}`));
      }

      const enqueueTime = Date.now() - startTime;
      expect(queue.size()).toBe(1000);
      expect(enqueueTime).toBeLessThan(1000); // Should be fast

      // Dequeue all
      const dequeueStart = Date.now();
      let count = 0;
      while (!queue.isEmpty()) {
        queue.dequeue();
        count++;
      }

      const dequeueTime = Date.now() - dequeueStart;
      expect(count).toBe(1000);
      expect(dequeueTime).toBeLessThan(1000); // Should be fast
    });
  });
});
