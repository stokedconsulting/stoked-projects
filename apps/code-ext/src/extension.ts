import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";
import { ProjectsViewProvider } from "./projects-view-provider";
import { GitHubAPI } from "./github-api";
import { WebSocketNotificationClient } from "./notifications/websocket-client";
import { TaskHistoryViewProvider } from "./task-history-view-provider";
import { TaskHistoryManager } from "./task-history-manager";
import { AgentDashboardProvider } from "./agent-dashboard-provider";
import { AgentSessionManager } from "./agent-session-manager";
import { AgentHeartbeatManager } from "./agent-heartbeat";
import { AgentLifecycleManager } from "./agent-lifecycle";
import { ManualOverrideControls } from "./manual-override-controls";
import { ProjectQueueManager } from "./project-queue-manager";
import { AgentExecutor } from "./agent-executor";
import { ActivityTracker } from "./activity-tracker";
import { PerformanceMetrics } from "./performance-metrics";
import { ConflictResolverProvider } from "./conflict-resolver-provider";
import { ConflictQueueManager, initializeConflictQueueManager } from "./conflict-queue-manager";

async function installClaudeCommands(context: vscode.ExtensionContext) {
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
      const sourcePath = vscode.Uri.joinPath(
        context.extensionUri,
        "commands",
        command,
      );
      try {
        const content = await vscode.workspace.fs.readFile(sourcePath);
        fs.writeFileSync(targetPath, content);
        installedCount++;
        console.log(`[claude-projects] Installed Claude command: ${command}`);
      } catch (error) {
        console.error(`[claude-projects] Failed to install ${command}:`, error);
      }
    }
  }

  if (installedCount > 0) {
    vscode.window
      .showInformationMessage(
        `Claude Projects: Installed ${installedCount} Claude command(s) to ~/.claude/commands/`,
        "Learn More",
      )
      .then((selection) => {
        if (selection === "Learn More") {
          vscode.env.openExternal(
            vscode.Uri.parse("https://github.com/anthropics/claude-code"),
          );
        }
      });
  }
}

async function installSessionWrapper(context: vscode.ExtensionContext) {
  const homeDir = require("os").homedir();
  const claudeProjectsDir = path.join(homeDir, ".claude-projects");

  // Create ~/.claude-projects if it doesn't exist
  if (!fs.existsSync(claudeProjectsDir)) {
    fs.mkdirSync(claudeProjectsDir, { recursive: true });
  }

  const wrapperFile = "claude-session-wrapper.sh";
  const targetPath = path.join(claudeProjectsDir, wrapperFile);

  // Only install if it doesn't exist
  if (!fs.existsSync(targetPath)) {
    const sourcePath = vscode.Uri.joinPath(
      context.extensionUri,
      "examples",
      wrapperFile,
    );
    try {
      const content = await vscode.workspace.fs.readFile(sourcePath);
      fs.writeFileSync(targetPath, content, { mode: 0o755 }); // Make executable
      console.log(`[claude-projects] Installed session wrapper to ~/.claude-projects/`);
      vscode.window.showInformationMessage(
        `Claude Projects: Installed session wrapper to ~/.claude-projects/`,
      );
    } catch (error) {
      console.error(`[claude-projects] Failed to install session wrapper:`, error);
    }
  }
}

