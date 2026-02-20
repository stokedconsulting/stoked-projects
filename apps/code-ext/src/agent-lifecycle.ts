import { AgentSessionManager } from './agent-session-manager';
import type { AgentOrchestrator } from '@stoked-projects/agent';

/**
 * Extended agent status including failure states
 */
export type AgentLifecycleStatus = 'idle' | 'working' | 'reviewing' | 'ideating' | 'paused' | 'stopped' | 'crashed' | 'failed';

/**
 * Process tracking information for an agent (retained for type compatibility)
 */
interface AgentProcess {
    agentId: number;
    startTime: Date;
}

/**
 * Agent Lifecycle Manager
 *
 * Manages agent lifecycle by delegating to AgentOrchestrator.
 * Previously spawned child processes; now delegates to the orchestrator
 * from @stoked-projects/agent which handles real agent loop management.
 */
export class AgentLifecycleManager {
    private sessionManager: AgentSessionManager;
    private workspaceRoot: string;
    private orchestrator: AgentOrchestrator | undefined;

    constructor(workspaceRoot: string, orchestrator?: AgentOrchestrator) {
        this.workspaceRoot = workspaceRoot;
        this.sessionManager = new AgentSessionManager(workspaceRoot);
        this.orchestrator = orchestrator;
    }

    /**
     * Set or update the AgentOrchestrator after construction.
     * Called when async orchestrator initialization completes.
     * @param orchestrator - The initialized AgentOrchestrator instance
     */
    public setOrchestrator(orchestrator: AgentOrchestrator): void {
        this.orchestrator = orchestrator;
        console.log('[AgentLifecycle] AgentOrchestrator set');
    }

    /**
     * Get the current AgentOrchestrator instance, if any.
     */
    public getOrchestrator(): AgentOrchestrator | undefined {
        return this.orchestrator;
    }

    /**
     * Start an agent by creating its session and delegating to orchestrator
     * @param agentId - Numeric identifier for the agent
     * @throws Error if agent is already running
     */
    public async startAgent(agentId: number): Promise<void> {
        console.log(`[AgentLifecycle] Starting agent-${agentId}...`);

        // Check if agent is already running
        if (this.isAgentRunning(agentId)) {
            throw new Error(`Agent ${agentId} is already running`);
        }

        try {
            // Create session file for dashboard compatibility
            await this.sessionManager.createAgentSession(agentId);
            console.log(`[AgentLifecycle] Session created for agent-${agentId}`);

            // Delegate to orchestrator: scale up by 1
            if (this.orchestrator) {
                const status = this.orchestrator.getStatus();
                this.orchestrator.setDesiredInstances(status.agents.length + 1);
                console.log(`[AgentLifecycle] Delegated agent-${agentId} start to orchestrator`);
            }

            console.log(`[AgentLifecycle] Agent-${agentId} started successfully`);
        } catch (error) {
            console.error(`[AgentLifecycle] Failed to start agent-${agentId}:`, error);

            try {
                await this.sessionManager.updateAgentSession(agentId, {
                    status: 'idle',
                    lastError: `Failed to start: ${error instanceof Error ? error.message : String(error)}`,
                    errorCount: 1
                });
            } catch (updateError) {
                console.error(`[AgentLifecycle] Failed to update session after start failure:`, updateError);
            }

            throw error;
        }
    }

    /**
     * Pause a running agent
     * Delegates to orchestrator, updates session status to 'paused'
     * @param agentId - Agent to pause
     * @throws Error if agent is not running or pause fails
     */
    public async pauseAgent(agentId: number): Promise<void> {
        console.log(`[AgentLifecycle] Pausing agent-${agentId}...`);

        if (!this.isAgentRunning(agentId)) {
            throw new Error(`Agent ${agentId} is not running`);
        }

        try {
            // Update session status first
            await this.sessionManager.updateAgentSession(agentId, {
                status: 'paused'
            });

            // Delegate to orchestrator
            if (this.orchestrator) {
                this.orchestrator.pauseAgent(agentId);
                console.log(`[AgentLifecycle] Delegated pause of agent-${agentId} to orchestrator`);
            } else {
                console.log(`[AgentLifecycle] Paused agent-${agentId} (no orchestrator attached)`);
            }

            console.log(`[AgentLifecycle] Agent-${agentId} paused successfully`);
        } catch (error) {
            console.error(`[AgentLifecycle] Failed to pause agent-${agentId}:`, error);
            throw error;
        }
    }

    /**
     * Resume a paused agent
     * Delegates to orchestrator, updates session status to 'idle'
     * @param agentId - Agent to resume
     * @throws Error if agent is not paused or resume fails
     */
    public async resumeAgent(agentId: number): Promise<void> {
        console.log(`[AgentLifecycle] Resuming agent-${agentId}...`);

        const session = await this.sessionManager.readAgentSession(agentId);
        if (!session) {
            throw new Error(`Agent ${agentId} session not found`);
        }

        if (session.status !== 'paused') {
            throw new Error(`Agent ${agentId} is not paused (current status: ${session.status})`);
        }

        try {
            // Delegate to orchestrator
            if (this.orchestrator) {
                this.orchestrator.resumeAgent(agentId);
                console.log(`[AgentLifecycle] Delegated resume of agent-${agentId} to orchestrator`);
            } else {
                console.log(`[AgentLifecycle] Resumed agent-${agentId} (no orchestrator attached)`);
            }

            // Update session status
            await this.sessionManager.updateAgentSession(agentId, {
                status: 'idle'
            });

            console.log(`[AgentLifecycle] Agent-${agentId} resumed successfully`);
        } catch (error) {
            console.error(`[AgentLifecycle] Failed to resume agent-${agentId}:`, error);
            throw error;
        }
    }

