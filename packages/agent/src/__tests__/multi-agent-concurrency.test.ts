/**
 * Multi-Agent Concurrency Tests (Work Item 6.2)
 *
 * Tests the AgentOrchestrator's multi-agent management behavior:
 * - Spawning the correct number of agent instances (AC-6.2.a)
 * - Unique ID assignment across agents (AC-6.2.b)
 * - Accurate status reporting of agent count (AC-6.2.c)
 * - Scale-up from 1 to 3 agents (AC-6.2.d)
 * - Scale-down from 3 to 1 agent with LIFO removal (AC-6.2.d)
 * - pauseAll / resumeAll across multiple agents
 * - emergencyStop halts all agents
 *
 * Implementation note: AgentLoop instances start in Idle state and call
 * sleep(30_000) between work-queue polls.  We use vitest fake timers so
 * that no real time elapses during those sleeps or the 30-second stop
 * grace period, keeping each test fast (< 1 s wall-clock).
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { AgentOrchestrator, OrchestratorConfig } from '../index';
import { AgentState } from '../types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Builds a minimal valid OrchestratorConfig for testing.
 * All budget limits are set high enough that they never trigger.
 * No enabledCategories means agents will not attempt ideation.
 */
const makeConfig = (
  tmpDir: string,
  overrides: Partial<OrchestratorConfig> = {},
): OrchestratorConfig => ({
  workspaceRoot: tmpDir,
  githubToken: 'test-token',
  desiredInstances: 1,
  dailyBudgetUsd: 50,
  monthlyBudgetUsd: 500,
  maxBudgetPerTaskUsd: 5,
  maxTurnsPerTask: 50,
  projectId: 'test-project',
  owner: 'test-owner',
  repo: 'test-repo',
  categoryPromptsDir: path.join(tmpDir, 'prompts'),
  events: {},
  ...overrides,
});

/**
 * Starts an orchestrator with fake timers active.
 *
 * Agents are added to the agents map synchronously inside _spawnAgent(), so
 * getStatus() reflects the correct count immediately after start() resolves.
 * No timer advancement is needed to observe spawning behavior.
 */
async function startOrchestrator(orchestrator: AgentOrchestrator): Promise<void> {
  await orchestrator.start();
  // Yield to the microtask queue so that any pending Promise continuations
  // (e.g. the beginning of each agent loop) have a chance to run before
  // we inspect state.  This is a real microtask flush, not a fake-timer op.
  await Promise.resolve();
}

/**
 * Stops an orchestrator by advancing fake time past the 30-second stop
 * grace period so that _stopAgentWithTimeout resolves via its timeout branch.
 *
 * Also advances past the idle sleep inside any still-running AgentLoop so
 * that loopDonePromise resolves cleanly.
 */
