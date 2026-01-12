import * as vscode from 'vscode';
import {
    ProjectFlowSession,
    FlowPhase,
    ExtractedInput,
    DesignIterationState,
    ProjectCreationConfig,
    ProjectFlowPreferences,
    ProjectCreationResult
} from './project-flow-types';

/**
 * Generate a simple UUID v4
 */
function generateUUID(): string {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
        const r = (Math.random() * 16) | 0;
        const v = c === 'x' ? r : (r & 0x3) | 0x8;
        return v.toString(16);
    });
}

/**
 * Manages the state and orchestration of the project creation flow
 */
export class ProjectFlowManager {
    private currentSession?: ProjectFlowSession;
    private preferences: ProjectFlowPreferences;

    constructor(private context: vscode.ExtensionContext) {
        // Load preferences from extension storage
        this.preferences = context.globalState.get('projectFlowPreferences') || {
            skipProductReview: false,
            defaultVisibility: 'private'
        };
    }

    /**
     * Start a new project flow session
     */
    public startSession(): string {
        const sessionId = generateUUID();
        this.currentSession = {
            sessionId,
            startedAt: new Date(),
            currentPhase: 'input',
            input: { type: 'text', content: '' },
            designIterations: {
                iterations: [],
                currentResult: '',
                userPreferences: {
                    skipProductReview: this.preferences.skipProductReview
                }
            }
        };

        return sessionId;
    }

    /**
     * Get current session
     */
    public getCurrentSession(): ProjectFlowSession | undefined {
        return this.currentSession;
    }

    /**
     * Update current phase
     */
    public setPhase(phase: FlowPhase): void {
        if (!this.currentSession) {
            throw new Error('No active session');
        }
        this.currentSession.currentPhase = phase;
    }

    /**
     * Store extracted input
     */
    public setInput(input: ExtractedInput): void {
        if (!this.currentSession) {
            throw new Error('No active session');
        }
        this.currentSession.input = input;
    }

    /**
     * Add design iteration
     */
    public addDesignIteration(prompt: string, result: string): void {
        if (!this.currentSession) {
            throw new Error('No active session');
        }
        this.currentSession.designIterations.iterations.push({
            prompt,
            result,
            timestamp: new Date()
        });
        this.currentSession.designIterations.currentResult = result;
    }

    /**
     * Set skip product review preference
     */
    public setSkipProductReview(skip: boolean): void {
        if (!this.currentSession) {
            throw new Error('No active session');
        }
        this.currentSession.designIterations.userPreferences.skipProductReview = skip;

        // Save to global preferences
        this.preferences.skipProductReview = skip;
        this.context.globalState.update('projectFlowPreferences', this.preferences);
    }

    /**
     * Set project creation configuration
     */
    public setFinalConfig(config: ProjectCreationConfig): void {
        if (!this.currentSession) {
            throw new Error('No active session');
        }
        this.currentSession.finalConfig = config;
    }

    /**
     * Get preferences
     */
    public getPreferences(): ProjectFlowPreferences {
        return this.preferences;
    }

    /**
     * Update last used repo
     */
    public updateLastUsedRepo(owner: string, name: string): void {
        this.preferences.lastUsedRepo = { owner, name };
        this.context.globalState.update('projectFlowPreferences', this.preferences);
    }

    /**
     * Clear current session
     */
    public clearSession(): void {
        this.currentSession = undefined;
    }

    /**
     * Get session state for persistence
     */
    public getSessionState(): any {
        return this.currentSession;
    }

    /**
     * Restore session from state
     */
    public restoreSession(state: any): void {
        this.currentSession = state;
    }
}
