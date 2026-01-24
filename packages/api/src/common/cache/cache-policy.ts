/**
 * Unified Cache Policy Configuration
 *
 * Defines cache behavior across the system with consistent TTLs and strategies.
 * Used by API, Extension, and MCP Server components.
 */

export enum CachePolicy {
  // Immediate - no caching for sensitive operations
  NO_CACHE = 'no-cache',
  NO_STORE = 'no-store',

  // Short TTL - data changes frequently
  SHORT = 'short',    // 30 seconds
  MEDIUM = 'medium',  // 5 minutes
  LONG = 'long',      // 1 hour

  // Health checks and monitoring
  HEALTH = 'health',  // 30 seconds

  // Static or reference data
  REFERENCE = 'reference', // 1 day
}

/**
 * Cache configuration with TTL in milliseconds
 */
export interface CachePolicyConfig {
  ttlMs: number;
  maxAge: number;           // max-age in seconds (for HTTP headers)
  sMaxAge?: number;         // s-maxage in seconds (for shared caches)
  isPublic: boolean;        // public vs private
  mustRevalidate: boolean;  // force revalidation before reuse
  cacheControl: string;     // Full Cache-Control header value
}

/**
 * Unified cache policy definitions
 * Used across extension, API, and MCP server
 */
export const CACHE_POLICIES: Record<CachePolicy, CachePolicyConfig> = {
  // No caching - for sensitive data and mutations
  [CachePolicy.NO_CACHE]: {
    ttlMs: 0,
    maxAge: 0,
    isPublic: false,
    mustRevalidate: true,
    cacheControl: 'private, no-cache, must-revalidate',
  },

  [CachePolicy.NO_STORE]: {
    ttlMs: 0,
    maxAge: 0,
    isPublic: false,
    mustRevalidate: true,
    cacheControl: 'no-store, private',
  },

  // Short TTL - 30 seconds
  [CachePolicy.SHORT]: {
    ttlMs: 30 * 1000,
    maxAge: 30,
    sMaxAge: 60,
    isPublic: true,
    mustRevalidate: false,
    cacheControl: 'public, max-age=30, s-maxage=60',
  },

  // Medium TTL - 5 minutes (default for most operations)
  [CachePolicy.MEDIUM]: {
    ttlMs: 5 * 60 * 1000,
    maxAge: 300,
    sMaxAge: 600,
    isPublic: true,
    mustRevalidate: false,
    cacheControl: 'public, max-age=300, s-maxage=600',
  },

  // Long TTL - 1 hour
  [CachePolicy.LONG]: {
    ttlMs: 60 * 60 * 1000,
    maxAge: 3600,
    sMaxAge: 7200,
    isPublic: true,
    mustRevalidate: false,
    cacheControl: 'public, max-age=3600, s-maxage=7200',
  },

  // Health checks - 30 seconds (same as SHORT)
  [CachePolicy.HEALTH]: {
    ttlMs: 30 * 1000,
    maxAge: 30,
    isPublic: true,
    mustRevalidate: false,
    cacheControl: 'public, max-age=30',
  },

  // Reference data - 1 day
  [CachePolicy.REFERENCE]: {
    ttlMs: 24 * 60 * 60 * 1000,
    maxAge: 86400,
    sMaxAge: 172800,
    isPublic: true,
    mustRevalidate: false,
    cacheControl: 'public, max-age=86400, s-maxage=172800',
  },
};

/**
 * Endpoint cache configurations
 * Maps API endpoints to their cache policies
 */
