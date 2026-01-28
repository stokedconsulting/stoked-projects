"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
const assert = __importStar(require("assert"));
const manual_override_controls_1 = require("../manual-override-controls");
suite('Manual Override Controls Test Suite', () => {
    let manualOverrideControls;
    let lifecycleManager;
    let sessionManager;
    let queueManager;
    let executor;
    let callLog;
    setup(() => {
        callLog = [];
        // Create simple mock objects
        lifecycleManager = {
            isAgentRunning: (id) => {
                callLog.push({ method: 'isAgentRunning', args: [id] });
                return lifecycleManager._isAgentRunning ?? false;
            },
            pauseAgent: async (id) => {
                callLog.push({ method: 'pauseAgent', args: [id] });
                return lifecycleManager._pauseAgentReturn;
            },
            resumeAgent: async (id) => {
                callLog.push({ method: 'resumeAgent', args: [id] });
                return lifecycleManager._resumeAgentReturn;
            },
            stopAgent: async (id) => {
                callLog.push({ method: 'stopAgent', args: [id] });
                return lifecycleManager._stopAgentReturn;
            },
            stopAllAgents: async (timeout) => {
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
            readAgentSession: async (id) => {
                callLog.push({ method: 'readAgentSession', args: [id] });
                return sessionManager._readAgentSessionReturn;
            },
            listAgentSessions: async () => {
                callLog.push({ method: 'listAgentSessions', args: [] });
                return sessionManager._listAgentSessionsReturn ?? [];
            },
            updateAgentSession: async (id, updates) => {
                callLog.push({ method: 'updateAgentSession', args: [id, updates] });
                return sessionManager._updateAgentSessionReturn;
            },
            _readAgentSessionReturn: null,
            _listAgentSessionsReturn: [],
            _updateAgentSessionReturn: undefined
        };
        queueManager = {
            getClaimedProjects: async (agentId) => {
                callLog.push({ method: 'getClaimedProjects', args: [agentId] });
                return queueManager._getClaimedProjectsReturn ?? [];
            },
            releaseProjectClaim: async (projectNumber, issueNumber) => {
                callLog.push({ method: 'releaseProjectClaim', args: [projectNumber, issueNumber] });
                return queueManager._releaseProjectClaimReturn;
            },
            claimProject: async (projectNumber, issueNumber, agentId) => {
                callLog.push({ method: 'claimProject', args: [projectNumber, issueNumber, agentId] });
                return queueManager._claimProjectReturn ?? false;
            },
            _getClaimedProjectsReturn: [],
            _releaseProjectClaimReturn: undefined,
            _claimProjectReturn: false
        };
        executor = {
            stopExecutionLoop: (id) => {
                callLog.push({ method: 'stopExecutionLoop', args: [id] });
                return executor._stopExecutionLoopReturn;
            },
            _stopExecutionLoopReturn: undefined
        };
        manualOverrideControls = new manual_override_controls_1.ManualOverrideControls(lifecycleManager, sessionManager, queueManager, executor);
    });
    suite('pauseAgent', () => {
        test('AC-2.5.a: Pauses agent within 2 seconds', async () => {
            const mockSession = {
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
            const mockSession = {
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
            const mockSession = {
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
            const mockSession = {
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
            const mockSessions = [
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
            const mockSession = {
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
            const mockClaim = {
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
            const mockSession = {
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
            const mockClaim = {
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
            const mockSession = {
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
            const mockSession = {
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
//# sourceMappingURL=manual-override-controls.test.js.map