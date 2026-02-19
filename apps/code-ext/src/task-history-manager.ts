import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

export interface TaskHistoryEntry {
    id: string;
    timestamp: Date;
    command: string;
    projectNumber?: number;
    phaseNumber?: number;
    itemNumber?: string;
    prompt: string;
    response?: string;
    subagentResponses?: {
        agentId: string;
        response: string;
        timestamp: Date;
    }[];
    status: 'pending' | 'completed' | 'failed';
    error?: string;
}

export class TaskHistoryManager {
    private history: TaskHistoryEntry[] = [];
    private readonly maxHistorySize = 100;
    private readonly storageKey = 'claudeProjects.taskHistory';
    private outputChannel: vscode.OutputChannel;

    constructor(
        private context: vscode.ExtensionContext,
        outputChannel: vscode.OutputChannel
    ) {
        this.outputChannel = outputChannel;
        this.outputChannel.appendLine(`[Task History] Initializing TaskHistoryManager...`);
        this.outputChannel.appendLine(`[Task History] Storage key: ${this.storageKey}`);
        this.outputChannel.appendLine(`[Task History] Max history size: ${this.maxHistorySize}`);
        this.loadHistory();
    }

    /**
     * Load history from workspace state
     */
    private loadHistory(): void {
        try {
            this.outputChannel.appendLine(`[Task History] Loading history from workspaceState...`);
            const saved = this.context.workspaceState.get<TaskHistoryEntry[]>(this.storageKey, []);
            this.outputChannel.appendLine(`[Task History] Raw entries from storage: ${saved.length}`);

            // Convert timestamp strings back to Date objects
            this.history = saved.map(entry => ({
                ...entry,
                timestamp: new Date(entry.timestamp),
                subagentResponses: entry.subagentResponses?.map(sub => ({
                    ...sub,
                    timestamp: new Date(sub.timestamp)
                }))
            }));

            this.outputChannel.appendLine(`[Task History] Loaded ${this.history.length} entries`);
            if (this.history.length > 0) {
                const stats = this.getStatistics();
                this.outputChannel.appendLine(`[Task History]   completed=${stats.completed}, pending=${stats.pending}, failed=${stats.failed}`);
                const newest = this.history[0];
                this.outputChannel.appendLine(`[Task History]   Most recent: "${newest.command}" (${newest.status}) at ${newest.timestamp.toISOString()}`);
            }
        } catch (error) {
            this.outputChannel.appendLine(`[Task History] ERROR loading history: ${error}`);
            this.history = [];
        }
    }

    /**
     * Save history to workspace state
     */
    private async saveHistory(): Promise<void> {
        try {
            await this.context.workspaceState.update(this.storageKey, this.history);
            this.outputChannel.appendLine(`[Task History] Saved ${this.history.length} entries to workspaceState`);
        } catch (error) {
            this.outputChannel.appendLine(`[Task History] ERROR saving history: ${error}`);
        }
    }

    /**
     * Add a new task to history
     */
    async addTask(
        command: string,
        prompt: string,
        options?: {
            projectNumber?: number;
            phaseNumber?: number;
            itemNumber?: string;
        }
    ): Promise<string> {
        const id = `task-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

        const entry: TaskHistoryEntry = {
            id,
            timestamp: new Date(),
            command,
            prompt,
            projectNumber: options?.projectNumber,
            phaseNumber: options?.phaseNumber,
            itemNumber: options?.itemNumber,
            status: 'pending',
            subagentResponses: []
        };

        this.history.unshift(entry); // Add to beginning (most recent first)

        // Trim history if too large
        if (this.history.length > this.maxHistorySize) {
            this.history = this.history.slice(0, this.maxHistorySize);
        }

        await this.saveHistory();
        this.outputChannel.appendLine(`[Task History] Added task: ${id} - ${command}`);

        return id;
    }

    /**
     * Update task with response
     */
    async updateTaskResponse(taskId: string, response: string, status: 'completed' | 'failed', error?: string): Promise<void> {
        const entry = this.history.find(e => e.id === taskId);
        if (!entry) {
            this.outputChannel.appendLine(`[Task History] Task not found: ${taskId}`);
            return;
        }

        entry.response = response;
        entry.status = status;
        if (error) {
            entry.error = error;
        }

        await this.saveHistory();
        this.outputChannel.appendLine(`[Task History] Updated task: ${taskId} - ${status}`);
    }

    /**
     * Add subagent response to a task
     */
    async addSubagentResponse(taskId: string, agentId: string, response: string): Promise<void> {
        const entry = this.history.find(e => e.id === taskId);
        if (!entry) {
            this.outputChannel.appendLine(`[Task History] Task not found: ${taskId}`);
            return;
        }

        if (!entry.subagentResponses) {
            entry.subagentResponses = [];
        }

        entry.subagentResponses.push({
            agentId,
            response,
            timestamp: new Date()
        });

        await this.saveHistory();
        this.outputChannel.appendLine(`[Task History] Added subagent response to task: ${taskId}`);
    }

    /**
     * Get all history entries
     */
    getHistory(): TaskHistoryEntry[] {
        return [...this.history]; // Return copy
    }

    /**
     * Get history for a specific project
     */
    getProjectHistory(projectNumber: number): TaskHistoryEntry[] {
        return this.history.filter(e => e.projectNumber === projectNumber);
    }

    /**
     * Clear all history
     */
    async clearHistory(): Promise<void> {
        this.history = [];
        await this.saveHistory();
        this.outputChannel.appendLine('[Task History] Cleared all history');
    }

    /**
     * Export history as JSON
     */
    exportHistory(): string {
        return JSON.stringify(this.history, null, 2);
    }

    /**
     * Get statistics
     */
    getStatistics(): {
        total: number;
        completed: number;
        pending: number;
        failed: number;
    } {
        return {
            total: this.history.length,
            completed: this.history.filter(e => e.status === 'completed').length,
            pending: this.history.filter(e => e.status === 'pending').length,
            failed: this.history.filter(e => e.status === 'failed').length
        };
    }
}
