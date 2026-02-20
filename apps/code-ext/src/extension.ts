import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";
import { ProjectsViewProvider } from "./projects-view-provider";
import { GitHubAPI } from "./github-api";
// DEPRECATED: WebSocketNotificationClient replaced by OrchestrationWebSocketClient for real-time project events
// import { WebSocketNotificationClient } from "./notifications/websocket-client";
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
import { ApiServiceManager } from "./api-service-manager-v2";
import { runMetaEvaluation } from "./meta-evaluator";
import { AgentOrchestrator, OrchestratorConfig } from "@stoked-projects/agent";
import { getAgentConfig } from "./agent-config";

async function installClaudeCommands(context: vscode.ExtensionContext) {
  const homeDir = require("os").homedir();
  const claudeCommandsDir = path.join(homeDir, ".claude", "commands");

  // Create ~/.claude/commands and subdirectories if they don't exist
  const subdirs = ["prompts", "template"];
  if (!fs.existsSync(claudeCommandsDir)) {
    fs.mkdirSync(claudeCommandsDir, { recursive: true });
  }
  for (const subdir of subdirs) {
    const subdirPath = path.join(claudeCommandsDir, subdir);
    if (!fs.existsSync(subdirPath)) {
      fs.mkdirSync(subdirPath, { recursive: true });
    }
  }

  // Top-level command files
  const commands = [
    "review-item.md",
    "review-phase.md",
    "review-project.md",
    "project-start.md",
    "project-create.md",
    "project-integrate.md",
  ];

  // Prompt files (installed to ~/.claude/commands/prompts/)
  const prompts = [
    "PROJECT_ORCHESTRATOR.md",
    "PRODUCT_REQUIREMENTS_DOCUMENT.md",
    "PRODUCT_FEATURE_BRIEF.md",
    "PROJECT_ORCHESTRATOR_IMPROVEMENTS.md",
    "PROBLEM_DESCRIPTION_PREPROCESSOR.md",
  ];

  // Template files (installed to ~/.claude/commands/template/)
  const templates = [
    "PRODUCT_REQUIREMENTS_DOCUMENT.md",
    "PRODUCT_FEATURE_BRIEF.md",
  ];

  // Build a flat list of { sourcePath, targetPath } for all files
  const installItems: Array<{ sourceRelative: string; targetPath: string; label: string }> = [];

  for (const cmd of commands) {
    installItems.push({
      sourceRelative: cmd,
      targetPath: path.join(claudeCommandsDir, cmd),
      label: cmd,
    });
  }
  for (const prompt of prompts) {
    installItems.push({
      sourceRelative: path.join("prompts", prompt),
      targetPath: path.join(claudeCommandsDir, "prompts", prompt),
      label: `prompts/${prompt}`,
    });
  }
  for (const template of templates) {
    installItems.push({
      sourceRelative: path.join("template", template),
      targetPath: path.join(claudeCommandsDir, "template", template),
      label: `template/${template}`,
    });
  }

  let installedCount = 0;

  for (const item of installItems) {
    const sourcePath = vscode.Uri.joinPath(
      context.extensionUri,
      "commands",
      item.sourceRelative,
    );

    try {
      const content = await vscode.workspace.fs.readFile(sourcePath);
      const newContent = Buffer.from(content).toString("utf8");

      // Check if file exists and content is different
      let shouldInstall = true;
      if (fs.existsSync(item.targetPath)) {
        const existingContent = fs.readFileSync(item.targetPath, "utf8");
        shouldInstall = existingContent !== newContent;
      }

      if (shouldInstall) {
        fs.writeFileSync(item.targetPath, content);
        installedCount++;
        console.log(`[stoked-projects] Installed/updated Claude command: ${item.label}`);
      }
    } catch (error) {
      console.error(`[stoked-projects] Failed to install ${item.label}:`, error);
    }
  }

  if (installedCount > 0) {
    vscode.window
      .showInformationMessage(
        `Stoked Projects: Installed ${installedCount} Claude command(s) to ~/.claude/commands/`,
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
  const claudeProjectsDir = path.join(homeDir, ".stoked-projects");

  // Create ~/.stoked-projects if it doesn't exist
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
      console.log(`[stoked-projects] Installed session wrapper to ~/.stoked-projects/`);
      vscode.window.showInformationMessage(
        `Stoked Projects: Installed session wrapper to ~/.stoked-projects/`,
      );
    } catch (error) {
      console.error(`[stoked-projects] Failed to install session wrapper:`, error);
    }
  }
}

