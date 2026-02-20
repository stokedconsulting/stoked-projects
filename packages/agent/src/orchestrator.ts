/**
 * AgentOrchestrator — Multi-agent manager for the autonomous agent loop.
 *
 * Manages a pool of AgentLoop instances, shared resources, budget enforcement,
 * worktree lifecycle, and scaling (up/down) of agent concurrency.
 *
 * ZERO vscode imports — pure Node.js / TypeScript.
 */

import {
  AgentState,
  BudgetStatus,
  OrchestratorConfig,
  OrchestratorStatus,
} from './types';
import { AgentLoop } from './agent-loop';
import { BudgetTracker } from './budget-tracker';
import { WorktreeManager } from './worktree-manager';
import { GitHubClient } from './util/github';
import { Logger } from './util/logger';
import { TemplateSubstitution } from './template-substitution';

// ---------------------------------------------------------------------------
// Internal constants
// ---------------------------------------------------------------------------

/** Interval (ms) between periodic orphaned worktree cleanups. */
const CLEANUP_INTERVAL_MS = 30 * 60 * 1_000; // 30 minutes

/** Grace period (ms) given to each agent to stop cleanly before allSettled resolves. */
const STOP_GRACE_PERIOD_MS = 30_000;

// ---------------------------------------------------------------------------
// AgentOrchestrator
// ---------------------------------------------------------------------------

/**
 * Top-level manager that owns a fleet of {@link AgentLoop} instances and
 * the shared infrastructure they depend on.
 *
 * Usage:
 * ```ts
 * const orchestrator = new AgentOrchestrator(config);
 * await orchestrator.start();
 * // ...
 * await orchestrator.stop();
 * ```
 */
export class AgentOrchestrator {
  // -------------------------------------------------------------------------
  // Configuration
  // -------------------------------------------------------------------------

  private readonly config: OrchestratorConfig;

  // -------------------------------------------------------------------------
  // Shared resources (created once, shared across all agents)
  // -------------------------------------------------------------------------

  private readonly budgetTracker: BudgetTracker;
  private readonly worktreeManager: WorktreeManager;
  private readonly githubClient: GitHubClient;
  private readonly templateSub: TemplateSubstitution;
  private readonly logger: Logger;

  // -------------------------------------------------------------------------
  // Agent management
  // -------------------------------------------------------------------------

  /** All active agent loop instances, keyed by their numeric agent ID. */
  private readonly agents: Map<number, AgentLoop> = new Map();

  /** Auto-incrementing counter for assigning unique agent IDs. */
  private nextAgentId = 1;

  // -------------------------------------------------------------------------
  // Lifecycle state
  // -------------------------------------------------------------------------

  /** Whether the orchestrator has been started (i.e. start() has been called). */
  private started = false;

  /** Handle for the periodic orphaned-worktree cleanup timer. */
  private cleanupTimer: ReturnType<typeof setInterval> | null = null;

  // -------------------------------------------------------------------------
  // Constructor
  // -------------------------------------------------------------------------

  /**
   * Creates an {@link AgentOrchestrator}.
   *
   * Shared resources are created here so that they are available before
   * `start()` is called.  No I/O is performed in the constructor.
   *
   * @param config  Top-level orchestrator configuration.
   */
  constructor(config: OrchestratorConfig) {
    this.config = config;

    this.budgetTracker = new BudgetTracker(
      config.dailyBudgetUsd,
      config.monthlyBudgetUsd,
      config.workspaceRoot,
    );

    this.worktreeManager = new WorktreeManager(config.workspaceRoot);
    this.githubClient = new GitHubClient(config.githubToken);
    this.templateSub = new TemplateSubstitution();

    // Orchestrator-level logger has no agent ID prefix.
    this.logger = new Logger();
  }

  // -------------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------------

