import * as vscode from 'vscode';
import { GenericPromptManager, GenericPrompt } from './generic-prompt-manager';
import { LlmActivityTracker } from './llm-activity-tracker';
import { getAgentConfig } from './agent-config';

export class AutoAssignmentEngine {
    private pollingInterval?: NodeJS.Timeout;
    private promptIndex = 0;
    private firstDispatchShown = false;
    private readonly POLL_INTERVAL = 30000; // 30 seconds

    constructor(
        private promptManager: GenericPromptManager,
        private activityTracker: LlmActivityTracker
    ) {}

    public start(): void {
        if (this.pollingInterval) return;

        this.pollingInterval = setInterval(() => {
            this.tick();
        }, this.POLL_INTERVAL);
    }

    public stop(): void {
        if (this.pollingInterval) {
            clearInterval(this.pollingInterval);
            this.pollingInterval = undefined;
        }
    }

    public dispose(): void {
        this.stop();
    }

    public isEnabled(): boolean {
        const config = vscode.workspace.getConfiguration('claudeProjects');
        return config.get<boolean>('autoAssignGenericPrompts', false);
    }

    public hasIdleCapacity(): boolean {
        const config = getAgentConfig();
        const active = this.activityTracker.getActiveSessionCount();
        return active < config.maxConcurrent;
    }

    private async tick(): Promise<void> {
        // Check if enabled
        if (!this.isEnabled()) return;

        // Check idle capacity
        const config = getAgentConfig();
        const active = this.activityTracker.getActiveSessionCount();
        const idle = config.maxConcurrent - active;
        if (idle <= 0) return;

        // Discover prompts
        const prompts = this.promptManager.discoverPrompts();
        if (prompts.length === 0) return;

        // Select next prompt (round-robin)
        const prompt = prompts[this.promptIndex % prompts.length];
        this.promptIndex++;

        // Dispatch
        await this.dispatch(prompt);
    }

    private async dispatch(prompt: GenericPrompt): Promise<void> {
        try {
            // Show first-time notification
            if (!this.firstDispatchShown) {
                this.firstDispatchShown = true;
                const action = await vscode.window.showInformationMessage(
                    'Auto-assignment is launching generic prompts to fill idle LLM capacity. Disable via settings.',
                    'Disable'
                );
                if (action === 'Disable') {
                    await vscode.workspace.getConfiguration('claudeProjects')
                        .update('autoAssignGenericPrompts', false, vscode.ConfigurationTarget.Workspace);
                    return;
                }
            }

            // Create terminal and dispatch
            const terminal = vscode.window.createTerminal({
                name: `Auto: ${prompt.filename}`,
                hideFromUser: false
            });
            terminal.sendText(`claude -p "$(cat '${prompt.filePath}')"`);
            terminal.show(false); // Don't steal focus

            // Mark dispatched
            this.promptManager.markDispatched(prompt);

            // Show notification
            vscode.window.showInformationMessage(`Auto-assigned: ${prompt.filename}`);
        } catch (error) {
            console.error('Auto-assignment dispatch error:', error);
        }
    }
}
