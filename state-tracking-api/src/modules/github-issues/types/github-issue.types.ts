/**
 * GitHub Issue Types
 *
 * Type definitions for GitHub Issues API operations
 */

/**
 * GitHub Issue state
 */
export enum IssueState {
  OPEN = 'OPEN',
  CLOSED = 'CLOSED',
}

/**
 * GitHub Issue object from GraphQL
 */
export interface GitHubIssue {
  id: string;
  number: number;
  title: string;
  body?: string;
  state: IssueState;
  url: string;
  createdAt: string;
  updatedAt: string;
  closedAt?: string;
  author?: {
    login: string;
  };
  labels?: Array<{
    name: string;
  }>;
  assignees?: Array<{
    login: string;
  }>;
}

/**
 * Response with warnings for partial failures
 */
export interface IssueResponseWithWarnings<T = any> {
  data: T;
  warnings?: string[];
}

/**
 * Cache entry for issue lists
 */
export interface IssueCacheEntry {
  data: GitHubIssue[];
  timestamp: number;
  ttl: number; // milliseconds
}

/**
 * Project field information
 */
export interface ProjectField {
  id: string;
  name: string;
  options?: Array<{
    id: string;
    name: string;
  }>;
}

/**
 * Project item creation result
 */
export interface ProjectItemResult {
  itemId: string;
  success: boolean;
  error?: string;
}
