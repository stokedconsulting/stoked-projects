/**
 * Activity hook for the autonomous agent loop.
 *
 * On every PostToolUse SDK event:
 *  - Extracts `tool_name` and any touched file paths from `tool_input`
 *  - Fires `events.onActivity(agentId, { toolName, filesAffected, timestamp })`
 *  - Fires `events.onHeartbeat(agentId)`
 *
 * ZERO vscode imports — pure Node.js.
 * ZERO @anthropic-ai/claude-agent-sdk imports — local compatible types only.
 */

import { AgentActivity, AgentEvents } from '../types';
import { HookCallback, HookInput, HookOutput } from './types';

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Creates a {@link HookCallback} that emits activity and heartbeat events for
 * every PostToolUse SDK event.
 */
export function createActivityHook(agentId: number, events: AgentEvents): HookCallback {
  return async function activityHook(
    input: HookInput,
    _toolUseID: string | undefined,
    _options: { signal: AbortSignal },
  ): Promise<HookOutput> {
    const timestamp = new Date().toISOString();
    const toolName = typeof input.tool_name === 'string' ? input.tool_name : 'unknown';
    const filesAffected = extractFilePaths(input.tool_input);

    const activity: AgentActivity = { toolName, filesAffected, timestamp };

    try {
      events.onActivity?.(agentId, activity);
    } catch (err) {
      console.error('[ActivityHook] onActivity callback threw', err);
    }

    try {
      events.onHeartbeat?.(agentId);
    } catch (err) {
      console.error('[ActivityHook] onHeartbeat callback threw', err);
    }

    return { continue: true };
  };
}

// ---------------------------------------------------------------------------
// Private helpers
// ---------------------------------------------------------------------------

/**
 * Extracts file path strings from a tool_input value.
 *
 * The SDK passes tool inputs as arbitrary JSON objects whose shape depends on
 * the tool.  We look for common path-bearing fields and collect unique,
 * non-empty string values.
 *
 * Recognised field names (case-sensitive):
 *   `file_path`, `path`, `paths`, `files`, `file`, `target`, `source`
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
