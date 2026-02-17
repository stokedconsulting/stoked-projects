import * as vscode from 'vscode';
import { TaskHistoryManager, TaskHistoryEntry } from './task-history-manager';
import { OrchestrationWebSocketClient, ProjectEvent } from './orchestration-websocket-client';

export class TaskHistoryViewProvider implements vscode.WebviewViewProvider {
    public static readonly viewType = 'claudeProjects.taskHistory';
    private _view?: vscode.WebviewView;
    private liveEntries: any[] = [];
    private readonly MAX_LIVE_ENTRIES = 500;
    private wsClient?: OrchestrationWebSocketClient;
    private taskHistoryHandler?: (event: ProjectEvent) => void;
    private workspaceId?: string;
    private showAllWorkspaces: boolean = false;
    private apiBaseUrl?: string;

    constructor(
        private readonly _extensionUri: vscode.Uri,
        private readonly historyManager: TaskHistoryManager
    ) {}

    public setWorkspaceId(workspaceId: string): void {
        this.workspaceId = workspaceId;
    }

    public setShowAllWorkspaces(show: boolean): void {
        this.showAllWorkspaces = show;
        // Trigger re-render if webview is active
        if (this._view) {
            this._view.webview.postMessage({
                type: 'filterChanged',
                showAllWorkspaces: this.showAllWorkspaces
            });
        }
    }

    public setApiBaseUrl(url: string): void {
        this.apiBaseUrl = url;
    }

    public resolveWebviewView(
        webviewView: vscode.WebviewView,
        context: vscode.WebviewViewResolveContext,
        _token: vscode.CancellationToken,
    ) {
        this._view = webviewView;

        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [this._extensionUri]
        };

        webviewView.webview.html = this._getHtmlForWebview(webviewView.webview);

        // Flush buffered live entries when webview becomes visible
        webviewView.onDidChangeVisibility(() => {
            if (webviewView.visible && this.liveEntries.length > 0) {
                webviewView.webview.postMessage({
                    type: 'liveEntries',
                    entries: this.liveEntries
                });
            }
        });

