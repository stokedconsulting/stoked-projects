/**
 * AgentLoop — drives a single agent through the full state machine lifecycle.
 *
 * The loop runs continuously until stopped, cycling through Idle → Claiming →
 * Working → Reviewing and back, with optional Ideating → CreatingProject
 * branches when the work queue is empty.
 *
 * ZERO vscode imports — pure Node.js / TypeScript.
 */

import {
  AgentLoopConfig,
  AgentState,
  AgentStatus,
  ParsedIdea,
  WorkItem,
} from './types';
import { AgentStateMachine } from './state-machine';
import { ExecutionAgent } from './execution-agent';
import { ReviewAgent } from './review-agent';
import { IdeationAgent } from './ideation-agent';
import { WorktreeManager } from './worktree-manager';
import { BudgetTracker } from './budget-tracker';
import { TemplateSubstitution } from './template-substitution';
import { GitHubClient } from './util/github';
import { Logger } from './util/logger';
import { createAgentHooks } from './hooks';

// ---------------------------------------------------------------------------
// Internal constants
// ---------------------------------------------------------------------------

/** How long to sleep (ms) when the work queue is empty. */
const IDLE_POLL_INTERVAL_MS = 30_000;

/** How long to sleep (ms) during the Cooldown state. */
const COOLDOWN_DURATION_MS = 60_000;

/** Maximum number of review retries before escalating to a REVIEW_ERROR. */
const MAX_REVIEW_RETRIES = 2;

// ---------------------------------------------------------------------------
// AgentLoop
// ---------------------------------------------------------------------------

/**
 * Manages the complete lifecycle of a single autonomous agent.
 *
 * Call {@link start} to begin the loop and {@link stop} to halt it cleanly.
 * Use {@link pause} / {@link resume} to temporarily suspend work.
 *
 * Usage:
 * ```ts
 * const loop = new AgentLoop({ agentId: 1, orchestratorConfig: cfg });
 * loop.start(); // non-blocking — runs in background
 * // later...
 * await loop.stop();
 * ```
 */
export class AgentLoop {
  // -------------------------------------------------------------------------
  // Control flags
  // -------------------------------------------------------------------------

  private running = false;

  // -------------------------------------------------------------------------
  // State machine
  // -------------------------------------------------------------------------

  private readonly fsm: AgentStateMachine;

  // -------------------------------------------------------------------------
  // Configuration + collaborators
  // -------------------------------------------------------------------------

  private readonly config: AgentLoopConfig;
  private readonly executionAgent: ExecutionAgent;
  private readonly reviewAgent: ReviewAgent;
  private readonly ideationAgent: IdeationAgent;
  private readonly worktreeManager: WorktreeManager;
  private readonly budgetTracker: BudgetTracker;
  private readonly templateSub: TemplateSubstitution;
  private readonly githubClient: GitHubClient;
  private readonly logger: Logger;

  // -------------------------------------------------------------------------
  // Runtime state
  // -------------------------------------------------------------------------

  /** Abort controller for the currently running SDK operation. */
  private currentAbortController: AbortController | null = null;

  /** Resolves when pause is lifted. */
  private pauseResolver: (() => void) | null = null;
  private pausePromise: Promise<void> | null = null;

  /** The work item currently being processed. */
  private currentWorkItem: WorkItem | null = null;

  /** The worktree path currently in use. */
  private currentWorktreePath: string | null = null;

  /** Number of tasks completed in this session. */
  private tasksCompleted = 0;

  /** Number of review retries for the current work item. */
  private retryCount = 0;

  /** Idea held between Ideating and CreatingProject states. */
  private pendingIdea: ParsedIdea | null = null;

  /** Promise that resolves when the main loop exits. */
  private loopDonePromise: Promise<void> | null = null;
  private loopDoneResolve: (() => void) | null = null;

  // -------------------------------------------------------------------------
  // Constructor
  // -------------------------------------------------------------------------

