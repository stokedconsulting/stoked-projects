/**
 * @deprecated Agent execution now handled by @stoked-projects/agent package.
 * This file is retained for backward compatibility of type exports only.
 * See packages/agent/src/execution-agent.ts for the real implementation.
 */

/**
 * Result of a project execution
 * @deprecated Use ExecutionResult from @stoked-projects/agent
 */
export interface ExecutionResult {
    success: boolean;
    projectNumber: number;
    issueNumber: number;
    branchName: string;
    error?: string;
    duration: number;
}

/**
 * Current execution status for an agent
 * @deprecated Use AgentStatus from @stoked-projects/agent
 */
export interface ExecutionStatus {
    agentId: number;
    isExecuting: boolean;
    currentProject: number | null;
    currentIssue: number | null;
    startedAt: Date | null;
    error?: string;
}

// No-op stub class for backward compatibility
// Real execution is handled by AgentOrchestrator via @stoked-projects/agent
export class AgentExecutor {
    constructor(_workspaceRoot: string, _githubApi: any, _projectId: string) {
        // No-op: execution delegated to AgentOrchestrator
    }

    public async startExecutionLoop(_agentId: number): Promise<void> { /* no-op */ }
    public stopExecutionLoop(_agentId: number): void { /* no-op */ }
    public async executeProject(_agentId: number, _projectNumber: number, _issueNumber: number): Promise<ExecutionResult> {
        return { success: false, projectNumber: 0, issueNumber: 0, branchName: '', error: 'Deprecated: use AgentOrchestrator', duration: 0 };
    }
    public getExecutionStatus(agentId: number): ExecutionStatus {
        return { agentId, isExecuting: false, currentProject: null, currentIssue: null, startedAt: null };
    }
    public isAgentExecuting(_agentId: number): boolean { return false; }
    public getExecutionStats(): { totalExecuting: number; agents: Array<any> } {
        return { totalExecuting: 0, agents: [] };
    }
}

/** @deprecated */
export function initializeAgentExecutor(_workspaceRoot: string, _githubApi: any, _projectId: string): AgentExecutor {
    return new AgentExecutor(_workspaceRoot, _githubApi, _projectId);
}

/** @deprecated */
export function getAgentExecutor(): AgentExecutor {
    return new AgentExecutor('', null, '');
}

/** @deprecated */
export function cleanupAgentExecutor(): void { /* no-op */ }
