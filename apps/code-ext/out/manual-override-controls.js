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
exports.ManualOverrideControls = void 0;
exports.initializeManualOverrideControls = initializeManualOverrideControls;
exports.getManualOverrideControls = getManualOverrideControls;
exports.cleanupManualOverrideControls = cleanupManualOverrideControls;
exports.pauseAgent = pauseAgent;
exports.pauseAllAgents = pauseAllAgents;
exports.resumeAgent = resumeAgent;
exports.resumeAllAgents = resumeAllAgents;
exports.stopAgent = stopAgent;
exports.emergencyStopAll = emergencyStopAll;
exports.reassignProject = reassignProject;
const vscode = __importStar(require("vscode"));
/**
 * Manual Override Controls
 *
 * Provides user-facing controls for pausing, resuming, stopping, and reassigning agents.
 * All operations are idempotent and handle edge cases gracefully.
 *
 * Work Item 2.5: Manual Override Controls
 * - Pause/Resume single or all agents
 * - Stop single agent or emergency stop all
 * - Reassign projects between agents
 * - Confirmation dialogs for destructive operations
 */
class ManualOverrideControls {
    lifecycleManager;
    sessionManager;
    queueManager;
    executor;
    constructor(lifecycleManager, sessionManager, queueManager, executor) {
        this.lifecycleManager = lifecycleManager;
        this.sessionManager = sessionManager;
        this.queueManager = queueManager;
        this.executor = executor;
    }
    /**
     * Pause a single agent
     * Sets agent status to "paused", prevents new project claims.
     * Current work continues until next checkpoint.
     *
     * AC-2.5.a: When "Pause Agent" button is clicked → agent status becomes "paused" within 2 seconds
     * AC-2.5.f: When control operation is invoked on already-stopped agent → no-op with no error
     *
     * @param agentId - Numeric agent identifier
     * @returns Promise that resolves when pause completes
     */
    async pauseAgent(agentId) {
        try {
            console.log(`[ManualOverride] Pausing agent-${agentId}...`);
            // Check if agent is running
            if (!this.lifecycleManager.isAgentRunning(agentId)) {
                console.log(`[ManualOverride] Agent-${agentId} is not running, no-op`);
                return;
            }
            // Check current status
            const session = await this.sessionManager.readAgentSession(agentId);
            if (!session) {
                console.log(`[ManualOverride] Agent-${agentId} session not found, no-op`);
                return;
            }
            // Idempotency: already paused
            if (session.status === 'paused') {
                console.log(`[ManualOverride] Agent-${agentId} is already paused, no-op`);
                return;
            }
            // Pause via lifecycle manager
            await this.lifecycleManager.pauseAgent(agentId);
            console.log(`[ManualOverride] Agent-${agentId} paused successfully`);
        }
        catch (error) {
            console.error(`[ManualOverride] Failed to pause agent-${agentId}:`, error);
            throw error;
        }
    }
    /**
     * Pause all running agents
     * Pauses each agent in parallel for faster execution.
     *
     * @returns Promise that resolves when all agents are paused
     */
    async pauseAllAgents() {
        try {
            console.log('[ManualOverride] Pausing all agents...');
            // Get all active sessions
            const sessions = await this.sessionManager.listAgentSessions();
            if (sessions.length === 0) {
                console.log('[ManualOverride] No agents to pause');
                return;
            }
            // Extract numeric IDs and filter for running agents
            const agentIds = [];
            for (const session of sessions) {
                const match = session.agentId.match(/^agent-(\d+)$/);
                if (match) {
                    const numericId = parseInt(match[1], 10);
                    // Only include agents that are not already paused
                    if (session.status !== 'paused' && this.lifecycleManager.isAgentRunning(numericId)) {
                        agentIds.push(numericId);
                    }
                }
            }
            if (agentIds.length === 0) {
                console.log('[ManualOverride] No agents need to be paused');
                return;
            }
            // Pause all agents in parallel
            const pausePromises = agentIds.map(agentId => this.pauseAgent(agentId));
            await Promise.all(pausePromises);
            console.log(`[ManualOverride] Paused ${agentIds.length} agent(s)`);
        }
        catch (error) {
            console.error('[ManualOverride] Failed to pause all agents:', error);
            throw error;
        }
    }
    /**
     * Resume a paused agent
     * Sets agent status back to "idle" and resumes project claims.
     *
     * AC-2.5.b: When "Resume Agent" button is clicked on paused agent → agent status returns to "idle" and resumes
     * AC-2.5.f: When control operation is invoked on already-stopped agent → no-op with no error
     *
     * @param agentId - Numeric agent identifier
     * @returns Promise that resolves when resume completes
     */
    async resumeAgent(agentId) {
        try {
            console.log(`[ManualOverride] Resuming agent-${agentId}...`);
            // Check if agent is running
            if (!this.lifecycleManager.isAgentRunning(agentId)) {
                console.log(`[ManualOverride] Agent-${agentId} is not running, no-op`);
                return;
            }
            // Check current status
            const session = await this.sessionManager.readAgentSession(agentId);
            if (!session) {
                console.log(`[ManualOverride] Agent-${agentId} session not found, no-op`);
                return;
            }
            // Idempotency: not paused
            if (session.status !== 'paused') {
                console.log(`[ManualOverride] Agent-${agentId} is not paused (status: ${session.status}), no-op`);
                return;
            }
            // Resume via lifecycle manager
            await this.lifecycleManager.resumeAgent(agentId);
            console.log(`[ManualOverride] Agent-${agentId} resumed successfully`);
        }
        catch (error) {
            console.error(`[ManualOverride] Failed to resume agent-${agentId}:`, error);
            throw error;
        }
    }
    /**
     * Resume all paused agents
     * Resumes each agent in parallel for faster execution.
     *
     * @returns Promise that resolves when all agents are resumed
     */
    async resumeAllAgents() {
        try {
            console.log('[ManualOverride] Resuming all agents...');
            // Get all active sessions
            const sessions = await this.sessionManager.listAgentSessions();
            if (sessions.length === 0) {
                console.log('[ManualOverride] No agents to resume');
                return;
            }
            // Extract numeric IDs and filter for paused agents
            const agentIds = [];
            for (const session of sessions) {
                const match = session.agentId.match(/^agent-(\d+)$/);
                if (match) {
                    const numericId = parseInt(match[1], 10);
                    // Only include paused agents
                    if (session.status === 'paused' && this.lifecycleManager.isAgentRunning(numericId)) {
                        agentIds.push(numericId);
                    }
                }
            }
            if (agentIds.length === 0) {
                console.log('[ManualOverride] No agents need to be resumed');
                return;
            }
            // Resume all agents in parallel
            const resumePromises = agentIds.map(agentId => this.resumeAgent(agentId));
            await Promise.all(resumePromises);
            console.log(`[ManualOverride] Resumed ${agentIds.length} agent(s)`);
        }
        catch (error) {
            console.error('[ManualOverride] Failed to resume all agents:', error);
            throw error;
        }
    }
    /**
     * Stop a single agent gracefully
     * Sends SIGTERM, waits 5 seconds, then sends SIGKILL if still running.
     *
     * AC-2.5.f: When control operation is invoked on already-stopped agent → no-op with no error
     *
     * @param agentId - Numeric agent identifier
     * @returns Promise that resolves when stop completes
     */
    async stopAgent(agentId) {
        try {
            console.log(`[ManualOverride] Stopping agent-${agentId}...`);
            // Check if agent is running
            if (!this.lifecycleManager.isAgentRunning(agentId)) {
                console.log(`[ManualOverride] Agent-${agentId} is not running, no-op`);
                return;
            }
            // Stop the execution loop first (if running)
            this.executor.stopExecutionLoop(agentId);
            // Stop the agent process
            await this.lifecycleManager.stopAgent(agentId);
            console.log(`[ManualOverride] Agent-${agentId} stopped successfully`);
        }
        catch (error) {
            console.error(`[ManualOverride] Failed to stop agent-${agentId}:`, error);
            throw error;
        }
    }
    /**
     * Emergency stop all agents immediately
     * Shows confirmation dialog, then stops all agents with SIGKILL.
     *
     * AC-2.5.c: When "Emergency Stop All" is clicked → confirmation dialog appears, then all agents stop within 5 seconds
     * AC-2.5.f: When control operation is invoked on already-stopped agent → no-op with no error
     *
     * @param skipConfirmation - If true, skips confirmation dialog (for programmatic use)
     * @returns Promise that resolves when all agents are stopped
     */
    async emergencyStopAll(skipConfirmation = false) {
        try {
            console.log('[ManualOverride] Emergency stop all requested...');
            // Get all active sessions
            const sessions = await this.sessionManager.listAgentSessions();
            if (sessions.length === 0) {
                console.log('[ManualOverride] No agents to stop');
                return;
            }
            // Show confirmation dialog (unless skipped)
            if (!skipConfirmation) {
                const confirmation = await vscode.window.showWarningMessage(`Emergency stop all ${sessions.length} agent(s)? This will immediately terminate all running agents.`, { modal: true }, 'Yes, stop all', 'Cancel');
                if (confirmation !== 'Yes, stop all') {
                    console.log('[ManualOverride] Emergency stop cancelled by user');
                    return;
                }
            }
            console.log(`[ManualOverride] Emergency stopping ${sessions.length} agent(s)...`);
            // Stop all execution loops first
            for (const session of sessions) {
                const match = session.agentId.match(/^agent-(\d+)$/);
                if (match) {
                    const numericId = parseInt(match[1], 10);
                    this.executor.stopExecutionLoop(numericId);
                }
            }
            // Stop all agents via lifecycle manager (with 5 second timeout)
            await this.lifecycleManager.stopAllAgents(5000);
            console.log('[ManualOverride] All agents stopped successfully');
        }
        catch (error) {
            console.error('[ManualOverride] Failed to stop all agents:', error);
            throw error;
        }
    }
    /**
     * Reassign a project from one agent to another
     * Releases current agent's claim on project, optionally assigns to different agent.
     *
     * AC-2.5.d: When "Reassign Project" is selected → current agent's claim is released and project returns to queue
     * AC-2.5.e: When agent is paused while actively working → current work continues to next checkpoint before pausing
     *
     * @param agentId - Numeric agent identifier currently working on project
     * @param newAgentId - Optional numeric agent ID to assign to (if not provided, returns to queue)
     * @returns Promise that resolves when reassignment completes
     */
    async reassignProject(agentId, newAgentId) {
        try {
            console.log(`[ManualOverride] Reassigning project from agent-${agentId}...`);
            // Get current agent session to find project/issue
            const session = await this.sessionManager.readAgentSession(agentId);
            if (!session) {
                throw new Error(`Agent-${agentId} session not found`);
            }
            if (!session.currentProjectNumber) {
                throw new Error(`Agent-${agentId} is not currently working on a project`);
            }
            // Get all claims for this agent
            const claims = await this.queueManager.getClaimedProjects(`agent-${agentId}`);
            if (claims.length === 0) {
                throw new Error(`Agent-${agentId} has no active claims`);
            }
            // Release all claims (typically just one, but handle multiple)
            for (const claim of claims) {
                console.log(`[ManualOverride] Releasing claim for project ${claim.projectNumber}, issue ${claim.issueNumber}`);
                await this.queueManager.releaseProjectClaim(claim.projectNumber, claim.issueNumber);
                // If newAgentId provided, immediately claim for new agent
                if (newAgentId !== undefined) {
                    console.log(`[ManualOverride] Reassigning to agent-${newAgentId}: project ${claim.projectNumber}, issue ${claim.issueNumber}`);
                    const claimed = await this.queueManager.claimProject(claim.projectNumber, claim.issueNumber, `agent-${newAgentId}`);
                    if (!claimed) {
                        console.warn(`[ManualOverride] Failed to reassign to agent-${newAgentId}, project returned to queue`);
                    }
                }
            }
            // Update session to clear current project
            await this.sessionManager.updateAgentSession(agentId, {
                status: 'idle',
                currentProjectNumber: null,
                currentPhase: null,
                branchName: null,
                currentTaskDescription: null
            });
            if (newAgentId !== undefined) {
                console.log(`[ManualOverride] Successfully reassigned project from agent-${agentId} to agent-${newAgentId}`);
            }
            else {
                console.log(`[ManualOverride] Successfully released project from agent-${agentId}, returned to queue`);
            }
        }
        catch (error) {
            console.error(`[ManualOverride] Failed to reassign project:`, error);
            throw error;
        }
    }
    /**
     * Check if an agent is currently working on a project
     * Useful for determining if reassignment is possible.
     *
     * @param agentId - Numeric agent identifier
     * @returns Promise resolving to true if agent has active work
     */
    async hasActiveWork(agentId) {
        try {
            const session = await this.sessionManager.readAgentSession(agentId);
            if (!session) {
                return false;
            }
            return session.currentProjectNumber !== null;
        }
        catch (error) {
            console.error(`[ManualOverride] Failed to check active work for agent-${agentId}:`, error);
            return false;
        }
    }
    /**
     * Get summary of all agent statuses
     * Useful for dashboard displays.
     *
     * @returns Promise resolving to status summary
     */
    async getAgentStatusSummary() {
        try {
            const sessions = await this.sessionManager.listAgentSessions();
            const summary = {
                total: sessions.length,
                running: 0,
                paused: 0,
                idle: 0,
                working: 0
            };
            for (const session of sessions) {
                const match = session.agentId.match(/^agent-(\d+)$/);
                if (match) {
                    const numericId = parseInt(match[1], 10);
                    if (this.lifecycleManager.isAgentRunning(numericId)) {
                        summary.running++;
                    }
                    if (session.status === 'paused') {
                        summary.paused++;
                    }
                    else if (session.status === 'idle') {
                        summary.idle++;
                    }
                    else if (session.status === 'working') {
                        summary.working++;
                    }
                }
            }
            return summary;
        }
        catch (error) {
            console.error('[ManualOverride] Failed to get agent status summary:', error);
            return {
                total: 0,
                running: 0,
                paused: 0,
                idle: 0,
                working: 0
            };
        }
    }
}
exports.ManualOverrideControls = ManualOverrideControls;
/**
 * Singleton instance for global access
 */
