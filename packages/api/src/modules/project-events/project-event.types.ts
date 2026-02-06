/**
 * Shared event types for real-time project updates.
 *
 * Flow: MCP tool -> POST /api/events/project -> Socket.io broadcast -> Extension webview
 */

export type ProjectEventType =
  | 'issue.created'
  | 'issue.updated'
  | 'issue.closed'
  | 'issue.deleted'
  | 'project.created'
  | 'project.updated'
  | 'worktree.updated';

export interface IssueCreatedData {
  projectNumber: number;
  issueNumber: number;
  title: string;
  url?: string;
  state?: string;
  owner?: string;
  repo?: string;
  labels?: string[];
}

export interface IssueUpdatedData {
  projectNumber: number;
  issueNumber: number;
  status?: string;
  title?: string;
  state?: string;
  phaseName?: string;
  updatedFields?: string[];
  fieldValues?: Record<string, string>;
}

export interface IssueClosedData {
  projectNumber: number;
  issueNumber: number;
  owner?: string;
  repo?: string;
}

export interface IssueDeletedData {
  projectNumber: number;
  issueNumber?: number;
  itemId?: string;
}

export interface ProjectCreatedData {
  projectNumber: number;
  title: string;
  owner?: string;
  repo?: string;
  url?: string;
  id?: string;
}

export interface ProjectUpdatedData {
  projectNumber: number;
  projectId?: string;
  title?: string;
  state?: string;
  body?: string;
}

export interface WorktreeUpdatedData {
  projectNumber: number;
  worktree: {
    hasWorktree: boolean;
    worktreePath: string;
    branch: string;
    hasUncommittedChanges: boolean;
    hasUnpushedCommits: boolean;
    hasPR: boolean;
    prNumber: number | null;
    prMerged: boolean;
  };
}

export type ProjectEventData =
  | IssueCreatedData
  | IssueUpdatedData
  | IssueClosedData
  | IssueDeletedData
  | ProjectCreatedData
  | ProjectUpdatedData
  | WorktreeUpdatedData;

export interface ProjectEvent {
  type: ProjectEventType;
  data: ProjectEventData;
  timestamp?: string;
}
