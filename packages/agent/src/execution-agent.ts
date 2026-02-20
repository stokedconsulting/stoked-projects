/**
 * ExecutionAgent — runs a Claude agent session to implement a work item.
 *
 * ZERO vscode imports — pure Node.js / SDK integration.
 */

import * as fs from 'fs';

import { query, AbortError } from '@anthropic-ai/claude-agent-sdk';

import { ExecutionResult, OrchestratorConfig, WorkItem } from './types';

// ---------------------------------------------------------------------------
// ExecutionAgent
// ---------------------------------------------------------------------------

/**
 * Executes a single work item by running a Claude agent session inside the
 * provided worktree directory.
 *
 * The agent is granted `bypassPermissions` so that it can read, write, and run
 * commands without interactive confirmation.  Budget and turn limits are
 * enforced by the SDK.
 */
export class ExecutionAgent {
  private readonly config: OrchestratorConfig;

  constructor(config: OrchestratorConfig) {
    this.config = config;
  }

  // -------------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------------

  /**
   * Executes the given work item inside the specified worktree.
   *
   * @param workItem        The unit of work to implement
   * @param worktreePath    Absolute path to the git worktree where the agent runs
   * @param abortController Controller used to cancel the session externally
   * @returns               Execution result with cost, turns, files touched, and
   *                        success/error information
   */
  async execute(
    workItem: WorkItem,
    worktreePath: string,
    abortController: AbortController,
  ): Promise<ExecutionResult> {
    // --- Validate worktree exists -------------------------------------------
    if (!fs.existsSync(worktreePath)) {
      throw new Error(
        `Worktree path does not exist: ${worktreePath}`,
      );
    }

    // --- Build prompt -------------------------------------------------------
    const prompt = this._buildPrompt(workItem);

    // --- Tracking state -----------------------------------------------------
    let costUsd = 0;
    let turnsUsed = 0;
    const filesTouched = new Set<string>();
    let success = false;
    let errorMessage: string | undefined;

    // --- Run SDK query ------------------------------------------------------
    try {
      const agentQuery = query({
        prompt,
        options: {
          cwd: worktreePath,
          permissionMode: 'bypassPermissions',
          allowDangerouslySkipPermissions: true,
          maxBudgetUsd: this.config.maxBudgetPerTaskUsd,
          maxTurns: this.config.maxTurnsPerTask,
          abortController,
          tools: { type: 'preset', preset: 'claude_code' },
          persistSession: false,
        },
      });

      for await (const message of agentQuery) {
        // --- Result message: captures final cost, turns, and success/error --
        if (message.type === 'result') {
          costUsd = message.total_cost_usd;
          turnsUsed = message.num_turns;

          if (message.subtype === 'success') {
            success = true;
          } else {
            // subtype is one of the error variants
            success = false;
            const errMsg = (message as { errors?: string[] }).errors;
            errorMessage = Array.isArray(errMsg) && errMsg.length > 0
              ? errMsg.join('; ')
              : `Execution stopped: ${message.subtype}`;
          }
        }

        // --- Assistant message: extract file paths from tool use blocks ------
        if (message.type === 'assistant') {
          const betaMessage = message.message;
          if (Array.isArray(betaMessage.content)) {
            for (const block of betaMessage.content) {
              if (block.type === 'tool_use') {
                const input = block.input as Record<string, unknown>;
                this._extractFilePaths(input, filesTouched);
              }
            }
          }
        }
      }
    } catch (err) {
      // AbortError is a clean exit — not a failure
      if (err instanceof AbortError) {
        return {
          success: false,
          costUsd,
          filesTouched: Array.from(filesTouched),
          turnsUsed,
          error: 'Execution aborted',
        };
      }

      // Any other error
      const detail = err instanceof Error ? err.message : String(err);
      return {
        success: false,
        costUsd,
        filesTouched: Array.from(filesTouched),
        turnsUsed,
        error: detail,
      };
    }

    return {
      success,
      costUsd,
      filesTouched: Array.from(filesTouched),
      turnsUsed,
      ...(errorMessage !== undefined ? { error: errorMessage } : {}),
    };
  }

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  /**
   * Builds the prompt that instructs Claude to implement the work item.
   */
  private _buildPrompt(workItem: WorkItem): string {
    const criteria = workItem.acceptanceCriteria
      .map((ac) => `- ${ac}`)
      .join('\n');

    return `You are implementing a task for issue #${workItem.issueNumber}.

## Task: ${workItem.issueTitle}

${workItem.issueBody}

## Acceptance Criteria
${criteria}

## Instructions
- Implement the changes described above
- Write tests for your implementation
- Ensure all existing tests still pass
- Commit your changes with a clear message`;
  }

  /**
   * Inspects a tool-use input object and adds any recognized file paths to
   * the tracking set.
   *
   * Common tool input shapes observed in Claude Code:
   *   { file_path: string }
   *   { path: string }
   *   { paths: string[] }
   */
  private _extractFilePaths(
    input: Record<string, unknown>,
    filesTouched: Set<string>,
  ): void {
    // Single file_path field (Read, Write, Edit tools)
    if (typeof input['file_path'] === 'string') {
      filesTouched.add(input['file_path']);
    }

    // Single path field (some tools use 'path')
    if (typeof input['path'] === 'string') {
      filesTouched.add(input['path']);
    }

    // Array of paths
    if (Array.isArray(input['paths'])) {
      for (const p of input['paths']) {
        if (typeof p === 'string') {
          filesTouched.add(p);
        }
      }
    }
  }
}
