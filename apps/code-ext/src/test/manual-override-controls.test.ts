import * as assert from 'assert';
import { ManualOverrideControls } from '../manual-override-controls';
import { AgentSession } from '../agent-session-manager';
import { ProjectClaim } from '../project-queue-manager';

suite('Manual Override Controls Test Suite', () => {
    let manualOverrideControls: ManualOverrideControls;
    let lifecycleManager: any;
    let sessionManager: any;
    let queueManager: any;
    let executor: any;
    let callLog: any[];

    setup(() => {
        callLog = [];

        // Create simple mock objects
        lifecycleManager = {
            isAgentRunning: (id: number) => {
                callLog.push({ method: 'isAgentRunning', args: [id] });
                return lifecycleManager._isAgentRunning ?? false;
            },
            pauseAgent: async (id: number) => {
                callLog.push({ method: 'pauseAgent', args: [id] });
                return lifecycleManager._pauseAgentReturn;
            },
            resumeAgent: async (id: number) => {
                callLog.push({ method: 'resumeAgent', args: [id] });
                return lifecycleManager._resumeAgentReturn;
            },
            stopAgent: async (id: number) => {
                callLog.push({ method: 'stopAgent', args: [id] });
                return lifecycleManager._stopAgentReturn;
            },
            stopAllAgents: async (timeout: number) => {
                callLog.push({ method: 'stopAllAgents', args: [timeout] });
                return lifecycleManager._stopAllAgentsReturn;
            },
            _isAgentRunning: false,
            _pauseAgentReturn: undefined,
            _resumeAgentReturn: undefined,
            _stopAgentReturn: undefined,
            _stopAllAgentsReturn: undefined
        };

        sessionManager = {
            readAgentSession: async (id: number) => {
                callLog.push({ method: 'readAgentSession', args: [id] });
                return sessionManager._readAgentSessionReturn;
            },
            listAgentSessions: async () => {
                callLog.push({ method: 'listAgentSessions', args: [] });
                return sessionManager._listAgentSessionsReturn ?? [];
            },
            updateAgentSession: async (id: number, updates: any) => {
                callLog.push({ method: 'updateAgentSession', args: [id, updates] });
                return sessionManager._updateAgentSessionReturn;
            },
            _readAgentSessionReturn: null,
            _listAgentSessionsReturn: [],
            _updateAgentSessionReturn: undefined
        };

        queueManager = {
            getClaimedProjects: async (agentId: string) => {
                callLog.push({ method: 'getClaimedProjects', args: [agentId] });
                return queueManager._getClaimedProjectsReturn ?? [];
            },
            releaseProjectClaim: async (projectNumber: number, issueNumber: number) => {
                callLog.push({ method: 'releaseProjectClaim', args: [projectNumber, issueNumber] });
                return queueManager._releaseProjectClaimReturn;
            },
            claimProject: async (projectNumber: number, issueNumber: number, agentId: string) => {
                callLog.push({ method: 'claimProject', args: [projectNumber, issueNumber, agentId] });
                return queueManager._claimProjectReturn ?? false;
            },
            _getClaimedProjectsReturn: [],
            _releaseProjectClaimReturn: undefined,
            _claimProjectReturn: false
        };

        executor = {
            stopExecutionLoop: (id: number) => {
                callLog.push({ method: 'stopExecutionLoop', args: [id] });
                return executor._stopExecutionLoopReturn;
            },
            _stopExecutionLoopReturn: undefined
        };

        manualOverrideControls = new ManualOverrideControls(
            lifecycleManager,
            sessionManager,
            queueManager,
            executor
        );
    });

    suite('pauseAgent', () => {
        test('AC-2.5.a: Pauses agent within 2 seconds', async () => {
            const mockSession: AgentSession = {
                agentId: 'agent-1',
                status: 'working',
                currentProjectNumber: 79,
                currentPhase: null,
                branchName: 'agent-1/project-1',
                lastHeartbeat: new Date().toISOString(),
                tasksCompleted: 0,
                currentTaskDescription: 'Test task',
                errorCount: 0,
                lastError: null
            };

            lifecycleManager._isAgentRunning = true;
            sessionManager._readAgentSessionReturn = mockSession;

            const startTime = Date.now();
            await manualOverrideControls.pauseAgent(1);
            const elapsed = Date.now() - startTime;

            assert.ok(elapsed < 2000, 'Pause operation should complete within 2 seconds');
            const pauseCalls = callLog.filter(c => c.method === 'pauseAgent');
            assert.strictEqual(pauseCalls.length, 1);
            assert.strictEqual(pauseCalls[0].args[0], 1);
        });

        test('AC-2.5.f: No-op when agent not running', async () => {
            lifecycleManager._isAgentRunning = false;

            await manualOverrideControls.pauseAgent(1);

            const pauseCalls = callLog.filter(c => c.method === 'pauseAgent');
            assert.strictEqual(pauseCalls.length, 0, 'Should not call pauseAgent when agent not running');
        });

        test('AC-2.5.f: No-op when agent already paused', async () => {
            const mockSession: AgentSession = {
                agentId: 'agent-1',
                status: 'paused',
                currentProjectNumber: null,
                currentPhase: null,
                branchName: null,
                lastHeartbeat: new Date().toISOString(),
                tasksCompleted: 0,
                currentTaskDescription: null,
                errorCount: 0,
                lastError: null
            };

            lifecycleManager._isAgentRunning = true;
            sessionManager._readAgentSessionReturn = mockSession;

            await manualOverrideControls.pauseAgent(1);

            const pauseCalls = callLog.filter(c => c.method === 'pauseAgent');
            assert.strictEqual(pauseCalls.length, 0, 'Should not call pauseAgent when already paused');
        });
    });

    suite('resumeAgent', () => {
        test('AC-2.5.b: Resumes paused agent to idle status', async () => {
            const mockSession: AgentSession = {
                agentId: 'agent-1',
                status: 'paused',
                currentProjectNumber: null,
                currentPhase: null,
                branchName: null,
                lastHeartbeat: new Date().toISOString(),
                tasksCompleted: 0,
                currentTaskDescription: null,
                errorCount: 0,
                lastError: null
            };

            lifecycleManager._isAgentRunning = true;
            sessionManager._readAgentSessionReturn = mockSession;

            await manualOverrideControls.resumeAgent(1);

            const resumeCalls = callLog.filter(c => c.method === 'resumeAgent');
            assert.strictEqual(resumeCalls.length, 1);
            assert.strictEqual(resumeCalls[0].args[0], 1);
        });

        test('AC-2.5.f: No-op when agent not paused', async () => {
            const mockSession: AgentSession = {
                agentId: 'agent-1',
                status: 'working',
                currentProjectNumber: 79,
                currentPhase: null,
                branchName: 'agent-1/project-1',
                lastHeartbeat: new Date().toISOString(),
                tasksCompleted: 0,
                currentTaskDescription: null,
                errorCount: 0,
                lastError: null
            };

            lifecycleManager._isAgentRunning = true;
            sessionManager._readAgentSessionReturn = mockSession;

            await manualOverrideControls.resumeAgent(1);

            const resumeCalls = callLog.filter(c => c.method === 'resumeAgent');
            assert.strictEqual(resumeCalls.length, 0, 'Should not resume non-paused agent');
        });
    });

    suite('stopAgent', () => {
        test('Stops agent and execution loop', async () => {
            lifecycleManager._isAgentRunning = true;

            await manualOverrideControls.stopAgent(1);

            const stopLoopCalls = callLog.filter(c => c.method === 'stopExecutionLoop');
            const stopAgentCalls = callLog.filter(c => c.method === 'stopAgent');

            assert.strictEqual(stopLoopCalls.length, 1);
            assert.strictEqual(stopAgentCalls.length, 1);
            assert.strictEqual(stopAgentCalls[0].args[0], 1);
        });

        test('AC-2.5.f: No-op when agent not running', async () => {
            lifecycleManager._isAgentRunning = false;

            await manualOverrideControls.stopAgent(1);

            const stopLoopCalls = callLog.filter(c => c.method === 'stopExecutionLoop');
            const stopAgentCalls = callLog.filter(c => c.method === 'stopAgent');

            assert.strictEqual(stopLoopCalls.length, 0);
            assert.strictEqual(stopAgentCalls.length, 0);
        });
    });

    suite('emergencyStopAll', () => {
        test('AC-2.5.c: Stops all agents within 5 seconds', async () => {
            const mockSessions: AgentSession[] = [
                {
                    agentId: 'agent-1',
                    status: 'working',
                    currentProjectNumber: 79,
                    currentPhase: null,
                    branchName: 'agent-1/project-1',
                    lastHeartbeat: new Date().toISOString(),
                    tasksCompleted: 0,
                    currentTaskDescription: null,
                    errorCount: 0,
                    lastError: null
                },
                {
                    agentId: 'agent-2',
                    status: 'idle',
                    currentProjectNumber: null,
                    currentPhase: null,
                    branchName: null,
                    lastHeartbeat: new Date().toISOString(),
                    tasksCompleted: 1,
                    currentTaskDescription: null,
                    errorCount: 0,
                    lastError: null
                }
            ];

            sessionManager._listAgentSessionsReturn = mockSessions;

            const startTime = Date.now();
            await manualOverrideControls.emergencyStopAll(true); // Skip confirmation
            const elapsed = Date.now() - startTime;

            assert.ok(elapsed < 5000, 'Emergency stop should complete within 5 seconds');

            const stopLoopCalls = callLog.filter(c => c.method === 'stopExecutionLoop');
            const stopAllCalls = callLog.filter(c => c.method === 'stopAllAgents');

            assert.strictEqual(stopLoopCalls.length, 2);
            assert.strictEqual(stopAllCalls.length, 1);
            assert.strictEqual(stopAllCalls[0].args[0], 5000);
        });
    });

    suite('reassignProject', () => {
        test('AC-2.5.d: Releases project claim and returns to queue', async () => {
            const mockSession: AgentSession = {
                agentId: 'agent-1',
                status: 'working',
                currentProjectNumber: 79,
                currentPhase: null,
                branchName: 'agent-1/project-1',
                lastHeartbeat: new Date().toISOString(),
                tasksCompleted: 0,
                currentTaskDescription: 'Working on issue #5',
                errorCount: 0,
                lastError: null
            };

            const mockClaim: ProjectClaim = {
                agentId: 'agent-1',
                claimedAt: new Date().toISOString(),
                projectNumber: 79,
                issueNumber: 5
            };

            sessionManager._readAgentSessionReturn = mockSession;
            queueManager._getClaimedProjectsReturn = [mockClaim];

            await manualOverrideControls.reassignProject(1);

            const releaseCalls = callLog.filter(c => c.method === 'releaseProjectClaim');
            const updateCalls = callLog.filter(c => c.method === 'updateAgentSession');
            const claimCalls = callLog.filter(c => c.method === 'claimProject');

            assert.strictEqual(releaseCalls.length, 1);
            assert.strictEqual(releaseCalls[0].args[0], 79);
            assert.strictEqual(releaseCalls[0].args[1], 5);
            assert.strictEqual(updateCalls.length, 1);
            assert.strictEqual(claimCalls.length, 0, 'Should not claim for new agent');
        });

        test('Reassigns project to new agent', async () => {
            const mockSession: AgentSession = {
                agentId: 'agent-1',
                status: 'working',
                currentProjectNumber: 79,
                currentPhase: null,
                branchName: 'agent-1/project-1',
                lastHeartbeat: new Date().toISOString(),
                tasksCompleted: 0,
                currentTaskDescription: 'Working on issue #5',
                errorCount: 0,
                lastError: null
            };

            const mockClaim: ProjectClaim = {
                agentId: 'agent-1',
                claimedAt: new Date().toISOString(),
                projectNumber: 79,
                issueNumber: 5
            };

            sessionManager._readAgentSessionReturn = mockSession;
            queueManager._getClaimedProjectsReturn = [mockClaim];
            queueManager._claimProjectReturn = true;

            await manualOverrideControls.reassignProject(1, 2);

            const releaseCalls = callLog.filter(c => c.method === 'releaseProjectClaim');
            const claimCalls = callLog.filter(c => c.method === 'claimProject');

            assert.strictEqual(releaseCalls.length, 1);
            assert.strictEqual(claimCalls.length, 1);
            assert.strictEqual(claimCalls[0].args[0], 79);
            assert.strictEqual(claimCalls[0].args[1], 5);
            assert.strictEqual(claimCalls[0].args[2], 'agent-2');
        });
    });

    suite('hasActiveWork', () => {
        test('Returns true when agent has active project', async () => {
            const mockSession: AgentSession = {
                agentId: 'agent-1',
                status: 'working',
                currentProjectNumber: 79,
                currentPhase: null,
                branchName: 'agent-1/project-1',
                lastHeartbeat: new Date().toISOString(),
                tasksCompleted: 0,
                currentTaskDescription: 'Working on issue #5',
                errorCount: 0,
                lastError: null
            };

            sessionManager._readAgentSessionReturn = mockSession;

            const result = await manualOverrideControls.hasActiveWork(1);

            assert.strictEqual(result, true);
        });

        test('Returns false when agent has no active project', async () => {
            const mockSession: AgentSession = {
                agentId: 'agent-1',
                status: 'idle',
                currentProjectNumber: null,
                currentPhase: null,
                branchName: null,
                lastHeartbeat: new Date().toISOString(),
                tasksCompleted: 0,
                currentTaskDescription: null,
                errorCount: 0,
                lastError: null
            };

            sessionManager._readAgentSessionReturn = mockSession;

            const result = await manualOverrideControls.hasActiveWork(1);

            assert.strictEqual(result, false);
        });
    });
});
