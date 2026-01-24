import { QueuedRequest, RequestPriority } from './types';

/**
 * Priority queue implementation for GitHub API requests
 *
 * Maintains three internal queues (high, normal, low) and dequeues
 * in priority order: high first, then normal, then low.
 */
export class PriorityQueue<T = any> {
  private highQueue: QueuedRequest<T>[] = [];
  private normalQueue: QueuedRequest<T>[] = [];
  private lowQueue: QueuedRequest<T>[] = [];

  /**
   * Add a request to the queue
   */
  enqueue(request: QueuedRequest<T>): void {
    switch (request.priority) {
      case RequestPriority.HIGH:
        this.highQueue.push(request);
        break;
      case RequestPriority.NORMAL:
        this.normalQueue.push(request);
        break;
      case RequestPriority.LOW:
        this.lowQueue.push(request);
        break;
    }
  }

  /**
   * Remove and return the highest priority request
   * Returns undefined if queue is empty
   */
  dequeue(): QueuedRequest<T> | undefined {
    if (this.highQueue.length > 0) {
      return this.highQueue.shift();
    }
    if (this.normalQueue.length > 0) {
      return this.normalQueue.shift();
    }
    if (this.lowQueue.length > 0) {
      return this.lowQueue.shift();
    }
    return undefined;
  }

  /**
   * Peek at the highest priority request without removing it
   */
  peek(): QueuedRequest<T> | undefined {
    if (this.highQueue.length > 0) {
      return this.highQueue[0];
    }
    if (this.normalQueue.length > 0) {
      return this.normalQueue[0];
    }
    if (this.lowQueue.length > 0) {
      return this.lowQueue[0];
    }
    return undefined;
  }

  /**
   * Get total number of queued requests
   */
  size(): number {
    return this.highQueue.length + this.normalQueue.length + this.lowQueue.length;
  }

  /**
   * Get count by priority level
   */
  sizeByPriority(priority: RequestPriority): number {
    switch (priority) {
      case RequestPriority.HIGH:
        return this.highQueue.length;
      case RequestPriority.NORMAL:
        return this.normalQueue.length;
      case RequestPriority.LOW:
        return this.lowQueue.length;
    }
  }

  /**
   * Check if queue is empty
   */
  isEmpty(): boolean {
    return this.size() === 0;
  }

  /**
   * Clear all queues
   */
  clear(): void {
    this.highQueue = [];
    this.normalQueue = [];
    this.lowQueue = [];
  }

  /**
   * Get all requests (in priority order)
   */
  getAll(): QueuedRequest<T>[] {
    return [...this.highQueue, ...this.normalQueue, ...this.lowQueue];
  }

  /**
   * Remove requests matching a predicate
   */
  removeWhere(predicate: (request: QueuedRequest<T>) => boolean): QueuedRequest<T>[] {
    const removed: QueuedRequest<T>[] = [];

    const filterQueue = (queue: QueuedRequest<T>[]) => {
      const kept: QueuedRequest<T>[] = [];
      for (const req of queue) {
        if (predicate(req)) {
          removed.push(req);
        } else {
          kept.push(req);
        }
      }
      return kept;
    };

    this.highQueue = filterQueue(this.highQueue);
    this.normalQueue = filterQueue(this.normalQueue);
    this.lowQueue = filterQueue(this.lowQueue);

    return removed;
  }

  /**
   * Get the age of the oldest request in milliseconds
   */
  getOldestRequestAge(): number {
    const now = Date.now();
    let oldestAge = 0;

    const checkQueue = (queue: QueuedRequest<T>[]) => {
      if (queue.length > 0) {
        const age = now - queue[0].enqueuedAt;
        if (age > oldestAge) {
          oldestAge = age;
        }
      }
    };

    checkQueue(this.highQueue);
    checkQueue(this.normalQueue);
    checkQueue(this.lowQueue);

    return oldestAge;
  }
}