let manualOverrideInstance = null;
/**
 * Initialize the manual override controls
 * Should be called during extension activation
 *
 * @param lifecycleManager - Agent lifecycle manager instance
 * @param sessionManager - Agent session manager instance
 * @param queueManager - Project queue manager instance
 * @param executor - Agent executor instance
 * @returns ManualOverrideControls instance
 */
function initializeManualOverrideControls(lifecycleManager, sessionManager, queueManager, executor) {
    manualOverrideInstance = new ManualOverrideControls(lifecycleManager, sessionManager, queueManager, executor);
    return manualOverrideInstance;
}
/**
 * Get the singleton manual override controls instance
 * @throws Error if not initialized
 */
function getManualOverrideControls() {
    if (!manualOverrideInstance) {
        throw new Error('ManualOverrideControls not initialized. Call initializeManualOverrideControls first.');
    }
    return manualOverrideInstance;
}
/**
 * Cleanup and reset the manual override controls
 * Should be called during extension deactivation
 */
function cleanupManualOverrideControls() {
    manualOverrideInstance = null;
}
// Export standalone functions for convenience
async function pauseAgent(agentId) {
    return getManualOverrideControls().pauseAgent(agentId);
}
async function pauseAllAgents() {
    return getManualOverrideControls().pauseAllAgents();
}
async function resumeAgent(agentId) {
    return getManualOverrideControls().resumeAgent(agentId);
}
async function resumeAllAgents() {
    return getManualOverrideControls().resumeAllAgents();
}
async function stopAgent(agentId) {
    return getManualOverrideControls().stopAgent(agentId);
}
async function emergencyStopAll(skipConfirmation = false) {
    return getManualOverrideControls().emergencyStopAll(skipConfirmation);
}
async function reassignProject(agentId, newAgentId) {
    return getManualOverrideControls().reassignProject(agentId, newAgentId);
}
//# sourceMappingURL=manual-override-controls.js.map