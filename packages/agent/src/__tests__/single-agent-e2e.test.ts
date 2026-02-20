/**
 * Single Agent End-to-End Tests (AC-6.1)
 *
 * Tests the single agent lifecycle through:
 *   - State machine transitions (AC-6.1.a)
 *   - Session file writing via the session-file-hook (AC-6.1.b)
 *   - Signal file generation alongside the session file
 *   - Budget tracker cost recording and persistence (AC-6.1.d)
 *   - tasksCompleted increment tracking (AC-6.1.b)
 *
 * Real SDK calls and GitHub API calls are NOT made — all tests run offline
 * using temp directories for file-system assertions.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { AgentStateMachine, InvalidTransitionError } from '../state-machine';
import { AgentState } from '../types';
import { BudgetTracker } from '../budget-tracker';
import { createSessionFileHook } from '../hooks/session-file-hook';
import { HookInput } from '../hooks/types';

// ---------------------------------------------------------------------------
// Shared fixture
// ---------------------------------------------------------------------------

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-e2e-'));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

// Minimal HookInput stub — session-file-hook only reads agentId/workspaceRoot
// from its config closure; it ignores the input object entirely.
const stubInput: HookInput = {
  session_id: 'test-session',
  transcript_path: '/dev/null',
  cwd: '/',
  hook_event_name: 'PostToolUse',
};

// ---------------------------------------------------------------------------
// AC-6.1.a — Full agent cycle through state machine
// ---------------------------------------------------------------------------

describe('AC-6.1.a: state machine — full agent cycle', () => {
  it('transitions Idle → Claiming → Working → Reviewing → Idle', () => {
    const fsm = new AgentStateMachine();

    expect(fsm.currentState).toBe(AgentState.Idle);

    fsm.transition('QUEUE_HAS_WORK');
    expect(fsm.currentState).toBe(AgentState.Claiming);

    fsm.transition('CLAIM_SUCCESS');
    expect(fsm.currentState).toBe(AgentState.Working);

    fsm.transition('EXECUTION_COMPLETE');
    expect(fsm.currentState).toBe(AgentState.Reviewing);

    fsm.transition('REVIEW_APPROVED');
    expect(fsm.currentState).toBe(AgentState.Idle);
  });

  it('fires onTransition listeners for each hop', () => {
    const fsm = new AgentStateMachine();
    const log: Array<{ from: AgentState; to: AgentState; event: string }> = [];

    fsm.onTransition((from, to, event) => log.push({ from, to, event }));

    fsm.transition('QUEUE_HAS_WORK');
    fsm.transition('CLAIM_SUCCESS');
    fsm.transition('EXECUTION_COMPLETE');
    fsm.transition('REVIEW_APPROVED');

    expect(log).toHaveLength(4);
    expect(log[0]).toMatchObject({ from: AgentState.Idle, to: AgentState.Claiming, event: 'QUEUE_HAS_WORK' });
    expect(log[1]).toMatchObject({ from: AgentState.Claiming, to: AgentState.Working, event: 'CLAIM_SUCCESS' });
    expect(log[2]).toMatchObject({ from: AgentState.Working, to: AgentState.Reviewing, event: 'EXECUTION_COMPLETE' });
    expect(log[3]).toMatchObject({ from: AgentState.Reviewing, to: AgentState.Idle, event: 'REVIEW_APPROVED' });
  });

  it('throws InvalidTransitionError for illegal events', () => {
    const fsm = new AgentStateMachine();

    // Cannot jump from Idle straight to Working
    expect(() => fsm.transition('CLAIM_SUCCESS')).toThrowError(InvalidTransitionError);
    // State is unchanged after the failure
    expect(fsm.currentState).toBe(AgentState.Idle);
  });

  it('canTransition returns false for illegal events without changing state', () => {
    const fsm = new AgentStateMachine();

    expect(fsm.canTransition('CLAIM_SUCCESS')).toBe(false);
    expect(fsm.currentState).toBe(AgentState.Idle);

    expect(fsm.canTransition('QUEUE_HAS_WORK')).toBe(true);
    expect(fsm.currentState).toBe(AgentState.Idle); // still unchanged
  });

  it('reset() returns machine to Idle without firing listeners', () => {
    const fsm = new AgentStateMachine();
    const log: string[] = [];

    fsm.onTransition((_, __, event) => log.push(event));
    fsm.transition('QUEUE_HAS_WORK');
    fsm.transition('CLAIM_SUCCESS');

    fsm.reset();

    expect(fsm.currentState).toBe(AgentState.Idle);
    // Only the two real transitions were logged — reset() is silent
    expect(log).toHaveLength(2);
  });

  it('handles review-rejected path: Working → Reviewing → Working → Reviewing → Idle', () => {
    const fsm = new AgentStateMachine();

    fsm.transition('QUEUE_HAS_WORK');
    fsm.transition('CLAIM_SUCCESS');
    fsm.transition('EXECUTION_COMPLETE');
    expect(fsm.currentState).toBe(AgentState.Reviewing);

    // First review: rejected → go back to Working
    fsm.transition('REVIEW_REJECTED');
    expect(fsm.currentState).toBe(AgentState.Working);

    // Second attempt
    fsm.transition('EXECUTION_COMPLETE');
    fsm.transition('REVIEW_APPROVED');
    expect(fsm.currentState).toBe(AgentState.Idle);
  });

  it('handles error path: Working → Error → Cooldown → Idle', () => {
    const fsm = new AgentStateMachine();

    fsm.transition('QUEUE_HAS_WORK');
    fsm.transition('CLAIM_SUCCESS');
    fsm.transition('EXECUTION_ERROR');
    expect(fsm.currentState).toBe(AgentState.Error);

    fsm.transition('ERROR_ACKNOWLEDGED');
    expect(fsm.currentState).toBe(AgentState.Cooldown);

    fsm.transition('COOLDOWN_COMPLETE');
    expect(fsm.currentState).toBe(AgentState.Idle);
  });

  it('Stopped state is terminal — all events throw', () => {
    const fsm = new AgentStateMachine();

    fsm.transition('QUEUE_HAS_WORK');
    fsm.transition('STOP');
    expect(fsm.currentState).toBe(AgentState.Stopped);

    // Any event from Stopped must fail
    expect(() => fsm.transition('QUEUE_HAS_WORK')).toThrowError(InvalidTransitionError);
    expect(() => fsm.transition('CLAIM_SUCCESS')).toThrowError(InvalidTransitionError);
  });

  it('Paused → Idle via RESUME', () => {
    const fsm = new AgentStateMachine();

    fsm.transition('QUEUE_HAS_WORK');
    fsm.transition('CLAIM_SUCCESS');
    fsm.transition('PAUSE');
    expect(fsm.currentState).toBe(AgentState.Paused);

    fsm.transition('RESUME');
    expect(fsm.currentState).toBe(AgentState.Idle);
  });
});

// ---------------------------------------------------------------------------
// AC-6.1.b — Session file written with correct structure
// ---------------------------------------------------------------------------

describe('AC-6.1.b: session file hook — writes session and signal files', () => {
  it('writes the session file with correct fields', async () => {
    const agentId = 1;
    const hook = createSessionFileHook({
      agentId,
      workspaceRoot: tmpDir,
      currentSession: () => ({
        status: 'working',
        currentProjectNumber: 42,
        currentPhase: 'Phase 1',
        tasksCompleted: 0,
      }),
    });

    const result = await hook(stubInput, undefined, { signal: new AbortController().signal });

    expect(result.continue).toBe(true);

    const sessionPath = path.join(tmpDir, '.claude-sessions', `agent-${agentId}.session`);
    expect(fs.existsSync(sessionPath)).toBe(true);

    const session = JSON.parse(fs.readFileSync(sessionPath, 'utf8'));
    expect(session.agentId).toBe(`agent-${agentId}`);
    expect(session.status).toBe('working');
    expect(session.currentProjectNumber).toBe(42);
    expect(session.currentPhase).toBe('Phase 1');
    expect(session.tasksCompleted).toBe(0);
    expect(typeof session.lastHeartbeat).toBe('string');
    expect(session.lastHeartbeat).toBeTruthy();
    // Verify it is a valid ISO-8601 timestamp
    expect(new Date(session.lastHeartbeat).getTime()).toBeGreaterThan(0);
  });

  it('tasksCompleted increments correctly across calls', async () => {
    const agentId = 1;
    let tasksCompleted = 0;

    const hook = createSessionFileHook({
      agentId,
      workspaceRoot: tmpDir,
      currentSession: () => ({
        status: 'idle',
        tasksCompleted,
      }),
    });

    // First call — zero tasks
    await hook(stubInput, undefined, { signal: new AbortController().signal });
    const sessionPath = path.join(tmpDir, '.claude-sessions', `agent-${agentId}.session`);
    let session = JSON.parse(fs.readFileSync(sessionPath, 'utf8'));
    expect(session.tasksCompleted).toBe(0);

    // Simulate completing a task and calling the hook again
    tasksCompleted = 1;
    await hook(stubInput, undefined, { signal: new AbortController().signal });
    session = JSON.parse(fs.readFileSync(sessionPath, 'utf8'));
    expect(session.tasksCompleted).toBe(1);
  });

  it('writes null fields with correct defaults when session is minimal', async () => {
    const agentId = 2;
    const hook = createSessionFileHook({
      agentId,
      workspaceRoot: tmpDir,
      currentSession: () => ({ status: 'idle' }),
    });

    await hook(stubInput, undefined, { signal: new AbortController().signal });

    const sessionPath = path.join(tmpDir, '.claude-sessions', `agent-${agentId}.session`);
    const session = JSON.parse(fs.readFileSync(sessionPath, 'utf8'));

    expect(session.agentId).toBe('agent-2');
    expect(session.status).toBe('idle');
    expect(session.currentProjectNumber).toBeNull();
    expect(session.currentPhase).toBeNull();
    expect(session.branchName).toBeNull();
    expect(session.currentTaskDescription).toBeNull();
    expect(session.errorCount).toBe(0);
    expect(session.lastError).toBeNull();
  });

  it('lastHeartbeat is always overwritten with a fresh timestamp', async () => {
    const agentId = 1;
    const hook = createSessionFileHook({
      agentId,
      workspaceRoot: tmpDir,
      currentSession: () => ({
        status: 'working',
        // Intentionally pass a stale heartbeat — hook must overwrite it
        lastHeartbeat: '2000-01-01T00:00:00.000Z',
      } as any),
    });

    const before = Date.now();
    await hook(stubInput, undefined, { signal: new AbortController().signal });
    const after = Date.now();

    const sessionPath = path.join(tmpDir, '.claude-sessions', `agent-${agentId}.session`);
    const session = JSON.parse(fs.readFileSync(sessionPath, 'utf8'));
    const heartbeat = new Date(session.lastHeartbeat).getTime();

    expect(heartbeat).toBeGreaterThanOrEqual(before);
    expect(heartbeat).toBeLessThanOrEqual(after);
  });
});

// ---------------------------------------------------------------------------
// Signal file written alongside session file
// ---------------------------------------------------------------------------

describe('signal file: written alongside session file', () => {
  it('writes signal file with state=responding', async () => {
    const agentId = 1;
    const hook = createSessionFileHook({
      agentId,
      workspaceRoot: tmpDir,
      currentSession: () => ({ status: 'working' }),
    });

    await hook(stubInput, undefined, { signal: new AbortController().signal });

    const signalPath = path.join(tmpDir, '.claude-sessions', `agent-${agentId}.signal`);
    expect(fs.existsSync(signalPath)).toBe(true);

    const signal = JSON.parse(fs.readFileSync(signalPath, 'utf8'));
    expect(signal.state).toBe('responding');
    expect(typeof signal.timestamp).toBe('string');
    expect(new Date(signal.timestamp).getTime()).toBeGreaterThan(0);
  });

  it('both session and signal share the same timestamp', async () => {
    const agentId = 1;
    const hook = createSessionFileHook({
      agentId,
      workspaceRoot: tmpDir,
      currentSession: () => ({ status: 'idle' }),
    });

    await hook(stubInput, undefined, { signal: new AbortController().signal });

    const sessionsDir = path.join(tmpDir, '.claude-sessions');
    const session = JSON.parse(fs.readFileSync(path.join(sessionsDir, `agent-${agentId}.session`), 'utf8'));
    const signal = JSON.parse(fs.readFileSync(path.join(sessionsDir, `agent-${agentId}.signal`), 'utf8'));

    expect(session.lastHeartbeat).toBe(signal.timestamp);
  });

  it('sessions directory is created automatically if it does not exist', async () => {
    const agentId = 3;
    const hook = createSessionFileHook({
      agentId,
      workspaceRoot: tmpDir,
      currentSession: () => ({ status: 'idle' }),
    });

    const sessionsDir = path.join(tmpDir, '.claude-sessions');
    expect(fs.existsSync(sessionsDir)).toBe(false);

    await hook(stubInput, undefined, { signal: new AbortController().signal });

    expect(fs.existsSync(sessionsDir)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// AC-6.1.d — Budget tracker records cost entries
// ---------------------------------------------------------------------------

describe('AC-6.1.d: budget tracker — cost recording and persistence', () => {
  it('records costs and reports correct daily/monthly spend', () => {
    const sessionsDir = path.join(tmpDir, '.claude-sessions');
    const tracker = new BudgetTracker(50, 500, sessionsDir);

    tracker.recordCost('agent-1', 0.05, 92);
    tracker.recordCost('agent-1', 0.10, 92);

    expect(tracker.getDailySpend()).toBeCloseTo(0.15, 5);
    expect(tracker.getMonthlySpend()).toBeCloseTo(0.15, 5);
    expect(tracker.isWithinBudget()).toBe(true);
  });

  it('persists cost entries to cost-log.json', () => {
    const sessionsDir = path.join(tmpDir, '.claude-sessions');
    const tracker = new BudgetTracker(50, 500, sessionsDir);

    tracker.recordCost('agent-1', 0.25, 42);
    tracker.persistToFile();

    const costLogPath = path.join(sessionsDir, 'cost-log.json');
    expect(fs.existsSync(costLogPath)).toBe(true);

    const entries = JSON.parse(fs.readFileSync(costLogPath, 'utf8'));
    expect(Array.isArray(entries)).toBe(true);
    expect(entries).toHaveLength(1);
    expect(entries[0].agentId).toBe('agent-1');
    expect(entries[0].costUsd).toBeCloseTo(0.25, 5);
    expect(entries[0].projectNumber).toBe(42);
    expect(typeof entries[0].timestamp).toBe('string');
  });

  it('detects budget exceeded when daily limit is crossed', () => {
    const sessionsDir = path.join(tmpDir, '.claude-sessions');
    const tracker = new BudgetTracker(1.00, 500, sessionsDir); // $1 daily limit

    const exceededStatuses: unknown[] = [];
    tracker.onBudgetExceeded((status) => exceededStatuses.push(status));

    tracker.recordCost('agent-1', 0.80, 92); // within budget
    expect(exceededStatuses).toHaveLength(0);

    tracker.recordCost('agent-1', 0.30, 92); // pushes over $1
    expect(exceededStatuses).toHaveLength(1);
    expect(tracker.isWithinBudget()).toBe(false);
  });

  it('getBudgetStatus returns correct remaining amounts', () => {
    const sessionsDir = path.join(tmpDir, '.claude-sessions');
    const tracker = new BudgetTracker(10, 100, sessionsDir);

    tracker.recordCost('agent-1', 3.00, 92);

    const status = tracker.getBudgetStatus();
    expect(status.dailyLimit).toBe(10);
    expect(status.monthlyLimit).toBe(100);
    expect(status.dailySpend).toBeCloseTo(3.00, 5);
    expect(status.monthlySpend).toBeCloseTo(3.00, 5);
    expect(status.dailyRemaining).toBeCloseTo(7.00, 5);
    expect(status.monthlyRemaining).toBeCloseTo(97.00, 5);
    expect(status.isWithinBudget).toBe(true);
  });

  it('loadFromFile restores persisted entries', () => {
    const sessionsDir = path.join(tmpDir, '.claude-sessions');

    // Write and persist
    const writer = new BudgetTracker(50, 500, sessionsDir);
    writer.recordCost('agent-1', 1.23, 7);
    writer.persistToFile();

    // Read in a fresh instance
    const reader = new BudgetTracker(50, 500, sessionsDir);
    reader.loadFromFile();

    expect(reader.getDailySpend()).toBeCloseTo(1.23, 5);
  });

  it('loadFromFile is a no-op when file does not exist', () => {
    const sessionsDir = path.join(tmpDir, '.claude-sessions');
    const tracker = new BudgetTracker(50, 500, sessionsDir);

    // Should not throw
    expect(() => tracker.loadFromFile()).not.toThrow();
    expect(tracker.getDailySpend()).toBe(0);
  });

  it('multiple agents tracked independently within shared tracker', () => {
    const sessionsDir = path.join(tmpDir, '.claude-sessions');
    const tracker = new BudgetTracker(50, 500, sessionsDir);

    tracker.recordCost('agent-1', 0.50, 92);
    tracker.recordCost('agent-2', 0.25, 92);
    tracker.recordCost('agent-3', 0.75, 92);

    // Total spend is the sum across all agents
    expect(tracker.getDailySpend()).toBeCloseTo(1.50, 5);
    expect(tracker.isWithinBudget()).toBe(true);

    tracker.persistToFile();
    const entries = JSON.parse(
      fs.readFileSync(path.join(sessionsDir, 'cost-log.json'), 'utf8'),
    ) as Array<{ agentId: string; costUsd: number }>;

    expect(entries).toHaveLength(3);
    const agentIds = entries.map((e) => e.agentId);
    expect(agentIds).toContain('agent-1');
    expect(agentIds).toContain('agent-2');
    expect(agentIds).toContain('agent-3');
  });
});