  constructor(config: AgentLoopConfig) {
    this.config = config;

    const { orchestratorConfig } = config;

    this.fsm = new AgentStateMachine();
    this.executionAgent = new ExecutionAgent(orchestratorConfig);
    this.reviewAgent = new ReviewAgent(orchestratorConfig);
    this.ideationAgent = new IdeationAgent(orchestratorConfig);
    this.worktreeManager = new WorktreeManager(orchestratorConfig.workspaceRoot);
    this.budgetTracker = new BudgetTracker(
      orchestratorConfig.dailyBudgetUsd,
      orchestratorConfig.monthlyBudgetUsd,
      orchestratorConfig.workspaceRoot,
    );
    this.templateSub = new TemplateSubstitution();
    this.githubClient = new GitHubClient(orchestratorConfig.githubToken);
    this.logger = new Logger(config.agentId);

    // Wire FSM transitions to the onStatusChange callback.
    this.fsm.onTransition((from, to, _event) => {
      const { events } = orchestratorConfig;
      if (events.onStatusChange) {
        events.onStatusChange(config.agentId, from, to);
      }
      this.logger.info(`State transition: ${from} → ${to}`);
    });
  }

  // -------------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------------

  /**
   * Starts the agent loop.  Returns a Promise that resolves once the loop
   * exits (either via {@link stop} or an unrecoverable error).
   */
  async start(): Promise<void> {
    if (this.running) {
      this.logger.warn('AgentLoop.start() called while already running — ignoring');
      return;
    }

    this.running = true;
    this.loopDonePromise = new Promise<void>((resolve) => {
      this.loopDoneResolve = resolve;
    });

    this.logger.info('Agent loop starting');

    try {
      await this._runLoop();
    } finally {
      this.running = false;
      if (this.loopDoneResolve) {
        this.loopDoneResolve();
      }
    }
  }

  /**
   * Pauses the loop after the current atomic step completes.
   * Any in-flight SDK query is aborted immediately.
   */
  pause(): void {
    const state = this.fsm.currentState;

    if (state === AgentState.Paused || state === AgentState.Stopped) {
      return;
    }

    // Set up the pause promise so the loop will await it.
    this.pausePromise = new Promise<void>((resolve) => {
      this.pauseResolver = resolve;
    });

    // Abort any in-flight SDK operation.
    if (this.currentAbortController) {
      this.currentAbortController.abort();
      this.currentAbortController = null;
    }

    if (this.fsm.canTransition('PAUSE')) {
      this.fsm.transition('PAUSE');
    }

    this.logger.info('Agent paused');
  }

  /**
   * Resumes a paused loop.
   */
  resume(): void {
    if (this.fsm.currentState !== AgentState.Paused) {
      return;
    }

    if (this.pauseResolver) {
      this.pauseResolver();
      this.pauseResolver = null;
      this.pausePromise = null;
    }

    this.fsm.transition('RESUME');
    this.logger.info('Agent resumed');
  }

  /**
   * Stops the loop permanently and waits for it to fully exit.
   */
  async stop(): Promise<void> {
    this.running = false;

    // Abort any in-flight SDK operation.
    if (this.currentAbortController) {
      this.currentAbortController.abort();
      this.currentAbortController = null;
    }

    // Resolve any pending pause so the loop can observe the STOP transition.
    if (this.pauseResolver) {
      this.pauseResolver();
      this.pauseResolver = null;
      this.pausePromise = null;
    }

    if (this.fsm.canTransition('STOP')) {
      this.fsm.transition('STOP');
    }

    this.logger.info('Agent stop requested — waiting for loop to exit');

    // Wait for the loop goroutine to exit.
    if (this.loopDonePromise) {
      await this.loopDonePromise;
    }
  }

  /** Returns the current FSM state. */
  getState(): AgentState {
    return this.fsm.currentState;
  }

  /** Returns the numeric agent identifier. */
  getAgentId(): number {
    return this.config.agentId;
  }

  // -------------------------------------------------------------------------
  // Main loop
  // -------------------------------------------------------------------------

