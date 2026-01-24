import * as vscode from 'vscode';

export interface CachedData {
    version: number;
    timestamp: number;
    owner: string;
    repo: string;
    repoProjects: any[];
    orgProjects: any[];
    statusOptions: any[];
}

export interface CacheMetrics {
    hits: number;
    misses: number;
    invalidations: number;
    lastInvalidationReason?: string;
}

export class CacheManager {
    private static readonly CACHE_VERSION = 1;
    private static readonly CACHE_KEY_PREFIX = 'ghProjects.cache';
    private static readonly CACHE_EXPIRY_MS = 5 * 60 * 1000; // 5 minutes
    private static readonly METRICS_KEY_PREFIX = 'ghProjects.metrics';

    private metrics: Map<string, CacheMetrics> = new Map();

    constructor(private context: vscode.ExtensionContext) {
        // Load cached metrics from storage
        this.loadMetrics();
    }

    /**
     * Get cache key for a specific owner/repo combination
     */
    private getCacheKey(owner: string, repo: string): string {
        return `${CacheManager.CACHE_KEY_PREFIX}.${owner}.${repo}`;
    }

    /**
     * Load cached data for a specific repository
     */
    async loadCache(owner: string, repo: string): Promise<CachedData | null> {
        const key = this.getCacheKey(owner, repo);
        const cached = this.context.workspaceState.get<CachedData>(key);

        if (!cached) {
            this.recordCacheMiss(owner, repo);
            return null;
        }

        // Validate cache version
        if (cached.version !== CacheManager.CACHE_VERSION) {
            console.log('Cache version mismatch, invalidating cache');
            await this.clearCache(owner, repo, 'version-mismatch');
            return null;
        }

        // Validate owner/repo match
        if (cached.owner !== owner || cached.repo !== repo) {
            console.log('Cache owner/repo mismatch, invalidating cache');
            await this.clearCache(owner, repo, 'owner-repo-mismatch');
            return null;
        }

        // Check if cache is stale
        if (this.isCacheStale(cached)) {
            this.recordCacheMiss(owner, repo);
            return null;
        }

        // Cache hit
        this.recordCacheHit(owner, repo);
        return cached;
    }

    /**
     * Save data to cache
     */
    async saveCache(
        owner: string,
        repo: string,
        repoProjects: any[],
        orgProjects: any[],
        statusOptions: any[]
    ): Promise<void> {
        const key = this.getCacheKey(owner, repo);
        const data: CachedData = {
            version: CacheManager.CACHE_VERSION,
            timestamp: Date.now(),
            owner,
            repo,
            repoProjects,
            orgProjects,
            statusOptions,
        };

        await this.context.workspaceState.update(key, data);
        console.log(`[CacheManager] Cache saved for ${owner}/${repo} (${JSON.stringify({
            repoProjects: repoProjects.length,
            orgProjects: orgProjects.length,
            statusOptions: statusOptions.length,
        })}`);
    }

    /**
     * Clear cache for a specific repository
     */
    async clearCache(owner: string, repo: string, reason: string = 'manual'): Promise<void> {
        const key = this.getCacheKey(owner, repo);
        await this.context.workspaceState.update(key, undefined);
        this.recordInvalidation(owner, repo, reason);
        console.log(`[CacheManager] Cache cleared for ${owner}/${repo} (reason: ${reason})`);
    }

    /**
     * Check if cached data is stale
     */
    isCacheStale(cached: CachedData): boolean {
        const age = Date.now() - cached.timestamp;
        return age > CacheManager.CACHE_EXPIRY_MS;
    }

    /**
     * Get cache age in seconds
     */
    getCacheAge(cached: CachedData): number {
        return Math.floor((Date.now() - cached.timestamp) / 1000);
    }

    /**
     * Clear all caches (useful for debugging or settings)
     */
    async clearAllCaches(): Promise<void> {
        const keys = this.context.workspaceState.keys();
        const cacheKeys = keys.filter(key => key.startsWith(CacheManager.CACHE_KEY_PREFIX));

        for (const key of cacheKeys) {
            await this.context.workspaceState.update(key, undefined);
        }

        console.log(`[CacheManager] Cleared all caches (${cacheKeys.length} entries)`);
    }

    /**
     * Get cache metrics for all cached repositories
     */
    getMetrics(): Map<string, CacheMetrics> {
        return this.metrics;
    }

    /**
     * Get cache hit rate as percentage
     */
    getHitRate(): number {
        let totalHits = 0;
        let totalRequests = 0;

        for (const metrics of this.metrics.values()) {
            totalHits += metrics.hits;
            totalRequests += metrics.hits + metrics.misses;
        }

        if (totalRequests === 0) {
            return 0;
        }

        return Math.round((totalHits / totalRequests) * 100);
    }

    // Private helper methods

    private getCacheKey(owner: string, repo: string): string {
        return `${CacheManager.CACHE_KEY_PREFIX}.${owner}.${repo}`;
    }

    private getMetricsKey(owner: string, repo: string): string {
        return `${CacheManager.METRICS_KEY_PREFIX}.${owner}.${repo}`;
    }

    private recordCacheHit(owner: string, repo: string): void {
        const key = `${owner}/${repo}`;
        const metrics = this.metrics.get(key) || { hits: 0, misses: 0, invalidations: 0 };
        metrics.hits++;
        this.metrics.set(key, metrics);
        this.saveMetrics();
    }

    private recordCacheMiss(owner: string, repo: string): void {
        const key = `${owner}/${repo}`;
        const metrics = this.metrics.get(key) || { hits: 0, misses: 0, invalidations: 0 };
        metrics.misses++;
        this.metrics.set(key, metrics);
        this.saveMetrics();
    }

    private recordInvalidation(owner: string, repo: string, reason: string): void {
        const key = `${owner}/${repo}`;
        const metrics = this.metrics.get(key) || { hits: 0, misses: 0, invalidations: 0 };
        metrics.invalidations++;
        metrics.lastInvalidationReason = reason;
        this.metrics.set(key, metrics);
        this.saveMetrics();
    }

    private loadMetrics(): void {
        try {
            const keys = this.context.workspaceState.keys();
            const metricsKeys = keys.filter(key => key.startsWith(CacheManager.METRICS_KEY_PREFIX));

            for (const key of metricsKeys) {
                const metrics = this.context.workspaceState.get<CacheMetrics>(key);
                if (metrics) {
                    const repoKey = key.replace(CacheManager.METRICS_KEY_PREFIX + '.', '');
                    this.metrics.set(repoKey, metrics);
                }
            }
        } catch (error) {
            console.warn('[CacheManager] Failed to load metrics:', error);
        }
    }

    private saveMetrics(): void {
        try {
            for (const [key, metrics] of this.metrics.entries()) {
                const metricsKey = `${CacheManager.METRICS_KEY_PREFIX}.${key}`;
                this.context.workspaceState.update(metricsKey, metrics);
            }
        } catch (error) {
            console.warn('[CacheManager] Failed to save metrics:', error);
        }
    }
}