    /**
     * Stop an agent gracefully
     * Delegates to orchestrator via setDesiredInstances scale-down
     * @param agentId - Agent to stop
     * @throws Error if stop operation fails
     */
    public async stopAgent(agentId: number): Promise<void> {
        console.log(`[AgentLifecycle] Stopping agent-${agentId}...`);

        try {
            // Update session status
            const session = await this.sessionManager.readAgentSession(agentId);
            if (session) {
                await this.sessionManager.updateAgentSession(agentId, {
                    status: 'idle'
                });
            }

            // Delegate to orchestrator: scale down by 1
            if (this.orchestrator) {
                const status = this.orchestrator.getStatus();
                const newCount = Math.max(0, status.agents.length - 1);
                this.orchestrator.setDesiredInstances(newCount);
                console.log(`[AgentLifecycle] Delegated agent-${agentId} stop to orchestrator (new count: ${newCount})`);
            } else {
                console.log(`[AgentLifecycle] Agent-${agentId} is not running (no orchestrator)`);
            }

            console.log(`[AgentLifecycle] Agent-${agentId} stopped successfully`);
        } catch (error) {
            console.error(`[AgentLifecycle] Failed to stop agent-${agentId}:`, error);
            throw error;
        }
    }

    /**
     * Stop all running agents
     * Used during extension deactivation
     * @param timeoutMs - Maximum time to wait for all agents to stop (default: 10000ms)
     */
    public async stopAllAgents(timeoutMs: number = 10000): Promise<void> {
        const agentCount = this.orchestrator ? this.orchestrator.getStatus().agents.length : 0;
        console.log(`[AgentLifecycle] Stopping all agents (${agentCount} running)...`);

        if (agentCount === 0 && !this.orchestrator) {
            console.log(`[AgentLifecycle] No agents running`);
            return;
        }

        try {
            if (this.orchestrator) {
                // Delegate to orchestrator stop with timeout
                await Promise.race([
                    this.orchestrator.stop(),
                    new Promise((_, reject) =>
                        setTimeout(() => reject(new Error('Timeout stopping all agents')), timeoutMs)
                    )
                ]);
            }
            console.log(`[AgentLifecycle] All agents stopped successfully`);
        } catch (error) {
            console.error(`[AgentLifecycle] Error stopping all agents:`, error);
            // Attempt emergency stop if available
            if (this.orchestrator) {
                try {
                    await this.orchestrator.emergencyStop();
                } catch (emergencyError) {
                    console.error(`[AgentLifecycle] Emergency stop also failed:`, emergencyError);
                }
            }
        }
    }

    /**
     * Check if an agent is running via orchestrator status
     * @param agentId - Agent ID
     * @returns true if agent has an active entry in orchestrator
     */
    public isAgentRunning(agentId: number): boolean {
        if (this.orchestrator) {
            const status = this.orchestrator.getStatus();
            return status.agents.some(a => a.id === agentId);
        }
        return false;
    }

    /**
     * Get statistics about all running agents
     */
    public async getAgentStats(): Promise<{
        totalRunning: number;
        byStatus: Record<string, number>;
        processes: Array<{ agentId: number; pid: number | undefined; uptime: number }>;
    }> {
        if (this.orchestrator) {
            const status = this.orchestrator.getStatus();
            const byStatus: Record<string, number> = {};

            for (const agent of status.agents) {
                byStatus[agent.state] = (byStatus[agent.state] || 0) + 1;
            }

            return {
                totalRunning: status.agents.length,
                byStatus,
                processes: status.agents.map(a => ({ agentId: a.id, pid: undefined, uptime: 0 }))
            };
        }

        // Fallback: read from session files when no orchestrator is attached
        const sessions = await this.sessionManager.listAgentSessions();
        const byStatus: Record<string, number> = {};

        for (const session of sessions) {
            byStatus[session.status] = (byStatus[session.status] || 0) + 1;
        }

        return {
            totalRunning: 0,
            byStatus,
            processes: []
        };
    }
}

/**
 * Singleton instance for global access
 */
let lifecycleManager: AgentLifecycleManager | null = null;

/**
 * Initialize the lifecycle manager with workspace root
 * Should be called during extension activation
 */
export function initializeLifecycleManager(workspaceRoot: string): AgentLifecycleManager {
    lifecycleManager = new AgentLifecycleManager(workspaceRoot);
    return lifecycleManager;
}

/**
 * Get the singleton lifecycle manager instance
 * @throws Error if not initialized
 */
export function getLifecycleManager(): AgentLifecycleManager {
    if (!lifecycleManager) {
        throw new Error('AgentLifecycleManager not initialized. Call initializeLifecycleManager first.');
    }
    return lifecycleManager;
}

/**
 * Cleanup and reset the lifecycle manager
 * Should be called during extension deactivation
 */
export async function cleanupLifecycleManager(): Promise<void> {
    if (lifecycleManager) {
        await lifecycleManager.stopAllAgents(10000);
        lifecycleManager = null;
    }
}

// Export standalone functions for convenience
export async function startAgent(agentId: number): Promise<void> {
    return getLifecycleManager().startAgent(agentId);
}

export async function pauseAgent(agentId: number): Promise<void> {
    return getLifecycleManager().pauseAgent(agentId);
}

export async function resumeAgent(agentId: number): Promise<void> {
    return getLifecycleManager().resumeAgent(agentId);
}

export async function stopAgent(agentId: number): Promise<void> {
    return getLifecycleManager().stopAgent(agentId);
}

export async function stopAllAgents(): Promise<void> {
    return getLifecycleManager().stopAllAgents();
}

export function isAgentRunning(agentId: number): boolean {
    return getLifecycleManager().isAgentRunning(agentId);
}
