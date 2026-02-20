/**
 * Core type system for the @stoked-projects/agent package.
 *
 * ZERO vscode imports — all types are pure TypeScript interfaces, enums, and type aliases.
 */

// ---------------------------------------------------------------------------
// State machine types
// ---------------------------------------------------------------------------

/**
 * All possible states for an agent instance in the autonomous loop.
 */
export enum AgentState {
  Idle = 'Idle',
  Claiming = 'Claiming',
  Working = 'Working',
  Reviewing = 'Reviewing',
  Ideating = 'Ideating',
  CreatingProject = 'CreatingProject',
  Paused = 'Paused',
  Stopped = 'Stopped',
  Error = 'Error',
  Cooldown = 'Cooldown',
}

/**
 * Events that drive state machine transitions.
 */
export type AgentEvent =
  | 'QUEUE_HAS_WORK'
  | 'QUEUE_EMPTY_IDEATE'
  | 'PAUSE'
  | 'STOP'
  | 'RESUME'
  | 'CLAIM_SUCCESS'
  | 'CLAIM_FAILED'
  | 'EXECUTION_COMPLETE'
  | 'EXECUTION_ERROR'
  | 'REVIEW_APPROVED'
  | 'REVIEW_REJECTED'
  | 'REVIEW_ERROR'
  | 'IDEA_GENERATED'
  | 'NO_IDEA'
  | 'IDEATION_ERROR'
  | 'PROJECT_CREATED'
  | 'CREATION_ERROR'
  | 'ERROR_ACKNOWLEDGED'
  | 'COOLDOWN_COMPLETE';

// ---------------------------------------------------------------------------
// Work-item types
// ---------------------------------------------------------------------------

/**
 * A unit of work claimed from the GitHub project queue.
 */
export interface WorkItem {
  projectNumber: number;
  issueNumber: number;
  issueTitle: string;
  issueBody: string;
  acceptanceCriteria: string[];
  labels: string[];
}

// ---------------------------------------------------------------------------
// Outcome types
// ---------------------------------------------------------------------------

/**
 * Result returned by the review agent after evaluating completed work.
 */
export interface ReviewOutcome {
  approved: boolean;
  criteriaResults: Array<{
    criterion: string;
    passed: boolean;
    feedback: string;
  }>;
  summary: string;
  testsRan: boolean;
  testsPassed: boolean;
}

/**
 * Result returned after an ideation cycle.
 */
export interface IdeationOutcome {
  idea: ParsedIdea | null;
  noIdeaAvailable: boolean;
  category: string;
}

/**
 * A structured idea parsed from Claude's ideation response.
 * Structurally compatible with the frozen ParsedIdea in apps/code-ext/src/ideation-executor.ts.
 */
export interface ParsedIdea {
  title: string;
  description: string;
  acceptanceCriteria: string[];
  technicalApproach: string;
  effortHours: number;
  category: string;
}

/**
 * Result returned after an agent completes task execution.
 */
export interface ExecutionResult {
  success: boolean;
  costUsd: number;
  filesTouched: string[];
  turnsUsed: number;
  error?: string;
}

// ---------------------------------------------------------------------------
// Activity / callback types
// ---------------------------------------------------------------------------

/**
 * A single agent activity event emitted during task execution.
 */
export interface AgentActivity {
  toolName: string;
  filesAffected: string[];
  timestamp: string;
}

/**
 * Callback hooks surfaced by the orchestrator for external consumers (e.g. the
 * VSCode extension) to observe agent lifecycle without tight coupling.
 */
export interface AgentEvents {
  onStatusChange?: (agentId: number, from: AgentState, to: AgentState) => void;
  onActivity?: (agentId: number, activity: AgentActivity) => void;
  onCostUpdate?: (agentId: number, costUsd: number) => void;
  onError?: (agentId: number, error: Error) => void;
  onHeartbeat?: (agentId: number) => void;
}

// ---------------------------------------------------------------------------
// Configuration types
// ---------------------------------------------------------------------------

/**
 * Top-level orchestrator configuration.
 */
export interface OrchestratorConfig {
  workspaceRoot: string;
  desiredInstances: number;
  dailyBudgetUsd: number;
  monthlyBudgetUsd: number;
  maxBudgetPerTaskUsd: number;
  maxBudgetPerReviewUsd?: number;
  maxBudgetPerIdeationUsd?: number;
  maxTurnsPerTask: number;
  enabledCategories?: string[];
  projectId: string;
  owner: string;
  repo: string;
  githubToken: string;
  categoryPromptsDir: string;
  events: AgentEvents;
}

/**
 * Configuration passed down to a single agent loop instance.
 */
export interface AgentLoopConfig {
  agentId: number;
  orchestratorConfig: OrchestratorConfig;
}

// ---------------------------------------------------------------------------
// Budget / status types
// ---------------------------------------------------------------------------

/**
 * Real-time snapshot of budget consumption.
 */
export interface BudgetStatus {
  dailySpend: number;
  monthlySpend: number;
  dailyLimit: number;
  monthlyLimit: number;
  dailyRemaining: number;
  monthlyRemaining: number;
  isWithinBudget: boolean;
}

/**
 * Metadata about a git worktree managed by the orchestrator.
 */
export interface WorktreeInfo {
  path: string;
  branch: string;
  agentId: number;
  issueNumber: number;
}

/**
 * Top-level status snapshot for the orchestrator.
 */
export interface OrchestratorStatus {
  agents: Array<{ id: number; state: AgentState }>;
  budgetStatus: BudgetStatus;
  activeWorktrees: number;
  desiredInstances: number;
}

// ---------------------------------------------------------------------------
// Agent session types — FROZEN: must remain structurally identical to the
// interfaces in apps/code-ext/src/agent-session-manager.ts
// ---------------------------------------------------------------------------

/**
 * Status values for a running agent.
 * FROZEN — must match apps/code-ext/src/agent-session-manager.ts exactly.
 */
export type AgentStatus = 'idle' | 'working' | 'reviewing' | 'ideating' | 'paused';

/**
 * Agent session state persisted to / read from the file system.
 * FROZEN — must remain structurally identical to the AgentSession interface
 * in apps/code-ext/src/agent-session-manager.ts.
 */
export interface AgentSession {
  agentId: string;
  status: AgentStatus;
  currentProjectNumber: number | null;
  currentPhase: string | null;
  branchName: string | null;
  lastHeartbeat: string;
  tasksCompleted: number;
  currentTaskDescription: string | null;
  errorCount: number;
  lastError: string | null;
}