  /**
   * Starts the orchestrator:
   * 1. Loads persisted budget data from disk.
   * 2. Cleans up any orphaned worktrees from a previous run.
   * 3. Spawns `desiredInstances` agent loops.
   * 4. Registers the budget-exceeded handler.
   * 5. Starts the periodic worktree cleanup timer.
   */
  async start(): Promise<void> {
    if (this.started) {
      this.logger.warn('AgentOrchestrator.start() called while already started — ignoring');
      return;
    }

    this.started = true;
    this.logger.info(
      `AgentOrchestrator starting — desiredInstances=${this.config.desiredInstances}`,
    );

    // --- Load persisted budget entries from disk ----------------------------
    this.budgetTracker.loadFromFile();
    this.logger.info('Budget loaded from disk');

    // --- Clean up any orphaned worktrees from previous runs ----------------
    try {
      const removed = await this.worktreeManager.cleanupOrphanedWorktrees();
      if (removed > 0) {
        this.logger.info(`Cleaned up ${removed} orphaned worktree(s) on startup`);
      }
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      this.logger.warn(`Failed to cleanup orphaned worktrees on startup: ${detail}`);
    }

    // --- Register the budget-exceeded handler ------------------------------
    this.budgetTracker.onBudgetExceeded((status) => this._onBudgetExceeded(status));

    // --- Spawn the desired number of agent instances -----------------------
    for (let i = 0; i < this.config.desiredInstances; i++) {
      this._spawnAgent();
    }

    // --- Start the periodic orphaned-worktree cleanup timer ----------------
    this.cleanupTimer = setInterval(async () => {
      try {
        const removed = await this.worktreeManager.cleanupOrphanedWorktrees();
        if (removed > 0) {
          this.logger.info(`Periodic cleanup removed ${removed} orphaned worktree(s)`);
        }
      } catch (err) {
        const detail = err instanceof Error ? err.message : String(err);
        this.logger.warn(`Periodic worktree cleanup failed: ${detail}`);
      }
    }, CLEANUP_INTERVAL_MS);

    this.logger.info(
      `AgentOrchestrator started with ${this.agents.size} agent(s)`,
    );
  }

  /**
   * Stops all agents gracefully and performs cleanup.
   *
   * Each agent is given up to {@link STOP_GRACE_PERIOD_MS} ms to stop
   * cleanly; `Promise.allSettled` is used so that a failure in one agent
   * does not block the others.
   */
  async stop(): Promise<void> {
    this.logger.info('AgentOrchestrator stopping — requesting all agents to stop');

    // Stop the periodic cleanup timer first so no new cleanups start during shutdown.
    if (this.cleanupTimer !== null) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }

    // Request all agents to stop, then wait with a timeout.
    const stopPromises = Array.from(this.agents.values()).map((agent) =>
      this._stopAgentWithTimeout(agent, STOP_GRACE_PERIOD_MS),
    );

    await Promise.allSettled(stopPromises);

    this.agents.clear();
    this.started = false;

    // Persist the current budget state to disk.
    try {
      this.budgetTracker.persistToFile();
      this.logger.info('Budget persisted to disk');
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      this.logger.warn(`Failed to persist budget to disk: ${detail}`);
    }