        // Handle messages from the webview
        webviewView.webview.onDidReceiveMessage(async data => {
            switch (data.type) {
                case 'ready':
                    this.refresh();
                    // Send initial workspace filter state
                    this._view?.webview.postMessage({
                        type: 'workspaceFilterState',
                        showAllWorkspaces: this.showAllWorkspaces,
                        workspaceId: this.workspaceId
                    });
                    break;
                case 'fetchHistory':
                    // Send both local history and live entries
                    this.refresh();
                    if (this.liveEntries.length > 0) {
                        this._view?.webview.postMessage({
                            type: 'liveEntries',
                            entries: this.liveEntries
                        });
                    }
                    break;
                case 'clear':
                    await this.historyManager.clearHistory();
                    this.refresh();
                    vscode.window.showInformationMessage('Task history cleared');
                    break;
                case 'export':
                    await this.exportHistory();
                    break;
                case 'copyResponse':
                    await vscode.env.clipboard.writeText(data.response);
                    vscode.window.showInformationMessage('Response copied to clipboard');
                    break;
                case 'toggleShowAllWorkspaces':
                    this.setShowAllWorkspaces(data.show);
                    break;
            }
        });
    }

    public refresh() {
        if (this._view) {
            const history = this.historyManager.getHistory();
            const stats = this.historyManager.getStatistics();
            this._view.webview.postMessage({
                type: 'historyData',
                history,
                stats
            });
        }
    }

    public setWebSocketClient(client: OrchestrationWebSocketClient): void {
        // Unregister old handler if exists
        if (this.wsClient && this.taskHistoryHandler) {
            this.wsClient.offTaskHistoryEvent(this.taskHistoryHandler);
        }

        this.wsClient = client;

        // Create and register handler
        this.taskHistoryHandler = (event: ProjectEvent) => {
            this.handleLiveEvent(event);
        };
        client.onTaskHistoryEvent(this.taskHistoryHandler);
    }

    public handleLiveEvent(event: ProjectEvent): void {
        // Apply workspace filtering
        if (!this.shouldShowEvent(event)) {
            return; // Skip events from other workspaces
        }

        // Handle orchestration progress separately
        if (event.type === 'orchestration.progress' && event.data) {
            if (this._view) {
                this._view.webview.postMessage({
                    type: 'orchestrationProgress',
                    completed: event.data.completed || 0,
                    total: event.data.total || 0
                });
            }
        }

        const entry = {
            id: `live-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`,
            type: event.type,
            timestamp: event.timestamp || new Date().toISOString(),
            projectNumber: event.data?.projectNumber,
            phaseNumber: event.data?.phaseNumber,
            workItemId: event.data?.workItemId,
            workItemTitle: event.data?.workItemTitle,
            status: this.mapEventTypeToStatus(event.type),
            data: event.data,
        };

        // Add to buffer
        this.liveEntries.unshift(entry);
        if (this.liveEntries.length > this.MAX_LIVE_ENTRIES) {
            this.liveEntries = this.liveEntries.slice(0, this.MAX_LIVE_ENTRIES);
        }

        // Send to webview if visible
        if (this._view) {
            this._view.webview.postMessage({ type: 'liveEntry', entry });
        }
    }

    private shouldShowEvent(event: ProjectEvent): boolean {
        // If "show all workspaces" is enabled, show everything
        if (this.showAllWorkspaces) {
            return true;
        }

        // If no workspace is set, show all events (with notice in UI)
        if (!this.workspaceId) {
            return true;
        }

        // If event has no workspaceId, show it (backward compatible)
        if (!event.data?.workspaceId) {
            return true;
        }

        // Check if workspaceId matches
        if (event.data.workspaceId === this.workspaceId) {
            return true;
        }

        // Check if worktreePath matches current workspace
        if (event.data.worktreePath) {
            const workspaceFolders = vscode.workspace.workspaceFolders;
            if (workspaceFolders && workspaceFolders.length > 0) {
                const currentWorkspacePath = workspaceFolders[0].uri.fsPath;
                // Check if worktreePath is within the current workspace
                if (event.data.worktreePath.startsWith(currentWorkspacePath)) {
                    return true;
                }
            }
        }

        // Event is from a different workspace, filter it out
        return false;
    }

    private mapEventTypeToStatus(type: string): string {
        switch (type) {
            case 'task.started':
            case 'phase.started':
                return 'in-progress';
            case 'task.completed':
            case 'phase.completed':
                return 'completed';
            case 'task.failed':
                return 'failed';
            case 'orchestration.progress':
                return 'progress';
            default:
                return 'unknown';
        }
    }

    public async backfill(): Promise<void> {
        if (!this.apiBaseUrl) {
            return; // Can't backfill without API URL
        }

        // Determine start time from most recent entry, or default to last 5 minutes
        let startTime: string;
        if (this.liveEntries.length > 0) {
            startTime = this.liveEntries[0].timestamp;
        } else {
            startTime = new Date(Date.now() - 5 * 60 * 1000).toISOString();
        }

        try {
            const url = this.workspaceId
                ? `${this.apiBaseUrl}/api/audit-history/workspace/${encodeURIComponent(this.workspaceId)}?startTime=${encodeURIComponent(startTime)}&limit=100`
                : `${this.apiBaseUrl}/api/audit-history?startTime=${encodeURIComponent(startTime)}&limit=100`;

            const response = await fetch(url);
            if (!response.ok) {
                console.warn(`[TaskHistory] Backfill failed: HTTP ${response.status}`);
                return;
            }

            const data = await response.json();
            const items = data.items || [];

            // Deduplicate against existing live entries
            const existingIds = new Set(this.liveEntries.map(e => e.id));

            for (const item of items) {
                const entryId = item.audit_id || `backfill-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`;
                if (existingIds.has(entryId)) {
                    continue; // Skip duplicate
                }

                const entry = {
                    id: entryId,
                    type: item.operation_type,
                    timestamp: item.timestamp,
                    projectNumber: item.project_number,
                    workItemId: item.task_id,
                    workItemTitle: item.operation_type,
                    status: item.response_status < 400 ? 'completed' : 'failed',
                    data: item,
                };

                this.liveEntries.push(entry);
            }

            // Sort by timestamp (newest first) and trim
            this.liveEntries.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
            if (this.liveEntries.length > this.MAX_LIVE_ENTRIES) {
                this.liveEntries = this.liveEntries.slice(0, this.MAX_LIVE_ENTRIES);
            }

            // Send all to webview
            if (this._view) {
                this._view.webview.postMessage({
                    type: 'liveEntries',
                    entries: this.liveEntries
                });
            }
        } catch (error) {
            console.warn(`[TaskHistory] Backfill error: ${error}`);
            // Non-fatal: continue with live updates
        }
    }

    public unregisterHandlers(): void {
        if (this.wsClient && this.taskHistoryHandler) {
            this.wsClient.offTaskHistoryEvent(this.taskHistoryHandler);
            this.taskHistoryHandler = undefined;
        }
    }

    private async exportHistory() {
        const json = this.historyManager.exportHistory();
        const uri = await vscode.window.showSaveDialog({
            filters: { 'JSON': ['json'] },
            defaultUri: vscode.Uri.file('task-history.json')
        });

        if (uri) {
            const fs = require('fs');
            fs.writeFileSync(uri.fsPath, json);
            vscode.window.showInformationMessage(`History exported to ${uri.fsPath}`);
        }
    }

    private _getHtmlForWebview(webview: vscode.Webview) {
        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Task History</title>
    <style>
        body {
            padding: 10px;
            font-family: var(--vscode-font-family);
            font-size: var(--vscode-font-size);
            color: var(--vscode-foreground);
        }

        .stats {
            display: flex;
            gap: 15px;
            margin-bottom: 15px;
            padding: 10px;
            background: var(--vscode-editor-background);
            border-radius: 4px;
        }

        .stat {
            flex: 1;
            text-align: center;
        }

        .stat-value {
            font-size: 24px;
            font-weight: bold;
            display: block;
        }

        .stat-label {
            font-size: 11px;
            color: var(--vscode-descriptionForeground);
            text-transform: uppercase;
        }

        .progress-container {
            margin-bottom: 15px;
            padding: 12px;
            background: var(--vscode-editor-background);
            border-radius: 4px;
        }

        .progress-label {
            font-size: 12px;
            font-weight: bold;
            margin-bottom: 6px;
            color: var(--vscode-descriptionForeground);
        }

        .progress-bar-wrapper {
            width: 100%;
            height: 20px;
            background: var(--vscode-input-background);
            border-radius: 10px;
            overflow: hidden;
            position: relative;
        }

        .progress-bar-fill {
            height: 100%;
            background: linear-gradient(90deg, #2196f3, #1976d2);
            transition: width 0.3s ease;
            border-radius: 10px;
        }

        .progress-text {
            position: absolute;
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%);
            font-size: 11px;
            font-weight: bold;
            color: var(--vscode-foreground);
            text-shadow: 0 0 3px rgba(0,0,0,0.5);
        }

        .filters {
            margin-bottom: 15px;
            padding: 12px;
            background: var(--vscode-editor-background);
            border-radius: 4px;
        }

        .filter-row {
            display: flex;
            gap: 10px;
            margin-bottom: 10px;
            flex-wrap: wrap;
        }

        .filter-row:last-child {
            margin-bottom: 0;
        }

        .filter-group {
            display: flex;
            gap: 5px;
            align-items: center;
        }

        select {
            padding: 4px 8px;
            background: var(--vscode-input-background);
            color: var(--vscode-input-foreground);
            border: 1px solid var(--vscode-input-border);
            border-radius: 3px;
            font-size: 12px;
        }

        label {
            font-size: 12px;
            display: flex;
            align-items: center;
            gap: 4px;
            cursor: pointer;
        }

        input[type="checkbox"] {
            cursor: pointer;
        }

        .time-filters {
            display: flex;
            gap: 5px;
        }

        .time-btn {
            padding: 4px 10px;
            background: var(--vscode-button-secondaryBackground);
            color: var(--vscode-button-secondaryForeground);
            border: none;
            border-radius: 3px;
            cursor: pointer;
            font-size: 11px;
        }

        .time-btn.active {
            background: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
        }

        .time-btn:hover {
            background: var(--vscode-button-hoverBackground);
        }

        .actions {
            display: flex;
            gap: 10px;
            margin-bottom: 15px;
        }

        button {
            padding: 6px 12px;
            background: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
            border: none;
            border-radius: 3px;
            cursor: pointer;
            font-size: 13px;
        }

        button:hover {
            background: var(--vscode-button-hoverBackground);
        }

        button.secondary {
            background: var(--vscode-button-secondaryBackground);
            color: var(--vscode-button-secondaryForeground);
        }

        button.secondary:hover {
            background: var(--vscode-button-secondaryHoverBackground);
        }

        .project-section {
            margin-bottom: 20px;
        }

        .project-header {
            padding: 10px;
            background: var(--vscode-editor-background);
            border-left: 3px solid #2196f3;
            border-radius: 4px;
            cursor: pointer;
            user-select: none;
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 10px;
        }

        .project-header:hover {
            background: var(--vscode-list-hoverBackground);
        }

        .project-title {
            font-weight: bold;
            font-size: 14px;
        }

        .expand-icon {
            font-size: 12px;
            transition: transform 0.2s;
        }

        .project-section.collapsed .expand-icon {
            transform: rotate(-90deg);
        }

        .project-section.collapsed .project-content {
            display: none;
        }

        .phase-section {
            margin-left: 15px;
            margin-bottom: 15px;
        }

        .phase-header {
            padding: 8px;
            background: var(--vscode-input-background);
            border-left: 2px solid #9c27b0;
            border-radius: 3px;
            font-size: 13px;
            font-weight: 600;
            margin-bottom: 8px;
        }

        .task-entry {
            margin-left: 15px;
            margin-bottom: 10px;
            padding: 10px;
            background: var(--vscode-editor-background);
            border-left: 3px solid var(--vscode-textLink-foreground);
            border-radius: 4px;
        }

        .task-entry.completed {
            border-left-color: #4caf50;
        }

        .task-entry.failed {
            border-left-color: #f44336;
        }

        .task-entry.pending {
            border-left-color: #ff9800;
        }

        .task-entry.in-progress {
            border-left-color: #2196f3;
        }

        .task-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 6px;
        }

        .task-command {
            font-weight: bold;
            font-size: 13px;
            display: flex;
            align-items: center;
            gap: 6px;
        }

        .status-icon {
            display: inline-flex;
            align-items: center;
            justify-content: center;
            width: 16px;
            height: 16px;
            font-size: 10px;
        }

        .status-icon.pulsing-dot {
            width: 8px;
            height: 8px;
            background: #2196f3;
            border-radius: 50%;
            animation: pulse 1.5s ease-in-out infinite;
        }

        @keyframes pulse {
            0%, 100% { opacity: 1; transform: scale(1); }
            50% { opacity: 0.6; transform: scale(1.3); }
        }

        .status-icon.checkmark {
            color: #4caf50;
        }

        .status-icon.x-mark {
            color: #f44336;
        }

        .status-icon.progress-icon {
            color: #9c27b0;
        }

        .task-time {
            font-size: 11px;
            color: var(--vscode-descriptionForeground);
        }

        .task-meta {
            font-size: 12px;
            color: var(--vscode-descriptionForeground);
            margin-bottom: 6px;
        }

        .duration {
            font-size: 11px;
            color: var(--vscode-descriptionForeground);
            margin-left: 8px;
        }

        .task-prompt {
            background: var(--vscode-textBlockQuote-background);
            border-left: 2px solid var(--vscode-textBlockQuote-border);
            padding: 8px;
            margin: 8px 0;
            font-family: var(--vscode-editor-font-family);
            font-size: 12px;
            white-space: pre-wrap;
            word-break: break-word;
        }

        .task-response {
            margin-top: 8px;
            padding: 8px;
            background: var(--vscode-editor-inactiveSelectionBackground);
            border-radius: 3px;
            font-size: 12px;
            white-space: pre-wrap;
            word-break: break-word;
            max-height: 200px;
            overflow-y: auto;
        }

        .subagent-responses {
            margin-top: 8px;
        }

        .subagent {
            margin: 5px 0;
            padding: 6px;
            background: var(--vscode-editor-background);
            border-left: 2px solid var(--vscode-charts-blue);
            font-size: 11px;
        }

        .subagent-id {
            font-weight: bold;
            margin-bottom: 4px;
        }

        .status-badge {
            display: inline-block;
            padding: 2px 8px;
            border-radius: 10px;
            font-size: 10px;
            font-weight: bold;
            text-transform: uppercase;
        }

        .status-badge.completed {
            background: #4caf50;
            color: white;
        }

        .status-badge.pending {
            background: #ff9800;
            color: white;
        }

        .status-badge.failed {
            background: #f44336;
            color: white;
        }

        .status-badge.in-progress {
            background: #2196f3;
            color: white;
        }

        .status-badge.progress {
            background: #9c27b0;
            color: white;
        }

        .copy-btn {
            padding: 4px 8px;
            font-size: 11px;
            margin-top: 5px;
        }

        .empty-state {
            text-align: center;
            padding: 40px 20px;
            color: var(--vscode-descriptionForeground);
        }

        .empty-state-icon {
            font-size: 48px;
            margin-bottom: 10px;
        }

        .live-entry {
            border-left-color: var(--vscode-textLink-foreground);
        }

        .live-entry.completed {
            border-left-color: #4caf50;
        }

        .live-entry.failed {
            border-left-color: #f44336;
        }

        .live-entry.in-progress {
            border-left-color: #2196f3;
        }

        .highlight {
            animation: highlightFade 2s ease-out;
        }

        @keyframes highlightFade {
            from { background-color: rgba(33, 150, 243, 0.3); }
            to { background-color: var(--vscode-editor-background); }
        }

        .hidden {
            display: none !important;
        }

        .workspace-notice {
            font-size: 11px;
            color: var(--vscode-descriptionForeground);
            font-style: italic;
            padding: 4px 8px;
            background: var(--vscode-input-background);
            border-radius: 3px;
        }
    </style>
