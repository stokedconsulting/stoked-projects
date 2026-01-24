import { Injectable, Logger } from '@nestjs/common';
import { GitHubIssue, IssueCacheEntry } from './types/github-issue.types';

/**
 * Cache Service for GitHub Issues
 *
 * Implements caching strategy:
 * - List operations: 2-minute cache
 * - Individual issues: No cache (always fresh)
 */
@Injectable()
export class GitHubIssuesCacheService {
  private readonly logger = new Logger(GitHubIssuesCacheService.name);
  private readonly cache = new Map<string, IssueCacheEntry>();
  private readonly DEFAULT_TTL = 2 * 60 * 1000; // 2 minutes in milliseconds

  /**
   * Get cached issue list
   * @param key Cache key (e.g., "owner/repo:open")
   * @returns Cached issues or null if expired/not found
   */
  getList(key: string): GitHubIssue[] | null {
    const entry = this.cache.get(key);

    if (!entry) {
      this.logger.debug(`Cache miss: ${key}`);
      return null;
    }

    const now = Date.now();
    const age = now - entry.timestamp;

    if (age > entry.ttl) {
      this.logger.debug(`Cache expired: ${key} (age: ${age}ms, ttl: ${entry.ttl}ms)`);
      this.cache.delete(key);
      return null;
    }

    this.logger.debug(`Cache hit: ${key} (age: ${age}ms, ttl: ${entry.ttl}ms)`);
    return entry.data;
  }

  /**
   * Set issue list in cache
   * @param key Cache key
   * @param data Issues to cache
   * @param ttl Time-to-live in milliseconds (default: 2 minutes)
   */
  setList(key: string, data: GitHubIssue[], ttl?: number): void {
    const cacheEntry: IssueCacheEntry = {
      data,
      timestamp: Date.now(),
      ttl: ttl ?? this.DEFAULT_TTL,
    };

    this.cache.set(key, cacheEntry);
    this.logger.debug(`Cache set: ${key} (${data.length} issues, ttl: ${cacheEntry.ttl}ms)`);
  }

  /**
   * Invalidate cache for a specific key
   * @param key Cache key to invalidate
   */
  invalidate(key: string): void {
    if (this.cache.has(key)) {
      this.cache.delete(key);
      this.logger.debug(`Cache invalidated: ${key}`);
    }
  }

  /**
   * Invalidate all cache entries for a repository
   * @param owner Repository owner
   * @param repo Repository name
   */
  invalidateRepository(owner: string, repo: string): void {
    const prefix = `${owner}/${repo}:`;
    let invalidatedCount = 0;

    for (const key of this.cache.keys()) {
      if (key.startsWith(prefix)) {
        this.cache.delete(key);
        invalidatedCount++;
      }
    }

    if (invalidatedCount > 0) {
      this.logger.debug(`Cache invalidated: ${invalidatedCount} entries for ${owner}/${repo}`);
    }
  }

  /**
   * Clear all cached data
   */
  clear(): void {
    const size = this.cache.size;
    this.cache.clear();
    this.logger.debug(`Cache cleared: ${size} entries removed`);
  }

  /**
   * Get cache statistics
   */
  getStats() {
    const now = Date.now();
    const entries = Array.from(this.cache.entries());

    return {
      totalEntries: entries.length,
      validEntries: entries.filter(([_, entry]) => now - entry.timestamp <= entry.ttl).length,
      expiredEntries: entries.filter(([_, entry]) => now - entry.timestamp > entry.ttl).length,
      oldestEntry: entries.length > 0 ? Math.min(...entries.map(([_, e]) => now - e.timestamp)) : 0,
      newestEntry: entries.length > 0 ? Math.max(...entries.map(([_, e]) => now - e.timestamp)) : 0,
    };
  }

  /**
   * Cleanup expired entries (can be called periodically)
   */
  cleanup(): void {
    const now = Date.now();
    let removed = 0;

    for (const [key, entry] of this.cache.entries()) {
      if (now - entry.timestamp > entry.ttl) {
        this.cache.delete(key);
        removed++;
      }
    }

    if (removed > 0) {
      this.logger.debug(`Cache cleanup: ${removed} expired entries removed`);
    }
  }
}
