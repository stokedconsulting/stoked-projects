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
exports.activate = activate;
exports.deactivate = deactivate;
const vscode = __importStar(require("vscode"));
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const projects_view_provider_1 = require("./projects-view-provider");
const github_api_1 = require("./github-api");
const websocket_client_1 = require("./notifications/websocket-client");
const task_history_view_provider_1 = require("./task-history-view-provider");
const task_history_manager_1 = require("./task-history-manager");
const agent_dashboard_provider_1 = require("./agent-dashboard-provider");
const agent_session_manager_1 = require("./agent-session-manager");
const agent_heartbeat_1 = require("./agent-heartbeat");
const agent_lifecycle_1 = require("./agent-lifecycle");
const manual_override_controls_1 = require("./manual-override-controls");
const project_queue_manager_1 = require("./project-queue-manager");
const agent_executor_1 = require("./agent-executor");
const activity_tracker_1 = require("./activity-tracker");
async function installClaudeCommands(context) {
    const homeDir = require("os").homedir();
    const claudeCommandsDir = path.join(homeDir, ".claude", "commands");
    // Create ~/.claude/commands if it doesn't exist
    if (!fs.existsSync(claudeCommandsDir)) {
        fs.mkdirSync(claudeCommandsDir, { recursive: true });
    }
    const commands = [
        "review-item.md",
        "review-phase.md",
        "review-project.md",
        "project-start.md",
        "project-create.md",
    ];
    let installedCount = 0;
    for (const command of commands) {
        const targetPath = path.join(claudeCommandsDir, command);
        // Only install if it doesn't exist
        if (!fs.existsSync(targetPath)) {
            const sourcePath = vscode.Uri.joinPath(context.extensionUri, "commands", command);
            try {
                const content = await vscode.workspace.fs.readFile(sourcePath);
                fs.writeFileSync(targetPath, content);
                installedCount++;
                console.log(`[claude-projects] Installed Claude command: ${command}`);
            }
            catch (error) {
                console.error(`[claude-projects] Failed to install ${command}:`, error);
            }
        }
    }
    if (installedCount > 0) {
        vscode.window
            .showInformationMessage(`Claude Projects: Installed ${installedCount} Claude command(s) to ~/.claude/commands/`, "Learn More")
            .then((selection) => {
            if (selection === "Learn More") {
                vscode.env.openExternal(vscode.Uri.parse("https://github.com/anthropics/claude-code"));
            }
        });
    }
}
function activate(context) {
    console.log('Congratulations, your extension "claude-projects-vscode" is now active!');
    // Install Claude commands if needed
    installClaudeCommands(context).catch((err) => {
        console.error("[claude-projects] Failed to install Claude commands:", err);
    });
    // Create output channel for notifications
    const notificationOutputChannel = vscode.window.createOutputChannel("Claude Projects - Notifications");
    context.subscriptions.push(notificationOutputChannel);
    // Create WebSocket client
    const wsClient = new websocket_client_1.WebSocketNotificationClient(notificationOutputChannel);
    // Create task history manager
    const taskHistoryOutputChannel = vscode.window.createOutputChannel("Claude Projects - Task History");
    context.subscriptions.push(taskHistoryOutputChannel);
    const taskHistoryManager = new task_history_manager_1.TaskHistoryManager(context, taskHistoryOutputChannel);
    // Register projects view provider
    const provider = new projects_view_provider_1.ProjectsViewProvider(context.extensionUri, context, wsClient);
    context.subscriptions.push(vscode.window.registerWebviewViewProvider(projects_view_provider_1.ProjectsViewProvider.viewType, provider));
    // Register task history view provider
    const taskHistoryProvider = new task_history_view_provider_1.TaskHistoryViewProvider(context.extensionUri, taskHistoryManager);
    context.subscriptions.push(vscode.window.registerWebviewViewProvider(task_history_view_provider_1.TaskHistoryViewProvider.viewType, taskHistoryProvider));
    // Register agent dashboard (only if workspace is available)
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (workspaceFolders && workspaceFolders.length > 0) {
        const workspaceRoot = workspaceFolders[0].uri.fsPath;
        // Initialize agent management components
        const sessionManager = new agent_session_manager_1.AgentSessionManager(workspaceRoot);
        const heartbeatManager = new agent_heartbeat_1.AgentHeartbeatManager(sessionManager);
        const lifecycleManager = new agent_lifecycle_1.AgentLifecycleManager(workspaceRoot);
        // Initialize GitHub API (will be used by ProjectQueueManager and AgentExecutor)
        const githubApi = new github_api_1.GitHubAPI();
        // Initialize project queue manager and agent executor
        // Note: projectId should come from configuration in production
        const projectId = 'PVT_kwDOAtJY_s4BLYHh'; // Placeholder project ID
        const queueManager = new project_queue_manager_1.ProjectQueueManager(workspaceRoot, githubApi);
        const executor = new agent_executor_1.AgentExecutor(workspaceRoot, githubApi, projectId);
        // Initialize activity tracker
        const activityTracker = new activity_tracker_1.ActivityTracker(workspaceRoot);
        // Initialize manual override controls
        const manualOverrideControls = new manual_override_controls_1.ManualOverrideControls(lifecycleManager, sessionManager, queueManager, executor);
        // Register agent dashboard view provider
        const agentDashboardProvider = new agent_dashboard_provider_1.AgentDashboardProvider(context.extensionUri, context, sessionManager, heartbeatManager, lifecycleManager, manualOverrideControls, activityTracker);
        context.subscriptions.push(vscode.window.registerWebviewViewProvider(agent_dashboard_provider_1.AgentDashboardProvider.viewType, agentDashboardProvider));
        // Store references for cleanup
        context.subscriptions.push({
            dispose: () => {
                heartbeatManager.stopAllHeartbeats();
                lifecycleManager.stopAllAgents().catch((err) => {
                    console.error("[claude-projects] Error stopping agents during deactivation:", err);
                });
            }
        });
        console.log("[claude-projects] Agent dashboard registered");
    }
    else {
        console.log("[claude-projects] No workspace folder, skipping agent dashboard");
    }
    // Watch for workspace folder changes and refresh
    context.subscriptions.push(vscode.workspace.onDidChangeWorkspaceFolders(() => {
        console.log("[claude-projects] Workspace folder changed, refreshing...");
        provider.refresh();
    }));
    // Watch for active text editor changes (switching between projects)
    context.subscriptions.push(vscode.window.onDidChangeActiveTextEditor(() => {
        // Debounce this to avoid excessive refreshes
        if (provider.shouldRefreshOnEditorChange()) {
            console.log("[claude-projects] Active editor changed to different repo, refreshing...");
            provider.refresh();
        }
    }));
    context.subscriptions.push(vscode.commands.registerCommand("ghProjects.refresh", () => {
        provider.refresh();
    }));
    context.subscriptions.push(vscode.commands.registerCommand("ghProjects.viewActiveSessions", () => {
        provider.viewActiveSessions();
    }));
    context.subscriptions.push(vscode.commands.registerCommand("ghProjects.stopAllSessions", () => {
        provider.stopAllSessions();
    }));
    // Debug command to diagnose API responses
    context.subscriptions.push(vscode.commands.registerCommand("ghProjects.debugApi", async () => {
        const api = new github_api_1.GitHubAPI();
        const initialized = await api.initialize();
        if (!initialized) {
            vscode.window.showErrorMessage("Failed to initialize GitHub API");
            return;
        }
        // Get the current repo info
        const gitExtension = vscode.extensions.getExtension("vscode.git");
        if (!gitExtension) {
            vscode.window.showErrorMessage("Git extension not found");
            return;
        }
        if (!gitExtension.isActive) {
            await gitExtension.activate();
        }
        const git = gitExtension.exports.getAPI(1);
        if (git.repositories.length === 0) {
            vscode.window.showErrorMessage("No git repositories found");
            return;
        }
        const repo = git.repositories[0];
        const remote = repo.state.remotes.find((r) => r.name === "origin") ||
            repo.state.remotes[0];
        if (!remote?.fetchUrl) {
            vscode.window.showErrorMessage("No remote found");
            return;
        }
        const match = remote.fetchUrl.match(/github\.com[:/]([^/]+)\/(.+?)(?:\.git)?$/);
        if (!match) {
            vscode.window.showErrorMessage(`Could not parse GitHub URL: ${remote.fetchUrl}`);
            return;
        }
        const owner = match[1];
        const repoName = match[2];
        // Fetch and display debug info
        const linkedResult = await api.getLinkedProjects(owner, repoName);
        const orgProjects = await api.getOrganizationProjects(owner);
        const debugInfo = [
            `Owner: ${owner}`,
            `Repo: ${repoName}`,
            ``,
            `=== Linked (Repo) Projects (${linkedResult.projects.length}) ===${linkedResult.error ? ` ERROR: ${linkedResult.error}` : ""}`,
            ...linkedResult.projects.map((p) => `  #${p.number}: ${p.title}`),
            ``,
            `=== Organization Projects (${orgProjects.length}) ===`,
            ...orgProjects.map((p) => `  #${p.number}: ${p.title}`),
            ``,
            `=== Filtered Unique Org Projects ===`,
        ];
        const repoProjectIds = new Set(linkedResult.projects.map((p) => p.id));
        const uniqueOrgProjects = orgProjects.filter((p) => !repoProjectIds.has(p.id));
        debugInfo.push(...uniqueOrgProjects.map((p) => `  #${p.number}: ${p.title}`));
        // Create output channel and show
        const outputChannel = vscode.window.createOutputChannel("GH Projects Debug");
        outputChannel.clear();
        outputChannel.appendLine(debugInfo.join("\n"));
        vscode.window.showInformationMessage(`Found ${linkedResult.projects.length} repo projects, ${orgProjects.length} org projects`);
    }));
    // Initialize WebSocket connection if enabled
    const wsEnabled = vscode.workspace
        .getConfiguration("ghProjects.notifications")
        .get("enabled", true);
    if (wsEnabled) {
        const wsUrl = vscode.workspace
            .getConfiguration("ghProjects.notifications")
            .get("websocketUrl", "ws://localhost:8080/notifications");
        const apiKey = vscode.workspace
            .getConfiguration("ghProjects.mcp")
            .get("apiKey", "");
        // Check if connecting to localhost (no API key required)
        const isLocalhost = wsUrl.includes("localhost") ||
            wsUrl.includes("127.0.0.1") ||
            wsUrl.includes("[::1]");
        if (!apiKey && !isLocalhost) {
            // API key is required for remote connections
            notificationOutputChannel.appendLine("[WebSocket] No API key configured for remote connection. Set ghProjects.mcp.apiKey in settings to enable real-time notifications.");
            vscode.window.showWarningMessage("Configure API key in settings to enable real-time notifications from remote server");
        }
        else {
            if (isLocalhost && !apiKey) {
                notificationOutputChannel.appendLine("[WebSocket] Connecting to localhost without authentication");
            }
            // We'll connect once we have project numbers from the provider
            // The provider will call wsClient.connect() when projects are loaded
            notificationOutputChannel.appendLine("[WebSocket] Real-time notifications enabled. Will connect once projects are loaded.");
        }
    }
    else {
        notificationOutputChannel.appendLine("[WebSocket] Real-time notifications disabled in settings");
    }
    // Cleanup on deactivation
    context.subscriptions.push({
        dispose: () => {
            wsClient.disconnect();
        },
    });
}
function deactivate() { }
//# sourceMappingURL=extension.js.map