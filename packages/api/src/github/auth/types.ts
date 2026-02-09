/**
 * Token source types supported by the authentication service
 */
export enum TokenSource {
  VSCODE = 'vscode',
  CONFIG = 'config',
  ENV = 'env',
}

/**
 * Metadata about a GitHub token
 */
export interface TokenMetadata {
  /** The actual token value */
  token: string;
  /** Array of OAuth scopes this token has */
  scopes: string[];
  /** Expiration timestamp (null if no expiration) */
  expiresAt: Date | null;
  /** Source from which this token was obtained */
  source: TokenSource;
}

/**
 * Cached token with TTL tracking
 */
export interface CachedToken {
  /** Token metadata */
  metadata: TokenMetadata;
  /** Timestamp when this token was cached */
  cachedAt: Date;
  /** TTL in milliseconds */
  ttl: number;
}

/**
 * Result of token validation
 */
export interface TokenValidationResult {
  /** Whether the token is valid */
  valid: boolean;
  /** Token metadata (only if valid) */
  metadata?: TokenMetadata;
  /** Error code (only if invalid) */
  errorCode?: string;
  /** Error message (only if invalid) */
  errorMessage?: string;
  /** Required scopes (for insufficient scope errors) */
  requiredScopes?: string[];
  /** Actual scopes (for insufficient scope errors) */
  actualScopes?: string[];
}
