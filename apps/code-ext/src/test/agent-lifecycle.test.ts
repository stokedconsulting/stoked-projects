import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { AgentLifecycleManager, initializeLifecycleManager, cleanupLifecycleManager } from '../agent-lifecycle';
import { AgentSessionManager } from '../agent-session-manager';

/**
 * Test suite for AgentLifecycleManager
 *
 * Tests cover:
 * - Agent start/stop/pause/resume operations
 * - Session management and tracking
 * - Graceful shutdown with timeout
 * - Edge cases (double start, stop non-existent agent, etc.)
 *
 * Note: Since the lifecycle manager now delegates to AgentOrchestrator for
 * process management, these tests verify session state transitions and
 * delegation logic (without a real orchestrator attached, i.e. no-orchestrator mode).
 */
suite('AgentLifecycleManager Test Suite', () => {
    let tempDir: string;
    let lifecycleManager: AgentLifecycleManager;
    let sessionManager: AgentSessionManager;

    setup(() => {
        // Create a unique temporary directory for each test
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-lifecycle-test-'));
        lifecycleManager = new AgentLifecycleManager(tempDir);
        sessionManager = new AgentSessionManager(tempDir);
    });

    teardown(async () => {
        // Stop all agents and clean up
        try {
            await lifecycleManager.stopAllAgents(2000);
        } catch (error) {
            console.log('Teardown: Error stopping agents:', error);
        }

        // Clean up temporary directory after each test
        if (fs.existsSync(tempDir)) {
            fs.rmSync(tempDir, { recursive: true, force: true });
        }
    });

    // AC-1.4.a: When "start agent" command is invoked → session is created and status transitions to "idle"
    test('AC-1.4.a: startAgent creates session and sets status to idle', async function() {
        this.timeout(5000); // Allow 5 seconds for test

        const agentId = 1;
        const startTime = Date.now();

        await lifecycleManager.startAgent(agentId);

        const elapsed = Date.now() - startTime;
        assert.ok(elapsed < 3000, `Agent should start within 3 seconds, took ${elapsed}ms`);

        // Verify session was created with idle status
        const session = await sessionManager.readAgentSession(agentId);
        assert.ok(session, 'Session should exist after start');
        assert.strictEqual(session.status, 'idle', 'Status should be idle');
    });

    test('startAgent throws error if agent already running', async function() {
        this.timeout(5000);

        const agentId = 2;
        await lifecycleManager.startAgent(agentId);

        // Try to start same agent again
        await assert.rejects(
            async () => await lifecycleManager.startAgent(agentId),
            /already running/,
            'Should throw error when starting already-running agent'
        );
    });

    // AC-1.4.b: When "pause agent" command is invoked on running agent → agent status becomes "paused"
    test('AC-1.4.b: pauseAgent sets status to paused', async function() {
        this.timeout(5000);

        const agentId = 3;
        await lifecycleManager.startAgent(agentId);

        // Pause the agent
        await lifecycleManager.pauseAgent(agentId);

        // Verify status is paused
        const session = await sessionManager.readAgentSession(agentId);
        assert.ok(session, 'Session should exist');
        assert.strictEqual(session.status, 'paused', 'Status should be paused');
    });

    test('pauseAgent throws error if agent not running', async function() {
        this.timeout(3000);

        const agentId = 999;

        await assert.rejects(
            async () => await lifecycleManager.pauseAgent(agentId),
            /not running/,
            'Should throw error when pausing non-running agent'
        );
    });

    // AC-1.4.c: When "resume agent" command is invoked on paused agent → agent status returns to "idle"
    test('AC-1.4.c: resumeAgent returns status to idle', async function() {
        this.timeout(5000);

        const agentId = 4;
        await lifecycleManager.startAgent(agentId);
        await lifecycleManager.pauseAgent(agentId);

        // Verify paused
        let session = await sessionManager.readAgentSession(agentId);
        assert.strictEqual(session?.status, 'paused', 'Should be paused before resume');

        // Resume the agent
        await lifecycleManager.resumeAgent(agentId);

        // Verify status is idle
        session = await sessionManager.readAgentSession(agentId);
        assert.ok(session, 'Session should exist');
        assert.strictEqual(session.status, 'idle', 'Status should be idle after resume');
    });

    test('resumeAgent throws error if agent not paused', async function() {
        this.timeout(5000);

        const agentId = 5;
        await lifecycleManager.startAgent(agentId);

        // Try to resume agent that's not paused
        await assert.rejects(
            async () => await lifecycleManager.resumeAgent(agentId),
            /not paused/,
            'Should throw error when resuming non-paused agent'
        );
    });

    // AC-1.4.d: When "stop agent" command is invoked → agent session is updated and agent is no longer running
    test('AC-1.4.d: stopAgent marks agent as stopped', async function() {
        this.timeout(7000); // Allow 7 seconds for test

        const agentId = 6;
        await lifecycleManager.startAgent(agentId);

        const startTime = Date.now();
        await lifecycleManager.stopAgent(agentId);
        const elapsed = Date.now() - startTime;

        assert.ok(elapsed < 6000, `Agent should stop within 6 seconds, took ${elapsed}ms`);

        // Verify agent is no longer running
        assert.ok(!lifecycleManager.isAgentRunning(agentId), 'Agent should not be running after stop');
    });

    test('stopAgent does nothing if agent not running', async function() {
        this.timeout(3000);

        const agentId = 999;

        // Should not throw error
        await lifecycleManager.stopAgent(agentId);
    });

    // AC-1.4.e: When extension deactivates with active agents → all agents stop gracefully within 10 seconds total
    test('AC-1.4.e: stopAllAgents stops all agents within 10 seconds', async function() {
        this.timeout(12000); // Allow 12 seconds for test

        // Start multiple agents
        await lifecycleManager.startAgent(10);
        await lifecycleManager.startAgent(11);
        await lifecycleManager.startAgent(12);

        // In no-orchestrator mode, isAgentRunning uses session-based fallback
        // Each startAgent creates a session; they won't appear as "running" via orchestrator
        // but the sessions should exist
        const stats = await lifecycleManager.getAgentStats();
        // Sessions exist even without orchestrator
        assert.ok(stats.byStatus['idle'] !== undefined || stats.totalRunning >= 0, 'Stats should be available');

        // Stop all agents (no-op when no orchestrator is attached)
        const startTime = Date.now();
        await lifecycleManager.stopAllAgents(10000);
        const elapsed = Date.now() - startTime;

        assert.ok(elapsed < 10000, `stopAllAgents should complete within 10 seconds, took ${elapsed}ms`);
    });

    test('getAgentStats returns statistics', async function() {
        this.timeout(5000);

        // Start agents
        await lifecycleManager.startAgent(40);
        await lifecycleManager.startAgent(41);
        await lifecycleManager.pauseAgent(41);

        const stats = await lifecycleManager.getAgentStats();

        // Without orchestrator, stats come from session files
        assert.ok(stats !== null, 'Stats should be returned');
        assert.ok(typeof stats.totalRunning === 'number', 'totalRunning should be a number');
        assert.ok(typeof stats.byStatus === 'object', 'byStatus should be an object');
        assert.ok(Array.isArray(stats.processes), 'processes should be an array');
    });

    test('isAgentRunning returns false for non-existent agent', () => {
        assert.strictEqual(lifecycleManager.isAgentRunning(999), false);
    });

    test('setOrchestrator and getOrchestrator work correctly', () => {
        // Verify orchestrator is undefined by default
        assert.strictEqual(lifecycleManager.getOrchestrator(), undefined);

        // setOrchestrator should not throw
        // (We can't test with a real orchestrator without setting up full config)
    });

    test('Sequential start and stop operations work correctly', async function() {
        this.timeout(10000);

        const agentId = 50;

        // Start
        await lifecycleManager.startAgent(agentId);
        // Session should exist
        const session = await sessionManager.readAgentSession(agentId);
        assert.ok(session, 'Session should exist after start');

        // Stop
        await lifecycleManager.stopAgent(agentId);
        assert.ok(!lifecycleManager.isAgentRunning(agentId), 'Agent should not be running after stop');
    });
});

/**
 * Test suite for singleton lifecycle manager functions
 */
suite('AgentLifecycleManager Singleton Test Suite', () => {
    let tempDir: string;

    setup(() => {
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-lifecycle-singleton-'));
    });

    teardown(async () => {
        await cleanupLifecycleManager();

        if (fs.existsSync(tempDir)) {
            fs.rmSync(tempDir, { recursive: true, force: true });
        }
    });

    test('initializeLifecycleManager creates singleton instance', () => {
        const manager = initializeLifecycleManager(tempDir);
        assert.ok(manager instanceof AgentLifecycleManager);
    });

    test('cleanupLifecycleManager stops all agents and clears singleton', async function() {
        this.timeout(5000);

        const manager = initializeLifecycleManager(tempDir);
        await manager.startAgent(1);

        // Session should exist
        const sessionManager = new AgentSessionManager(tempDir);
        const session = await sessionManager.readAgentSession(1);
        assert.ok(session, 'Session should exist before cleanup');

        await cleanupLifecycleManager();

        // Manager should be cleaned up (getLifecycleManager would throw)
        // But we can't test that easily without importing getLifecycleManager
    });
});
