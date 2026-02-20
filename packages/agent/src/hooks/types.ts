/**
 * Local compatible types for SDK hook interfaces.
 *
 * These mirror the shapes from @anthropic-ai/claude-agent-sdk but are defined
 * locally to avoid transitive dependency issues.  They must remain structurally
 * compatible with the SDK types so that values produced here can be passed
 * directly to SDK `Options.hooks`.
 *
 * ZERO vscode imports.
 * ZERO @anthropic-ai/claude-agent-sdk imports.
 */

// ---------------------------------------------------------------------------
// Hook I/O types
// ---------------------------------------------------------------------------

/**
 * Input passed to every hook callback by the SDK.
 * Covers fields from BaseHookInput plus optional PostToolUse / Stop fields.
 */
export interface HookInput {
  session_id: string;
  transcript_path: string;
  cwd: string;
  hook_event_name: string;
  /** Present on PostToolUse events. */
  tool_name?: string;
  /** Present on PostToolUse events. */
  tool_input?: unknown;
  /** Present on PostToolUse events. */
  tool_response?: unknown;
  /** Present on PostToolUse events. */
  tool_use_id?: string;
  /** Present on Stop events. */
  stop_hook_active?: boolean;
  /** Present on Stop events. */
  last_assistant_message?: string;
  [key: string]: unknown;
}

/**
 * Output returned from a hook callback.
 * Setting `continue: false` signals the SDK to halt execution.
 */
export interface HookOutput {
  continue?: boolean;
  suppressOutput?: boolean;
  stopReason?: string;
  [key: string]: unknown;
}

// ---------------------------------------------------------------------------
// Callback / matcher types
// ---------------------------------------------------------------------------

/**
 * A hook callback function, compatible with the SDK's HookCallback type.
 */
export type HookCallback = (
  input: HookInput,
  toolUseID: string | undefined,
  options: { signal: AbortSignal },
) => Promise<HookOutput>;

/**
 * Groups one or more hook callbacks with an optional matcher string,
 * compatible with the SDK's HookCallbackMatcher type.
 */
export interface HookCallbackMatcher {
  matcher?: string;
  hooks: HookCallback[];
  timeout?: number;
}

// ---------------------------------------------------------------------------
// Top-level hooks map
// ---------------------------------------------------------------------------

/**
 * All hook event names supported by the SDK.
 */
export type HookEvent =
  | 'PreToolUse'
  | 'PostToolUse'
  | 'PostToolUseFailure'
  | 'Notification'
  | 'UserPromptSubmit'
  | 'SessionStart'
  | 'SessionEnd'
  | 'Stop'
  | 'SubagentStart'
  | 'SubagentStop'
  | 'PreCompact'
  | 'PermissionRequest'
  | 'Setup'
  | 'TeammateIdle'
  | 'TaskCompleted'
  | 'ConfigChange';

/**
 * The shape of `Options['hooks']` in the SDK.
 */
export type HooksMap = Partial<Record<HookEvent, HookCallbackMatcher[]>>;
