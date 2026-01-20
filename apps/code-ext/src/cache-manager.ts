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

export class CacheManager {
    private static readonly CACHE_VERSION = 1;
    private static readonly CACHE_KEY_PREFIX = 'ghProjects.cache';
    private static readonly CACHE_EXPIRY_MS = 5 * 60 * 1000; // 5 minutes

    constructor(private context: vscode.ExtensionContext) { }

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
            return null;
        }

        // Validate cache version
        if (cached.version !== CacheManager.CACHE_VERSION) {
            console.log('Cache version mismatch, invalidating cache');
            await this.clearCache(owner, repo);
            return null;
        }

        // Validate owner/repo match
        if (cached.owner !== owner || cached.repo !== repo) {
            console.log('Cache owner/repo mismatch, invalidating cache');
            await this.clearCache(owner, repo);
            return null;
        }

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
    }

    /**
     * Clear cache for a specific repository
     */
    async clearCache(owner: string, repo: string): Promise<void> {
        const key = this.getCacheKey(owner, repo);
        await this.context.workspaceState.update(key, undefined);
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
    }
}
