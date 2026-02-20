/**
 * ReviewAgent - Evaluates completed work against acceptance criteria using Claude.
 *
 * Runs git diff HEAD~1 in the worktree, sends the diff + acceptance criteria to
 * Claude with read-only tools, and parses the structured ReviewOutcome JSON from
 * the result.
 *
 * ZERO vscode imports — pure Node.js.
 */

import { execFile } from 'child_process';
import { promisify } from 'util';

import { query } from '@anthropic-ai/claude-agent-sdk';

import { OrchestratorConfig, ReviewOutcome, WorkItem } from './types';

const execFileAsync = promisify(execFile);

// ---------------------------------------------------------------------------
// ReviewAgent class
// ---------------------------------------------------------------------------

/**
 * Uses the Claude Agent SDK to review completed work items against their
 * acceptance criteria.  The agent is given read-only tools (no Write or Edit)
 * so it can inspect code and run tests without mutating the worktree.
 */
export class ReviewAgent {
  private readonly _config: OrchestratorConfig;

  constructor(config: OrchestratorConfig) {
    this._config = config;
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  /**
   * Reviews the changes in `worktreePath` against `workItem.acceptanceCriteria`.
   *
   * @param workItem        The work item that was completed
   * @param worktreePath    Absolute path to the git worktree containing the changes
   * @param abortController Shared abort controller for cancellation
   * @returns               A structured {@link ReviewOutcome}
   */
  async review(
    workItem: WorkItem,
    worktreePath: string,
    abortController: AbortController,
  ): Promise<ReviewOutcome> {
    // 1. Obtain the diff between the last commit and its parent.
    const diff = await this._getGitDiff(worktreePath);

    // 2. Build the review prompt.
    const prompt = this._buildPrompt(workItem, diff);

    // 3. Call Claude via the SDK with read-only tools.
    const resultText = await this._runQuery(prompt, worktreePath, abortController);

    // 4. Parse and return the structured outcome.
    return this._parseOutcome(resultText);
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  /**
   * Runs `git diff HEAD~1` in the given directory and returns the raw diff
   * string.  Returns an empty string when there is no parent commit.
   */
  private async _getGitDiff(cwd: string): Promise<string> {
    try {
      const { stdout } = await execFileAsync('git', ['diff', 'HEAD~1'], { cwd });
      return stdout.trim();
    } catch (err: unknown) {
      // When HEAD~1 does not exist (first commit) git exits non-zero.
      const message = err instanceof Error ? err.message : String(err);
      console.warn(`[ReviewAgent] git diff HEAD~1 failed (${message}) — returning empty diff`);
      return '';
    }
  }

  /**
   * Assembles the review prompt from the work item and the diff text.
   */
  private _buildPrompt(workItem: WorkItem, diff: string): string {
    const criteriaList = workItem.acceptanceCriteria
      .map((ac, i) => `${i + 1}. ${ac}`)
      .join('\n');

    return `You are a code reviewer. Review the following changes against the acceptance criteria.

## Issue: ${workItem.issueTitle}

## Acceptance Criteria
${criteriaList}

## Changes Made (git diff)
${diff || '(no diff available — this may be the first commit)'}

## Instructions
- Evaluate each acceptance criterion individually
- Run any test commands if applicable
- Respond with a JSON object (no markdown fences) in this exact format:
{
  "approved": true/false,
  "criteriaResults": [
    {"criterion": "...", "passed": true/false, "feedback": "..."}
  ],
  "summary": "Overall assessment",
  "testsRan": true/false,
  "testsPassed": true/false
}`;
  }

  /**
   * Invokes `query()` with the review prompt and returns the final result text
   * from the first `SDKResultSuccess` message encountered.
   *
   * Throws if the query ends with an error result or if the abort controller is
   * signalled before a result is produced.
   */
  private async _runQuery(
    prompt: string,
    cwd: string,
    abortController: AbortController,
  ): Promise<string> {
    const stream = query({
      prompt,
      options: {
        allowedTools: ['Read', 'Glob', 'Grep', 'Bash'],
        cwd,
        permissionMode: 'bypassPermissions',
        allowDangerouslySkipPermissions: true,
        maxBudgetUsd: this._config.maxBudgetPerReviewUsd ?? 1.0,
        maxTurns: 50,
        abortController,
        persistSession: false,
      },
    });

    let resultText: string | null = null;

    for await (const message of stream) {
      if (message.type === 'result') {
        if (message.subtype === 'success') {
          resultText = message.result;
        } else {
          // error_during_execution, error_max_turns, error_max_budget_usd, etc.
          throw new Error(
            `[ReviewAgent] Query ended with error result: subtype=${message.subtype}`,
          );
        }
        break;
      }
    }

    if (resultText === null) {
      throw new Error('[ReviewAgent] Query completed without producing a result message');
    }

    return resultText;
  }

  /**
   * Parses the raw text returned by Claude into a {@link ReviewOutcome}.
   *
   * Handles both plain JSON and JSON wrapped in markdown code fences
   * (` ```json ... ``` `).  On parse failure returns a rejected outcome
   * describing the error so the caller can react without crashing.
   */
  private _parseOutcome(text: string): ReviewOutcome {
    // Strip optional markdown code fences.
    const stripped = text
      .replace(/^```(?:json)?\s*/i, '')
      .replace(/\s*```\s*$/, '')
      .trim();

    try {
      const parsed = JSON.parse(stripped) as ReviewOutcome;

      // Validate the minimum required shape.
      if (typeof parsed.approved !== 'boolean') {
        throw new Error('Missing or invalid "approved" field');
      }
      if (!Array.isArray(parsed.criteriaResults)) {
        throw new Error('Missing or invalid "criteriaResults" field');
      }

      return parsed;
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      console.error('[ReviewAgent] Failed to parse ReviewOutcome JSON:', message);
      console.error('[ReviewAgent] Raw result text:', text);

      return {
        approved: false,
        criteriaResults: [],
        summary: `Review agent returned unparseable output. Parse error: ${message}`,
        testsRan: false,
        testsPassed: false,
      };
    }
  }
}