async function installCategoryPrompts(context: vscode.ExtensionContext) {
  const homeDir = require("os").homedir();
  const genericDir = path.join(homeDir, ".stoked-projects", "generic");

  // Create ~/.stoked-projects/generic if it doesn't exist
  if (!fs.existsSync(genericDir)) {
    fs.mkdirSync(genericDir, { recursive: true });
  }

  const sourceDir = vscode.Uri.joinPath(
    context.extensionUri,
    "commands",
    "category-prompts",
  );

  try {
    const entries = await vscode.workspace.fs.readDirectory(sourceDir);
    let installedCount = 0;

    for (const [name, type] of entries) {
      if (type !== vscode.FileType.File || !name.endsWith(".md")) {
        continue;
      }

      const sourcePath = vscode.Uri.joinPath(sourceDir, name);
      const targetPath = path.join(genericDir, name);

      try {
        const content = await vscode.workspace.fs.readFile(sourcePath);
        const newContent = Buffer.from(content).toString("utf8");

        let shouldInstall = true;
        if (fs.existsSync(targetPath)) {
          const existingContent = fs.readFileSync(targetPath, "utf8");
          shouldInstall = existingContent !== newContent;
        }

        if (shouldInstall) {
          fs.writeFileSync(targetPath, content);
          installedCount++;
          console.log(`[stoked-projects] Installed/updated category prompt: ${name}`);
        }
      } catch (error) {
        console.error(`[stoked-projects] Failed to install category prompt ${name}:`, error);
      }
    }

    if (installedCount > 0) {
      console.log(`[stoked-projects] Installed ${installedCount} category prompt(s) to ~/.stoked-projects/generic/`);
    }
  } catch (error) {
    console.error("[stoked-projects] Failed to install category prompts:", error);
  }
}