  private async _runLoop(): Promise<void> {
    while (this.running) {
      const state = this.fsm.currentState;

      try {
        switch (state) {
          case AgentState.Idle:
            await this._handleIdle();
            break;

          case AgentState.Claiming:
            await this._handleClaiming();
            break;

          case AgentState.Working:
            await this._handleWorking();
            break;

          case AgentState.Reviewing:
            await this._handleReviewing();
            break;

          case AgentState.Ideating:
            await this._handleIdeating();
            break;

          case AgentState.CreatingProject:
            await this._handleCreatingProject();
            break;

          case AgentState.Error:
            await this._handleError();
            break;

          case AgentState.Cooldown:
            await this._handleCooldown();
            break;

          case AgentState.Paused:
            await this._handlePaused();
            break;

          case AgentState.Stopped:
            return;

          default: {
            // Exhaustive check — TypeScript will warn if a new state is added
            // without a handler.
            const _exhaustive: never = state;
            this.logger.error(`Unhandled agent state: ${String(_exhaustive)}`);
            return;
          }
        }
      } catch (err) {
        // Catch unhandled exceptions in state handlers and transition to Error.
        const error = err instanceof Error ? err : new Error(String(err));
        this.logger.error('Unhandled exception in state handler', error);

        if (this.fsm.canTransition('EXECUTION_ERROR')) {
          this.fsm.transition('EXECUTION_ERROR');
        } else if (this.fsm.canTransition('REVIEW_ERROR')) {
          this.fsm.transition('REVIEW_ERROR');
        } else if (this.fsm.canTransition('IDEATION_ERROR')) {
          this.fsm.transition('IDEATION_ERROR');
        } else if (this.fsm.canTransition('CREATION_ERROR')) {
          this.fsm.transition('CREATION_ERROR');
        } else if (this.fsm.currentState !== AgentState.Error) {
          // Force the machine into Error state if no clean path exists.
          // We do this by resetting and manually noting the error state so
          // the next iteration runs _handleError.
          this.logger.error('Could not transition to Error state; resetting FSM');
          this.fsm.reset();
        }

        // Notify the error callback.
        const { events } = this.config.orchestratorConfig;
        if (events.onError) {
          events.onError(this.config.agentId, error);
        }
      }
    }
  }

  // -------------------------------------------------------------------------
  // State handlers
  // -------------------------------------------------------------------------

  /**
   * Idle: check budget, find work, decide what to do next.
   */
  private async _handleIdle(): Promise<void> {
    // --- Budget check -------------------------------------------------------
    if (!this.budgetTracker.isWithinBudget()) {
      this.logger.warn('Budget exceeded — pausing agent');
      this.pause();
      return;
    }

    // --- Find work ----------------------------------------------------------
    const workItem = await this._findNextWorkItem();

    if (workItem !== null) {
      this.currentWorkItem = workItem;
      this.retryCount = 0;
      this.fsm.transition('QUEUE_HAS_WORK');
      return;
    }

    // --- No work found: ideate or sleep ------------------------------------
    const { enabledCategories } = this.config.orchestratorConfig;
    const ideationEnabled = Array.isArray(enabledCategories) && enabledCategories.length > 0;

    if (ideationEnabled) {
      this.fsm.transition('QUEUE_EMPTY_IDEATE');
      return;
    }

    // Sleep before polling again.
    this.logger.debug(`Queue empty — sleeping ${IDLE_POLL_INTERVAL_MS / 1000}s`);
    await sleep(IDLE_POLL_INTERVAL_MS);
  }

