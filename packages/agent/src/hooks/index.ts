/**
 * Hooks barrel — composes all three agent hooks into a single SDK-compatible
 * `Options['hooks']` map and re-exports individual hook factories.
 *
 * Usage:
 * ```ts
 * import { createAgentHooks } from './hooks';
 *
 * const hooks = createAgentHooks({
 *   agentId: 1,
 *   workspaceRoot: '/path/to/workspace',
 *   events: myAgentEvents,
 *   currentSession: () => agentState.currentSession(),
 * });
 *
 * // Pass directly to SDK options:
 * await runAgent({ ..., hooks });
 * ```
 *
 * ZERO vscode imports.
 * ZERO @anthropic-ai/claude-agent-sdk imports — local compatible types only.
 */

import * as fs from 'fs';
import * as path from 'path';

import { AgentEvents, AgentSession } from '../types';
import { createActivityHook } from './activity-hook';
import { createProgressHook } from './progress-hook';
import { createSessionFileHook } from './session-file-hook';
import {
  HookCallback,
  HookCallbackMatcher,
  HookEvent,
  HookInput,
  HookOutput,
  HooksMap,
} from './types';

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

/**
 * Configuration for the composed agent hooks factory.
 */
export interface AgentHooksConfig {
  /** Numeric agent identifier. */
  agentId: number;
  /** Absolute path to the workspace root. */
  workspaceRoot: string;
  /** Agent event callbacks surfaced to external observers (e.g. the extension). */
  events: AgentEvents;
  /**
   * Factory that returns the current partial session state, merged with a fresh
   * heartbeat timestamp before each file write.
   */
  currentSession: () => Partial<AgentSession>;
}

// ---------------------------------------------------------------------------
// Composed factory
// ---------------------------------------------------------------------------

/**
 * Composes the session-file, activity, and progress hooks into a single map
 * compatible with the SDK's `Options['hooks']` field.
 *
 * @returns An object with `hooks` (the SDK-compatible map) and `getProgress`
 *          (an accessor for the accumulated progress snapshot).
 */
export function createAgentHooks(config: AgentHooksConfig): {
  hooks: HooksMap;
  getProgress: () => import('./progress-hook').ProgressSnapshot;
} {
  const { agentId, workspaceRoot, events, currentSession } = config;

  const sessionFileHook = createSessionFileHook({ agentId, workspaceRoot, currentSession });
  const activityHook = createActivityHook(agentId, events);
  const { hook: progressHook, getProgress } = createProgressHook(agentId);

  const stopHook = createStopHook(agentId, workspaceRoot);

  const postToolUse: HookCallbackMatcher = {
    hooks: [sessionFileHook, activityHook, progressHook],
  };

  const stop: HookCallbackMatcher = {
    hooks: [stopHook],
  };

  const hooks: HooksMap = {
    PostToolUse: [postToolUse],
    Stop: [stop],
  };

  return { hooks, getProgress };
}

// ---------------------------------------------------------------------------
// Stop hook (inline, not worth a separate file)
// ---------------------------------------------------------------------------

/**
 * Writes a `state: 'stopped'` signal file when the SDK emits a Stop event.
 */
function createStopHook(agentId: number, workspaceRoot: string): HookCallback {
  const sessionsDir = path.join(workspaceRoot, '.claude-sessions');
  const signalFile = path.join(sessionsDir, `agent-${agentId}.signal`);

  return async function stopHook(
    _input: HookInput,
    _toolUseID: string | undefined,
    _options: { signal: AbortSignal },
  ): Promise<HookOutput> {
    const timestamp = new Date().toISOString();
    const payload = JSON.stringify({ state: 'stopped', timestamp }, null, 2);
    const tmpPath = `${signalFile}.tmp`;

    try {
      fs.mkdirSync(sessionsDir, { recursive: true });
      fs.writeFileSync(tmpPath, payload, 'utf8');
      fs.renameSync(tmpPath, signalFile);
    } catch (err) {
      console.error(`[StopHook] Failed to write signal file for agent ${agentId}`, err);
      try {
        fs.unlinkSync(tmpPath);
      } catch {
        // Ignore cleanup errors
      }
    }

    return { continue: true };
  };
}

// ---------------------------------------------------------------------------
// Re-exports
// ---------------------------------------------------------------------------

export * from './activity-hook';
export * from './progress-hook';
export * from './session-file-hook';
export * from './types';
