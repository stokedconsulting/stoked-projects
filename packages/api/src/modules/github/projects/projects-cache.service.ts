import { Injectable, Logger } from '@nestjs/common';

interface CacheEntry<T> {
  data: T;
  timestamp: number;
  ttl: number;
}

@Injectable()
export class ProjectsCacheService {
  private readonly logger = new Logger(ProjectsCacheService.name);
  private readonly cache = new Map<string, CacheEntry<any>>();
  private readonly CACHE_TTL = 5 * 60 * 1000; // 5 minutes

  get<T>(key: string): T | null {
    const entry = this.cache.get(key);
    if (!entry) {
      return null;
    }

    const now = Date.now();
    if (now - entry.timestamp > entry.ttl) {
      this.cache.delete(key);
      this.logger.debug(`Cache expired for key: ${key}`);
      return null;
    }

    this.logger.debug(`Cache hit for key: ${key}`);
    return entry.data;
  }

  set<T>(key: string, data: T, ttl?: number): void {
    this.cache.set(key, {
      data,
      timestamp: Date.now(),
      ttl: ttl || this.CACHE_TTL,
    });
    this.logger.debug(`Cached data for key: ${key}`);
  }

  delete(key: string): void {
    this.cache.delete(key);
    this.logger.debug(`Deleted cache for key: ${key}`);
  }

  clear(): void {
    this.cache.clear();
    this.logger.debug('Cleared all cache');
  }
}
