/**
 * Progress hook for the autonomous agent loop.
 *
 * Tracks internal metrics across the lifetime of an SDK session:
 *  - `filesTouched`    – unique set of file paths touched by any tool
 *  - `toolUseCounts`   – per-tool invocation counts
 *  - `totalTurns`      – total number of PostToolUse events received
 *
 * Usage:
 * ```ts
 * const { hook, getProgress } = createProgressHook(agentId);
 * // register `hook` in SDK options
 * // call `getProgress()` at any time to snapshot current state
 * ```
 *
 * ZERO vscode imports — pure Node.js.
 * ZERO @anthropic-ai/claude-agent-sdk imports — local compatible types only.
 */

import { HookCallback, HookInput, HookOutput } from './types';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/**
 * A point-in-time snapshot of agent progress.
 */
export interface ProgressSnapshot {
  filesTouched: string[];
  toolUseCounts: Record<string, number>;
  totalTurns: number;
}

/**
 * Return value of {@link createProgressHook}.
 */
export interface ProgressHook {
  /** SDK-compatible hook callback to register under PostToolUse. */
  hook: HookCallback;
  /** Returns a snapshot of the current progress metrics. */
  getProgress: () => ProgressSnapshot;
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Creates a progress-tracking hook and a `getProgress()` accessor that
 * returns the current accumulated metrics.
 */
export function createProgressHook(_agentId: number): ProgressHook {
  const filesTouched = new Set<string>();
  const toolUseCounts = new Map<string, number>();
  let totalTurns = 0;

  const hook: HookCallback = async function progressHook(
    input: HookInput,
    _toolUseID: string | undefined,
    _options: { signal: AbortSignal },
  ): Promise<HookOutput> {
    totalTurns += 1;

    const toolName = typeof input.tool_name === 'string' ? input.tool_name : 'unknown';
    toolUseCounts.set(toolName, (toolUseCounts.get(toolName) ?? 0) + 1);

    const files = extractFilePaths(input.tool_input);
    for (const f of files) {
      filesTouched.add(f);
    }

    return { continue: true };
  };

  function getProgress(): ProgressSnapshot {
    return {
      filesTouched: Array.from(filesTouched),
      toolUseCounts: Object.fromEntries(toolUseCounts),
      totalTurns,
    };
  }

  return { hook, getProgress };
}

// ---------------------------------------------------------------------------
// Private helpers
// ---------------------------------------------------------------------------

/**
 * Extracts file path strings from a tool_input value.
 * Mirrors the logic in activity-hook.ts intentionally — both modules are
 * independent and must not import each other.
 */
function extractFilePaths(toolInput: unknown): string[] {
  if (!toolInput || typeof toolInput !== 'object' || Array.isArray(toolInput)) {
    return [];
  }

  const input = toolInput as Record<string, unknown>;
  const pathFields = ['file_path', 'path', 'paths', 'files', 'file', 'target', 'source'];
  const collected = new Set<string>();

  for (const field of pathFields) {
    const value = input[field];
    if (typeof value === 'string' && value.trim()) {
      collected.add(value.trim());
    } else if (Array.isArray(value)) {
      for (const item of value) {
        if (typeof item === 'string' && item.trim()) {
          collected.add(item.trim());
        }
      }
    }
  }

  return Array.from(collected);
}
