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
exports.AgentDashboardProvider = void 0;
const vscode = __importStar(require("vscode"));
const agent_config_1 = require("./agent-config");
/**
 * Agent Dashboard Provider
 *
 * Provides a webview panel displaying real-time agent status and controls.
 * Updates automatically every 2 seconds via polling.
 */
class AgentDashboardProvider {
    _extensionUri;
    _context;
    static viewType = 'claudeProjects.agentDashboard';
    _view;
    _updateInterval;
    _sessionManager;
    _heartbeatManager;
    _lifecycleManager;
    _manualOverrideControls;
    _activityTracker;
    constructor(_extensionUri, _context, sessionManager, heartbeatManager, lifecycleManager, manualOverrideControls, activityTracker) {
        this._extensionUri = _extensionUri;
        this._context = _context;
        this._sessionManager = sessionManager;
        this._heartbeatManager = heartbeatManager;
        this._lifecycleManager = lifecycleManager;
        this._manualOverrideControls = manualOverrideControls;
        this._activityTracker = activityTracker;
    }
    resolveWebviewView(webviewView, context, _token) {
        this._view = webviewView;
        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [this._extensionUri]
        };
        webviewView.webview.html = this._getHtmlForWebview(webviewView.webview);
        // Handle messages from webview
        webviewView.webview.onDidReceiveMessage(async (data) => {
            switch (data.type) {
                case 'refresh':
                    await this.updateDashboard();
                    break;
                case 'pauseAgent':
                    await this.handlePauseAgent(data.agentId);
                    break;
                case 'pauseAll':
                    await this.handlePauseAll();
                    break;
                case 'resumeAgent':
                    await this.handleResumeAgent(data.agentId);
                    break;
                case 'resumeAll':
                    await this.handleResumeAll();
                    break;
                case 'stopAgent':
                    await this.handleStopAgent(data.agentId);
                    break;
                case 'reassignProject':
                    await this.handleReassignProject(data.agentId, data.newAgentId);
                    break;
                case 'addAgent':
                    await this.handleAddAgent();
                    break;
                case 'emergencyStopAll':
                    await this.handleEmergencyStopAll();
                    break;
                case 'clearActivity':
                    await this.handleClearActivity();
                    break;
            }
        });
        // Start auto-refresh when view becomes visible
        webviewView.onDidChangeVisibility(() => {
            if (webviewView.visible) {
                this.startAutoRefresh();
            }
            else {
                this.stopAutoRefresh();
            }
        });
        // Initial update
        this.updateDashboard();
        // Start auto-refresh if view is visible
        if (webviewView.visible) {
            this.startAutoRefresh();
        }
    }
    /**
     * Start auto-refresh interval (every 2 seconds)
     */
    startAutoRefresh() {
        if (this._updateInterval) {
            return; // Already running
        }
        console.log('[AgentDashboard] Starting auto-refresh (2s interval)');
        this._updateInterval = setInterval(() => {
            void this.updateDashboard();
        }, 2000);
    }
    /**
     * Stop auto-refresh interval
     */
    stopAutoRefresh() {
        if (this._updateInterval) {
            console.log('[AgentDashboard] Stopping auto-refresh');
            clearInterval(this._updateInterval);
            this._updateInterval = undefined;
        }
    }
    /**
     * Update dashboard with current agent data
     */
    async updateDashboard() {
        if (!this._view) {
            return;
        }
        try {
            // Get all agent sessions
            const sessions = await this._sessionManager.listAgentSessions();
            // Get health status for each agent
            const healthStatuses = await this._heartbeatManager.getAllAgentHealthStatuses();
            // Get config for max concurrent agents
            const config = (0, agent_config_1.getAgentConfig)();
            // Get recent activity
            const recentActivity = this._activityTracker.getRecentActivity(50);
            // Get cost tracking data (mock for now - can be replaced with actual cost tracking)
            const costData = this.getCostData();
            // Build dashboard data
            const dashboardData = {
                totalAgents: sessions.length,
                maxConcurrent: config.maxConcurrent,
                agents: sessions.map(session => {
                    // Extract numeric agent ID from "agent-N" format
                    const agentIdMatch = session.agentId.match(/^agent-(\d+)$/);
                    const numericAgentId = agentIdMatch ? parseInt(agentIdMatch[1], 10) : 0;
                    const healthStatus = healthStatuses.get(numericAgentId);
                    // Calculate elapsed time
                    const lastHeartbeat = new Date(session.lastHeartbeat);
                    const elapsedMs = Date.now() - lastHeartbeat.getTime();
                    // Calculate progress (mock - can be enhanced with actual task tracking)
                    const progress = this.calculateAgentProgress(session);
                    return {
                        agentId: session.agentId,
                        numericAgentId,
                        status: session.status,
                        healthStatus: healthStatus?.status || 'unresponsive',
                        currentProjectNumber: session.currentProjectNumber,
                        currentPhase: session.currentPhase,
                        currentTaskDescription: session.currentTaskDescription,
                        tasksCompleted: session.tasksCompleted,
                        elapsedMs,
                        lastError: session.lastError,
                        errorCount: session.errorCount,
                        isRunning: this._lifecycleManager.isAgentRunning(numericAgentId),
                        progress
                    };
                }),
                counts: this.calculateStatusCounts(sessions, healthStatuses),
                recentActivity,
                costData
            };
            // Send update to webview
            this._view.webview.postMessage({
                type: 'updateDashboard',
                data: dashboardData
            });
        }
        catch (error) {
            console.error('[AgentDashboard] Failed to update dashboard:', error);
            this._view?.webview.postMessage({
                type: 'error',
                message: `Failed to update dashboard: ${error instanceof Error ? error.message : String(error)}`
            });
        }
    }
    /**
     * Calculate counts by status
     */
    calculateStatusCounts(sessions, healthStatuses) {
        const counts = {
            working: 0,
            idle: 0,
            reviewing: 0,
            ideating: 0,
            paused: 0,
            unresponsive: 0
        };
        for (const session of sessions) {
            // Extract numeric agent ID
            const agentIdMatch = session.agentId.match(/^agent-(\d+)$/);
            const numericAgentId = agentIdMatch ? parseInt(agentIdMatch[1], 10) : 0;
            const healthStatus = healthStatuses.get(numericAgentId);
            if (healthStatus?.status === 'unresponsive') {
                counts.unresponsive++;
            }
            else {
                counts[session.status]++;
            }
        }
        return counts;
    }
    /**
     * Handle pause agent request
     */
    async handlePauseAgent(agentId) {
        try {
            // Extract numeric ID
            const match = agentId.match(/^agent-(\d+)$/);
            if (!match) {
                throw new Error('Invalid agent ID format');
            }
            const numericAgentId = parseInt(match[1], 10);
            await this._lifecycleManager.pauseAgent(numericAgentId);
            vscode.window.showInformationMessage(`Agent ${agentId} paused`);
            await this.updateDashboard();
        }
        catch (error) {
            console.error('[AgentDashboard] Failed to pause agent:', error);
            vscode.window.showErrorMessage(`Failed to pause agent: ${error instanceof Error ? error.message : String(error)}`);
        }
    }
    /**
     * Handle resume agent request
     */
    async handleResumeAgent(agentId) {
        try {
            // Extract numeric ID
            const match = agentId.match(/^agent-(\d+)$/);
            if (!match) {
                throw new Error('Invalid agent ID format');
            }
            const numericAgentId = parseInt(match[1], 10);
            await this._lifecycleManager.resumeAgent(numericAgentId);
            vscode.window.showInformationMessage(`Agent ${agentId} resumed`);
            await this.updateDashboard();
        }
        catch (error) {
            console.error('[AgentDashboard] Failed to resume agent:', error);
            vscode.window.showErrorMessage(`Failed to resume agent: ${error instanceof Error ? error.message : String(error)}`);
        }
    }
    /**
     * Handle stop agent request
     */
    async handleStopAgent(agentId) {
        try {
            const confirmation = await vscode.window.showWarningMessage(`Stop ${agentId}?`, { modal: true }, 'Stop');
            if (confirmation !== 'Stop') {
                return;
            }
            // Extract numeric ID
            const match = agentId.match(/^agent-(\d+)$/);
            if (!match) {
                throw new Error('Invalid agent ID format');
            }
            const numericAgentId = parseInt(match[1], 10);
            await this._lifecycleManager.stopAgent(numericAgentId);
            vscode.window.showInformationMessage(`Agent ${agentId} stopped`);
            await this.updateDashboard();
        }
        catch (error) {
            console.error('[AgentDashboard] Failed to stop agent:', error);
            vscode.window.showErrorMessage(`Failed to stop agent: ${error instanceof Error ? error.message : String(error)}`);
        }
    }
    /**
     * Handle add agent request
     */
    async handleAddAgent() {
        try {
            const config = (0, agent_config_1.getAgentConfig)();
            const sessions = await this._sessionManager.listAgentSessions();
            if (sessions.length >= config.maxConcurrent) {
                vscode.window.showWarningMessage(`Cannot add agent: Maximum concurrent agents (${config.maxConcurrent}) reached`);
                return;
            }
            // Find next available agent ID
            const existingIds = sessions.map(s => {
                const match = s.agentId.match(/^agent-(\d+)$/);
                return match ? parseInt(match[1], 10) : 0;
            });
            const nextId = Math.max(0, ...existingIds) + 1;
            // Start the new agent
            await this._lifecycleManager.startAgent(nextId);
            this._heartbeatManager.startHeartbeat(nextId);
            vscode.window.showInformationMessage(`Agent agent-${nextId} created`);
            await this.updateDashboard();
        }
        catch (error) {
            console.error('[AgentDashboard] Failed to add agent:', error);
            vscode.window.showErrorMessage(`Failed to add agent: ${error instanceof Error ? error.message : String(error)}`);
        }
    }
    /**
     * Handle pause all agents request
     */
    async handlePauseAll() {
        try {
            const sessions = await this._sessionManager.listAgentSessions();
            if (sessions.length === 0) {
                vscode.window.showInformationMessage('No agents running');
                return;
            }
            // Show progress
            await vscode.window.withProgress({
                location: vscode.ProgressLocation.Notification,
                title: 'Pausing all agents...',
                cancellable: false
            }, async (progress) => {
                await this._manualOverrideControls.pauseAllAgents();
            });
            vscode.window.showInformationMessage('All agents paused');
            await this.updateDashboard();
        }
        catch (error) {
            console.error('[AgentDashboard] Failed to pause all agents:', error);
            vscode.window.showErrorMessage(`Failed to pause all agents: ${error instanceof Error ? error.message : String(error)}`);
        }
    }
    /**
     * Handle resume all agents request
     */
    async handleResumeAll() {
        try {
            const sessions = await this._sessionManager.listAgentSessions();
            if (sessions.length === 0) {
                vscode.window.showInformationMessage('No agents running');
                return;
            }
            // Show progress
            await vscode.window.withProgress({
                location: vscode.ProgressLocation.Notification,
                title: 'Resuming all agents...',
                cancellable: false
            }, async (progress) => {
                await this._manualOverrideControls.resumeAllAgents();
            });
            vscode.window.showInformationMessage('All agents resumed');
            await this.updateDashboard();
        }
        catch (error) {
            console.error('[AgentDashboard] Failed to resume all agents:', error);
            vscode.window.showErrorMessage(`Failed to resume all agents: ${error instanceof Error ? error.message : String(error)}`);
        }
    }
    /**
     * Handle reassign project request
     */
    async handleReassignProject(agentId, newAgentId) {
        try {
            // Extract numeric ID for current agent
            const match = agentId.match(/^agent-(\d+)$/);
            if (!match) {
                throw new Error('Invalid agent ID format');
            }
            const numericAgentId = parseInt(match[1], 10);
            // Extract numeric ID for new agent (if provided)
            let numericNewAgentId;
            if (newAgentId) {
                const newMatch = newAgentId.match(/^agent-(\d+)$/);
                if (newMatch) {
                    numericNewAgentId = parseInt(newMatch[1], 10);
                }
            }
            // Check if agent has active work
            const hasWork = await this._manualOverrideControls.hasActiveWork(numericAgentId);
            if (!hasWork) {
                vscode.window.showWarningMessage(`Agent ${agentId} is not currently working on a project`);
                return;
            }
            const confirmation = await vscode.window.showWarningMessage(numericNewAgentId !== undefined
                ? `Reassign project from ${agentId} to agent-${numericNewAgentId}?`
                : `Release project from ${agentId} and return to queue?`, { modal: true }, 'Reassign');
            if (confirmation !== 'Reassign') {
                return;
            }
            await this._manualOverrideControls.reassignProject(numericAgentId, numericNewAgentId);
            if (numericNewAgentId !== undefined) {
                vscode.window.showInformationMessage(`Project reassigned from ${agentId} to agent-${numericNewAgentId}`);
            }
            else {
                vscode.window.showInformationMessage(`Project released from ${agentId}, returned to queue`);
            }
            await this.updateDashboard();
        }
        catch (error) {
            console.error('[AgentDashboard] Failed to reassign project:', error);
            vscode.window.showErrorMessage(`Failed to reassign project: ${error instanceof Error ? error.message : String(error)}`);
        }
    }
    /**
     * Handle emergency stop all request
     */
    async handleEmergencyStopAll() {
        try {
            const sessions = await this._sessionManager.listAgentSessions();
            if (sessions.length === 0) {
                vscode.window.showInformationMessage('No agents running');
                return;
            }
            // Show progress
            await vscode.window.withProgress({
                location: vscode.ProgressLocation.Notification,
                title: 'Stopping all agents...',
                cancellable: false
            }, async (progress) => {
                // Use manual override controls for emergency stop (includes confirmation)
                await this._manualOverrideControls.emergencyStopAll(true); // skip confirmation, we already showed one
                this._heartbeatManager.stopAllHeartbeats();
            });
            vscode.window.showInformationMessage('All agents stopped');
            await this.updateDashboard();
        }
        catch (error) {
            console.error('[AgentDashboard] Failed to stop all agents:', error);
            vscode.window.showErrorMessage(`Failed to stop all agents: ${error instanceof Error ? error.message : String(error)}`);
        }
    }
    /**
     * Handle clear activity request
     */
    async handleClearActivity() {
        try {
            this._activityTracker.clearOldActivity();
            vscode.window.showInformationMessage('Activity log cleared');
            await this.updateDashboard();
        }
        catch (error) {
            console.error('[AgentDashboard] Failed to clear activity:', error);
            vscode.window.showErrorMessage(`Failed to clear activity: ${error instanceof Error ? error.message : String(error)}`);
        }
    }
    /**
     * Calculate agent progress for current task
     */
    calculateAgentProgress(session) {
        // If agent is idle or paused, no progress
        if (session.status === 'idle' || session.status === 'paused') {
            return {
                current: 0,
                total: 0,
                percentage: 0,
                description: session.status === 'paused' ? 'Paused' : 'Idle'
            };
        }
        // For reviewing, estimate based on review criteria (typically 5 criteria)
        if (session.status === 'reviewing') {
            // Mock progress - in real implementation, this would come from review state
            return {
                current: 3,
                total: 5,
                percentage: 60,
                description: 'Reviewing (3 of 5 criteria)'
            };
        }
        // For working/ideating, estimate based on phase
        // Phases typically go: 1-4, so we can estimate progress
        if (session.currentPhase) {
            const phaseMatch = session.currentPhase.match(/(\d+)/);
            if (phaseMatch) {
                const currentPhase = parseInt(phaseMatch[1], 10);
                const totalPhases = 4; // Typical project has 4 phases
                const percentage = Math.min(100, Math.round((currentPhase / totalPhases) * 100));
                return {
                    current: currentPhase,
                    total: totalPhases,
                    percentage,
                    description: `Phase ${currentPhase} of ${totalPhases}`
                };
            }
        }
        // Default progress
        return {
            current: 0,
            total: 0,
            percentage: 0,
            description: session.status === 'working' ? 'Working' : 'Ideating'
        };
    }
    /**
     * Get cost tracking data
     * This is a mock implementation - can be replaced with actual cost tracking
     */
    getCostData() {
        // Mock data - in real implementation, this would query actual cost tracking
        return {
            daily: {
                spent: 12.34,
                limit: 50.00,
                percentage: 24.68
            },
            monthly: {
                spent: 123.45,
                limit: 500.00,
                percentage: 24.69
            }
        };
    }
    /**
     * Public method to log activity (can be called from other components)
     */
    logActivity(event) {
        this._activityTracker.logAgentActivity(event);
        // Send activity update to webview if it's visible
        if (this._view && this._view.visible) {
            this._view.webview.postMessage({
                type: 'activityUpdate',
                event
            });
        }
    }
    /**
     * Cleanup resources
     */
    dispose() {
        this.stopAutoRefresh();
    }
    /**
     * Get HTML for webview
     */
    _getHtmlForWebview(webview) {
        const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'media', 'agent-dashboard.js'));
        const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'media', 'agent-dashboard.css'));
        const nonce = getNonce();
        return `<!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource}; script-src 'nonce-${nonce}';">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <link href="${styleUri}" rel="stylesheet">
            <title>Agent Dashboard</title>
        </head>
        <body>
            <div id="app">
                <div id="loading" class="loading-container">
                    <div class="loading-spinner"></div>
                    <div class="loading-text">Loading agents...</div>
                </div>
                <div id="error" class="error-banner"></div>
                <div id="content"></div>
            </div>
            <script nonce="${nonce}" src="${scriptUri}"></script>
        </body>
        </html>`;
    }
}
exports.AgentDashboardProvider = AgentDashboardProvider;
/**
 * Generate a nonce for CSP
 */
function getNonce() {
    let text = '';
    const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    for (let i = 0; i < 32; i++) {
        text += possible.charAt(Math.floor(Math.random() * possible.length));
    }
    return text;
}
//# sourceMappingURL=agent-dashboard-provider.js.map