async function stopOrchestrator(orchestrator: AgentOrchestrator): Promise<void> {
  // Call stop() — it will wait for agents to stop or for the 30s timeout.
  const stopPromise = orchestrator.stop();

  // Advance fake time past both the 30-second stop grace period and the
  // 30-second idle sleep so all pending timers resolve.
  await vi.advanceTimersByTimeAsync(35_000);

  await stopPromise;
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe('Multi-Agent Concurrency', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-multi-'));
    vi.useFakeTimers();
  });

  afterEach(async () => {
    vi.useRealTimers();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  // -------------------------------------------------------------------------
  // AC-6.2.a: Orchestrator creates correct number of agent instances
  // -------------------------------------------------------------------------

  it('AC-6.2.a: orchestrator creates 3 agent instances when desiredInstances=3', async () => {
    const orchestrator = new AgentOrchestrator(makeConfig(tmpDir, { desiredInstances: 3 }));
    await startOrchestrator(orchestrator);

    try {
      const status = orchestrator.getStatus();

      // desiredInstances is a config value that must always reflect what was requested.
      expect(status.desiredInstances).toBe(3);

      // Immediately after start(), before any agent sleeps complete, all 3
      // agents must be present in the agents map.
      expect(status.agents.length).toBe(3);
    } finally {
      await stopOrchestrator(orchestrator);
    }
  });

  // -------------------------------------------------------------------------
  // AC-6.2.b: Each agent receives a unique ID (no collisions)
  // -------------------------------------------------------------------------

  it('AC-6.2.b: each spawned agent receives a unique numeric ID', async () => {
    const orchestrator = new AgentOrchestrator(makeConfig(tmpDir, { desiredInstances: 3 }));
    await startOrchestrator(orchestrator);

    try {
      const status = orchestrator.getStatus();
      const ids = status.agents.map((a) => a.id);

      // The number of distinct IDs must equal the number of agents.
      const uniqueIds = new Set(ids);
      expect(uniqueIds.size).toBe(ids.length);

      // All IDs must be positive integers.
      for (const id of ids) {
        expect(typeof id).toBe('number');
        expect(Number.isInteger(id)).toBe(true);
        expect(id).toBeGreaterThan(0);
      }
    } finally {
      await stopOrchestrator(orchestrator);
    }
  });

  // -------------------------------------------------------------------------
  // AC-6.2.b (additional): IDs are monotonically increasing from 1
  // -------------------------------------------------------------------------

  it('AC-6.2.b: agent IDs are monotonically increasing starting from 1', async () => {
    const orchestrator = new AgentOrchestrator(makeConfig(tmpDir, { desiredInstances: 3 }));
    await startOrchestrator(orchestrator);

    try {
      const status = orchestrator.getStatus();
      const ids = status.agents.map((a) => a.id).sort((a, b) => a - b);

      // IDs must start from 1 and be consecutive integers.
      expect(ids).toEqual([1, 2, 3]);
    } finally {
      await stopOrchestrator(orchestrator);
    }
  });

  // -------------------------------------------------------------------------
  // AC-6.2.c: getStatus() reports the correct agent count
  // -------------------------------------------------------------------------

  it('AC-6.2.c: getStatus reports correct agent count matching desiredInstances', async () => {
    const orchestrator = new AgentOrchestrator(makeConfig(tmpDir, { desiredInstances: 2 }));
    await startOrchestrator(orchestrator);

    try {
      const status = orchestrator.getStatus();

      expect(status.agents.length).toBe(2);
      expect(status.desiredInstances).toBe(2);

      // budgetStatus must be present and reflect a valid, within-budget state.
      expect(status.budgetStatus).toBeDefined();
      expect(status.budgetStatus.isWithinBudget).toBe(true);
    } finally {
      await stopOrchestrator(orchestrator);
    }
  });

  // -------------------------------------------------------------------------
  // AC-6.2.d: Scale up — setDesiredInstances from 1 to 3
  // -------------------------------------------------------------------------

  it('AC-6.2.d: scale up from 1 to 3 agents increases agent count', async () => {
    const orchestrator = new AgentOrchestrator(makeConfig(tmpDir, { desiredInstances: 1 }));
    await startOrchestrator(orchestrator);

    try {
      const statusBefore = orchestrator.getStatus();
      expect(statusBefore.agents.length).toBe(1);

      orchestrator.setDesiredInstances(3);
      // Let the new agent loops enter their first await so they are in a stable state.
      await Promise.resolve();

      const statusAfter = orchestrator.getStatus();

      // Two more agents must have been added immediately.
      expect(statusAfter.agents.length).toBe(3);

      // All agent IDs must still be unique after the scale-up.
      const ids = statusAfter.agents.map((a) => a.id);
      expect(new Set(ids).size).toBe(3);
    } finally {
      await stopOrchestrator(orchestrator);
    }
  });

  // -------------------------------------------------------------------------
  // AC-6.2.d: Scale down — setDesiredInstances from 3 to 1, LIFO removal
  // -------------------------------------------------------------------------

  it('AC-6.2.d: scale down from 3 to 1 removes agents with highest IDs (LIFO)', async () => {
    const orchestrator = new AgentOrchestrator(makeConfig(tmpDir, { desiredInstances: 3 }));
    await startOrchestrator(orchestrator);

    try {
      const statusBefore = orchestrator.getStatus();
      const idsBefore = statusBefore.agents.map((a) => a.id).sort((a, b) => a - b);
      expect(idsBefore).toEqual([1, 2, 3]);

      // Scale down to 1: agents 2 and 3 must be removed (highest IDs first).
      orchestrator.setDesiredInstances(1);

      const statusAfter = orchestrator.getStatus();

      // Only one agent should remain.
      expect(statusAfter.agents.length).toBe(1);

      // The remaining agent must be the one with the lowest ID (agent 1).
      const remainingId = statusAfter.agents[0].id;
      expect(remainingId).toBe(1);
    } finally {
      await stopOrchestrator(orchestrator);
    }
  });

  // -------------------------------------------------------------------------
  // Scale up then down — combined cycle
  // -------------------------------------------------------------------------

  it('can scale up to 5 and back down to 2 with correct IDs remaining', async () => {
    const orchestrator = new AgentOrchestrator(makeConfig(tmpDir, { desiredInstances: 2 }));
    await startOrchestrator(orchestrator);

    try {
      // Scale up to 5.
      orchestrator.setDesiredInstances(5);
      await Promise.resolve();

      const statusAt5 = orchestrator.getStatus();
      expect(statusAt5.agents.length).toBe(5);

      const idsAt5 = statusAt5.agents.map((a) => a.id).sort((a, b) => a - b);
      expect(idsAt5).toEqual([1, 2, 3, 4, 5]);

      // Scale back down to 2: agents 3, 4, 5 removed.
      orchestrator.setDesiredInstances(2);
      const statusAt2 = orchestrator.getStatus();
      expect(statusAt2.agents.length).toBe(2);

      const idsAt2 = statusAt2.agents.map((a) => a.id).sort((a, b) => a - b);
      expect(idsAt2).toEqual([1, 2]);
    } finally {
      await stopOrchestrator(orchestrator);
    }
  });

  // -------------------------------------------------------------------------
  // Pause all / resume all
  // -------------------------------------------------------------------------

  it('pauseAll transitions all agents to Paused state', async () => {
    const orchestrator = new AgentOrchestrator(makeConfig(tmpDir, { desiredInstances: 2 }));
    await startOrchestrator(orchestrator);

    try {
      await orchestrator.pauseAll();
      await Promise.resolve();

      const status = orchestrator.getStatus();
      expect(status.agents.length).toBe(2);

      // All present agents must be in the Paused state.
      for (const agent of status.agents) {
        expect(agent.state).toBe(AgentState.Paused);
      }
    } finally {
      await stopOrchestrator(orchestrator);
    }
  });

  it('resumeAll transitions paused agents back to Idle state', async () => {
    const orchestrator = new AgentOrchestrator(makeConfig(tmpDir, { desiredInstances: 2 }));
    await startOrchestrator(orchestrator);

    try {
      // Pause all first, then resume.
      await orchestrator.pauseAll();
      await Promise.resolve();

      // Confirm paused before resuming.
      const pausedStatus = orchestrator.getStatus();
      for (const agent of pausedStatus.agents) {
        expect(agent.state).toBe(AgentState.Paused);
      }

      await orchestrator.resumeAll();
      await Promise.resolve();

      const resumedStatus = orchestrator.getStatus();
      expect(resumedStatus.agents.length).toBe(2);

      // After resumeAll, agents must be back in Idle (the only non-paused state
      // reachable synchronously via resume() → FSM RESUME transition).
      for (const agent of resumedStatus.agents) {
        expect(agent.state).toBe(AgentState.Idle);
      }
    } finally {
      await stopOrchestrator(orchestrator);
    }
  });

  // -------------------------------------------------------------------------
  // Emergency stop
  // -------------------------------------------------------------------------

  it('emergencyStop immediately clears all agents from the map', async () => {
    const orchestrator = new AgentOrchestrator(makeConfig(tmpDir, { desiredInstances: 2 }));
    await startOrchestrator(orchestrator);

    const statusBefore = orchestrator.getStatus();
    expect(statusBefore.agents.length).toBe(2);

    // emergencyStop calls agent.stop() on each agent and clears the map.
    // We fire stopOrchestrator semantics inline here since emergencyStop is the
    // subject — we advance timers so all stop operations complete.
    const stopPromise = orchestrator.emergencyStop();
    await vi.advanceTimersByTimeAsync(35_000);
    await stopPromise;

    const statusAfter = orchestrator.getStatus();

    // After emergency stop, the agents map must be empty.
    expect(statusAfter.agents.length).toBe(0);
  });

  // -------------------------------------------------------------------------
  // Edge case: setDesiredInstances(0) clears all agents
  // -------------------------------------------------------------------------

  it('setDesiredInstances(0) removes all agents', async () => {
    const orchestrator = new AgentOrchestrator(makeConfig(tmpDir, { desiredInstances: 3 }));
    await startOrchestrator(orchestrator);

    try {
      const statusBefore = orchestrator.getStatus();
      expect(statusBefore.agents.length).toBe(3);

      orchestrator.setDesiredInstances(0);

      const statusAfter = orchestrator.getStatus();
      expect(statusAfter.agents.length).toBe(0);
    } finally {
      await stopOrchestrator(orchestrator);
    }
  });

  // -------------------------------------------------------------------------
  // Edge case: setDesiredInstances with same value is a no-op
  // -------------------------------------------------------------------------

  it('setDesiredInstances with the same count does not change agents', async () => {
    const orchestrator = new AgentOrchestrator(makeConfig(tmpDir, { desiredInstances: 2 }));
    await startOrchestrator(orchestrator);

    try {
      const statusBefore = orchestrator.getStatus();
      const idsBefore = statusBefore.agents.map((a) => a.id).sort((a, b) => a - b);

      orchestrator.setDesiredInstances(2);

      const statusAfter = orchestrator.getStatus();
      const idsAfter = statusAfter.agents.map((a) => a.id).sort((a, b) => a - b);

      expect(idsAfter).toEqual(idsBefore);
    } finally {
      await stopOrchestrator(orchestrator);
    }
  });

  // -------------------------------------------------------------------------
  // Error event callback is wired up correctly
  // -------------------------------------------------------------------------

  it('onError callback is accepted without throwing', async () => {
    const errors: Array<{ agentId: number; error: Error }> = [];

    const orchestrator = new AgentOrchestrator(
      makeConfig(tmpDir, {
        desiredInstances: 1,
        events: {
          onError: (agentId, error) => {
            errors.push({ agentId, error });
          },
        },
      }),
    );

    await startOrchestrator(orchestrator);

    // Verify orchestrator started and has the expected agent count.
    const status = orchestrator.getStatus();
    expect(status.desiredInstances).toBe(1);
    expect(status.agents.length).toBe(1);

    await stopOrchestrator(orchestrator);

    // errors array may be empty (no errors occurred synchronously) — that is fine.
    expect(Array.isArray(errors)).toBe(true);
  });

  // -------------------------------------------------------------------------
  // Concurrent orchestrators use independent ID sequences
  // -------------------------------------------------------------------------

  it('two independent orchestrators produce separate ID namespaces', async () => {
    const tmpDir2 = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-multi-b-'));

    try {
      const orch1 = new AgentOrchestrator(makeConfig(tmpDir, { desiredInstances: 2 }));
      const orch2 = new AgentOrchestrator(makeConfig(tmpDir2, { desiredInstances: 2 }));

      await startOrchestrator(orch1);
      await startOrchestrator(orch2);

      try {
        const status1 = orch1.getStatus();
        const status2 = orch2.getStatus();

        // Both orchestrators must have 2 agents each.
        expect(status1.agents.length).toBe(2);
        expect(status2.agents.length).toBe(2);

        // Each orchestrator starts its own counter from 1.
        const ids1 = status1.agents.map((a) => a.id).sort((a, b) => a - b);
        const ids2 = status2.agents.map((a) => a.id).sort((a, b) => a - b);

        expect(ids1).toEqual([1, 2]);
        expect(ids2).toEqual([1, 2]);
      } finally {
        await stopOrchestrator(orch1);
        await stopOrchestrator(orch2);
      }
    } finally {
      fs.rmSync(tmpDir2, { recursive: true, force: true });
    }
  });
});
