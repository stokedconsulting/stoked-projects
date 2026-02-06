import { Injectable, Logger } from '@nestjs/common';
import { v4 as uuidv4 } from 'uuid';
import { PriorityQueue } from './priority-queue';
import {
  QueuedRequest,
  RequestPriority,
  RateLimitConfig,
  RateLimitInfo,
  UserRateLimitState,
  QueueStats,
} from './types';

/**
 * GitHub API Rate Limiting and Request Queue Service
 *
 * Features:
 * - Tracks GitHub rate limits (5,000 requests/hour for GraphQL, separate for REST)
 * - Maintains priority queue (high|normal|low)
 * - Per-user rate limit tracking
 * - Proactive throttling at 80% threshold
 * - Queue capacity management (max 1,000 requests)
 * - Stale request cleanup (>2 minutes)
 * - High-priority bypass (max 10% of traffic)
 */
@Injectable()
export class RateLimitService {
  private readonly logger = new Logger(RateLimitService.name);

  // Per-user rate limit state
  private userStates = new Map<string, UserRateLimitState>();

  // Request queues per user
  private userQueues = new Map<string, PriorityQueue>();

  // High-priority bypass tracking
  private bypassCounts = new Map<string, number[]>(); // userId -> timestamps

  // Configuration with defaults
  private config: RateLimitConfig = {
    maxQueueSize: 1000,
    requestTimeout: 2 * 60 * 1000, // 2 minutes
    throttleThreshold: 0.8, // 80%
    throttleRate: 0.5, // 50% of normal rate
    maxBypassRate: 0.1, // 10%
    bypassWindowMs: 60 * 60 * 1000, // 1 hour
  };

  // Processing state
  private processing = new Map<string, boolean>();
  private processingIntervals = new Map<string, NodeJS.Timeout>();

  // Cleanup interval
  private cleanupInterval: NodeJS.Timeout;

  constructor() {
    // Start cleanup interval (every 30 seconds)
    this.cleanupInterval = setInterval(() => this.cleanupStaleRequests(), 30000);
  }

