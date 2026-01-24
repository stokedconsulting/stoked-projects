/**
 * MCP Server Client-Side Cache Manager
 *
 * Respects API Cache-Control headers and implements TTL-based caching
 * for MCP tool responses.
 */

export interface CacheEntry<T> {
  data: T;
  timestamp: number;
  maxAgeSeconds: number;
  etag?: string;
}

export interface CacheConfig {
  maxSize?: number;           // Maximum number of entries
  defaultMaxAge?: number;     // Default TTL in seconds if not provided
  enableCompression?: boolean; // Enable data compression for large objects
}

export class CacheClient<T = any> {
  private cache: Map<string, CacheEntry<T>> = new Map();
  private readonly maxSize: number;
  private readonly defaultMaxAge: number;
  private hits = 0;
  private misses = 0;
  private evictions = 0;

  constructor(config: CacheConfig = {}) {
    this.maxSize = config.maxSize || 1000;
    this.defaultMaxAge = config.defaultMaxAge || 300; // 5 minutes default
  }

  /**
   * Set cache entry with optional TTL
   */
  set(key: string, data: T, maxAgeSeconds?: number, etag?: string): void {
    // Evict oldest entry if cache is full (LRU)
    if (this.cache.size >= this.maxSize && !this.cache.has(key)) {
      this.evictOldest();
    }

    this.cache.set(key, {
      data,
      timestamp: Date.now(),
      maxAgeSeconds: maxAgeSeconds || this.defaultMaxAge,
      etag,
    });
  }

  /**
   * Get cache entry if valid and not expired
   */
  get(key: string): T | null {
    const entry = this.cache.get(key);

    if (!entry) {
      this.misses++;
      return null;
    }

    // Check if entry has expired
    const age = (Date.now() - entry.timestamp) / 1000;
    if (age > entry.maxAgeSeconds) {
      this.cache.delete(key);
      this.misses++;
      return null;
    }

    this.hits++;
    return entry.data;
  }

  /**
   * Get cache entry and ETag for validation
   */
  getWithETag(key: string): { data: T; etag: string } | null {
    const entry = this.cache.get(key);

    if (!entry || !entry.etag) {
      return null;
    }

    // Check if entry has expired
    const age = (Date.now() - entry.timestamp) / 1000;
    if (age > entry.maxAgeSeconds) {
      this.cache.delete(key);
      return null;
    }

    return { data: entry.data, etag: entry.etag };
  }

  /**
   * Get ETag for a cached entry (for revalidation)
   */
  getETag(key: string): string | null {
    const entry = this.cache.get(key);
    return entry?.etag || null;
  }

  /**
   * Clear specific cache entry
   */
  delete(key: string): boolean {
    return this.cache.delete(key);
  }

  /**
   * Clear all cache entries
   */
  clear(): void {
    this.cache.clear();
  }

  /**
   * Check if key exists and is not expired
   */
  has(key: string): boolean {
    return this.get(key) !== null;
  }

  /**
   * Get cache size
   */
  size(): number {
    return this.cache.size;
  }

  /**
   * Get cache metrics
   */
  getMetrics(): {
    size: number;
    hits: number;
    misses: number;
    hitRate: number;
    evictions: number;
  } {
    const total = this.hits + this.misses;
    const hitRate = total === 0 ? 0 : Math.round((this.hits / total) * 100);

    return {
      size: this.cache.size,
      hits: this.hits,
      misses: this.misses,
      hitRate,
      evictions: this.evictions,
    };
  }

  /**
   * Parse Cache-Control header to extract max-age
   */
  static parseMaxAge(cacheControl: string): number | null {
    if (!cacheControl) {
      return null;
    }

    // Extract max-age value
    const match = cacheControl.match(/max-age=(\d+)/);
    if (match && match[1]) {
      return parseInt(match[1], 10);
    }

    return null;
  }

  /**
   * Check if response is cacheable based on Cache-Control header
   */
  static isCacheable(cacheControl: string): boolean {
    if (!cacheControl) {
      return false;
    }

    // Explicitly not cacheable
    if (cacheControl.includes('no-store') || cacheControl.includes('private')) {
      return false;
    }

    // Must have max-age to be cacheable
    return cacheControl.includes('max-age=');
  }

  // Private methods

  private evictOldest(): void {
    // Find oldest entry (LRU - Least Recently Used)
    let oldestKey: string | null = null;
    let oldestTime = Date.now();

    for (const [key, entry] of this.cache.entries()) {
      if (entry.timestamp < oldestTime) {
        oldestTime = entry.timestamp;
        oldestKey = key;
      }
    }

    if (oldestKey) {
      this.cache.delete(oldestKey);
      this.evictions++;
    }
  }
}

/**
 * Create cache client instance
 */
export function createCacheClient<T = any>(
  config?: CacheConfig,
): CacheClient<T> {
  return new CacheClient<T>(config);
}
