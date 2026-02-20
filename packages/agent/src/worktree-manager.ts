/**
 * WorktreeManager — creates, manages, and removes git worktrees for agent instances.
 *
 * ZERO vscode imports — pure Node.js (fs, path, child_process).
 */

import * as fs from 'fs';
import * as path from 'path';

import { gitExec } from './util/git';
import { WorktreeInfo } from './types';

// ---------------------------------------------------------------------------
// WorktreeManager
// ---------------------------------------------------------------------------

/**
 * Manages git worktrees for parallel agent execution.
 *
 * Each agent instance gets its own worktree so that multiple agents can work
 * on different issues simultaneously without interfering with one another.
 *
 * Worktree layout (relative to workspaceRoot):
 *   ../.agent-worktrees/agent-{agentId}-issue-{issueNumber}/
 *
 * Branch naming convention:
 *   agent-{agentId}/issue-{issueNumber}
 */
export class WorktreeManager {
  private readonly workspaceRoot: string;

  constructor(workspaceRoot: string) {
    this.workspaceRoot = workspaceRoot;
  }

  // -------------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------------

  /**
   * Creates a new git worktree for the given agent/issue pair.
   *
   * The worktree is placed at:
   *   `../.agent-worktrees/agent-{agentId}-issue-{issueNumber}/`
   *
   * The branch is created from `origin/main` and named:
   *   `agent-{agentId}/issue-{issueNumber}`
   *
   * Failure modes handled:
   * - Branch already exists: appends a timestamp suffix to the branch name.
   * - Worktree path already exists: removes the existing directory first.
   *
   * @param agentId      Numeric identifier for the agent instance
   * @param issueNumber  GitHub issue number being worked on
   * @returns            Metadata about the newly created worktree
   */
  async createWorktree(agentId: number, issueNumber: number): Promise<WorktreeInfo> {
    const worktreePath = this._worktreePath(agentId, issueNumber);
    let branchName = `agent-${agentId}/issue-${issueNumber}`;

    // --- Pre-flight: remove a stale directory if it exists ------------------
    if (fs.existsSync(worktreePath)) {
      await this._removeDirectory(worktreePath);
    }

    // --- Fetch latest origin/main -------------------------------------------
    await gitExec(['fetch', 'origin', 'main'], this.workspaceRoot);

    // --- Attempt to create the branch + worktree ----------------------------
    try {
      await gitExec(
        ['worktree', 'add', '-b', branchName, worktreePath, 'origin/main'],
        this.workspaceRoot,
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      // Branch already exists — append timestamp and retry once
      if (message.includes('already exists') || message.includes('already checked out')) {
        branchName = `${branchName}-${Date.now()}`;
        await gitExec(
          ['worktree', 'add', '-b', branchName, worktreePath, 'origin/main'],
          this.workspaceRoot,
        );
      } else {
        throw err;
      }
    }

    return {
      path: worktreePath,
      branch: branchName,
      agentId,
      issueNumber,
    };
  }

  /**
   * Stages all changes, commits with the given message, and pushes the branch
   * to origin.
   *
   * @param worktreePath  Absolute path to the worktree
   * @param message       Git commit message
   * @throws              Error if the push fails (message is preserved)
   */
  async commitAndPush(worktreePath: string, message: string): Promise<void> {
    await gitExec(['add', '--all'], worktreePath);
    await gitExec(['commit', '-m', message], worktreePath);

    try {
      // Push and set the upstream tracking branch
      const branch = await this._getBranchInWorktree(worktreePath);
      await gitExec(['push', '--set-upstream', 'origin', branch], worktreePath);
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      throw new Error(`git push failed for worktree at ${worktreePath}: ${detail}`);
    }
  }

  /**
   * Removes the worktree at `worktreePath` and prunes stale worktree metadata.
   *
   * @param worktreePath  Absolute path to the worktree to remove
   */
  async removeWorktree(worktreePath: string): Promise<void> {
    try {
      await gitExec(['worktree', 'remove', '--force', worktreePath], this.workspaceRoot);
    } catch {
      // If git cannot remove it (e.g. path already gone), fall back to manual removal
      if (fs.existsSync(worktreePath)) {
        await this._removeDirectory(worktreePath);
      }
    }

    // Always prune stale references
    await gitExec(['worktree', 'prune'], this.workspaceRoot);
  }

  /**
   * Removes all worktrees found in the `.agent-worktrees` directory.
   *
   * @returns  Number of worktrees that were removed
   */
  async cleanupOrphanedWorktrees(): Promise<number> {
    const agentWorktreesDir = this._agentWorktreesDir();

    if (!fs.existsSync(agentWorktreesDir)) {
      return 0;
    }

    const entries = fs.readdirSync(agentWorktreesDir, { withFileTypes: true });
    let removed = 0;

    for (const entry of entries) {
      if (entry.isDirectory()) {
        const fullPath = path.join(agentWorktreesDir, entry.name);
        try {
          await this.removeWorktree(fullPath);
          removed++;
        } catch {
          // Log and continue — best-effort cleanup
          console.warn(`[WorktreeManager] Failed to remove orphaned worktree: ${fullPath}`);
        }
      }
    }

    return removed;
  }

  /**
   * Lists all agent worktrees that are currently present on disk.
   *
   * Parses directory names of the form `agent-{agentId}-issue-{issueNumber}` and
   * reads the active branch for each worktree.
   *
   * @returns  Array of WorktreeInfo for every discovered worktree
   */
  async listActiveWorktrees(): Promise<WorktreeInfo[]> {
    const agentWorktreesDir = this._agentWorktreesDir();

    if (!fs.existsSync(agentWorktreesDir)) {
      return [];
    }

    const entries = fs.readdirSync(agentWorktreesDir, { withFileTypes: true });
    const results: WorktreeInfo[] = [];

    for (const entry of entries) {
      if (!entry.isDirectory()) {
        continue;
      }

      const match = entry.name.match(/^agent-(\d+)-issue-(\d+)$/);
      if (!match) {
        continue;
      }

      const agentId = parseInt(match[1], 10);
      const issueNumber = parseInt(match[2], 10);
      const worktreePath = path.join(agentWorktreesDir, entry.name);

      try {
        const branch = await this._getBranchInWorktree(worktreePath);
        results.push({ path: worktreePath, branch, agentId, issueNumber });
      } catch {
        // Worktree exists on disk but git cannot read it — skip
      }
    }

    return results;
  }

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  /** Absolute path to the shared `.agent-worktrees` parent directory. */
  private _agentWorktreesDir(): string {
    return path.resolve(this.workspaceRoot, '..', '.agent-worktrees');
  }

  /** Absolute path for a specific agent/issue worktree. */
  private _worktreePath(agentId: number, issueNumber: number): string {
    return path.join(this._agentWorktreesDir(), `agent-${agentId}-issue-${issueNumber}`);
  }

  /** Reads the current branch name inside a worktree directory. */
  private async _getBranchInWorktree(worktreePath: string): Promise<string> {
    return gitExec(['rev-parse', '--abbrev-ref', 'HEAD'], worktreePath);
  }

  /**
   * Recursively removes a directory using `fs.rmSync`.
   * Wrapped in a Promise to keep the public API consistently async.
   */
  private async _removeDirectory(dirPath: string): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        fs.rmSync(dirPath, { recursive: true, force: true });
        resolve();
      } catch (err) {
        reject(err);
      }
    });
  }
}