  /**
   * Claiming: attempt to claim the current work item from GitHub.
   */
  private async _handleClaiming(): Promise<void> {
    if (!this.currentWorkItem) {
      this.logger.error('Claiming state reached with no currentWorkItem — transitioning CLAIM_FAILED');
      this.fsm.transition('CLAIM_FAILED');
      return;
    }

    const { projectId, agentId: _agentIdStr } = this._claimMeta();

    try {
      const claimed = await this.githubClient.claimIssue(
        projectId,
        String(this.currentWorkItem.issueNumber),
        `agent-${this.config.agentId}`,
      );

      if (!claimed) {
        this.logger.warn(
          `Failed to claim issue #${this.currentWorkItem.issueNumber} — another agent may have taken it`,
        );
        this.currentWorkItem = null;
        this.fsm.transition('CLAIM_FAILED');
        return;
      }

      // Create a worktree for the claimed issue.
      const info = await this.worktreeManager.createWorktree(
        this.config.agentId,
        this.currentWorkItem.issueNumber,
      );
      this.currentWorktreePath = info.path;

      this.logger.info(
        `Claimed issue #${this.currentWorkItem.issueNumber} — worktree at ${info.path}`,
      );
      this.fsm.transition('CLAIM_SUCCESS');
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      this.logger.error(`Error claiming issue: ${detail}`);
      this.currentWorkItem = null;
      this.currentWorktreePath = null;
      this.fsm.transition('CLAIM_FAILED');
    }
  }

  /**
   * Working: run the ExecutionAgent on the current work item.
   */
  private async _handleWorking(): Promise<void> {
    if (!this.currentWorkItem || !this.currentWorktreePath) {
      this.logger.error('Working state reached without work item or worktree — transitioning EXECUTION_ERROR');
      this.fsm.transition('EXECUTION_ERROR');
      return;
    }

    const abort = new AbortController();
    this.currentAbortController = abort;

    this.logger.info(
      `Executing issue #${this.currentWorkItem.issueNumber} (retry ${this.retryCount})`,
    );

    try {
      const result = await this.executionAgent.execute(
        this.currentWorkItem,
        this.currentWorktreePath,
        abort,
      );

      this.currentAbortController = null;

      if (!result.success) {
        this.logger.warn(`Execution failed: ${result.error ?? 'unknown error'}`);
        this.fsm.transition('EXECUTION_ERROR');
        return;
      }

      // Record cost.
      this.budgetTracker.recordCost(
        `agent-${this.config.agentId}`,
        result.costUsd,
        this.currentWorkItem.projectNumber,
      );

      // Commit and push the changes.
      const commitMsg = `feat: implement issue #${this.currentWorkItem.issueNumber} — ${this.currentWorkItem.issueTitle}`;
      await this.worktreeManager.commitAndPush(this.currentWorktreePath, commitMsg);

      this.logger.info(
        `Execution complete for issue #${this.currentWorkItem.issueNumber} — cost $${result.costUsd.toFixed(4)}`,
      );
      this.fsm.transition('EXECUTION_COMPLETE');
    } catch (err) {
      this.currentAbortController = null;
      const detail = err instanceof Error ? err.message : String(err);
      this.logger.error(`Execution threw an exception: ${detail}`);
      this.fsm.transition('EXECUTION_ERROR');
    }
  }

  /**
   * Reviewing: run the ReviewAgent on the completed work.
   */
  private async _handleReviewing(): Promise<void> {
    if (!this.currentWorkItem || !this.currentWorktreePath) {
      this.logger.error('Reviewing state reached without work item or worktree — transitioning REVIEW_ERROR');
      this.fsm.transition('REVIEW_ERROR');
      return;
    }

    const abort = new AbortController();
    this.currentAbortController = abort;

    this.logger.info(`Reviewing issue #${this.currentWorkItem.issueNumber}`);

    try {
      const outcome = await this.reviewAgent.review(
        this.currentWorkItem,
        this.currentWorktreePath,
        abort,
      );

      this.currentAbortController = null;

      if (outcome.approved) {
        // Update issue status on GitHub and clean up.
        await this._finalizeApprovedWork();
        this.fsm.transition('REVIEW_APPROVED');
        return;
      }

      // Not approved — decide whether to retry or escalate.
      if (this.retryCount < MAX_REVIEW_RETRIES) {
        this.retryCount++;
        this.logger.warn(
          `Review rejected for issue #${this.currentWorkItem.issueNumber} — retry ${this.retryCount}/${MAX_REVIEW_RETRIES}. ${outcome.summary}`,
        );
        this.fsm.transition('REVIEW_REJECTED');
        return;
      }

      // Too many retries — release and clean up.
      this.logger.error(
        `Review failed after ${MAX_REVIEW_RETRIES} retries for issue #${this.currentWorkItem.issueNumber} — releasing`,
      );
      await this._cleanupCurrentWork();
      this.fsm.transition('REVIEW_ERROR');
    } catch (err) {
      this.currentAbortController = null;
      const detail = err instanceof Error ? err.message : String(err);
      this.logger.error(`Review threw an exception: ${detail}`);
      await this._cleanupCurrentWork();
      this.fsm.transition('REVIEW_ERROR');
    }
  }

