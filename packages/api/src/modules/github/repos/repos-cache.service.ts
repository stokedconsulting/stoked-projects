import { Injectable, Logger } from '@nestjs/common';

/**
 * Cache entry with TTL
 */
interface CacheEntry<T> {
  data: T;
  timestamp: number;
  ttl: number; // in milliseconds
}

/**
 * Cache service for repository and organization metadata
 *
 * Implements in-memory caching with different TTLs:
 * - Repository metadata: 10 minutes (600,000ms)
 * - Organization metadata: 5 minutes (300,000ms)
 */
@Injectable()
export class ReposCacheService {
  private readonly logger = new Logger(ReposCacheService.name);
  private readonly cache = new Map<string, CacheEntry<any>>();

  // Cache TTLs in milliseconds
  private readonly REPO_CACHE_TTL = 10 * 60 * 1000; // 10 minutes
  private readonly ORG_CACHE_TTL = 5 * 60 * 1000; // 5 minutes

  /**
   * Get cached repository metadata
   */
  getRepository(owner: string, repo: string, includeProjects: boolean): any | null {
    const key = this.getRepoKey(owner, repo, includeProjects);
    return this.get(key);
  }

  /**
   * Set repository metadata in cache
   */
  setRepository(owner: string, repo: string, includeProjects: boolean, data: any): void {
    const key = this.getRepoKey(owner, repo, includeProjects);
    this.set(key, data, this.REPO_CACHE_TTL);
  }

  /**
   * Get cached organization metadata
   */
  getOrganization(owner: string): any | null {
    const key = this.getOrgKey(owner);
    return this.get(key);
  }

  /**
   * Set organization metadata in cache
   */
  setOrganization(owner: string, data: any): void {
    const key = this.getOrgKey(owner);
    this.set(key, data, this.ORG_CACHE_TTL);
  }

  /**
   * Get cached linked projects
   */
  getLinkedProjects(owner: string, repo: string): any | null {
    const key = this.getLinkedProjectsKey(owner, repo);
    return this.get(key);
  }

  /**
   * Set linked projects in cache
   */
  setLinkedProjects(owner: string, repo: string, data: any): void {
    const key = this.getLinkedProjectsKey(owner, repo);
    this.set(key, data, this.REPO_CACHE_TTL);
  }

  /**
   * Invalidate all cache entries for a repository
   */
  invalidateRepository(owner: string, repo: string): void {
    const patterns = [
      this.getRepoKey(owner, repo, false),
      this.getRepoKey(owner, repo, true),
      this.getLinkedProjectsKey(owner, repo),
    ];

    patterns.forEach((pattern) => {
      if (this.cache.has(pattern)) {
        this.cache.delete(pattern);
        this.logger.debug(`Invalidated cache for key: ${pattern}`);
      }
    });
  }

  /**
   * Invalidate all cache entries for an organization
   */
  invalidateOrganization(owner: string): void {
    const key = this.getOrgKey(owner);
    if (this.cache.has(key)) {
      this.cache.delete(key);
      this.logger.debug(`Invalidated cache for key: ${key}`);
    }
  }

  /**
   * Clear all cache entries
   */
  clearAll(): void {
    this.cache.clear();
    this.logger.log('All cache entries cleared');
  }

  /**
   * Get cache statistics
   */
  getStats(): { size: number; keys: string[] } {
    return {
      size: this.cache.size,
      keys: Array.from(this.cache.keys()),
    };
  }

  /**
   * Generic get method with TTL validation
   */
  private get<T>(key: string): T | null {
    const entry = this.cache.get(key);

    if (!entry) {
      return null;
    }

    const now = Date.now();
    const age = now - entry.timestamp;

    // Check if cache entry is still valid
    if (age > entry.ttl) {
      this.cache.delete(key);
      this.logger.debug(`Cache expired for key: ${key} (age: ${age}ms, ttl: ${entry.ttl}ms)`);
      return null;
    }

    this.logger.debug(`Cache hit for key: ${key} (age: ${age}ms, ttl: ${entry.ttl}ms)`);
    return entry.data as T;
  }

  /**
   * Generic set method with TTL
   */
  private set<T>(key: string, data: T, ttl: number): void {
    this.cache.set(key, {
      data,
      timestamp: Date.now(),
      ttl,
    });
    this.logger.debug(`Cache set for key: ${key} (ttl: ${ttl}ms)`);
  }

  /**
   * Generate cache key for repository metadata
   */
  private getRepoKey(owner: string, repo: string, includeProjects: boolean): string {
    return `repo:${owner}:${repo}:projects=${includeProjects}`;
  }

  /**
   * Generate cache key for organization metadata
   */
  private getOrgKey(owner: string): string {
    return `org:${owner}`;
  }

  /**
   * Generate cache key for linked projects
   */
  private getLinkedProjectsKey(owner: string, repo: string): string {
    return `linked-projects:${owner}:${repo}`;
  }
}