</head>
<body>
    <div class="stats" id="stats">
        <div class="stat">
            <span class="stat-value" id="stat-total">0</span>
            <span class="stat-label">Total</span>
        </div>
        <div class="stat">
            <span class="stat-value" id="stat-completed">0</span>
            <span class="stat-label">Completed</span>
        </div>
        <div class="stat">
            <span class="stat-value" id="stat-pending">0</span>
            <span class="stat-label">Pending</span>
        </div>
        <div class="stat">
            <span class="stat-value" id="stat-failed">0</span>
            <span class="stat-label">Failed</span>
        </div>
    </div>

    <div class="progress-container" id="progress-container" style="display: none;">
        <div class="progress-label">Orchestration Progress</div>
        <div class="progress-bar-wrapper">
            <div class="progress-bar-fill" id="progress-fill" style="width: 0%"></div>
            <div class="progress-text" id="progress-text">0 / 0 items (0%)</div>
        </div>
    </div>

    <div class="filters">
        <div class="filter-row">
            <div class="filter-group">
                <label>Project:</label>
                <select id="filter-project" onchange="applyFilters()">
                    <option value="">All Projects</option>
                </select>
            </div>
            <div class="filter-group">
                <label>Phase:</label>
                <select id="filter-phase" onchange="applyFilters()">
                    <option value="">All Phases</option>
                </select>
            </div>
        </div>
        <div class="filter-row">
            <div class="filter-group">
                <label><input type="checkbox" id="filter-started" checked onchange="applyFilters()"> Started</label>
                <label><input type="checkbox" id="filter-completed" checked onchange="applyFilters()"> Completed</label>
                <label><input type="checkbox" id="filter-failed" checked onchange="applyFilters()"> Failed</label>
                <label><input type="checkbox" id="filter-progress" checked onchange="applyFilters()"> Progress</label>
            </div>
        </div>
        <div class="filter-row">
            <div class="time-filters">
                <button class="time-btn active" onclick="setTimeFilter('all')">All</button>
                <button class="time-btn" onclick="setTimeFilter('1h')">Last 1 Hour</button>
                <button class="time-btn" onclick="setTimeFilter('24h')">Last 24 Hours</button>
            </div>
        </div>
        <div class="filter-row">
            <div class="filter-group">
                <label><input type="checkbox" id="showAllWorkspaces" onchange="toggleShowAllWorkspaces()"> Show all workspaces</label>
            </div>
            <div id="workspace-notice" class="workspace-notice" style="display: none;">
                Open a folder to enable workspace filtering
            </div>
        </div>
    </div>

    <div class="actions">
        <button onclick="exportHistory()">Export History</button>
        <button class="secondary" onclick="clearHistory()">Clear All</button>
    </div>

    <div id="history"></div>

    <script>
        const vscode = acquireVsCodeApi();

        let allEntries = [];
        let startTimes = new Map();
        let currentTimeFilter = 'all';
        let orchestrationData = { completed: 0, total: 0 };
        let currentWorkspaceId = null;

        // Request data when loaded
        vscode.postMessage({ type: 'ready' });

        window.addEventListener('message', event => {
            const message = event.data;
            switch (message.type) {
                case 'historyData':
                    renderHistory(message.history, message.stats);
                    break;
                case 'liveEntry':
                    addLiveEntry(message.entry);
                    break;
                case 'liveEntries':
                    message.entries.forEach(entry => addLiveEntry(entry));
                    break;
                case 'orchestrationProgress':
                    updateOrchestrationProgress(message.completed, message.total);
                    break;
                case 'workspaceFilterState':
                    currentWorkspaceId = message.workspaceId;
                    const checkbox = document.getElementById('showAllWorkspaces');
                    if (checkbox) {
                        checkbox.checked = message.showAllWorkspaces;
                    }
                    // Show notice if no workspace
                    const notice = document.getElementById('workspace-notice');
                    if (notice) {
                        notice.style.display = currentWorkspaceId ? 'none' : 'block';
                    }
                    break;
                case 'filterChanged':
                    const showAllCheckbox = document.getElementById('showAllWorkspaces');
                    if (showAllCheckbox) {
                        showAllCheckbox.checked = message.showAllWorkspaces;
                    }
                    break;
            }
        });

        function updateOrchestrationProgress(completed, total) {
            orchestrationData = { completed, total };
            const progressContainer = document.getElementById('progress-container');
            const progressFill = document.getElementById('progress-fill');
            const progressText = document.getElementById('progress-text');

            if (total > 0) {
                progressContainer.style.display = 'block';
                const percentage = Math.round((completed / total) * 100);
                progressFill.style.width = percentage + '%';
                progressText.textContent = completed + ' / ' + total + ' items (' + percentage + '%)';
            } else {
                progressContainer.style.display = 'none';
            }
        }

        function getStatusIcon(type, status) {
            if (type === 'task.started' || type === 'phase.started') {
                return '<span class="status-icon pulsing-dot"></span>';
            } else if (type === 'task.completed' || type === 'phase.completed') {
                return '<span class="status-icon checkmark">✓</span>';
            } else if (type === 'task.failed') {
                return '<span class="status-icon x-mark">✕</span>';
            } else if (type === 'orchestration.progress') {
                return '<span class="status-icon progress-icon">⟳</span>';
            }
            return '';
        }

        function formatDuration(ms) {
            if (!ms) return '';
            const seconds = Math.floor(ms / 1000);
            if (seconds < 60) return seconds + 's';
            const minutes = Math.floor(seconds / 60);
            const secs = seconds % 60;
            return minutes + 'm ' + secs + 's';
        }

        function renderHistory(history, stats) {
            // Update stats
            document.getElementById('stat-total').textContent = stats.total;
            document.getElementById('stat-completed').textContent = stats.completed;
            document.getElementById('stat-pending').textContent = stats.pending;
            document.getElementById('stat-failed').textContent = stats.failed;

            // Store history entries
            allEntries = history.map(task => ({
                ...task,
                isLive: false
            }));

            // Render grouped entries
            renderGroupedEntries();
            populateFilterDropdowns();
        }

        function renderGroupedEntries() {
            const container = document.getElementById('history');

            // Filter entries
            const filtered = allEntries.filter(entry => passesFilters(entry));

            if (filtered.length === 0) {
                container.innerHTML = \`
                    <div class="empty-state">
                        <div class="empty-state-icon">📋</div>
                        <div>No task history yet</div>
                        <div style="font-size: 12px; margin-top: 5px;">
                            Use extension commands to track your work
                        </div>
                    </div>
                \`;
                return;
            }

            // Group by project then phase
            const grouped = {};
            filtered.forEach(entry => {
                const projectNum = entry.projectNumber || 'unknown';
                const phaseNum = entry.phaseNumber || 'none';

                if (!grouped[projectNum]) grouped[projectNum] = {};
                if (!grouped[projectNum][phaseNum]) grouped[projectNum][phaseNum] = [];

                grouped[projectNum][phaseNum].push(entry);
            });

            // Sort entries within each group by timestamp (newest first)
            Object.values(grouped).forEach(project => {
                Object.values(project).forEach(phase => {
                    phase.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
                });
            });

            // Render
            let html = '';
            Object.keys(grouped).sort().forEach(projectNum => {
                const projectData = grouped[projectNum];
                html += \`<div class="project-section" data-project="\${projectNum}">
                    <div class="project-header" onclick="toggleProject(this)">
                        <span class="project-title">Project #\${projectNum}</span>
                        <span class="expand-icon">▼</span>
                    </div>
                    <div class="project-content">\`;

                Object.keys(projectData).sort().forEach(phaseNum => {
                    const entries = projectData[phaseNum];
                    html += \`<div class="phase-section">
                        <div class="phase-header">Phase \${phaseNum}</div>\`;

                    entries.forEach(entry => {
                        html += renderEntry(entry);
                    });

                    html += \`</div>\`;
                });

                html += \`</div></div>\`;
            });

            container.innerHTML = html;
        }

        function renderEntry(entry) {
            const time = new Date(entry.timestamp).toLocaleString();
            const timeShort = new Date(entry.timestamp).toLocaleTimeString();
            const icon = getStatusIcon(entry.type || entry.command, entry.status);

            let duration = '';
            if (entry.isLive && entry.workItemId) {
                const startTime = startTimes.get(entry.workItemId);
                if (startTime && (entry.status === 'completed' || entry.status === 'failed')) {
                    const ms = new Date(entry.timestamp) - startTime;
                    duration = '<span class="duration">(' + formatDuration(ms) + ')</span>';
                }
            }

            const title = entry.workItemTitle || entry.command || entry.type;
            const phaseText = entry.phaseNumber ? 'Phase ' + entry.phaseNumber + (entry.itemNumber ? '.' + entry.itemNumber : '') : '';

            const subagents = entry.subagentResponses && entry.subagentResponses.length > 0
                ? \`<div class="subagent-responses">
                    <strong>Subagent Responses (\${entry.subagentResponses.length}):</strong>
                    \${entry.subagentResponses.map(sub => \`
                        <div class="subagent">
                            <div class="subagent-id">\${sub.agentId}</div>
                            <div>\${sub.response.substring(0, 200)}\${sub.response.length > 200 ? '...' : ''}</div>
                        </div>
                    \`).join('')}
                </div>\`
                : '';

            const workItemAttr = entry.workItemId ? 'data-work-item-id="' + entry.workItemId + '"' : '';
            const entryClass = entry.isLive ? 'task-entry live-entry ' + entry.status : 'task-entry ' + entry.status;

            return \`<div class="\${entryClass}" \${workItemAttr}>
                <div class="task-header">
                    <span class="task-command">
                        \${icon}
                        \${title}
                        \${phaseText ? '<span class="task-meta" style="margin-left: 8px;">[\${phaseText}]</span>' : ''}
                        \${duration}
                    </span>
                    <span class="task-time">\${entry.isLive ? timeShort : time}</span>
                </div>
                <div class="task-meta">
                    <span class="status-badge \${entry.status}">\${entry.type || entry.command || entry.status}</span>
                </div>
                \${entry.prompt ? '<div class="task-prompt">' + entry.prompt + '</div>' : ''}
                \${entry.response ? \`
                    <div class="task-response">
                        \${entry.response.substring(0, 500)}\${entry.response.length > 500 ? '...' : ''}
                        <button class="copy-btn" onclick='copyResponse(\${JSON.stringify(entry.response)})'>
                            Copy Full Response
                        </button>
                    </div>
                \` : ''}
                \${entry.error ? '<div style="color: #f44336; margin-top: 8px;">Error: ' + entry.error + '</div>' : ''}
                \${subagents}
            </div>\`;
        }

        function passesFilters(entry) {
            // Time filter
            if (currentTimeFilter !== 'all') {
                const now = Date.now();
                const entryTime = new Date(entry.timestamp).getTime();
                const cutoff = currentTimeFilter === '1h' ? 60 * 60 * 1000 : 24 * 60 * 60 * 1000;
                if (now - entryTime > cutoff) return false;
            }

            // Project filter
            const projectFilter = document.getElementById('filter-project').value;
            if (projectFilter && entry.projectNumber != projectFilter) return false;

            // Phase filter
            const phaseFilter = document.getElementById('filter-phase').value;
            if (phaseFilter && entry.phaseNumber != phaseFilter) return false;

            // Status filters
            const type = entry.type || entry.command || '';
            const started = document.getElementById('filter-started').checked;
            const completed = document.getElementById('filter-completed').checked;
            const failed = document.getElementById('filter-failed').checked;
            const progress = document.getElementById('filter-progress').checked;

            if ((type.includes('started') && !started) ||
                (type.includes('completed') && !completed) ||
                (type.includes('failed') && !failed) ||
                (type.includes('progress') && !progress)) {
                return false;
            }

            return true;
        }

        function populateFilterDropdowns() {
            const projectSelect = document.getElementById('filter-project');
            const phaseSelect = document.getElementById('filter-phase');

            // Get unique projects
            const projects = [...new Set(allEntries.map(e => e.projectNumber).filter(Boolean))].sort();
            const currentProject = projectSelect.value;

            projectSelect.innerHTML = '<option value="">All Projects</option>' +
                projects.map(p => '<option value="' + p + '"' + (p == currentProject ? ' selected' : '') + '>Project #' + p + '</option>').join('');

            // Get phases for selected project
            const selectedProject = projectSelect.value;
            let phases = [];
            if (selectedProject) {
                phases = [...new Set(allEntries.filter(e => e.projectNumber == selectedProject).map(e => e.phaseNumber).filter(Boolean))].sort();
            } else {
                phases = [...new Set(allEntries.map(e => e.phaseNumber).filter(Boolean))].sort();
            }

            const currentPhase = phaseSelect.value;
            phaseSelect.innerHTML = '<option value="">All Phases</option>' +
                phases.map(p => '<option value="' + p + '"' + (p == currentPhase ? ' selected' : '') + '>Phase ' + p + '</option>').join('');
        }

        function applyFilters() {
            populateFilterDropdowns();
            renderGroupedEntries();
        }

        function setTimeFilter(filter) {
            currentTimeFilter = filter;
            document.querySelectorAll('.time-btn').forEach(btn => btn.classList.remove('active'));
            event.target.classList.add('active');
            applyFilters();
        }

        function toggleProject(header) {
            const section = header.parentElement;
            section.classList.toggle('collapsed');
        }

        function clearHistory() {
            if (confirm('Clear all task history?')) {
                vscode.postMessage({ type: 'clear' });
            }
        }

        function exportHistory() {
            vscode.postMessage({ type: 'export' });
        }

        function copyResponse(response) {
            vscode.postMessage({ type: 'copyResponse', response });
        }

        function toggleShowAllWorkspaces() {
            const checkbox = document.getElementById('showAllWorkspaces');
            vscode.postMessage({
                type: 'toggleShowAllWorkspaces',
                show: checkbox.checked
            });
        }

        function addLiveEntry(entry) {
            // Track start times for duration calculation
            if (entry.type === 'task.started' && entry.workItemId) {
                startTimes.set(entry.workItemId, new Date(entry.timestamp));
            }

            // Handle orchestration progress
            if (entry.type === 'orchestration.progress' && entry.data) {
                if (entry.data.completed !== undefined && entry.data.total !== undefined) {
                    updateOrchestrationProgress(entry.data.completed, entry.data.total);
                }
            }

            // Check if entry for this workItemId already exists (update in place)
            const existingIndex = allEntries.findIndex(e => e.workItemId && e.workItemId === entry.workItemId);

            if (existingIndex >= 0) {
                // Update existing entry
                const existing = allEntries[existingIndex];
                const startTime = startTimes.get(entry.workItemId);

                allEntries[existingIndex] = {
                    ...existing,
                    ...entry,
                    isLive: true,
                    status: entry.status
                };

                renderGroupedEntries();

                // Highlight updated entry
                const entryEl = document.querySelector('[data-work-item-id="' + entry.workItemId + '"]');
                if (entryEl) {
                    entryEl.classList.add('highlight');
                    setTimeout(() => entryEl.classList.remove('highlight'), 2000);
                }
            } else {
                // Add new entry
                allEntries.unshift({
                    ...entry,
                    isLive: true,
                    timestamp: entry.timestamp || new Date().toISOString()
                });

                renderGroupedEntries();
                populateFilterDropdowns();

                // Highlight new entry
                const entryEl = entry.workItemId
                    ? document.querySelector('[data-work-item-id="' + entry.workItemId + '"]')
                    : document.querySelector('.task-entry');

                if (entryEl) {
                    entryEl.classList.add('highlight');
                    setTimeout(() => entryEl.classList.remove('highlight'), 2000);
                }
            }
        }
    </script>
</body>
</html>`;
    }
}