  /**
   * Ideating: pick an enabled category, load its prompt, and run IdeationAgent.
   */
  private async _handleIdeating(): Promise<void> {
    const { enabledCategories, categoryPromptsDir, owner, repo, githubToken, workspaceRoot } =
      this.config.orchestratorConfig;

    const categories = enabledCategories ?? [];
    if (categories.length === 0) {
      this.logger.warn('Ideating state reached but no enabled categories — transitioning NO_IDEA');
      this.fsm.transition('NO_IDEA');
      return;
    }

    // Pick a random category.
    const category = categories[Math.floor(Math.random() * categories.length)];

    const abort = new AbortController();
    this.currentAbortController = abort;

    this.logger.info(`Ideating for category: ${category}`);

    try {
      // Build template context and load the category prompt.
      const context = await this.templateSub.buildContext(workspaceRoot, owner, repo, githubToken);
      const prompt = await this.templateSub.loadAndSubstitute(categoryPromptsDir, category, context);

      // Fetch existing issue titles to avoid duplicates.
      const existingCount = await this.githubClient.getOpenIssueCount(owner, repo);
      // We only have the count here; pass an empty list as a placeholder.
      // The IdeationAgent's duplicate detection will skip checking against an
      // empty list — full title list injection is a Phase 5 concern.
      const existingTitles: string[] = [];
      this.logger.debug(`Existing open issue count: ${existingCount}`);

      const outcome = await this.ideationAgent.ideate(category, prompt, existingTitles, abort);

      this.currentAbortController = null;

      if (outcome.noIdeaAvailable || outcome.idea === null) {
        this.logger.info('No idea available from ideation agent');
        this.fsm.transition('NO_IDEA');
        return;
      }

      this.pendingIdea = outcome.idea;
      this.logger.info(`Idea generated: "${outcome.idea.title}"`);
      this.fsm.transition('IDEA_GENERATED');
    } catch (err) {
      this.currentAbortController = null;
      const detail = err instanceof Error ? err.message : String(err);
      this.logger.error(`Ideation error: ${detail}`);
      this.fsm.transition('IDEATION_ERROR');
    }
  }

  /**
   * CreatingProject: create a GitHub issue from the pending idea.
   */
  private async _handleCreatingProject(): Promise<void> {
    if (!this.pendingIdea) {
      this.logger.error('CreatingProject state reached with no pendingIdea — transitioning CREATION_ERROR');
      this.fsm.transition('CREATION_ERROR');
      return;
    }

    const { owner, repo } = this.config.orchestratorConfig;
    const idea = this.pendingIdea;

    this.logger.info(`Creating issue for idea: "${idea.title}"`);

    try {
      const body = this._buildIssueBody(idea);
      const created = await this.githubClient.createIssue(owner, repo, idea.title, body);

      this.pendingIdea = null;
      this.logger.info(`Created issue #${created.number}: "${idea.title}"`);
      this.fsm.transition('PROJECT_CREATED');
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      this.logger.error(`Issue creation failed: ${detail}`);
      this.pendingIdea = null;
      this.fsm.transition('CREATION_ERROR');
    }
  }