export function activate(context: vscode.ExtensionContext) {
  console.log(
    'Congratulations, your extension "stoked-projects-vscode" is now active!',
  );

  // Install Claude commands if needed
  installClaudeCommands(context).catch((err) => {
    console.error("[stoked-projects] Failed to install Claude commands:", err);
  });

  // Install session wrapper if needed
  installSessionWrapper(context).catch((err) => {
    console.error("[stoked-projects] Failed to install session wrapper:", err);
  });

  // Install category prompts to ~/.stoked-projects/generic/
  installCategoryPrompts(context).catch((err) => {
    console.error("[stoked-projects] Failed to install category prompts:", err);
  });

  // Create output channel for meta evaluation
  const metaEvalOutputChannel = vscode.window.createOutputChannel(
    "Stoked Projects - Meta Evaluation",
  );
  context.subscriptions.push(metaEvalOutputChannel);

  // Run meta evaluation (generate CP_OVERVIEW, CP_TEST docs if missing)
  runMetaEvaluation(context, metaEvalOutputChannel).catch((err) => {
    metaEvalOutputChannel.appendLine(`[Meta Eval] FATAL: ${err}`);
    console.error("[stoked-projects] Meta evaluation failed:", err);
  });

  // Create output channel for notifications
  const notificationOutputChannel = vscode.window.createOutputChannel(
    "Stoked Projects - Notifications",
  );
  context.subscriptions.push(notificationOutputChannel);

  // Initialize and start the API service (must happen before ProjectsViewProvider connects)
  const apiServiceManager = new ApiServiceManager(context, notificationOutputChannel);
  apiServiceManager.initialize().then((success) => {
    if (success) {
      console.log("[stoked-projects] API service started successfully");
    } else {
      console.warn("[stoked-projects] API service failed to start — orchestration features may be unavailable");
    }
  }).catch((err) => {
    console.error("[stoked-projects] API service initialization error:", err);
  });
  context.subscriptions.push({
    dispose: () => {
      apiServiceManager.stop().catch((err) => {
        console.error("[stoked-projects] Error stopping API service during deactivation:", err);
      });
    },
  });

  // DEPRECATED: Old WebSocket notification client removed.
  // Real-time project events now flow through the OrchestrationWebSocketClient.

  // Create task history manager
  const taskHistoryOutputChannel = vscode.window.createOutputChannel(
    "Stoked Projects - Task History",
  );
  context.subscriptions.push(taskHistoryOutputChannel);
  const taskHistoryManager = new TaskHistoryManager(context, taskHistoryOutputChannel);

  // Register projects view provider
  const provider = new ProjectsViewProvider(
    context.extensionUri,
    context,
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
    taskHistoryOutputChannel,
  );

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(
      TaskHistoryViewProvider.viewType,
      taskHistoryProvider,
    ),
  );

  // Register agent dashboard (only if workspace is available)
  // Declare orchestrator outside the if-block so it's accessible in the config change listener
  let orchestrator: AgentOrchestrator | undefined;

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

    console.log("[stoked-projects] Conflict resolver registered");

    // Store references for cleanup
    context.subscriptions.push({
      dispose: () => {
        heartbeatManager.stopAllHeartbeats();
        if (orchestrator) {
          orchestrator.stop().catch((err) => {
            console.error("[stoked-projects] Error stopping orchestrator during deactivation:", err);
          });
        }
        lifecycleManager.stopAllAgents().catch((err) => {
          console.error("[stoked-projects] Error stopping agents during deactivation:", err);
        });
      }
    });

    // Async orchestrator initialization — get GitHub token, then create orchestrator
    // and pass it to lifecycleManager via setOrchestrator().
    (async () => {
      try {
        let githubToken = '';
        try {
          const ghSession = await vscode.authentication.getSession(
            'github',
            ['repo', 'read:org', 'read:project', 'project'],
            { createIfNone: false }
          );
          githubToken = ghSession?.accessToken ?? '';
        } catch (e) {
          console.warn('[stoked-projects] Could not get GitHub token for orchestrator:', e);
        }

        const agentConfig = getAgentConfig();
        const homeDir = require('os').homedir();
        const categoryPromptsDir = path.join(homeDir, '.stoked-projects', 'generic');

        const orchestratorConfig: OrchestratorConfig = {
          workspaceRoot,
          githubToken,
          desiredInstances: agentConfig.maxConcurrent,
          dailyBudgetUsd: agentConfig.dailyBudgetUSD,
          monthlyBudgetUsd: agentConfig.monthlyBudgetUSD,
          maxBudgetPerTaskUsd: 5,
          maxBudgetPerReviewUsd: 2,
          maxBudgetPerIdeationUsd: 1,
          maxTurnsPerTask: 50,
          projectId,
          owner: '',
          repo: '',
          categoryPromptsDir,
          events: {
            onStatusChange: (agentId, from, to) => {
              console.log(`[stoked-projects] Agent ${agentId}: ${from} -> ${to}`);
            },
            onError: (agentId, error) => {
              console.error(`[stoked-projects] Agent ${agentId} error:`, error.message);
              vscode.window.showErrorMessage(`Agent ${agentId} error: ${error.message}`);
            },
            onCostUpdate: (agentId, costUsd) => {
              console.log(`[stoked-projects] Agent ${agentId} cost update: $${costUsd.toFixed(4)}`);
            },
          },
        };

        orchestrator = new AgentOrchestrator(orchestratorConfig);

        // Wire orchestrator to lifecycle manager so it can use it
        lifecycleManager.setOrchestrator(orchestrator);

        console.log('[stoked-projects] AgentOrchestrator created and wired to lifecycle manager');
      } catch (e) {
        console.error('[stoked-projects] Failed to create orchestrator:', e);
        vscode.window.showErrorMessage('Failed to initialize agent orchestrator. Agent features may be unavailable.');
      }
    })();

    console.log("[stoked-projects] Agent dashboard registered");
  } else {
    console.log("[stoked-projects] No workspace folder, skipping agent dashboard");
  }

  // Listen for agent config changes to update orchestrator desired instances
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('claudeProjects.agents.maxConcurrent') && orchestrator) {
        const newConfig = getAgentConfig();
        orchestrator.setDesiredInstances(newConfig.maxConcurrent);
        console.log(`[stoked-projects] Updated desired instances to ${newConfig.maxConcurrent}`);
      }
    })
  );

  // Watch for workspace folder changes and refresh
  context.subscriptions.push(
    vscode.workspace.onDidChangeWorkspaceFolders(() => {
      console.log("[stoked-projects] Workspace folder changed, refreshing...");
      provider.refresh();
    }),
  );

  // Watch for active text editor changes (switching between projects)
  context.subscriptions.push(
    vscode.window.onDidChangeActiveTextEditor(() => {
      // Debounce this to avoid excessive refreshes
      if (provider.shouldRefreshOnEditorChange()) {
        console.log(
          "[stoked-projects] Active editor changed to different repo, refreshing...",
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

  // Re-authenticate GitHub (force new session to pick up new org/repo access)
  context.subscriptions.push(
    vscode.commands.registerCommand("claudeProjects.reauthGithub", async () => {
      try {
        const session = await vscode.authentication.getSession(
          "github",
          ["repo", "read:org", "read:project", "project"],
          { forceNewSession: true },
        );
        if (session) {
          vscode.window.showInformationMessage(
            `Re-authenticated as ${session.account.label}. Refreshing...`,
          );
          provider.refresh();
        }
      } catch (e) {
        vscode.window.showErrorMessage(`Re-authentication failed: ${e}`);
      }
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

  // Real-time notifications now handled by OrchestrationWebSocketClient inside ProjectsViewProvider
  notificationOutputChannel.appendLine(
    "[Notifications] Real-time project events flow through OrchestrationWebSocketClient",
  );

  // Cleanup on deactivation
  context.subscriptions.push({
    dispose: () => {
      provider.dispose();
    },
  });
}

export function deactivate() { }
