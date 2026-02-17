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
  | 'worktree.updated'
  | 'task.started'
  | 'task.completed'
  | 'task.failed'
  | 'phase.started'
  | 'phase.completed'
  | 'orchestration.progress';

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

export interface TaskStartedData {
  projectNumber: number;
  phaseNumber: number;
  workItemId: string;
  workItemTitle: string;
  agentId?: string;
  workspaceId?: string;
  worktreePath?: string;
}

export interface TaskCompletedData {
  projectNumber: number;
  phaseNumber: number;
  workItemId: string;
  workItemTitle: string;
  agentId?: string;
  result?: string;
  filesChanged?: string[];
  workspaceId?: string;
  worktreePath?: string;
}

export interface TaskFailedData {
  projectNumber: number;
  phaseNumber: number;
  workItemId: string;
  workItemTitle: string;
  agentId?: string;
  error: string;
  workspaceId?: string;
  worktreePath?: string;
}

export interface PhaseStartedData {
  projectNumber: number;
  phaseNumber: number;
  phaseName: string;
  totalItems: number;
  workspaceId?: string;
}

export interface PhaseCompletedData {
  projectNumber: number;
  phaseNumber: number;
  phaseName: string;
  completedItems: number;
  totalItems: number;
  workspaceId?: string;
}

export interface OrchestrationProgressData {
  projectNumber: number;
  totalPhases: number;
  completedPhases: number;
  totalItems: number;
  completedItems: number;
  inProgressItems: number;
  failedItems: number;
  workspaceId?: string;
}

export type ProjectEventData =
  | IssueCreatedData
  | IssueUpdatedData
  | IssueClosedData
  | IssueDeletedData
  | ProjectCreatedData
  | ProjectUpdatedData
  | WorktreeUpdatedData
  | TaskStartedData
  | TaskCompletedData
  | TaskFailedData
  | PhaseStartedData
  | PhaseCompletedData
  | OrchestrationProgressData;

export interface ProjectEvent {
  type: ProjectEventType;
  data: ProjectEventData;
  timestamp?: string;
}

export const PROJECT_EVENT_TYPES: ProjectEventType[] = [
  'issue.created',
  'issue.updated',
  'issue.closed',
  'issue.deleted',
  'project.created',
  'project.updated',
  'worktree.updated',
  'task.started',
  'task.completed',
  'task.failed',
  'phase.started',
  'phase.completed',
  'orchestration.progress',
];