  /**
   * Cleanup resources (for testing)
   */
  onModuleDestroy(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
    }
    this.clearQueues();
  }

  /**
   * Update configuration
   */
  configure(config: Partial<RateLimitConfig>): void {
    this.config = { ...this.config, ...config };
    this.logger.log(`Rate limit config updated: ${JSON.stringify(this.config)}`);
  }

  /**
   * Enqueue a request for execution
   *
   * @param userId - User making the request
   * @param execute - Function to execute
   * @param priority - Request priority (default: normal)
   * @param resource - API resource type (default: graphql)
   * @returns Promise that resolves with the request result
   * @throws Error if queue is at capacity
   */
  async enqueueRequest<T>(
    userId: string,
    execute: () => Promise<T>,
    priority: RequestPriority = RequestPriority.NORMAL,
    resource: 'graphql' | 'rest' = 'graphql',
  ): Promise<T> {
    // Initialize user queue if needed
    if (!this.userQueues.has(userId)) {
      this.userQueues.set(userId, new PriorityQueue());
    }

    const queue = this.userQueues.get(userId)!;

    // Check queue capacity (AC-1.5.f)
    if (queue.size() >= this.config.maxQueueSize) {
      const error = new Error(
        `Queue at capacity (${this.config.maxQueueSize} requests). Please try again later.`,
      );
      error.name = 'QueueCapacityError';
      throw error;
    }

    // Create queued request
    return new Promise<T>((resolve, reject) => {
      const request: QueuedRequest<T> = {
        id: uuidv4(),
        userId,
        priority,
        execute,
        enqueuedAt: Date.now(),
        resolve,
        reject,
        resource,
      };

      queue.enqueue(request);
      this.logger.debug(
        `Request ${request.id} enqueued for user ${userId} (priority: ${priority}, queue size: ${queue.size()})`,
      );

      // Start processing if not already running
      this.startProcessing(userId);
    });
  }

  /**
   * Update rate limit info from response headers
   *
   * @param userId - User ID
   * @param headers - Response headers from GitHub API
   * @param resource - API resource type
   */
  updateRateLimitFromHeaders(
    userId: string,
    headers: Record<string, string>,
    resource: 'graphql' | 'rest',
  ): void {
    const remaining = parseInt(headers['x-ratelimit-remaining'] || '5000', 10);
    const limit = parseInt(headers['x-ratelimit-limit'] || '5000', 10);
    const resetAt = parseInt(headers['x-ratelimit-reset'] || '0', 10);

    const rateLimitInfo: RateLimitInfo = {
      remaining,
      limit,
      resetAt,
      resource,
    };

    // Get or create user state
    let userState = this.userStates.get(userId);
    if (!userState) {
      userState = {
        userId,
        graphql: { ...rateLimitInfo, resource: 'graphql' },
        rest: { ...rateLimitInfo, resource: 'rest' },
        lastUpdated: Date.now(),
      };
      this.userStates.set(userId, userState);
    }

    // Update the appropriate resource limit
    if (resource === 'graphql') {
      userState.graphql = rateLimitInfo;
    } else {
      userState.rest = rateLimitInfo;
    }
    userState.lastUpdated = Date.now();

    this.logger.debug(
      `Rate limit updated for ${userId}/${resource}: ${remaining}/${limit} (resets at ${new Date(resetAt * 1000).toISOString()})`,
    );
  }

  /**
   * Get current queue statistics for a user
   */
  getQueueStats(userId: string): QueueStats {
    const queue = this.userQueues.get(userId);
    if (!queue) {
      return {
        total: 0,
        high: 0,
        normal: 0,
        low: 0,
        oldestAge: 0,
        bypassCount: this.getBypassCount(userId),
      };
    }

    return {
      total: queue.size(),
      high: queue.sizeByPriority(RequestPriority.HIGH),
      normal: queue.sizeByPriority(RequestPriority.NORMAL),
      low: queue.sizeByPriority(RequestPriority.LOW),
      oldestAge: queue.getOldestRequestAge(),
      bypassCount: this.getBypassCount(userId),
    };
  }

  /**
   * Get rate limit state for a user
   */
  getRateLimitState(userId: string): UserRateLimitState | undefined {
    return this.userStates.get(userId);
  }

  /**
   * Clear all queues (for testing)
   */
  clearQueues(): void {
    this.userQueues.clear();
    this.userStates.clear();
    this.bypassCounts.clear();
    this.processing.clear();
    this.processingIntervals.forEach((interval) => clearInterval(interval));
    this.processingIntervals.clear();
  }

  /**
   * Start processing queue for a user
   */
  private startProcessing(userId: string): void {
    if (this.processing.get(userId)) {
      return; // Already processing
    }

    this.processing.set(userId, true);
    this.processNextRequest(userId);
  }

  /**
   * Process next request in queue
   */
  private async processNextRequest(userId: string): Promise<void> {
    const queue = this.userQueues.get(userId);
    if (!queue || queue.isEmpty()) {
      this.processing.set(userId, false);
      return;
    }

    const request = queue.peek();
    if (!request) {
      this.processing.set(userId, false);
      return;
    }

    const userState = this.userStates.get(userId);
    const rateLimitInfo =
      request.resource === 'graphql' ? userState?.graphql : userState?.rest;

    // Check if we should bypass queue for high-priority (AC-1.5.d)
    if (request.priority === RequestPriority.HIGH && this.canBypass(userId)) {
      this.logger.debug(`High-priority request ${request.id} bypassing queue`);
      queue.dequeue(); // Remove from queue
      this.recordBypass(userId);
      this.executeRequest(request, userId);
      // Continue processing immediately
      setImmediate(() => this.processNextRequest(userId));
      return;
    }

    // Check rate limit status
    if (rateLimitInfo) {
      const now = Math.floor(Date.now() / 1000);

      // AC-1.5.c: Rate limit exceeded - pause until reset
      if (rateLimitInfo.remaining === 0 && rateLimitInfo.resetAt > now) {
        const waitMs = (rateLimitInfo.resetAt - now) * 1000;
        this.logger.warn(
          `Rate limit exceeded for ${userId}/${request.resource}. Waiting ${Math.round(waitMs / 1000)}s until reset.`,
        );
        setTimeout(() => this.processNextRequest(userId), waitMs);
        return;
      }

      // AC-1.5.b: Proactive throttling at 80% threshold
      const utilizationRate = 1 - rateLimitInfo.remaining / rateLimitInfo.limit;
      if (utilizationRate >= this.config.throttleThreshold) {
        // Calculate throttled delay
        const normalDelay = 100; // Base delay between requests (ms)
        const throttledDelay = normalDelay / this.config.throttleRate;
        this.logger.debug(
          `Throttling ${userId}/${request.resource} at ${(utilizationRate * 100).toFixed(1)}% utilization (delay: ${throttledDelay}ms)`,
        );
        setTimeout(() => this.executeAndContinue(request, userId), throttledDelay);
        return;
      }
    }

    // AC-1.5.a: Execute immediately if quota available
    this.executeAndContinue(request, userId);
  }

  /**
   * Execute request and continue processing
   */
  private async executeAndContinue(request: QueuedRequest, userId: string): Promise<void> {
    const queue = this.userQueues.get(userId);
    if (queue) {
      queue.dequeue(); // Remove from queue
    }
    await this.executeRequest(request, userId);
    setImmediate(() => this.processNextRequest(userId));
  }

  /**
   * Execute a request
   */
  private async executeRequest(request: QueuedRequest, userId: string): Promise<void> {
    try {
      this.logger.debug(`Executing request ${request.id} for ${userId}`);
      const result = await request.execute();
      request.resolve(result);
    } catch (error) {
      this.logger.error(`Request ${request.id} failed: ${error.message}`);
      request.reject(error);
    }
  }

  /**
   * Clean up stale requests (>2 minutes old) - AC-1.5.e
   */
  private cleanupStaleRequests(): void {
    const now = Date.now();
    const maxAge = this.config.requestTimeout;

    for (const [userId, queue] of this.userQueues.entries()) {
      const staleRequests = queue.removeWhere((req) => now - req.enqueuedAt > maxAge);

      for (const req of staleRequests) {
        const error = new Error(
          `Request timed out after ${Math.round(maxAge / 1000)}s in queue`,
        );
        error.name = 'RequestTimeoutError';
        req.reject(error);
        this.logger.warn(
          `Request ${req.id} for ${userId} timed out after ${Math.round((now - req.enqueuedAt) / 1000)}s`,
        );
      }
    }

    // Clean up old bypass timestamps
    for (const [userId, timestamps] of this.bypassCounts.entries()) {
      const validTimestamps = timestamps.filter(
        (ts) => now - ts < this.config.bypassWindowMs,
      );
      this.bypassCounts.set(userId, validTimestamps);
    }
  }

  /**
   * Check if high-priority request can bypass queue
   */
  private canBypass(userId: string): boolean {
    const bypassCount = this.getBypassCount(userId);
    const userState = this.userStates.get(userId);

    if (!userState) {
      return true; // No rate limit info yet, allow bypass
    }

    // Calculate total requests in the bypass window
    const totalRequests = userState.graphql.limit + userState.rest.limit;
    const maxBypasses = Math.floor(totalRequests * this.config.maxBypassRate);

    return bypassCount < maxBypasses;
  }

  /**
   * Record a bypass event
   */
  private recordBypass(userId: string): void {
    const timestamps = this.bypassCounts.get(userId) || [];
    timestamps.push(Date.now());
    this.bypassCounts.set(userId, timestamps);
  }

  /**
   * Get current bypass count for user (within window)
   */
  private getBypassCount(userId: string): number {
    const timestamps = this.bypassCounts.get(userId) || [];
    const now = Date.now();
    const validTimestamps = timestamps.filter(
      (ts) => now - ts < this.config.bypassWindowMs,
    );
    return validTimestamps.length;
  }
}
