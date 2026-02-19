import * as vscode from 'vscode';
import { TaskHistoryManager, TaskHistoryEntry } from './task-history-manager';

export class TaskHistoryViewProvider implements vscode.WebviewViewProvider {
    public static readonly viewType = 'claudeProjects.taskHistory';
    private _view?: vscode.WebviewView;
    private _outputChannel: vscode.OutputChannel;

    constructor(
        private readonly _extensionUri: vscode.Uri,
        private readonly historyManager: TaskHistoryManager,
        outputChannel?: vscode.OutputChannel
    ) {
        this._outputChannel = outputChannel || vscode.window.createOutputChannel("Stoked Projects - Task History View");
        this._outputChannel.appendLine(`[Task History View] Provider created`);
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

        this._outputChannel.appendLine(`[Task History View] Webview resolved — rendering HTML`);

        // Handle messages from the webview
        webviewView.webview.onDidReceiveMessage(async data => {
            this._outputChannel.appendLine(`[Task History View] Received message: ${data.type}`);
            switch (data.type) {
                case 'ready':
                    this._outputChannel.appendLine(`[Task History View] Webview ready — sending initial data`);
                    this.refresh();
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
            }
        });
    }

    public refresh() {
        if (this._view) {
            const history = this.historyManager.getHistory();
            const stats = this.historyManager.getStatistics();
            this._outputChannel.appendLine(`[Task History View] Refreshing — ${history.length} entries (completed=${stats.completed}, pending=${stats.pending}, failed=${stats.failed})`);
            this._view.webview.postMessage({
                type: 'historyData',
                history,
                stats
            });
        } else {
            this._outputChannel.appendLine(`[Task History View] Refresh called but webview not resolved yet`);
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
            margin-bottom: 20px;
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

        .task-entry {
            margin-bottom: 15px;
            padding: 12px;
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

        .task-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 8px;
        }

        .task-command {
            font-weight: bold;
            font-size: 14px;
        }

        .task-time {
            font-size: 11px;
            color: var(--vscode-descriptionForeground);
        }

        .task-meta {
            font-size: 12px;
            color: var(--vscode-descriptionForeground);
            margin-bottom: 8px;
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

    <div class="actions">
        <button onclick="exportHistory()">Export History</button>
        <button class="secondary" onclick="clearHistory()">Clear All</button>
    </div>

    <div id="history"></div>

    <script>
        const vscode = acquireVsCodeApi();

        // Request data when loaded
        vscode.postMessage({ type: 'ready' });

        window.addEventListener('message', event => {
            const message = event.data;
            switch (message.type) {
                case 'historyData':
                    renderHistory(message.history, message.stats);
                    break;
            }
        });

        function renderHistory(history, stats) {
            // Update stats
            document.getElementById('stat-total').textContent = stats.total;
            document.getElementById('stat-completed').textContent = stats.completed;
            document.getElementById('stat-pending').textContent = stats.pending;
            document.getElementById('stat-failed').textContent = stats.failed;

            // Render history
            const container = document.getElementById('history');

            if (history.length === 0) {
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

            container.innerHTML = history.map(task => {
                const time = new Date(task.timestamp).toLocaleString();
                const projectInfo = task.projectNumber
                    ? \`Project #\${task.projectNumber}\${task.phaseNumber ? \` Phase \${task.phaseNumber}\` : ''}\${task.itemNumber ? \` Item \${task.itemNumber}\` : ''}\`
                    : '';

                const subagents = task.subagentResponses && task.subagentResponses.length > 0
                    ? \`
                        <div class="subagent-responses">
                            <strong>Subagent Responses (\${task.subagentResponses.length}):</strong>
                            \${task.subagentResponses.map(sub => \`
                                <div class="subagent">
                                    <div class="subagent-id">\${sub.agentId}</div>
                                    <div>\${sub.response.substring(0, 200)}\${sub.response.length > 200 ? '...' : ''}</div>
                                </div>
                            \`).join('')}
                        </div>
                    \`
                    : '';

                return \`
                    <div class="task-entry \${task.status}">
                        <div class="task-header">
                            <span class="task-command">\${task.command}</span>
                            <span class="task-time">\${time}</span>
                        </div>
                        \${projectInfo ? \`<div class="task-meta">\${projectInfo}</div>\` : ''}
                        <div class="task-meta">
                            <span class="status-badge \${task.status}">\${task.status}</span>
                        </div>
                        <div class="task-prompt">\${task.prompt}</div>
                        \${task.response ? \`
                            <div class="task-response">
                                \${task.response.substring(0, 500)}\${task.response.length > 500 ? '...' : ''}
                                <button class="copy-btn" onclick='copyResponse(\${JSON.stringify(task.response)})'>
                                    Copy Full Response
                                </button>
                            </div>
                        \` : ''}
                        \${task.error ? \`<div style="color: #f44336; margin-top: 8px;">Error: \${task.error}</div>\` : ''}
                        \${subagents}
                    </div>
                \`;
            }).join('');
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
    </script>
</body>
</html>`;
    }
}
