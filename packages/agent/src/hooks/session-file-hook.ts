/**
 * Session file hook for the autonomous agent loop.
 *
 * On every PostToolUse event, writes an up-to-date AgentSession JSON to
 * `.claude-sessions/agent-{agentId}.session` and a signal file to
 * `.claude-sessions/agent-{agentId}.signal`.
 *
 * Both writes are atomic (write to temp file, then rename) to prevent partial
 * reads by the VSCode extension.
 *
 * ZERO vscode imports — pure Node.js.
 * ZERO @anthropic-ai/claude-agent-sdk imports — local compatible types only.
 */

import * as fs from 'fs';
import * as path from 'path';

import { AgentSession } from '../types';
import { HookCallback, HookInput, HookOutput } from './types';

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

export interface SessionFileHookConfig {
  /** Numeric agent identifier used to name the session / signal files. */
  agentId: number;
  /** Absolute path to the workspace root. */
  workspaceRoot: string;
  /**
   * Factory that returns the current partial session state.  The hook merges
   * this with a fresh `lastHeartbeat` timestamp before writing.
   */
  currentSession: () => Partial<AgentSession>;
}

// ---------------------------------------------------------------------------
// Signal file payload
// ---------------------------------------------------------------------------

interface SignalPayload {
  state: 'responding' | 'stopped';
  timestamp: string;
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Creates a {@link HookCallback} that persists agent session state and signal
 * files on every PostToolUse SDK event.
 */
export function createSessionFileHook(config: SessionFileHookConfig): HookCallback {
  const { agentId, workspaceRoot, currentSession } = config;
  const sessionsDir = path.join(workspaceRoot, '.claude-sessions');
  const sessionFile = path.join(sessionsDir, `agent-${agentId}.session`);
  const signalFile = path.join(sessionsDir, `agent-${agentId}.signal`);

  return async function sessionFileHook(
    _input: HookInput,
    _toolUseID: string | undefined,
    _options: { signal: AbortSignal },
  ): Promise<HookOutput> {
    const timestamp = new Date().toISOString();

    try {
      fs.mkdirSync(sessionsDir, { recursive: true });
    } catch (err) {
      console.error(`[SessionFileHook] Failed to create sessions dir: ${sessionsDir}`, err);
      return { continue: true };
    }

    // Write session file atomically
    const session: AgentSession = {
      agentId: `agent-${agentId}`,
      status: 'working',
      currentProjectNumber: null,
      currentPhase: null,
      branchName: null,
      tasksCompleted: 0,
      currentTaskDescription: null,
      errorCount: 0,
      lastError: null,
      ...currentSession(),
      lastHeartbeat: timestamp,
    };

    writeAtomic(sessionFile, JSON.stringify(session, null, 2));

    // Write signal file atomically
    const signal: SignalPayload = { state: 'responding', timestamp };
    writeAtomic(signalFile, JSON.stringify(signal, null, 2));

    return { continue: true };
  };
}

// ---------------------------------------------------------------------------
// Private helpers
// ---------------------------------------------------------------------------

/**
 * Writes `content` to `filePath` atomically using a sibling temp file and
 * `fs.renameSync`.  Errors are caught and logged; they are never re-thrown so
 * that a failing write never blocks the SDK.
 */
function writeAtomic(filePath: string, content: string): void {
  const tmpPath = `${filePath}.tmp`;
  try {
    fs.writeFileSync(tmpPath, content, 'utf8');
    fs.renameSync(tmpPath, filePath);
  } catch (err) {
    console.error(`[SessionFileHook] Atomic write failed for ${filePath}`, err);
    // Clean up orphaned temp file if it exists
    try {
      fs.unlinkSync(tmpPath);
    } catch {
      // Ignore cleanup errors
    }
  }
}