export const ENDPOINT_CACHE_CONFIG: Record<string, CachePolicy> = {
  // Health endpoints
  'GET /health': CachePolicy.HEALTH,
  'GET /health/ready': CachePolicy.HEALTH,
  'GET /health/live': CachePolicy.HEALTH,
  'GET /health/detailed': CachePolicy.HEALTH,
  'GET /health/system': CachePolicy.HEALTH,

  // Session endpoints
  'GET /sessions/:id': CachePolicy.MEDIUM,
  'POST /sessions': CachePolicy.NO_STORE,
  'PATCH /sessions/:id': CachePolicy.NO_STORE,
  'DELETE /sessions/:id': CachePolicy.NO_STORE,

  // Task endpoints
  'GET /tasks': CachePolicy.MEDIUM,
  'GET /tasks/:id': CachePolicy.MEDIUM,
  'POST /tasks': CachePolicy.NO_STORE,
  'PATCH /tasks/:id': CachePolicy.NO_STORE,
  'DELETE /tasks/:id': CachePolicy.NO_STORE,

  // Machine endpoints
  'GET /machines': CachePolicy.MEDIUM,
  'GET /machines/:id': CachePolicy.MEDIUM,
  'POST /machines': CachePolicy.NO_STORE,
  'PATCH /machines/:id': CachePolicy.NO_STORE,
  'DELETE /machines/:id': CachePolicy.NO_STORE,

  // Default for all other endpoints
  'DEFAULT': CachePolicy.NO_STORE,
};

/**
 * Get cache policy for an endpoint
 * @param method HTTP method (GET, POST, etc.)
 * @param path URL path
 * @returns Cache policy configuration
 */
export function getCachePolicyForEndpoint(
  method: string,
  path: string,
): CachePolicyConfig {
  const key = `${method} ${path}`;

  // Try exact match first
  if (ENDPOINT_CACHE_CONFIG[key]) {
    return CACHE_POLICIES[ENDPOINT_CACHE_CONFIG[key]];
  }

  // Try pattern match (e.g., GET /tasks/:id -> GET /tasks/:id)
  for (const configKey of Object.keys(ENDPOINT_CACHE_CONFIG)) {
    const pattern = configKey
      .replace(/:[a-zA-Z_][a-zA-Z0-9_]*/g, '[^/]+')
      .split(' ');

    if (pattern.length === 2) {
      const [configMethod, configPath] = pattern;
      const pathRegex = new RegExp(`^${configPath}$`);

      if (method === configMethod && pathRegex.test(path)) {
        return CACHE_POLICIES[ENDPOINT_CACHE_CONFIG[configKey]];
      }
    }
  }

  // Fallback to default
  return CACHE_POLICIES[ENDPOINT_CACHE_CONFIG.DEFAULT];
}

/**
 * Determine if an endpoint result should be cached
 * @param method HTTP method
 * @param statusCode HTTP status code
 * @returns Whether response should be cached
 */
export function shouldCacheResponse(method: string, statusCode: number): boolean {
  // Only cache GET requests
  if (method !== 'GET') {
    return false;
  }

  // Only cache successful responses
  if (statusCode < 200 || statusCode >= 300) {
    return false;
  }

  // Cache 200 OK responses
  return statusCode === 200;
}

/**
 * Parse Cache-Control header value
 * @param cacheControl Cache-Control header string
 * @returns Parsed cache control object
 */
export function parseCacheControl(
  cacheControl: string,
): Record<string, string | boolean> {
  const result: Record<string, string | boolean> = {};
  const parts = cacheControl.split(/,\s*/);

  for (const part of parts) {
    const [key, value] = part.split('=');
    const trimmedKey = key.trim();

    if (value) {
      result[trimmedKey] = value.trim();
    } else {
      result[trimmedKey] = true;
    }
  }

  return result;
}

/**
 * Extract max-age value in seconds from Cache-Control header
 * @param cacheControl Cache-Control header string
 * @returns max-age in seconds, or null if not found
 */
export function getMaxAgeSeconds(cacheControl: string): number | null {
  const parsed = parseCacheControl(cacheControl);
  const maxAge = parsed['max-age'];

  if (maxAge && typeof maxAge === 'string') {
    const seconds = parseInt(maxAge, 10);
    if (!isNaN(seconds)) {
      return seconds;
    }
  }

  return null;
}

/**
 * Check if response should be cached based on Cache-Control header
 * @param cacheControl Cache-Control header value
 * @returns Whether response should be cached
 */
export function isCacheable(cacheControl: string): boolean {
  const parsed = parseCacheControl(cacheControl);

  // Explicitly not cacheable
  if (parsed['no-store'] || parsed['no-cache']) {
    return false;
  }

  // Has max-age (is cacheable)
  if ('max-age' in parsed) {
    return true;
  }

  // Has expires header (would be checked separately)
  return false;
}