  /**
   * Error: log, emit the error event, then acknowledge to transition to Cooldown.
   */
  private async _handleError(): Promise<void> {
    this.logger.error('Agent entered Error state');

    const { events } = this.config.orchestratorConfig;
    if (events.onError) {
      events.onError(
        this.config.agentId,
        new Error(`Agent ${this.config.agentId} entered Error state`),
      );
    }

    this.fsm.transition('ERROR_ACKNOWLEDGED');
  }

  /**
   * Cooldown: sleep before returning to Idle.
   */
  private async _handleCooldown(): Promise<void> {
    this.logger.info(`Cooldown — sleeping ${COOLDOWN_DURATION_MS / 1000}s`);
    await sleep(COOLDOWN_DURATION_MS);
    this.fsm.transition('COOLDOWN_COMPLETE');
  }

  /**
   * Paused: await the pause promise until resume() is called.
   */
  private async _handlePaused(): Promise<void> {
    if (this.pausePromise) {
      await this.pausePromise;
    }
  }

  // -------------------------------------------------------------------------
  // Work-item discovery (stub — real implementation in Phase 5)
  // -------------------------------------------------------------------------

  /**
   * Returns the next available work item from the queue, or `null` if the
   * queue is empty.
   *
   * This is a stub implementation that always returns `null`.  The orchestrator
   * will inject work items via this method in Phase 5 (work queue integration).
   */
  private async _findNextWorkItem(): Promise<WorkItem | null> {
    return null;
  }

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  /**
   * Returns the project ID and agent ID string used for claim operations.
   */
  private _claimMeta(): { projectId: string; agentId: string } {
    return {
      projectId: this.config.orchestratorConfig.projectId,
      agentId: `agent-${this.config.agentId}`,
    };
  }

  /**
   * Called when a review is approved: update the issue status on GitHub,
   * increment tasksCompleted, and remove the worktree.
   */
  private async _finalizeApprovedWork(): Promise<void> {
    if (!this.currentWorkItem || !this.currentWorktreePath) {
      return;
    }

    this.tasksCompleted++;
    this.logger.info(
      `Issue #${this.currentWorkItem.issueNumber} approved — tasks completed: ${this.tasksCompleted}`,
    );

    await this._cleanupCurrentWork();
  }

  /**
   * Removes the current worktree and resets work-item state.
   */
  private async _cleanupCurrentWork(): Promise<void> {
    if (this.currentWorktreePath) {
      try {
        await this.worktreeManager.removeWorktree(this.currentWorktreePath);
      } catch (err) {
        const detail = err instanceof Error ? err.message : String(err);
        this.logger.warn(`Failed to remove worktree at ${this.currentWorktreePath}: ${detail}`);
      }
      this.currentWorktreePath = null;
    }

    this.currentWorkItem = null;
  }

  /**
   * Builds a GitHub issue body from a ParsedIdea.
   */
  private _buildIssueBody(idea: ParsedIdea): string {
    const criteria = idea.acceptanceCriteria.map((ac) => `- [ ] ${ac}`).join('\n');

    return `## Description

${idea.description}

## Technical Approach

${idea.technicalApproach}

## Acceptance Criteria

${criteria}

## Metadata

- **Category**: ${idea.category}
- **Estimated effort**: ${idea.effortHours}h`;
  }

  /**
   * Derives the {@link AgentStatus} (used in session files) from the current
   * FSM {@link AgentState}.
   */
  private _currentStatus(): AgentStatus {
    switch (this.fsm.currentState) {
      case AgentState.Working:
        return 'working';
      case AgentState.Reviewing:
        return 'reviewing';
      case AgentState.Ideating:
      case AgentState.CreatingProject:
        return 'ideating';
      case AgentState.Paused:
        return 'paused';
      default:
        return 'idle';
    }
  }
}

// ---------------------------------------------------------------------------
// Internal utilities
// ---------------------------------------------------------------------------

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