    this.logger.info('AgentOrchestrator stopped');
  }

  /**
   * Aborts all agents immediately without waiting for graceful shutdown.
   * Prefer {@link stop} unless the process is exiting urgently.
   */
  async emergencyStop(): Promise<void> {
    this.logger.warn('AgentOrchestrator emergency stop initiated');

    if (this.cleanupTimer !== null) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }

    // Stop all agents — we still use allSettled to be resilient, but we
    // don't wait for their full loop to drain (stop() does request a drain).
    const stopPromises = Array.from(this.agents.values()).map(async (agent) => {
      try {
        await agent.stop();
      } catch (err) {
        const detail = err instanceof Error ? err.message : String(err);
        this.logger.error(`Emergency stop: agent ${agent.getAgentId()} threw: ${detail}`);
      }
    });

    await Promise.allSettled(stopPromises);

    this.agents.clear();
    this.started = false;

    // Best-effort budget persist.
    try {
      this.budgetTracker.persistToFile();
    } catch {
      // Swallow — we're in an emergency stop, best-effort only.
    }

    this.logger.warn('AgentOrchestrator emergency stop complete');
  }

  /**
   * Adjusts the number of running agents to `n`.
   *
   * - Scale **up**: spawn new agents until the count reaches `n`.
   * - Scale **down**: stop the highest-ID agents (LIFO) until the count reaches `n`.
   *
   * @param n  Desired number of concurrent agent instances.
   */
  setDesiredInstances(n: number): void {
    if (n < 0) {
      this.logger.warn(`setDesiredInstances called with negative value ${n} — ignoring`);
      return;
    }

    const current = this.agents.size;
    this.logger.info(`setDesiredInstances(${n}) — current=${current}`);

    if (n > current) {
      // Scale up: spawn additional agents.
      const toAdd = n - current;
      for (let i = 0; i < toAdd; i++) {
        this._spawnAgent();
      }
    } else if (n < current) {
      // Scale down: stop the agents with the highest IDs first (LIFO).
      const toRemove = current - n;
      const sortedIds = Array.from(this.agents.keys()).sort((a, b) => b - a);
      const toStop = sortedIds.slice(0, toRemove);

      for (const agentId of toStop) {
        const agent = this.agents.get(agentId);
        if (!agent) continue;

        this.agents.delete(agentId);
        this._stopAgentWithTimeout(agent, STOP_GRACE_PERIOD_MS).catch((err) => {
          const detail = err instanceof Error ? err.message : String(err);
          this.logger.error(`Error stopping agent ${agentId} during scale-down: ${detail}`);
        });
      }
    }
  }

  /**
   * Pauses all currently running agents.
   */
  async pauseAll(): Promise<void> {
    this.logger.info('Pausing all agents');
    for (const agent of this.agents.values()) {
      agent.pause();
    }
  }

  /**
   * Resumes all currently paused agents.
   */
  async resumeAll(): Promise<void> {
    this.logger.info('Resuming all agents');
    for (const agent of this.agents.values()) {
      agent.resume();
    }
  }

  /**
   * Pauses a specific agent by its numeric ID.
   *
   * @param agentId  The ID of the agent to pause.
   */
  pauseAgent(agentId: number): void {
    const agent = this.agents.get(agentId);
    if (!agent) {
      this.logger.warn(`pauseAgent(${agentId}) — no agent found with that ID`);
      return;
    }
    agent.pause();
    this.logger.info(`Agent ${agentId} paused`);
  }

  /**
   * Resumes a specific agent by its numeric ID.
   *
   * @param agentId  The ID of the agent to resume.
   */
  resumeAgent(agentId: number): void {
    const agent = this.agents.get(agentId);
    if (!agent) {
      this.logger.warn(`resumeAgent(${agentId}) — no agent found with that ID`);
      return;
    }
    agent.resume();
    this.logger.info(`Agent ${agentId} resumed`);
  }

  /**
   * Returns an immutable status snapshot of the orchestrator and all agents.
   */
  getStatus(): OrchestratorStatus {
    const agentSnapshots = Array.from(this.agents.values()).map((agent) => ({
      id: agent.getAgentId(),
      state: agent.getState(),
    }));

    return {
      agents: agentSnapshots,
      budgetStatus: this.budgetTracker.getBudgetStatus(),
      activeWorktrees: agentSnapshots.filter(
        (a) => a.state === AgentState.Working || a.state === AgentState.Reviewing,
      ).length,
      desiredInstances: this.config.desiredInstances,
    };
  }

  // -------------------------------------------------------------------------
  // Internal methods
  // -------------------------------------------------------------------------

  /**
   * Creates a new {@link AgentLoop}, starts it (non-blocking), registers it
   * in the agents map, and returns it.
   *
   * Agent loop crashes are caught, logged, and the agent is removed from the
   * map.  Crashed agents are NOT automatically restarted — the operator (or
   * an external watchdog) must call {@link setDesiredInstances} to scale back up.
   */
  private _spawnAgent(): AgentLoop {
    const agentId = this.nextAgentId++;

    const loop = new AgentLoop({
      agentId,
      orchestratorConfig: this.config,
    });

    this.agents.set(agentId, loop);
    this.logger.info(`Spawning agent ${agentId}`);

    // Start the loop in the background; catch unhandled crashes.
    loop.start().catch((err) => {
      const detail = err instanceof Error ? err.message : String(err);
      this.logger.error(`Agent ${agentId} crashed: ${detail}`);

      // Remove the crashed agent from the map so getStatus() is accurate.
      this.agents.delete(agentId);

      // Notify the external error handler if one is registered.
      if (this.config.events.onError) {
        const error = err instanceof Error ? err : new Error(detail);
        this.config.events.onError(agentId, error);
      }
    });

    return loop;
  }

  /**
   * Wraps `agent.stop()` in a race against a timeout promise.
   * This prevents a single stalled agent from blocking orchestrator shutdown.
   *
   * Resolves (never rejects) regardless of whether the agent stopped cleanly.
   */
  private async _stopAgentWithTimeout(
    agent: AgentLoop,
    timeoutMs: number,
  ): Promise<void> {
    const agentId = agent.getAgentId();

    try {
      await Promise.race([
        agent.stop(),
        new Promise<void>((resolve) =>
          setTimeout(() => {
            this.logger.warn(
              `Agent ${agentId} did not stop within ${timeoutMs / 1_000}s — continuing shutdown`,
            );
            resolve();
          }, timeoutMs),
        ),
      ]);
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      this.logger.error(`Error while stopping agent ${agentId}: ${detail}`);
    }
  }

  /**
   * Called by the {@link BudgetTracker} whenever a budget limit is exceeded.
   * Pauses all agents immediately to prevent further spend.
   */
  private _onBudgetExceeded(status: BudgetStatus): void {
    this.logger.warn(
      `Budget exceeded — daily=$${status.dailySpend.toFixed(4)}/${status.dailyLimit}, ` +
      `monthly=$${status.monthlySpend.toFixed(4)}/${status.monthlyLimit} — pausing all agents`,
    );

    // pauseAll is async but we fire-and-forget here since the BudgetTracker
    // callback is synchronous.  All pause() calls on the individual agents
    // are themselves synchronous so the effect is immediate.
    this.pauseAll().catch((err) => {
      const detail = err instanceof Error ? err.message : String(err);
      this.logger.error(`Failed to pause all agents after budget exceeded: ${detail}`);
    });
  }
}