export function activate(context: vscode.ExtensionContext) {
  console.log(
    'Congratulations, your extension "claude-projects-vscode" is now active!',
  );

  // Install Claude commands if needed
  installClaudeCommands(context).catch((err) => {
    console.error("[claude-projects] Failed to install Claude commands:", err);
  });

  // Install session wrapper if needed
  installSessionWrapper(context).catch((err) => {
    console.error("[claude-projects] Failed to install session wrapper:", err);
  });

  // Create output channel for notifications
  const notificationOutputChannel = vscode.window.createOutputChannel(
    "Claude Projects - Notifications",
  );
  context.subscriptions.push(notificationOutputChannel);

  // Create WebSocket client
  const wsClient = new WebSocketNotificationClient(notificationOutputChannel);

  // Create task history manager
  const taskHistoryOutputChannel = vscode.window.createOutputChannel(
    "Claude Projects - Task History",
  );
  context.subscriptions.push(taskHistoryOutputChannel);
  const taskHistoryManager = new TaskHistoryManager(context, taskHistoryOutputChannel);

  // Register projects view provider
  const provider = new ProjectsViewProvider(
    context.extensionUri,
    context,
    wsClient,
  );

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(
      ProjectsViewProvider.viewType,
      provider,
    ),
  );

  // Register task history view provider
  const taskHistoryProvider = new TaskHistoryViewProvider(
    context.extensionUri,
    taskHistoryManager,
  );

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(
      TaskHistoryViewProvider.viewType,
      taskHistoryProvider,
    ),
  );

  // Register agent dashboard (only if workspace is available)
  const workspaceFolders = vscode.workspace.workspaceFolders;
  if (workspaceFolders && workspaceFolders.length > 0) {
    const workspaceRoot = workspaceFolders[0].uri.fsPath;

    // Initialize agent management components
    const sessionManager = new AgentSessionManager(workspaceRoot);
    const heartbeatManager = new AgentHeartbeatManager(sessionManager);
    const lifecycleManager = new AgentLifecycleManager(workspaceRoot);

    // Initialize GitHub API (will be used by ProjectQueueManager and AgentExecutor)
    const githubApi = new GitHubAPI();

    // Initialize project queue manager and agent executor
    // Note: projectId should come from configuration in production
    const projectId = 'PVT_kwDOAtJY_s4BLYHh'; // Placeholder project ID
    const queueManager = new ProjectQueueManager(workspaceRoot, githubApi);
    const executor = new AgentExecutor(workspaceRoot, githubApi, projectId);

    // Initialize activity tracker
    const activityTracker = new ActivityTracker(workspaceRoot);

    // Initialize performance metrics tracker
    const performanceMetrics = new PerformanceMetrics(workspaceRoot, sessionManager);

    // Initialize conflict queue manager
    const conflictQueueManager = initializeConflictQueueManager(workspaceRoot);

    // Initialize manual override controls
    const manualOverrideControls = new ManualOverrideControls(
      lifecycleManager,
      sessionManager,
      queueManager,
      executor
    );

    // Register agent dashboard view provider
    const agentDashboardProvider = new AgentDashboardProvider(
      context.extensionUri,
      context,
      sessionManager,
      heartbeatManager,
      lifecycleManager,
      manualOverrideControls,
      activityTracker,
      performanceMetrics
    );

    context.subscriptions.push(
      vscode.window.registerWebviewViewProvider(
        AgentDashboardProvider.viewType,
        agentDashboardProvider,
      ),
    );

    // Register conflict resolver view provider
    const conflictResolverProvider = new ConflictResolverProvider(
      context.extensionUri,
      context,
      conflictQueueManager,
      queueManager
    );

    context.subscriptions.push(
      vscode.window.registerWebviewViewProvider(
        ConflictResolverProvider.viewType,
        conflictResolverProvider,
      ),
    );

    console.log("[claude-projects] Conflict resolver registered");

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
  } else {
    console.log("[claude-projects] No workspace folder, skipping agent dashboard");
  }

  // Watch for workspace folder changes and refresh
  context.subscriptions.push(
    vscode.workspace.onDidChangeWorkspaceFolders(() => {
      console.log("[claude-projects] Workspace folder changed, refreshing...");
      provider.refresh();
    }),
  );

  // Watch for active text editor changes (switching between projects)
  context.subscriptions.push(
    vscode.window.onDidChangeActiveTextEditor(() => {
      // Debounce this to avoid excessive refreshes
      if (provider.shouldRefreshOnEditorChange()) {
        console.log(
          "[claude-projects] Active editor changed to different repo, refreshing...",
        );
        provider.refresh();
      }
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("claudeProjects.refresh", () => {
      provider.refresh();
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("claudeProjects.viewActiveSessions", () => {
      provider.viewActiveSessions();
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("claudeProjects.stopAllSessions", () => {
      provider.stopAllSessions();
    }),
  );

  // Debug command to diagnose API responses
  context.subscriptions.push(
    vscode.commands.registerCommand("claudeProjects.debugApi", async () => {
      const api = new GitHubAPI();
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
      const remote =
        repo.state.remotes.find((r: any) => r.name === "origin") ||
        repo.state.remotes[0];

      if (!remote?.fetchUrl) {
        vscode.window.showErrorMessage("No remote found");
        return;
      }

      const match = remote.fetchUrl.match(
        /github\.com[:/]([^/]+)\/(.+?)(?:\.git)?$/,
      );
      if (!match) {
        vscode.window.showErrorMessage(
          `Could not parse GitHub URL: ${remote.fetchUrl}`,
        );
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
      const uniqueOrgProjects = orgProjects.filter(
        (p) => !repoProjectIds.has(p.id),
      );
      debugInfo.push(
        ...uniqueOrgProjects.map((p) => `  #${p.number}: ${p.title}`),
      );

      // Create output channel and show
      const outputChannel =
        vscode.window.createOutputChannel("GH Projects Debug");
      outputChannel.clear();
      outputChannel.appendLine(debugInfo.join("\n"));

      vscode.window.showInformationMessage(
        `Found ${linkedResult.projects.length} repo projects, ${orgProjects.length} org projects`,
      );
    }),
  );

  // Initialize WebSocket connection if enabled
  const wsEnabled = vscode.workspace
    .getConfiguration("claudeProjects.notifications")
    .get<boolean>("enabled", true);
  if (wsEnabled) {
    const wsUrl = vscode.workspace
      .getConfiguration("claudeProjects.notifications")
      .get<string>("websocketUrl", "ws://localhost:8080/notifications");
    const apiKey = vscode.workspace
      .getConfiguration("claudeProjects.mcp")
      .get<string>("apiKey", "");

    // Check if connecting to localhost (no API key required)
    const isLocalhost =
      wsUrl.includes("localhost") ||
      wsUrl.includes("127.0.0.1") ||
      wsUrl.includes("[::1]");

    if (!apiKey && !isLocalhost) {
      // API key is required for remote connections
      notificationOutputChannel.appendLine(
        "[WebSocket] No API key configured for remote connection. Set claudeProjects.mcp.apiKey in settings to enable real-time notifications.",
      );
      vscode.window.showWarningMessage(
        "Configure API key in settings to enable real-time notifications from remote server",
      );
    } else {
      if (isLocalhost && !apiKey) {
        notificationOutputChannel.appendLine(
          "[WebSocket] Connecting to localhost without authentication",
        );
      }
      // We'll connect once we have project numbers from the provider
      // The provider will call wsClient.connect() when projects are loaded
      notificationOutputChannel.appendLine(
        "[WebSocket] Real-time notifications enabled. Will connect once projects are loaded.",
      );
    }
  } else {
    notificationOutputChannel.appendLine(
      "[WebSocket] Real-time notifications disabled in settings",
    );
  }

  // Cleanup on deactivation
  context.subscriptions.push({
    dispose: () => {
      wsClient.disconnect();
      provider.dispose();
    },
  });
}

export function deactivate() {}
