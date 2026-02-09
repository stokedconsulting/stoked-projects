/**
 * GitHub Client Types
 *
 * Type definitions for the unified GitHub API client
 */

/**
 * GitHub operation types
 */
export enum GitHubOperationType {
  GRAPHQL = 'graphql',
  REST = 'rest',
}

/**
 * GitHub API error codes
 */
export enum GitHubErrorCode {
  GITHUB_AUTH_FAILED = 'GITHUB_AUTH_FAILED',
  RATE_LIMIT_EXCEEDED = 'RATE_LIMIT_EXCEEDED',
  NETWORK_TIMEOUT = 'NETWORK_TIMEOUT',
  API_DEPRECATED = 'API_DEPRECATED',
  UNKNOWN_ERROR = 'UNKNOWN_ERROR',
}

/**
 * Normalized response format
 */
export interface GitHubResponse<T = any> {
  success: boolean;
  data?: T;
  error?: GitHubError;
  metadata?: {
    operation: GitHubOperationType;
    duration: number;
    retryCount?: number;
  };
}

/**
 * Error object with retry metadata
 */
export interface GitHubError {
  code: GitHubErrorCode;
  message: string;
  retryable: boolean;
  retryAfter?: number; // seconds
  originalError?: any;
}

/**
 * GraphQL request options
 */
export interface GraphQLOptions {
  query: string;
  variables?: Record<string, any>;
}

/**
 * REST request options
 */
export interface RestOptions {
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  endpoint: string;
  params?: Record<string, any>;
  body?: any;
}

/**
 * Client configuration
 */
export interface GitHubClientConfig {
  token: string;
  maxConnections?: number; // Default: 10
  retryAttempts?: number; // Default: 3
  retryDelays?: number[]; // Default: [1000, 2000, 4000]
  timeout?: number; // Default: 30000 (30 seconds)
}

/**
 * Rate limit info
 */
export interface RateLimitInfo {
  limit: number;
  remaining: number;
  reset: Date;
  used: number;
}

/**
 * Connection pool status
 */
export interface ConnectionPoolStatus {
  total: number;
  active: number;
  idle: number;
  queued: number;
}
