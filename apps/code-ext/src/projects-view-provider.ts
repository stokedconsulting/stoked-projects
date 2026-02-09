import * as vscode from "vscode";
import { GitHubAPI, Project, ProjectItem } from "./github-api";
import { APIClient } from "./api-client";
import { groupItemsByPhase, calculatePhaseStatus } from "./phase-logic";
import { ClaudeMonitor } from "./claude-monitor";
import { CacheManager } from "./cache-manager";
import { calculateDataDiff, hasChanges } from "./diff-calculator";
import { ProjectFlowManager } from "./project-flow-manager";
import { ClaudeAPI } from "./claude-api";
import { LlmActivityTracker } from "./llm-activity-tracker";
import { getAgentConfig } from "./agent-config";
import { AutoAssignmentEngine } from "./auto-assignment-engine";
import { GenericPromptManager } from "./generic-prompt-manager";
// DEPRECATED: GitHubProjectCreator removed - use MCP Server tools instead
// See: docs/mcp-migration-guide.md
import {
  detectFilePath,
  getTypeaheadResults,
  extractInput,
} from "./input-detection";
import { exec } from "child_process";
import { promisify } from "util";
// DEPRECATED: WebSocketNotificationClient replaced by OrchestrationWebSocketClient
// import { WebSocketNotificationClient, WebSocketEvent } from "./notifications/websocket-client";
import { OrchestrationWebSocketClient } from "./orchestration-websocket-client";

const execAsync = promisify(exec);

/**
 * Unified GitHub client interface
 * Wraps either GitHubAPI (direct GraphQL) or APIClient (HTTP API)
 */
interface IUnifiedGitHubClient {
  initialize(): Promise<boolean>;
  getLinkedProjects(
    owner: string,
    repo: string,
  ): Promise<{
    projects: Project[];
    repositoryId?: string;
    error?: string;
    errors?: any[];
  }>;
  getOrganizationProjects(owner: string): Promise<Project[]>;
  getProjectItems(projectId: string): Promise<ProjectItem[]>;
  getProjectFields(projectId: string): Promise<any[]>;
  updateItemFieldValue(
    projectId: string,
    itemId: string,
    fieldId: string,
    optionId: string,
  ): Promise<boolean>;
  deleteProjectItem(projectId: string, itemId: string): Promise<boolean>;
  deleteProject(projectId: string): Promise<boolean>;
  linkProjectToRepository(
    projectId: string,
    repositoryId: string,
  ): Promise<boolean>;
  unlinkProjectFromRepository(
    projectId: string,
    repositoryId: string,
  ): Promise<boolean>;
  getRepositoryId(owner: string, repo: string): Promise<string | null>;
  closeIssue(
    owner: string,
    repo: string,
    issueNumber: number,
  ): Promise<boolean>;
  updateWorkspaceDesired(
    workspaceId: string,
    desired: number,
  ): Promise<{
    workspace: { workspace_id: string; running: number; desired: number };
    global: { running: number; desired: number };
  } | null>;
  getWorkspaceOrchestration(workspaceId: string): Promise<{
    workspace: { workspace_id: string; running: number; desired: number };
    global: { running: number; desired: number };
  } | null>;
}

export class ProjectsViewProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = "claudeProjects.view";
  private _view?: vscode.WebviewView;
  private _githubAPI: IUnifiedGitHubClient;
  private _orchestrationClient: APIClient; // Separate client for orchestration (always uses API)
  private _claudeMonitor?: ClaudeMonitor;
  private _workspaceCountInterval?: NodeJS.Timeout;
  private _llmActivityTracker?: LlmActivityTracker;
  private _llmActivityInterval?: NodeJS.Timeout;
  private _concurrencyDebounce?: NodeJS.Timeout;
  private _autoAssignment?: AutoAssignmentEngine;
  private _promptManager?: GenericPromptManager;
  private _cacheManager: CacheManager;
  private _currentOwner?: string;
  private _currentRepo?: string;
  private _currentRepoId?: string; // Cache the repository node ID
  private _lastRepoCheck?: string; // Track last checked repo for debouncing
  private _refreshPromise?: Promise<void>; // Dedup concurrent refreshes
  private _hasDisplayedData = false; // Track if we've shown data to the user
  private _projectFlowManager?: ProjectFlowManager;
  private _claudeAPI?: ClaudeAPI;
  // DEPRECATED: _projectCreator removed - use MCP Server tools instead
  private _outputChannel: vscode.OutputChannel;
  private _showOrgProjects: boolean = false; // Default to repo mode (matches webview default)
  // DEPRECATED: _wsClient removed — real-time events flow through _orchestrationWsClient
  private _orchestrationWsClient?: OrchestrationWebSocketClient; // WebSocket for orchestration sync
  private _activeProjectNumbers: number[] = [];
  private _orchestrationData: {
    workspace: {
      running: number;
      desired: number;
    };
    global: {
      running: number;
      desired: number;
    };
  };

  constructor(
    private readonly _extensionUri: vscode.Uri,
    private readonly _context: vscode.ExtensionContext,
    _wsClient?: any, // DEPRECATED: kept for backwards compatibility but unused
  ) {
    this._outputChannel = vscode.window.createOutputChannel("Claude Projects");

    // Check configuration for API service usage
    const config = vscode.workspace.getConfiguration("claudeProjects");
    const useAPIService = config.get<boolean>("useAPIService", false);
    const apiBaseUrl = config.get<string>(
      "apiBaseUrl",
      "https://claude-projects.truapi.com",
    );

    // ALWAYS create orchestration client for API (orchestration doesn't need GitHub token)
    this._orchestrationClient = new APIClient(
      { baseUrl: apiBaseUrl },
      this._outputChannel,
    );
    this._outputChannel.appendLine("[Init] Orchestration client created (always uses API)");

    // Create GitHub client based on config (for projects)
    if (useAPIService) {
      this._outputChannel.appendLine("[Init] Using HTTP API client for projects (will fallback to GraphQL if unreachable)");
      this._githubAPI = new APIClient(
        { baseUrl: apiBaseUrl },
        this._outputChannel,
      );
    } else {
      this._outputChannel.appendLine("[Init] Using direct GraphQL client for projects");
      this._githubAPI = new GitHubAPI(this._outputChannel);
    }

    this._cacheManager = new CacheManager(_context);
    this._projectFlowManager = new ProjectFlowManager(_context);
    this._claudeAPI = new ClaudeAPI();
    // DEPRECATED: _projectCreator removed - use MCP Server tools instead
    // Initialize orchestration data from context or defaults
    const savedOrchestration = _context.workspaceState.get<any>('orchestrationData');
    this._orchestrationData = savedOrchestration || {
      workspace: {
        running: 0,
        desired: 0,
      },
      global: {
        running: 0,
        desired: 0,
      },
    };
  }

  // DEPRECATED: setupWebSocketHandlers and handleWebSocketUpdate removed.
  // Real-time project events now flow through handleGranularProjectEvent
  // via the OrchestrationWebSocketClient's project.event Socket.io listener.

  /**
   * Handle granular project events from the orchestration WebSocket.
   * Dispatches specific messages to the webview for DOM-level updates without full refresh.
   */
  private handleGranularProjectEvent(event: { type: string; data: Record<string, any> }): void {
    if (!this._view) return;

    const { type, data } = event;

    switch (type) {
      case 'issue.updated':
        this._outputChannel.appendLine(
          `[GranularEvent] Issue updated: project=${data.projectNumber}, issue=${data.issueNumber}, status=${data.status}`
        );
        this._view.webview.postMessage({
          type: 'itemStatusUpdate',
          projectNumber: data.projectNumber,
          issueNumber: data.issueNumber,
          status: data.status,
          title: data.title,
          state: data.state,
          phaseName: data.phaseName,
          updatedFields: data.updatedFields,
        });
        break;

      case 'issue.created':
        this._outputChannel.appendLine(
          `[GranularEvent] Issue created: project=${data.projectNumber}, issue=${data.issueNumber}`
        );
        this._view.webview.postMessage({
          type: 'itemAdded',
          projectNumber: data.projectNumber,
          issueNumber: data.issueNumber,
          title: data.title,
          url: data.url,
          state: data.state,
          owner: data.owner,
          repo: data.repo,
          labels: data.labels,
        });
        break;

      case 'issue.closed':
        this._outputChannel.appendLine(
          `[GranularEvent] Issue closed: project=${data.projectNumber}, issue=${data.issueNumber}`
        );
        this._view.webview.postMessage({
          type: 'itemStatusUpdate',
          projectNumber: data.projectNumber,
          issueNumber: data.issueNumber,
          status: 'Done',
          state: 'CLOSED',
        });
        break;

      case 'issue.deleted':
        this._outputChannel.appendLine(
          `[GranularEvent] Issue deleted: project=${data.projectNumber}, item=${data.itemId}`
        );
        if (data.itemId) {
          this._view.webview.postMessage({
            type: 'removeItem',
            projectId: '', // Will be resolved by item ID in webview
            itemId: data.itemId,
          });
        }
        break;

      case 'project.created':
        this._outputChannel.appendLine(
          `[GranularEvent] Project created: number=${data.projectNumber}, title=${data.title}`
        );
        // Immediately subscribe to this project's events so we don't miss
        // issue.created events that arrive while the refresh is still running
        if (data.projectNumber && !this._activeProjectNumbers.includes(data.projectNumber)) {
          this._activeProjectNumbers.push(data.projectNumber);
          this.updateProjectSubscriptions(this._activeProjectNumbers);
          this._outputChannel.appendLine(
            `[GranularEvent] Pre-subscribed to project #${data.projectNumber} for real-time events`
          );
        }
        // Send project stub to webview so it appears immediately
        this._view.webview.postMessage({
          type: 'projectCreated',
          projectNumber: data.projectNumber,
          title: data.title || `Project #${data.projectNumber}`,
          url: data.url,
        });
        // Also trigger a full refresh to get complete project data
        this.refresh();
        break;

      case 'project.updated':
        this._outputChannel.appendLine(
          `[GranularEvent] Project updated: number=${data.projectNumber}`
        );
        this._view.webview.postMessage({
          type: 'projectMetadataUpdate',
          projectNumber: data.projectNumber,
          title: data.title,
          state: data.state,
        });
        break;

      case 'worktree.updated':
        this._outputChannel.appendLine(
          `[GranularEvent] Worktree updated: project=${data.projectNumber}, branch=${(data.worktree as any)?.branch}`
        );
        this._view.webview.postMessage({
          type: 'worktreeStatusUpdate',
          projectNumber: data.projectNumber,
          worktree: data.worktree,
        });
        break;

      default:
        this._outputChannel.appendLine(
          `[GranularEvent] Unknown event type: ${type}`
        );
    }
  }

  /**
   * Update subscribed project numbers on the orchestration WebSocket
   */
  private updateProjectSubscriptions(projectNumbers: number[]): void {
    this._activeProjectNumbers = projectNumbers;
    if (this._orchestrationWsClient?.isConnected()) {
      this._orchestrationWsClient.subscribeProjects(projectNumbers);
    }
  }

  /**
   * Get orchestration data
   */
  private getOrchestrationData(): {
    workspace: {
      running: number;
      desired: number;
    };
    global: {
      running: number;
      desired: number;
    };
  } {
    return this._orchestrationData;
  }

  /**
   * Update orchestration data (e.g., from API or external source)
   */
  private setOrchestrationData(data: Partial<{
    workspace?: Partial<{
      running: number;
      desired: number;
    }>;
    global?: Partial<{
      running: number;
      desired: number;
    }>;
  }>): void {
    // Deep merge the partial updates
    if (data.workspace) {
      this._orchestrationData.workspace = {
        ...this._orchestrationData.workspace,
        ...data.workspace,
      };
    }
    if (data.global) {
      this._orchestrationData.global = {
        ...this._orchestrationData.global,
        ...data.global,
      };
    }

    // Save to workspace state
    this._context.workspaceState.update('orchestrationData', this._orchestrationData);

    // Notify webview
    this.sendOrchestrationData();
  }


  /**
   * Send orchestration data to webview
   */
  private sendOrchestrationData(): void {
    if (!this._view) return;

    const data = this.getOrchestrationData();
    this._view.webview.postMessage({
      type: "orchestrationData",
      data,
    });
  }

  /**
   * Update workspace running count from ClaudeMonitor
   */
  private updateWorkspaceRunningCount(): void {
    if (!this._claudeMonitor) {
      return;
    }

    try {
      const count = this._claudeMonitor.countWorkspaceActiveSessions();

      // Update orchestration data if count changed
      if (this._orchestrationData.workspace.running !== count) {
        this.setOrchestrationData({
          workspace: {
            running: count
          }
        });
      }
    } catch (error) {
      console.error('Error updating workspace running count:', error);
    }
  }

  /**
   * Start periodic workspace count updates
   */
  private startWorkspaceCountUpdates(): void {
    // Update immediately
    this.updateWorkspaceRunningCount();

    // Then update every 10 seconds
    if (this._workspaceCountInterval) {
      clearInterval(this._workspaceCountInterval);
    }

    this._workspaceCountInterval = setInterval(() => {
      this.updateWorkspaceRunningCount();
    }, 10000); // 10 seconds
  }

  /**
   * Stop periodic workspace count updates
   */
  private stopWorkspaceCountUpdates(): void {
    if (this._workspaceCountInterval) {
      clearInterval(this._workspaceCountInterval);
      this._workspaceCountInterval = undefined;
    }
  }

  /**
   * Start periodic LLM activity updates for status bar
   */
  private startLlmActivityUpdates(): void {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders || workspaceFolders.length === 0) {
      return;
    }

    const workspaceRoot = workspaceFolders[0].uri.fsPath;

    if (!this._llmActivityTracker) {
      this._llmActivityTracker = new LlmActivityTracker(workspaceRoot);
    }

    // Initialize prompt manager and auto-assignment engine
    if (!this._promptManager) {
      this._promptManager = new GenericPromptManager(workspaceRoot);
    }
    if (!this._autoAssignment) {
      this._autoAssignment = new AutoAssignmentEngine(this._promptManager, this._llmActivityTracker);
      this._autoAssignment.start();
    }

    // Send updates every 2 seconds
    this._llmActivityInterval = setInterval(() => {
      this.sendLlmActivityUpdate();
    }, 2000);

    // Send immediate update
    this.sendLlmActivityUpdate();
  }

  /**
   * Stop periodic LLM activity updates
   */
  private stopLlmActivityUpdates(): void {
    if (this._llmActivityInterval) {
      clearInterval(this._llmActivityInterval);
      this._llmActivityInterval = undefined;
    }
    if (this._llmActivityTracker) {
      this._llmActivityTracker.dispose();
      this._llmActivityTracker = undefined;
    }
    if (this._autoAssignment) {
      this._autoAssignment.dispose();
      this._autoAssignment = undefined;
    }
    this._promptManager = undefined;
  }

  /**
   * Send LLM activity update to webview
   */
  private sendLlmActivityUpdate(): void {
    if (!this._view || !this._llmActivityTracker) {
      return;
    }

    try {
      this._llmActivityTracker.refresh();
      const active = this._llmActivityTracker.getActiveSessionCount();
      const allocated = getAgentConfig().maxConcurrent;
      const sessions = this._llmActivityTracker.getActiveSessions();
      const autoAssignEnabled = this._autoAssignment?.isEnabled() || false;
      const hasIdleCapacity = this._autoAssignment?.hasIdleCapacity() || false;

      this._view.webview.postMessage({
        type: 'llmActivityUpdate',
        active,
        allocated,
        sessions,
        autoAssignEnabled,
        hasIdleCapacity
      });
    } catch (error) {
      console.error('Error sending LLM activity update:', error);
    }
  }

  /**
   * Test API connectivity by making a health check request
   */
  private async testAPIConnection(): Promise<boolean> {
    try {
      const config = vscode.workspace.getConfiguration("claudeProjects");
      const apiBaseUrl = config.get<string>(
        "apiBaseUrl",
        "http://localhost:8167",
      );

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 2000); // 2 second timeout

      const response = await fetch(`${apiBaseUrl}/health`, {
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      return response.ok;
    } catch (error) {
      this._outputChannel.appendLine(`[Init] API health check failed: ${error}`);
      return false;
    }
  }

  /**
   * Fetch orchestration data from API on startup
   */
  private async fetchOrchestrationData(): Promise<void> {
    try {
      const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
      if (!workspaceFolder) {
        return;
      }

      const workspaceId = workspaceFolder.uri.fsPath;

      this._outputChannel.appendLine(
        `[Orchestration] Fetching initial data for workspace: ${workspaceId}`,
      );

      const result = await this._orchestrationClient.getWorkspaceOrchestration(workspaceId);

      if (result) {
        this.setOrchestrationData({
          workspace: {
            running: result.workspace.running,
            desired: result.workspace.desired,
          },
          global: {
            running: result.global.running,
            desired: result.global.desired,
          },
        });

        this._outputChannel.appendLine(
          `[Orchestration] Fetched initial data. Workspace: running=${result.workspace.running}, desired=${result.workspace.desired}. Global: running=${result.global.running}, desired=${result.global.desired}`,
        );
      }

      // Initialize orchestration WebSocket after fetching initial data
      await this.initializeOrchestrationWebSocket();
    } catch (error) {
      this._outputChannel.appendLine(
        `[Orchestration] Error fetching initial data: ${error}`,
      );
    }
  }

  /**
   * Initialize and connect to the orchestration WebSocket
   * This enables real-time synchronization of running/desired counts across all IDE instances
   */
  private async initializeOrchestrationWebSocket(): Promise<void> {
    try {
      const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
      if (!workspaceFolder) {
        return;
      }

      const workspaceId = workspaceFolder.uri.fsPath;
      const config = vscode.workspace.getConfiguration("claudeProjects");
      const apiBaseUrl = config.get<string>(
        "apiBaseUrl",
        "https://claude-projects.truapi.com",
      );

      // Check if this is a localhost connection
      const isLocalhost = apiBaseUrl.includes('localhost') || apiBaseUrl.includes('127.0.0.1');

      // Get API key for authentication (skip for localhost)
      let apiKey: string | undefined;
      if (!isLocalhost) {
        const session = await vscode.authentication.getSession(
          'github',
          ['repo', 'read:org', 'read:project', 'project'],
          { createIfNone: false }
        );
        apiKey = session?.accessToken;
      }

      // Create and connect orchestration WebSocket client
      this._orchestrationWsClient = new OrchestrationWebSocketClient(this._outputChannel);

      // Register event handlers BEFORE connecting
      this._orchestrationWsClient.onGlobalUpdate((global) => {
        this._outputChannel.appendLine(
          `[OrchestrationSync] Global update received: running=${global.running}, desired=${global.desired}`
        );

        // Update local state with new global values
        this.setOrchestrationData({
          global: {
            running: global.running,
            desired: global.desired,
          },
        });
      });

      this._orchestrationWsClient.onWorkspaceUpdate((workspace) => {
        this._outputChannel.appendLine(
          `[OrchestrationSync] Workspace update received: running=${workspace.running}, desired=${workspace.desired}`
        );

        // Update local state with new workspace values
        this.setOrchestrationData({
          workspace: {
            running: workspace.running,
            desired: workspace.desired,
          },
        });
      });

      // Register project event handler
      this._orchestrationWsClient.onProjectEvent((event) => {
        this._outputChannel.appendLine(
          `[OrchestrationSync] Project event received: type=${event.type}`
        );
        this.handleGranularProjectEvent(event);
      });

      // Connect to WebSocket with project numbers
      await this._orchestrationWsClient.connect({
        url: apiBaseUrl,
        apiKey,
        workspaceId,
        projectNumbers: this._activeProjectNumbers,
      });

      this._outputChannel.appendLine('[OrchestrationSync] WebSocket connected and handlers registered');
    } catch (error) {
      this._outputChannel.appendLine(
        `[OrchestrationSync] Error initializing WebSocket: ${error}`
      );
    }
  }

  /**
   * Update workspace currently running count (called from API or external source)
   */
  private updateWorkspaceRunning(count: number): void {
    this.setOrchestrationData({
      workspace: { running: count }
    });
  }

  /**
   * Update desired LLMs count for workspace
   */
  private async updateOrchestrationDesired(scope: string, desired: number): Promise<void> {
    try {
      // Validate and clamp the value
      const clampedDesired = Math.max(0, Math.min(desired, 20));

      if (scope === 'workspace') {
        // Get workspace identifier
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        if (!workspaceFolder) {
          throw new Error('No workspace folder found');
        }

        const workspaceId = workspaceFolder.uri.fsPath;

        this._outputChannel.appendLine(
          `[Orchestration] Updating workspace ${workspaceId} desired to ${clampedDesired}`,
        );

        // Call API to update workspace orchestration using dedicated orchestration client
        const result = await this._orchestrationClient.updateWorkspaceDesired(
          workspaceId,
          clampedDesired,
        );

        if (result) {
          // Update local state with API response (includes global totals)
          this.setOrchestrationData({
            workspace: {
              running: result.workspace.running,
              desired: result.workspace.desired,
            },
            global: {
              running: result.global.running,
              desired: result.global.desired,
            },
          });

          this._outputChannel.appendLine(
            `[Orchestration] Updated successfully. Global: running=${result.global.running}, desired=${result.global.desired}`,
          );
        } else {
          throw new Error('API returned null response');
        }
      }

    } catch (error) {
      this._outputChannel.appendLine(
        `[Orchestration] Error updating desired count: ${error}`,
      );
      vscode.window.showErrorMessage(
        `Failed to update orchestration settings: ${error}`,
      );
    }
  }

  public async resolveWebviewView(
    webviewView: vscode.WebviewView,
    context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken,
  ) {
    this._view = webviewView;

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [this._extensionUri],
    };

    webviewView.webview.html = this._getHtmlForWebview(webviewView.webview);

    webviewView.webview.onDidReceiveMessage(async (data) => {
      switch (data.type) {
        case "refresh": {
          // Background refresh - don't clear cache, keep existing UI while fetching
          // Send refreshing indicator so UI shows subtle loading state
          this._view?.webview.postMessage({ type: "refreshing" });
          await this.refresh();
          break;
        }
        case "clearCache": {
          // Clear cache and refresh
          await this._cacheManager.clearAllCaches();
          vscode.window.showInformationMessage("Cache cleared");
          await this.refresh();
          break;
        }
        case "openUrl": {
          if (data.url) {
            vscode.env.openExternal(vscode.Uri.parse(data.url));
          }
          break;
        }
        case "updateStatus": {
          await this.handleStatusUpdate(
            data.projectId,
            data.itemId,
            data.statusOptionId,
          );
          break;
        }
        case "deleteItem": {
          await this.handleDeleteItem(
            data.projectId,
            data.itemId,
            data.itemTitle,
          );
          break;
        }
        case "deleteProject": {
          await this.handleDeleteProject(data.projectId, data.projectTitle);
          break;
        }
        case "startProject": {
          await this.handleStartProject(data.projectNumber);
          break;
        }
        case "startProjectWithContext": {
          const context = await vscode.window.showInputBox({
            prompt: "Add context checking/setup instructions",
            placeHolder:
              'e.g., Focus on dark mode fixes, or "resuming from yesterday"',
            ignoreFocusOut: true,
          });
          if (context !== undefined) {
            await this.handleStartProject(data.projectNumber, context);
          }
          break;
        }
        case "addProject": {
          await this.handleAddProject();
          break;
        }
        case "startProjectFlow": {
          await this.handleStartProjectFlow();
          break;
        }
        case "inputSubmitted": {
          await this.handleInputSubmitted(data.input, data.detection);
          break;
        }
        case "typeaheadRequest": {
          await this.handleTypeaheadRequest(data.input);
          break;
        }
        case "designFeedback": {
          await this.handleDesignFeedback(data.feedback, data.skipReview);
          break;
        }
        case "designAccepted": {
          await this.handleDesignAccepted(data.skipReview);
          break;
        }
        case "projectApproved": {
          await this.handleProjectApproved(data.isPublic);
          break;
        }
        case "markAllDone": {
          await this.handleMarkAllDone(data.projectId, data.projectTitle);
          break;
        }
        case "markPhaseDone": {
          await this.handleMarkPhaseDone(
            data.projectId,
            data.itemIds,
            data.phaseName,
          );
          break;
        }
        case "modeChanged": {
          this._showOrgProjects = data.showOrgProjects;
          this._outputChannel.appendLine(
            `\n>>> MODE SWITCHED: Now showing ${this._showOrgProjects ? "ORGANIZATION" : "REPOSITORY"} projects`,
          );
          this.updateViewTitle();
          break;
        }
        case "refreshProject": {
          await this.handleRefreshProject(data.projectId, data.projectNumber);
          break;
        }
        case "linkProjectToRepo": {
          await this.handleLinkProjectToRepo(
            data.projectId,
            data.projectNumber,
          );
          break;
        }
        case "unlinkProjectFromRepo": {
          await this.handleUnlinkProjectFromRepo(
            data.projectId,
            data.projectNumber,
          );
          break;
        }
        case "reviewProject": {
          await this.handleReviewProject(data.projectNumber);
          break;
        }
        case "reviewPhase": {
          await this.handleReviewPhase(data.projectNumber, data.phaseNumber);
          break;
        }
        case "reviewItem": {
          await this.handleReviewItem(data.projectNumber, data.phaseItemNumber);
          break;
        }
        case "updateOrchestrationDesired": {
          await this.updateOrchestrationDesired(data.scope, data.desired);
          break;
        }
        case "openTaskHistory": {
          await this.handleOpenTaskHistory();
          break;
        }
        case "closeTaskHistory": {
          // Task history is handled in webview, no action needed
          break;
        }
        case "updateSettings": {
          // Handle settings updates from webview
          if (data.settings?.llmProvider) {
            await vscode.workspace
              .getConfiguration("claudeProjects")
              .update(
                "llmProvider",
                data.settings.llmProvider,
                vscode.ConfigurationTarget.Global
              );
            this._outputChannel.appendLine(
              `[Settings] LLM Provider changed to: ${data.settings.llmProvider}`
            );
          }
          break;
        }
        case "adjustConcurrency": {
          const config = getAgentConfig();
          const newValue = Math.max(1, Math.min(10, config.maxConcurrent + data.delta));
          // Debounce: use a class-level timer
          if (this._concurrencyDebounce) {
            clearTimeout(this._concurrencyDebounce);
          }
          this._concurrencyDebounce = setTimeout(async () => {
            await vscode.workspace.getConfiguration('claudeProjects.agents')
              .update('maxConcurrent', newValue, vscode.ConfigurationTarget.Workspace);
            this.sendLlmActivityUpdate();
          }, 300);
          // Send immediate visual update (optimistic)
          this._view?.webview.postMessage({
            type: 'llmActivityUpdate',
            active: this._llmActivityTracker?.getActiveSessionCount() || 0,
            allocated: newValue,
            sessions: this._llmActivityTracker?.getActiveSessions() || []
          });
          break;
        }
        case "toggleAutoAssignment": {
          await vscode.workspace.getConfiguration('claudeProjects')
            .update('autoAssignGenericPrompts', data.enabled, vscode.ConfigurationTarget.Workspace);
          this.sendLlmActivityUpdate();
          break;
        }
        case "openGenericPromptsFolder": {
          const workspaceFolders = vscode.workspace.workspaceFolders;
          if (workspaceFolders) {
            const path = require('path');
            const genericPath = vscode.Uri.file(
              path.join(workspaceFolders[0].uri.fsPath, '.claude-projects', 'generic')
            );
            vscode.commands.executeCommand('revealFileInOS', genericPath);
          }
          break;
        }
        case "worktreeCommitPush": {
          await this.handleWorktreeCommitPush(data.projectNumber, data.projectTitle, data.worktreePath);
          break;
        }
        case "worktreeCreatePR": {
          await this.handleWorktreeCreatePR(data.projectNumber, data.projectTitle, data.branch, data.worktreePath);
          break;
        }
        case "worktreeMerge": {
          await this.handleWorktreeMerge(data.prNumber, data.worktreePath);
          break;
        }
        case "worktreeClean": {
          await this.handleWorktreeClean(data.worktreePath, data.projectNumber);
          break;
        }
        case "initGitRepo": {
          await this.handleInitGitRepo();
          break;
        }
        case "ready": {
          // Webview is ready, send initial data
          this._outputChannel.appendLine("[WebView] Webview ready, triggering refresh");
          this.refresh().catch((e) => {
            this._outputChannel.appendLine(`[WebView] Initial refresh failed: ${e}`);
          });
          // Send immediate LLM activity update on webview ready
          this.sendLlmActivityUpdate();
          break;
        }
      }
    });

    // Initialize ClaudeMonitor if not already initialized
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (workspaceFolders && workspaceFolders.length > 0 && !this._claudeMonitor) {
      const workspaceRoot = workspaceFolders[0].uri.fsPath;
      this._claudeMonitor = new ClaudeMonitor(workspaceRoot);
      this._claudeMonitor.setProjectUpdateCallback(async (signal) => {
        console.log("[claude-projects] Received project update signal:", signal.project_update);
        if (signal.project_update) {
          // Refresh the view to show updated status
          await this.refresh();
        }
      });
    }

    // Send orchestration data immediately
    this.sendOrchestrationData();

    // Fetch initial orchestration data from API
    this.fetchOrchestrationData();

    // Start periodic workspace count updates
    this.startWorkspaceCountUpdates();

    // Start LLM activity updates for status bar
    this.startLlmActivityUpdates();

    // Clean up on dispose
    webviewView.onDidDispose(() => {
      this.stopWorkspaceCountUpdates();
      this.stopLlmActivityUpdates();
    });

    // Initial load - only refresh if we don't have any cached data
    // Check if we have owner/repo context first
    const folders = vscode.workspace.workspaceFolders;
    if (folders && folders.length > 0) {
      this.getRepoContext()
        .then(async ({ owner, repo }) => {
          if (owner && repo) {
            const cached = await this._cacheManager.loadCache(owner, repo);
            if (!cached) {
              // No cache exists, do initial refresh
              this.refresh().catch((e) => {
                console.error("Initial refresh failed:", e);
                if (this._view) {
                  this._view.webview.postMessage({
                    type: "error",
                    message: `Initial load failed: ${e instanceof Error ? e.message : String(e)}`,
                  });
                }
              });
            } else {
              // We have cached data, send it to the webview
              this._currentOwner = owner;
              this._currentRepo = repo;
              this._view?.webview.postMessage({
                type: "repoInfo",
                owner: owner,
                repo: repo,
              });
              this.updateViewTitle();

              // Send cached data to webview
              this._hasDisplayedData = true;
              const cacheAge = this._cacheManager.getCacheAge(cached);
              const isStale = this._cacheManager.isCacheStale(cached);
              this._view?.webview.postMessage({
                type: "cachedData",
                repoProjects: cached.repoProjects,
                orgProjects: cached.orgProjects,
                statusOptions: cached.statusOptions,
                isStale,
                cacheAge,
              });
            }
          }
        })
        .catch((e) => {
          console.error("Failed to get repo context:", e);
          if (this._view) {
            this._view.webview.postMessage({
              type: "error",
              message:
                e instanceof Error
                  ? e.message
                  : "Could not determine GitHub repository. Ensure a folder with a git remote is open.",
            });
          }
        });
    }
  }

  /**
   * Update the view title based on current mode and repo context
   * - In org mode (showOrgProjects=true): Shows the org name (e.g., "stokedconsulting")
   * - In repo mode (showOrgProjects=false): Shows owner/repo (e.g., "stokedconsulting/des.irable.v3")
   */
  private updateViewTitle() {
    if (!this._view) return;

    if (this._showOrgProjects) {
      // Org mode: show just the org/owner name
      this._view.title = this._currentOwner || "Projects";
    } else {
      // Repo mode: show owner/repo
      if (this._currentOwner && this._currentRepo) {
        this._view.title = `${this._currentOwner}/${this._currentRepo}`;
      } else {
        this._view.title = "Projects";
      }
    }
  }

  private async handleStatusUpdate(
    projectId: string,
    itemId: string,
    statusOptionId: string,
  ) {
    if (!this._view) return;

    // Find the project to get the status field ID
    // We'll need to fetch fields again or store them
    const fields = await this._githubAPI.getProjectFields(projectId);
    const statusField = fields.find((f: any) => f.name === "Status");

    if (!statusField) {
      vscode.window.showErrorMessage("Status field not found");
      return;
    }

    const success = await this._githubAPI.updateItemFieldValue(
      projectId,
      itemId,
      statusField.id,
      statusOptionId,
    );

    if (success) {
      vscode.window.showInformationMessage("Status updated successfully");
      // Refresh the view to show updated status
      await this.refresh();
    } else {
      vscode.window.showErrorMessage("Failed to update status");
    }
  }

  private async handleDeleteItem(
    projectId: string,
    itemId: string,
    itemTitle: string,
  ) {
    if (!this._view) return;

    const confirm = await vscode.window.showWarningMessage(
      `Are you sure you want to delete "${itemTitle}" from this project?`,
      { modal: true },
      "Delete",
    );

    if (confirm !== "Delete") {
      return;
    }

    const success = await this._githubAPI.deleteProjectItem(projectId, itemId);

    if (success) {
      vscode.window.showInformationMessage(
        `Deleted "${itemTitle}" from project`,
      );
      // Send message to remove item from UI instead of full refresh
      this._view.webview.postMessage({
        type: "removeItem",
        projectId: projectId,
        itemId: itemId,
      });
    } else {
      vscode.window.showErrorMessage("Failed to delete item");
    }
  }

  private async handleDeleteProject(projectId: string, projectTitle: string) {
    if (!this._view) return;

    const confirm = await vscode.window.showWarningMessage(
      `Are you sure you want to DELETE the entire project "${projectTitle}"? This action cannot be undone.`,
      { modal: true },
      "Delete Project",
    );

    if (confirm !== "Delete Project") {
      return;
    }

    const success = await this._githubAPI.deleteProject(projectId);

    if (success) {
      vscode.window.showInformationMessage(`Deleted project "${projectTitle}"`);
      // Send message to remove project from UI instead of full refresh
      this._view.webview.postMessage({
        type: "removeProject",
        projectId: projectId,
      });
    } else {
      vscode.window.showErrorMessage("Failed to delete project");
    }
  }

  private async handleMarkAllDone(projectId: string, projectTitle: string) {
    if (!this._view) return;

    const confirm = await vscode.window.showWarningMessage(
      `Mark ALL items in "${projectTitle}" as Done?`,
      { modal: true },
      "Mark All Done",
    );

    if (confirm !== "Mark All Done") {
      return;
    }

    try {
      // Get project fields
      const fields = await this._githubAPI.getProjectFields(projectId);
      const statusField = fields.find((f: any) => f.name === "Status");

      if (!statusField) {
        vscode.window.showErrorMessage("Status field not found");
        return;
      }

      const doneOption = statusField.options?.find(
        (o: any) => o.name === "Done",
      );
      if (!doneOption) {
        vscode.window.showErrorMessage("Done status option not found");
        return;
      }

      // Get all project items
      const items = await this._githubAPI.getProjectItems(projectId);

      // Update each item that isn't already done
      let updatedCount = 0;
      for (const item of items) {
        const currentStatus = item.fieldValues["Status"];
        if (!["Done", "Merged", "Closed"].includes(currentStatus || "")) {
          const success = await this._githubAPI.updateItemFieldValue(
            projectId,
            item.id,
            statusField.id,
            doneOption.id,
          );
          if (success) updatedCount++;
        }
      }

      vscode.window.showInformationMessage(
        `Marked ${updatedCount} items as Done`,
      );
      await this.refresh();
    } catch (error) {
      vscode.window.showErrorMessage(
        `Failed to mark items as Done: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  private async handleMarkPhaseDone(
    projectId: string,
    itemIds: string[],
    phaseName: string,
  ) {
    if (!this._view) return;

    const confirm = await vscode.window.showWarningMessage(
      `Mark all items in phase "${phaseName}" as Done?`,
      { modal: true },
      "Mark Done",
    );

    if (confirm !== "Mark Done") {
      return;
    }

    try {
      // Get project fields
      const fields = await this._githubAPI.getProjectFields(projectId);
      const statusField = fields.find((f: any) => f.name === "Status");

      if (!statusField) {
        vscode.window.showErrorMessage("Status field not found");
        return;
      }

      const doneOption = statusField.options?.find(
        (o: any) => o.name === "Done",
      );
      if (!doneOption) {
        vscode.window.showErrorMessage("Done status option not found");
        return;
      }

      // Update each item
      let updatedCount = 0;
      for (const itemId of itemIds) {
        const success = await this._githubAPI.updateItemFieldValue(
          projectId,
          itemId,
          statusField.id,
          doneOption.id,
        );
        if (success) updatedCount++;
      }

      vscode.window.showInformationMessage(
        `Marked ${updatedCount} items in "${phaseName}" as Done`,
      );
      await this.refresh();
    } catch (error) {
      vscode.window.showErrorMessage(
        `Failed to mark phase items as Done: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  private async handleRefreshProject(projectId: string, projectNumber: number) {
    if (!this._view) return;

    // Send message to show loading state on just this project
    this._view.webview.postMessage({
      type: "projectRefreshing",
      projectId: projectId,
    });

    try {
      // Check if project link status has changed by fetching current linked projects
      if (!this._currentOwner || !this._currentRepo) {
        throw new Error("No repository context available");
      }

      const linkedResult = await this._githubAPI.getLinkedProjects(
        this._currentOwner,
        this._currentRepo,
      );
      const isNowLinked = linkedResult.projects.some((p) => p.id === projectId);

      // Check if this project was unlinked from the repo
      if (!isNowLinked) {
        this._outputChannel.appendLine(
          `[claude-projects] Project #${projectNumber} is not linked to ${this._currentOwner}/${this._currentRepo}`,
        );

        // Load current cache
        const cached = await this._cacheManager.loadCache(
          this._currentOwner,
          this._currentRepo,
        );
        if (cached) {
          // Check if it's still an org project
          const allOrgProjects = await this._githubAPI.getOrganizationProjects(
            this._currentOwner,
          );
          const isOrgProject = allOrgProjects.some((p) => p.id === projectId);

          if (!isOrgProject) {
            // Not in org or repo - project was deleted or moved
            this._outputChannel.appendLine(
              `[claude-projects] Project #${projectNumber} no longer exists in org - removing`,
            );

            // Remove from both lists
            const updatedRepoProjects = cached.repoProjects.filter(
              (p: any) => p.id !== projectId,
            );
            const updatedOrgProjects = cached.orgProjects.filter(
              (p: any) => p.id !== projectId,
            );

            // Update cache
            await this._cacheManager.saveCache(
              this._currentOwner,
              this._currentRepo,
              updatedRepoProjects,
              updatedOrgProjects,
              cached.statusOptions,
            );

            // Tell UI to remove the project
            this._view.webview.postMessage({
              type: "projectRemoved",
              projectId: projectId,
            });

            return; // Don't send projectUpdate
          } else {
            // It's an org project - update cache to ensure it's in the right list
            this._outputChannel.appendLine(
              `[claude-projects] Project #${projectNumber} is an org project - refreshing data`,
            );

            const updatedRepoProjects = cached.repoProjects.filter(
              (p: any) => p.id !== projectId,
            );
            let updatedOrgProjects = cached.orgProjects;

            // Ensure it's in orgProjects
            const alreadyInOrgProjects = updatedOrgProjects.some(
              (p: any) => p.id === projectId,
            );
            if (!alreadyInOrgProjects) {
              const orgProject = allOrgProjects.find((p) => p.id === projectId);
              if (orgProject) {
                updatedOrgProjects = [
                  ...updatedOrgProjects,
                  {
                    ...orgProject,
                    phases: [],
                    itemCount: 0,
                    notDoneCount: 0,
                    items: [],
                    statusOptions: [],
                    isLoading: true,
                  },
                ];
              }
            }

            // Update cache
            await this._cacheManager.saveCache(
              this._currentOwner,
              this._currentRepo,
              updatedRepoProjects,
              updatedOrgProjects,
              cached.statusOptions,
            );

            // Continue to fetch fresh data below (don't return here!)
          }
        }
      }

      // Fetch fresh items for this specific project
      const items = await this._githubAPI.getProjectItems(projectId);
      const phases = groupItemsByPhase(items);

      // Fetch fields for status options
      const fields = await this._githubAPI.getProjectFields(projectId);
      const statusField = fields.find((f: any) => f.name === "Status");

      let statusOptions: any[] = [];
      if (statusField && statusField.options) {
        statusOptions = statusField.options.map((o: any) => ({
          id: o.id,
          name: o.name,
        }));
      }

      // Sort phases and calculate counts
      const sortedPhases = Array.from(phases.values()).sort(
        (a, b) => a.phaseNumber - b.phaseNumber,
      );

      const notDoneItems = items.filter((i) => {
        const status = i.fieldValues["Status"];
        return !["Done", "Merged", "Closed"].includes(status || "");
      });

      const projectData = {
        id: projectId,
        number: projectNumber,
        phases: sortedPhases,
        itemCount: items.length,
        notDoneCount: notDoneItems.length,
        items: notDoneItems,
        statusOptions: statusOptions,
        statusFieldId: statusField?.id,
        isLoading: false,
      };

      // Update the cache with fresh data
      const cached = await this._cacheManager.loadCache(
        this._currentOwner,
        this._currentRepo,
      );
      if (cached) {
        // Update the project in repoProjects or orgProjects
        const updatedRepoProjects = cached.repoProjects.map((p: any) =>
          p.id === projectId ? { ...p, ...projectData } : p,
        );
        const updatedOrgProjects = cached.orgProjects.map((p: any) =>
          p.id === projectId ? { ...p, ...projectData } : p,
        );

        await this._cacheManager.saveCache(
          this._currentOwner,
          this._currentRepo,
          updatedRepoProjects,
          updatedOrgProjects,
          cached.statusOptions,
        );
      }

      // Send update for this project
      this._view.webview.postMessage({
        type: "projectUpdate",
        projectId: projectId,
        projectData: projectData,
        statusOptions: statusOptions,
        isLinked: isNowLinked,
      });
    } catch (error) {
      console.error(
        `[claude-projects] Error refreshing project #${projectNumber}:`,
        error,
      );
      // Clear loading state even on error
      this._view.webview.postMessage({
        type: "projectRefreshError",
        projectId: projectId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private async handleLinkProjectToRepo(
    projectId: string,
    projectNumber: number,
  ) {
    if (!this._currentOwner || !this._currentRepo) {
      vscode.window.showErrorMessage(
        "No repository context available. Please open a repository first.",
      );
      return;
    }

    if (!this._currentRepoId) {
      vscode.window.showErrorMessage(
        "Repository ID not available. Please refresh the extension first.",
      );
      return;
    }

    try {
      this._outputChannel.appendLine(
        `[claude-projects] Linking project #${projectNumber} to ${this._currentOwner}/${this._currentRepo} (repo ID: ${this._currentRepoId})`,
      );
      const repositoryId = this._currentRepoId;

      // Link the project to the repository
      const success = await this._githubAPI.linkProjectToRepository(
        projectId,
        repositoryId,
      );

      if (success) {
        vscode.window.showInformationMessage(
          `Project #${projectNumber} linked to ${this._currentOwner}/${this._currentRepo}`,
        );
        // Clear cache FIRST to prevent stale data from being sent
        await this._cacheManager.clearCache(
          this._currentOwner,
          this._currentRepo,
        );
        // Show loading indicator
        this._view?.webview.postMessage({ type: "loading" });
        // Do full refresh (no optimistic update to avoid race conditions)
        await this.refresh();
      } else {
        vscode.window.showErrorMessage("Failed to link project to repository");
      }
    } catch (error) {
      console.error(
        "[claude-projects] Error linking project to repository:",
        error,
      );
      vscode.window.showErrorMessage(
        `Failed to link project: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  private async handleUnlinkProjectFromRepo(
    projectId: string,
    projectNumber: number,
  ) {
    if (!this._currentOwner || !this._currentRepo) {
      vscode.window.showErrorMessage(
        "No repository context available. Please open a repository first.",
      );
      return;
    }

    if (!this._currentRepoId) {
      vscode.window.showErrorMessage(
        "Repository ID not available. Please refresh the extension first.",
      );
      return;
    }

    try {
      this._outputChannel.appendLine(
        `[claude-projects] Unlinking project #${projectNumber} from ${this._currentOwner}/${this._currentRepo} (repo ID: ${this._currentRepoId})`,
      );
      const repositoryId = this._currentRepoId;

      // Unlink the project from the repository
      const success = await this._githubAPI.unlinkProjectFromRepository(
        projectId,
        repositoryId,
      );

      if (success) {
        vscode.window.showInformationMessage(
          `Project #${projectNumber} unlinked from ${this._currentOwner}/${this._currentRepo}`,
        );
        // Clear cache FIRST to prevent stale data from being sent
        await this._cacheManager.clearCache(
          this._currentOwner,
          this._currentRepo,
        );
        // Show loading indicator
        this._view?.webview.postMessage({ type: "loading" });
        // Do full refresh (no optimistic update to avoid race conditions)
        await this.refresh();
      } else {
        vscode.window.showErrorMessage(
          "Failed to unlink project from repository",
        );
      }
    } catch (error) {
      console.error(
        "[claude-projects] Error unlinking project from repository:",
        error,
      );
      vscode.window.showErrorMessage(
        `Failed to unlink project: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  /**
   * Refresh worktree status for a project and send update to webview
   */
  private async refreshWorktreeStatus(projectNumber: number): Promise<void> {
    try {
      const worktree = await this.getWorktreeStatus(projectNumber);
      this._view?.webview.postMessage({
        type: "worktreeStatusUpdate",
        projectNumber,
        worktree,
      });
      // Push to API for caching and broadcast to other instances
      this.pushWorktreeStatusToAPI(projectNumber, worktree);
    } catch (error) {
      this._outputChannel.appendLine(
        `[Worktree] Error refreshing status for project #${projectNumber}: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  /**
   * Push worktree status to the API (fire-and-forget)
   */
  private pushWorktreeStatusToAPI(projectNumber: number, worktree: {
    hasWorktree: boolean;
    worktreePath: string;
    branch: string;
    hasUncommittedChanges: boolean;
    hasUnpushedCommits: boolean;
    hasPR: boolean;
    prNumber: number | null;
    prMerged: boolean;
  }): void {
    const workspaceId = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    this._orchestrationClient.updateWorktreeStatus(
      projectNumber,
      worktree,
      workspaceId,
    ).catch((error) => {
      this._outputChannel.appendLine(
        `[Worktree] Failed to push status to API (non-fatal): ${error instanceof Error ? error.message : String(error)}`
      );
    });
  }

  private async handleWorktreeCommitPush(projectNumber: number, projectTitle: string, worktreePath: string): Promise<void> {
    try {
      vscode.window.showInformationMessage(`Committing and pushing project #${projectNumber}...`);
      const commitMsg = `Complete project #${projectNumber}: ${projectTitle}`;
      await execAsync(
        `git -C "${worktreePath}" add -A && git -C "${worktreePath}" commit -m "${commitMsg.replace(/"/g, '\\"')}" && git -C "${worktreePath}" push -u origin HEAD`,
        { timeout: 30000 }
      );
      vscode.window.showInformationMessage(`Project #${projectNumber}: Changes committed and pushed.`);
      await this.refreshWorktreeStatus(projectNumber);
    } catch (error) {
      vscode.window.showErrorMessage(
        `Failed to commit/push project #${projectNumber}: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  private async handleWorktreeCreatePR(projectNumber: number, projectTitle: string, branch: string, worktreePath: string): Promise<void> {
    try {
      vscode.window.showInformationMessage(`Creating PR for project #${projectNumber}...`);
      const prTitle = `Project #${projectNumber}: ${projectTitle}`;
      const prBody = `Automated PR for project #${projectNumber}: ${projectTitle}`;
      const { stdout } = await execAsync(
        `gh pr create --head "${branch}" --base main --title "${prTitle.replace(/"/g, '\\"')}" --body "${prBody.replace(/"/g, '\\"')}"`,
        { cwd: worktreePath, timeout: 30000 }
      );
      const prUrl = stdout.trim();
      vscode.window.showInformationMessage(`PR created: ${prUrl}`);
      await this.refreshWorktreeStatus(projectNumber);
    } catch (error) {
      vscode.window.showErrorMessage(
        `Failed to create PR for project #${projectNumber}: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  private async handleWorktreeMerge(prNumber: number, worktreePath: string): Promise<void> {
    try {
      vscode.window.showInformationMessage(`Merging PR #${prNumber}...`);
      await execAsync(
        `gh pr merge ${prNumber} --merge --delete-branch`,
        { cwd: worktreePath, timeout: 30000 }
      );
      vscode.window.showInformationMessage(`PR #${prNumber} merged successfully.`);
      // Find project number from worktree path
      const match = worktreePath.match(/project-(\d+)/);
      if (match) {
        await this.refreshWorktreeStatus(parseInt(match[1], 10));
      }
    } catch (error) {
      vscode.window.showErrorMessage(
        `Failed to merge PR #${prNumber}: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  private async handleWorktreeClean(worktreePath: string, projectNumber: number): Promise<void> {
    const confirm = await vscode.window.showWarningMessage(
      `Remove worktree for project #${projectNumber}? This cannot be undone.`,
      { modal: true },
      "Remove"
    );
    if (confirm !== "Remove") return;

    try {
      const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
      if (!workspaceRoot) return;

      await execAsync(
        `git worktree remove "${worktreePath}" --force`,
        { cwd: workspaceRoot, timeout: 15000 }
      );
      vscode.window.showInformationMessage(`Worktree for project #${projectNumber} removed.`);
      await this.refreshWorktreeStatus(projectNumber);
    } catch (error) {
      vscode.window.showErrorMessage(
        `Failed to remove worktree: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  /**
   * Get worktree status for a project (branch, uncommitted changes, PR state, etc.)
   */
  private async getWorktreeStatus(projectNumber: number): Promise<{
    hasWorktree: boolean;
    worktreePath: string;
    branch: string;
    hasUncommittedChanges: boolean;
    hasUnpushedCommits: boolean;
    hasPR: boolean;
    prNumber: number | null;
    prMerged: boolean;
  }> {
    const result = {
      hasWorktree: false,
      worktreePath: "",
      branch: "",
      hasUncommittedChanges: false,
      hasUnpushedCommits: false,
      hasPR: false,
      prNumber: null as number | null,
      prMerged: false,
    };

    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!workspaceRoot) return result;

    try {
      // Find worktree for this project
      const { stdout: wtList } = await execAsync("git worktree list --porcelain", {
        cwd: workspaceRoot,
      });

      const lines = wtList.split("\n");
      let currentPath = "";

      for (const line of lines) {
        if (line.startsWith("worktree ")) {
          currentPath = line.substring(9).trim();
        }
        if (
          currentPath &&
          (currentPath.includes(`project-${projectNumber}`) ||
            currentPath.includes(`task/${projectNumber}`))
        ) {
          result.hasWorktree = true;
          result.worktreePath = currentPath;
          break;
        }
      }

      if (!result.hasWorktree) return result;

      // Get branch name
      try {
        const { stdout: branchOut } = await execAsync(
          `git -C "${result.worktreePath}" rev-parse --abbrev-ref HEAD`
        );
        result.branch = branchOut.trim();
      } catch {
        // Could not determine branch
      }

      // Check for uncommitted changes
      try {
        const { stdout: statusOut } = await execAsync(
          `git -C "${result.worktreePath}" status --porcelain`
        );
        result.hasUncommittedChanges = statusOut.trim().length > 0;
      } catch {
        // Assume no changes if command fails
      }

      // Check for unpushed commits
      if (!result.hasUncommittedChanges) {
        try {
          const { stdout: logOut } = await execAsync(
            `git -C "${result.worktreePath}" log @{u}..HEAD --oneline`
          );
          result.hasUnpushedCommits = logOut.trim().length > 0;
        } catch {
          // No upstream or error — treat as having unpushed commits if branch exists
          if (result.branch) {
            result.hasUnpushedCommits = true;
          }
        }
      }

      // Check for existing PR
      if (result.branch && !result.hasUncommittedChanges) {
        try {
          const { stdout: prOut } = await execAsync(
            `gh pr list --head "${result.branch}" --json number,state --limit 1`,
            { cwd: result.worktreePath }
          );
          const prs = JSON.parse(prOut.trim() || "[]");
          if (prs.length > 0) {
            result.hasPR = true;
            result.prNumber = prs[0].number;
            result.prMerged = prs[0].state === "MERGED";
          }
        } catch {
          // gh CLI not available or error
        }
      }
    } catch (error) {
      this._outputChannel.appendLine(
        `[Worktree] Error checking worktree status for project #${projectNumber}: ${error instanceof Error ? error.message : String(error)}`
      );
    }

    return result;
  }

  private async handleReviewProject(projectNumber: number) {
    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!workspaceRoot) {
      vscode.window.showErrorMessage("No workspace folder found");
      return;
    }

    // Find existing terminal or create new one
    let terminal = vscode.window.terminals.find(
      (t) => t.name === `Review Project #${projectNumber}`,
    );
    if (!terminal) {
      terminal = vscode.window.createTerminal({
        name: `Review Project #${projectNumber}`,
        cwd: workspaceRoot,
      });
    }

    terminal.show();
    terminal.sendText(
      `claude --dangerously-skip-permissions /review-project ${projectNumber}`,
    );
  }

  private async handleReviewPhase(projectNumber: number, phaseNumber: number) {
    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!workspaceRoot) {
      vscode.window.showErrorMessage("No workspace folder found");
      return;
    }

    // Find existing terminal or create new one
    let terminal = vscode.window.terminals.find(
      (t) =>
        t.name === `Review Phase ${phaseNumber} - Project #${projectNumber}`,
    );
    if (!terminal) {
      terminal = vscode.window.createTerminal({
        name: `Review Phase ${phaseNumber} - Project #${projectNumber}`,
        cwd: workspaceRoot,
      });
    }

    terminal.show();
    terminal.sendText(
      `claude --dangerously-skip-permissions /review-phase ${projectNumber} ${phaseNumber}`,
    );
  }

  private async handleReviewItem(
    projectNumber: number,
    phaseItemNumber: string,
  ) {
    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!workspaceRoot) {
      vscode.window.showErrorMessage("No workspace folder found");
      return;
    }

    // Find existing terminal or create new one
    let terminal = vscode.window.terminals.find(
      (t) =>
        t.name === `Review Item ${phaseItemNumber} - Project #${projectNumber}`,
    );
    if (!terminal) {
      terminal = vscode.window.createTerminal({
        name: `Review Item ${phaseItemNumber} - Project #${projectNumber}`,
        cwd: workspaceRoot,
      });
    }

    terminal.show();
    terminal.sendText(
      `claude --dangerously-skip-permissions /review-item ${projectNumber} ${phaseItemNumber}`,
    );
  }

  private async handleOpenTaskHistory() {
    // Send message to webview to show task history overlay
    if (this._view) {
      this._view.webview.postMessage({
        type: 'showTaskHistory'
      });
    }
  }

  private async handleInitGitRepo(): Promise<void> {
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    if (!workspaceFolder) {
      vscode.window.showErrorMessage("No workspace folder open");
      return;
    }
    const workspacePath = workspaceFolder.uri.fsPath;

    try {
      // 1. Authenticate with GitHub
      const api = new GitHubAPI(this._outputChannel);
      const initialized = await api.initialize();
      if (!initialized) {
        vscode.window.showErrorMessage("Failed to authenticate with GitHub");
        return;
      }

      // 2. Fetch user info and orgs
      const userInfo = await api.getAuthenticatedUser();
      if (!userInfo) {
        vscode.window.showErrorMessage("Failed to fetch GitHub user info");
        return;
      }

      // 3. Detect repo name from package.json or folder name
      let detectedName = workspaceFolder.name;
      let detectedOrg: string | null = null;

      try {
        const pkgUri = vscode.Uri.joinPath(workspaceFolder.uri, "package.json");
        const pkgBytes = await vscode.workspace.fs.readFile(pkgUri);
        const pkg = JSON.parse(Buffer.from(pkgBytes).toString("utf8"));
        if (pkg.name) {
          const scopeMatch = pkg.name.match(/^@([^/]+)\/(.+)$/);
          if (scopeMatch) {
            detectedOrg = scopeMatch[1];
            detectedName = scopeMatch[2];
          } else {
            detectedName = pkg.name;
          }
        }
      } catch {
        // No package.json or parse error - use folder name
      }

      // 4. Smart default: check if detected org matches a user org
      let selectedOrg: string | null = null;
      let repoName = detectedName;
      let smartMatched = false;

      const matchingOrg = detectedOrg
        ? userInfo.organizations.find(
            (o) => o.login.toLowerCase() === detectedOrg!.toLowerCase(),
          )
        : null;

      if (matchingOrg) {
        // Check if repo already exists
        const exists = await api.checkRepoExists(matchingOrg.login, detectedName);
        if (!exists) {
          const choice = await vscode.window.showQuickPick(
            [
              {
                label: `Yes - create in ${matchingOrg.login}`,
                value: "yes",
              },
              {
                label: "Choose different target",
                value: "choose",
              },
            ],
            {
              placeHolder: `Create "${detectedName}" in ${matchingOrg.login}?`,
            },
          );
          if (!choice) return; // cancelled
          if (choice.value === "yes") {
            selectedOrg = matchingOrg.login;
            smartMatched = true;
          }
          // else fall through to manual selection
        }
        // If exists, fall through to manual selection
      }

      if (!smartMatched) {
        // 5. Manual selection: pick target
        const targets = [
          {
            label: `Personal account (${userInfo.login})`,
            value: null as string | null,
          },
          ...userInfo.organizations.map((o) => ({
            label: o.name ? `${o.name} (${o.login})` : o.login,
            value: o.login as string | null,
          })),
        ];

        const target = await vscode.window.showQuickPick(targets, {
          placeHolder: "Where should the repository be created?",
        });
        if (!target) return; // cancelled
        selectedOrg = target.value;

        // 6. Get repo name
        const nameInput = await vscode.window.showInputBox({
          prompt: "Repository name",
          value: repoName,
          validateInput: (v) => {
            if (!v.trim()) return "Repository name is required";
            if (!/^[a-zA-Z0-9._-]+$/.test(v)) {
              return "Name can only contain alphanumeric characters, hyphens, underscores, and dots";
            }
            return null;
          },
        });
        if (!nameInput) return; // cancelled
        repoName = nameInput;
      }

      // 7. Pick visibility
      const visibility = await vscode.window.showQuickPick(
        [
          { label: "Private", value: true },
          { label: "Public", value: false },
        ],
        { placeHolder: "Repository visibility" },
      );
      if (!visibility) return; // cancelled

      // 8. Execute: git init, create repo, add remote, push
      await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: "Initializing repository...",
          cancellable: false,
        },
        async (progress) => {
          // git init
          progress.report({ message: "Running git init..." });
          await execAsync("git init", { cwd: workspacePath });

          // Create GitHub repo
          progress.report({ message: "Creating GitHub repository..." });
          const owner = selectedOrg || userInfo.login;
          const result = await api.createRepository(
            repoName,
            selectedOrg,
            visibility.value,
          );
          if (!result) {
            vscode.window.showErrorMessage(
              `Failed to create repository "${repoName}" in ${owner}`,
            );
            return;
          }

          // Add remote
          progress.report({ message: "Adding remote..." });
          const remoteUrl = result.ssh_url || result.clone_url;
          await execAsync(`git remote add origin ${remoteUrl}`, {
            cwd: workspacePath,
          });

          // Create initial commit if no commits exist
          progress.report({ message: "Creating initial commit..." });
          try {
            await execAsync("git rev-parse HEAD", { cwd: workspacePath });
            // Has commits already
          } catch {
            // No commits - create initial commit
            await execAsync("git add -A", { cwd: workspacePath });
            await execAsync('git commit -m "Initial commit" --allow-empty', {
              cwd: workspacePath,
            });
          }

          // Push
          progress.report({ message: "Pushing to remote..." });
          try {
            await execAsync("git push -u origin HEAD", { cwd: workspacePath });
          } catch (pushErr) {
            this._outputChannel.appendLine(
              `[InitRepo] Push failed (may need manual push): ${pushErr}`,
            );
          }

          vscode.window.showInformationMessage(
            `Repository created: ${result.full_name}`,
          );
        },
      );

      // 9. Wait for VS Code's git extension to detect the new repo AND remote, then refresh
      const gitExtension = vscode.extensions.getExtension("vscode.git");
      if (gitExtension) {
        const gitApi = gitExtension.exports.getAPI(1);
        let repoDetected = false;
        let remoteDetected = false;
        for (let i = 0; i < 30; i++) {
          if (gitApi.repositories.length > 0) {
            repoDetected = true;
            const detectedRepo = gitApi.repositories[0];
            if (detectedRepo.state.remotes.length > 0) {
              remoteDetected = true;
              break;
            }
          }
          await new Promise((r) => setTimeout(r, 500));
        }
        if (!repoDetected) {
          this._outputChannel.appendLine(
            "[InitRepo] Git extension did not detect repo after 15s, refreshing anyway",
          );
        } else if (!remoteDetected) {
          this._outputChannel.appendLine(
            "[InitRepo] Git extension detected repo but not remote after 15s, refreshing anyway",
          );
        }
      }
      // Send loading state to clear any no-repo/no-remote panels immediately
      if (this._view) {
        this._view.webview.postMessage({ type: "loading" });
      }
      await this.refresh();
    } catch (err: any) {
      this._outputChannel.appendLine(`[InitRepo] Error: ${err}`);
      vscode.window.showErrorMessage(
        `Failed to initialize repository: ${err.message || err}`,
      );
    }
  }

  private async handleStartProject(projectNumber: number, context?: string) {
    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!workspaceRoot) {
      vscode.window.showErrorMessage("No workspace folder found");
      return;
    }

    // Initialize ClaudeMonitor if not already done
    if (!this._claudeMonitor) {
      this._claudeMonitor = new ClaudeMonitor(workspaceRoot);
      // Set up callback for project updates
      this._claudeMonitor.setProjectUpdateCallback(async (signal) => {
        console.log(
          "[claude-projects] Received project update signal:",
          signal.project_update,
        );
        // Clear cache and refresh to show updated data
        if (this._currentOwner && this._currentRepo) {
          await this._cacheManager.clearCache(
            this._currentOwner,
            this._currentRepo,
          );
          await this.refresh();
          vscode.window
            .showInformationMessage(
              `Project updated: ${signal.project_update?.type || "unknown"}`,
              "View Projects",
            )
            .then((selection) => {
              if (selection === "View Projects") {
                vscode.commands.executeCommand("claudeProjects.view.focus");
              }
            });
        }
      });
    }

    let terminal = vscode.window.terminals.find(
      (t) => t.name === `Project #${projectNumber}`,
    );
    if (!terminal) {
      terminal = vscode.window.createTerminal({
        name: `Project #${projectNumber}`,
        cwd: workspaceRoot,
      });
    }

    terminal.show();

    // Start monitoring the session
    const sessionId = this._claudeMonitor.startSession(projectNumber, terminal);

    // Build the command
    const sessionFile = `.claude-sessions/${sessionId}.response.md`;
    const homeDir = require("os").homedir();
    const wrapperScript = `${homeDir}/.claude-projects/claude-session-wrapper.sh`;

    // Check if wrapper script exists
    const fs = require("fs");
    const useWrapper = fs.existsSync(wrapperScript);

    // Check for existing worktree
    let worktreePath = "";
    let existingWorktree = false;
    try {
      const { stdout } = await execAsync("git worktree list --porcelain", {
        cwd: workspaceRoot,
      });
      // Parse worktree output:
      // worktree /path/to/wt
      // HEAD ...
      // branch ...
      //
      // worktree ...

      const lines = stdout.split("\n");
      let currentPath = "";

      for (const line of lines) {
        if (line.startsWith("worktree ")) {
          currentPath = line.substring(9).trim();
        }
        // Check if this worktree relates to the project
        // Assumption: worktree path or branch contains project number, e.g., "project-123"
        if (
          currentPath &&
          (currentPath.includes(`project-${projectNumber}`) ||
            currentPath.includes(`task/${projectNumber}`))
        ) {
          worktreePath = currentPath;
          existingWorktree = true;
          break;
        }
      }
    } catch (error) {
      console.error("Error checking worktrees:", error);
    }

    let claudePrompt = `/project-start ${projectNumber}`;

    // Add context to the prompt if provided
    if (context) {
      // Sanitize context: escape double quotes to prevent breaking shell command
      const sanitizedContext = context.replace(/"/g, '\\"');
      claudePrompt += ` context: ${sanitizedContext}`;
    }

    // Add worktree info if found
    if (existingWorktree) {
      claudePrompt += ` (Note: A worktree already exists at ${worktreePath}. Please reuse it if appropriate.)`;
    } else {
      // New project start: instruct agent to initialize environment and use correct location
      const repoName = workspaceRoot.split("/").pop();
      const targetWorktreePath = `../${repoName}-project-${projectNumber}`;
      claudePrompt += ` (IMPORTANT: Create the new worktree at '${targetWorktreePath}' (sibling directory). After creating it, you MUST run 'env-cp ${workspaceRoot} <new_worktree_path>' to initialize the environment (certs/env files) before starting work.)`;
    }

    // Get LLM provider from configuration
    const llmProvider = vscode.workspace
      .getConfiguration("claudeProjects")
      .get<string>("llmProvider", "claudeCode");

    let command: string;
    if (llmProvider === "goose") {
      // Build Goose command using recipe
      const recipePath = `~/.config/goose/recipes/project-start.yaml`;
      // Goose uses environment variables for parameters
      const gooseParams = `PROJECT_NUMBER=${projectNumber}`;
      if (context) {
        const sanitizedContext = context.replace(/'/g, "'\\''");
        command = `${gooseParams} CONTEXT='${sanitizedContext}' goose run --recipe ${recipePath}`;
      } else {
        command = `${gooseParams} goose run --recipe ${recipePath}`;
      }
      
      // Warn about worktree info if applicable
      if (existingWorktree) {
        command = `${gooseParams} WORKTREE_PATH='${worktreePath}' goose run --recipe ${recipePath}`;
      }
    } else {
      // Default: Claude Code command
      if (useWrapper) {
        // Make wrapper executable
        terminal.sendText(`chmod +x "${wrapperScript}"`);
        // Use wrapper script
        command = `"${wrapperScript}" "${sessionFile}" --dangerously-skip-permissions "${claudePrompt}"`;
      } else {
        // Fall back to direct command (monitoring will be less accurate)
        command = `claude --dangerously-skip-permissions "${claudePrompt}"`;
      }
    }

    terminal.sendText(command);

    // Show instructions to the user
    const message = useWrapper
      ? `Started Project #${projectNumber} with session wrapper and auto-continuation`
      : `Started Project #${projectNumber} with auto-continuation (install wrapper for better tracking)`;

    vscode.window
      .showInformationMessage(message, "View Session Log", "Stop Monitoring")
      .then((selection) => {
        if (selection === "View Session Log") {
          const sessionPath = `${workspaceRoot}/${sessionFile}`;
          vscode.workspace.openTextDocument(sessionPath).then((doc) => {
            vscode.window.showTextDocument(doc, { preview: false });
          });
        } else if (selection === "Stop Monitoring") {
          this._claudeMonitor?.stopSession(sessionId);
        }
      });
  }

  private async handleAddProject() {
    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!workspaceRoot) {
      vscode.window.showErrorMessage("No workspace folder found");
      return;
    }

    // Initialize ClaudeMonitor if not already done
    if (!this._claudeMonitor) {
      this._claudeMonitor = new ClaudeMonitor(workspaceRoot);
    }

    // Create a temporary file with instructions
    const fs = require("fs");
    const path = require("path");
    const tmpDir = path.join(workspaceRoot, ".claude-sessions");

    // Ensure tmp directory exists
    if (!fs.existsSync(tmpDir)) {
      fs.mkdirSync(tmpDir, { recursive: true });
    }

    const tmpFile = path.join(tmpDir, `new-project-${Date.now()}.md`);
    const initialContent = `# New Project Description

Enter your project description below. You can use markdown formatting.
When you're done, save and close this file.

---

`;

    fs.writeFileSync(tmpFile, initialContent);

    // Open the file in the editor
    const doc = await vscode.workspace.openTextDocument(tmpFile);
    const editor = await vscode.window.showTextDocument(doc, {
      preview: false,
    });

    // Wait for the user to save the document (triggers on save, not close)
    const disposable = vscode.workspace.onDidSaveTextDocument(
      async (savedDoc) => {
        if (savedDoc.uri.fsPath === tmpFile) {
          disposable.dispose();

          // Read the file contents
          const content = fs.readFileSync(tmpFile, "utf8");

          // Remove the instruction header
          const projectText = content
            .replace(/^# New Project Description[\s\S]*?---\s*\n/, "")
            .trim();

          // Close the temp file editor tab
          await vscode.commands.executeCommand('workbench.action.closeActiveEditor');

          if (!projectText) {
            // Clean up temp file if empty
            try {
              fs.unlinkSync(tmpFile);
            } catch (e) {
              // Ignore cleanup errors
            }
            vscode.window.showWarningMessage(
              "Project description was empty. Cancelled.",
            );
            return;
          }

          // Write just the clean content to an input file (no header)
          // This avoids command-line length limits for large descriptions
          const inputFile = path.join(tmpDir, `project-input-${Date.now()}.md`);
          fs.writeFileSync(inputFile, projectText);

          // Clean up the original temp file with instructions
          try {
            fs.unlinkSync(tmpFile);
          } catch (e) {
            // Ignore cleanup errors
          }

          // Create a new terminal with the Claude command
          const shortTitle =
            projectText.substring(0, 30) +
            (projectText.length > 30 ? "..." : "");
          const terminal = vscode.window.createTerminal({
            name: `Creating: ${shortTitle}`,
            cwd: workspaceRoot,
          });

          terminal.show();

          // Start monitoring the creation session
          // Pass inputFile path so it gets cleaned up when session ends
          const sessionId = this._claudeMonitor!.startCreationSession(
            projectText,
            terminal,
            inputFile,
          );
          const sessionFile = `.claude-sessions/${sessionId}.response.md`;

          // Get LLM provider from configuration
          const llmProvider = vscode.workspace
            .getConfiguration("claudeProjects")
            .get<string>("llmProvider", "claudeCode");

          // Build and send the command based on provider
          // Pass file path instead of raw text to avoid shell limits
          let command: string;
          if (llmProvider === "goose") {
            // Goose uses recipe with environment variable pointing to file
            const recipePath = `~/.config/goose/recipes/project-create.yaml`;
            command = `PROJECT_INPUT_FILE='${inputFile}' goose run --recipe ${recipePath}`;
          } else {
            // Claude Code command - pass file path as argument
            command = `claude --dangerously-skip-permissions "/project-create ${inputFile}"`;
          }
          terminal.sendText(command);

          vscode.window
            .showInformationMessage(
              `Creating project with auto-continuation: ${shortTitle}`,
              "View Session Log",
              "Stop Monitoring",
            )
            .then((selection) => {
              if (selection === "View Session Log") {
                const sessionPath = `${workspaceRoot}/${sessionFile}`;
                vscode.workspace.openTextDocument(sessionPath).then((doc) => {
                  vscode.window.showTextDocument(doc, { preview: false });
                });
              } else if (selection === "Stop Monitoring") {
                this._claudeMonitor?.stopSession(sessionId);
              }
            });
        }
      },
    );

    // Show a message to guide the user
    vscode.window.showInformationMessage(
      "Write your project description in the editor, then save the file (Cmd+S) to continue.",
    );
  }

  /**
   * Get the current repository owner and name from git remote
   */
  private async getRepoContext(): Promise<{ owner: string; repo: string }> {
    const folders = vscode.workspace.workspaceFolders;
    if (!folders || folders.length === 0) {
      throw new Error("No workspace folder open");
    }

    const gitExtension = vscode.extensions.getExtension("vscode.git");
    if (!gitExtension) {
      throw new Error("VS Code Git extension not found");
    }

    if (!gitExtension.isActive) {
      await gitExtension.activate();
    }
    const git = gitExtension.exports.getAPI(1);

    // Poll for repositories if not immediately available
    let retries = 5;
    while (git.repositories.length === 0 && retries > 0) {
      await new Promise((resolve) => setTimeout(resolve, 500));
      retries--;
    }

    if (git.repositories.length === 0) {
      throw new Error("No git repository found");
    }

    const repo = git.repositories[0];

    // Wait for remotes to populate
    let remoteRetries = 10;
    while (repo.state.remotes.length === 0 && remoteRetries > 0) {
      await new Promise((resolve) => setTimeout(resolve, 500));
      remoteRetries--;
    }

    const remote =
      repo.state.remotes.find((r: any) => r.name === "origin") ||
      repo.state.remotes[0];

    if (!remote || !remote.fetchUrl) {
      throw new Error("No remote found in current repository");
    }

    // Extract owner/repo from URL
    const match = remote.fetchUrl.match(
      /github\.com[:/]([^/]+)\/(.+?)(?:\.git)?$/,
    );
    if (!match) {
      throw new Error(`Could not parse GitHub URL: ${remote.fetchUrl}`);
    }

    return {
      owner: match[1],
      repo: match[2],
    };
  }

  /**
   * Check if we should refresh when the active editor changes
   * Returns true if we've switched to a different repository
   */
  public shouldRefreshOnEditorChange(): boolean {
    const folders = vscode.workspace.workspaceFolders;
    if (!folders || folders.length === 0) {
      return false;
    }

    // Get current repo path as a simple check
    const currentFolder = folders[0].uri.fsPath;
    const repoKey = `${currentFolder}`;

    // Check if this is a different repo than last time
    if (this._lastRepoCheck && this._lastRepoCheck !== repoKey) {
      this._lastRepoCheck = repoKey;
      return true;
    }

    this._lastRepoCheck = repoKey;
    return false;
  }

  public async refresh() {
    if (!this._view) return;

    // Deduplicate concurrent refresh calls — reuse in-flight promise
    if (this._refreshPromise) {
      return this._refreshPromise;
    }

    this._refreshPromise = this._doRefresh();
    try {
      await this._refreshPromise;
    } finally {
      this._refreshPromise = undefined;
    }
  }

  private async _doRefresh() {
    if (!this._view) return;

    try {
      const { owner, repo } = await this.getRepoContext();
      await this.loadData(owner, repo);
    } catch (error) {
      this._view.webview.postMessage({
        type: "error",
        message:
          error instanceof Error
            ? error.message
            : "Could not determine GitHub repository. Ensure a folder with a git remote is open.",
      });
    }
  }

  private async loadData(owner: string, repo: string) {
    if (!this._view) return;

    this._currentOwner = owner;
    this._currentRepo = repo;

    // Send repo info to webview for GitHub button
    this._view.webview.postMessage({
      type: "repoInfo",
      owner: owner,
      repo: repo,
    });

    // Update the view title based on current mode
    this.updateViewTitle();

    // Try to load from cache first
    const cached = await this._cacheManager.loadCache(owner, repo);
    if (cached) {
      const isStale = this._cacheManager.isCacheStale(cached);
      const cacheAge = this._cacheManager.getCacheAge(cached);

      // Send cached data immediately
      this._hasDisplayedData = true;
      this._view.webview.postMessage({
        type: "cachedData",
        repoProjects: cached.repoProjects,
        orgProjects: cached.orgProjects,
        statusOptions: cached.statusOptions,
        isStale,
        cacheAge,
      });
    } else {
      // No cache, show loading
      this._view.webview.postMessage({ type: "loading" });
    }

    // Helper: only send error to webview if no data is currently displayed.
    // If the user already sees cached/stale data, a transient fetch error
    // should not flash over it — just log it.
    const sendErrorIfNoData = (message: string) => {
      if (this._hasDisplayedData) {
        this._outputChannel.appendLine(
          `[loadData] Suppressed transient error (data already displayed): ${message}`,
        );
      } else {
        this._view!.webview.postMessage({ type: "error", message });
      }
    };

    // Now fetch fresh data asynchronously
    if (!this._githubAPI) {
      // Should not happen if initialized
      const api = new GitHubAPI(this._outputChannel);
      const success = await api.initialize();
      if (success) {
        this._githubAPI = api;
      } else {
        return;
      }
    }

    const initialized = await this._githubAPI.initialize();
    if (!initialized) {
      // If API client failed, try fallback to GraphQL
      if (this._githubAPI instanceof APIClient) {
        this._outputChannel.appendLine(
          "[Init] API client failed, falling back to direct GraphQL",
        );
        this._githubAPI = new GitHubAPI(this._outputChannel);
        const graphqlInit = await this._githubAPI.initialize();
        if (!graphqlInit) {
          sendErrorIfNoData("GitHub connection failed.");
          return;
        }
      } else {
        sendErrorIfNoData("GitHub connection failed.");
        return;
      }
    }

    let linkedResult = await this._githubAPI!.getLinkedProjects(owner, repo);

    // If API returned an error and we're using APIClient, fall back to GraphQL
    if (linkedResult.error && this._githubAPI instanceof APIClient) {
      this._outputChannel.appendLine(
        `[Fallback] API error: ${linkedResult.error}. Switching to direct GraphQL mode.`,
      );

      // Switch to direct GraphQL client
      this._githubAPI = new GitHubAPI(this._outputChannel);
      const graphqlInit = await this._githubAPI.initialize();

      if (!graphqlInit) {
        sendErrorIfNoData("Failed to connect to GitHub after API fallback.");
        return;
      }

      // Retry with GraphQL client
      linkedResult = await this._githubAPI.getLinkedProjects(owner, repo);
    }

    if (linkedResult.error) {
      sendErrorIfNoData(linkedResult.error);
      return;
    }
    // Fetch repository-linked projects (projects linked to this specific repo)
    const repoProjects = linkedResult.projects;

    // Cache the repository ID for link/unlink operations
    if (linkedResult.repositoryId) {
      this._currentRepoId = linkedResult.repositoryId;
      this._outputChannel.appendLine(
        `[claude-projects] Cached repository ID: ${this._currentRepoId}`,
      );
    }

    this._outputChannel.appendLine(`\n========== REFRESH DEBUG ==========`);
    this._outputChannel.appendLine(
      `[claude-projects] RAW REPO PROJECTS (from getLinkedProjects):`,
    );
    repoProjects.forEach((p) =>
      this._outputChannel.appendLine(
        `  - #${p.number}: ${p.title} (id: ${p.id})`,
      ),
    );

    // Fetch organization projects NOT linked to ANY repository
    // These are mutually exclusive with repoProjects, but we deduplicate as a safety net
    const allOrgProjects =
      await this._githubAPI!.getOrganizationProjects(owner);

    this._outputChannel.appendLine(
      `[claude-projects] RAW ORG PROJECTS (from getOrganizationProjects):`,
    );
    allOrgProjects.forEach((p) =>
      this._outputChannel.appendLine(
        `  - #${p.number}: ${p.title} (id: ${p.id})`,
      ),
    );

    // Safety deduplication: filter out any org projects that might also be in repo projects
    // (Should already be filtered by the API, but this is a defensive check)
    const repoProjectIds = new Set(repoProjects.map((p) => p.id));
    const uniqueOrgProjects = allOrgProjects.filter(
      (p) => !repoProjectIds.has(p.id),
    );

    this._outputChannel.appendLine(`[claude-projects] AFTER DEDUPLICATION:`);
    this._outputChannel.appendLine(
      `  Repo projects: ${repoProjects.length} - [${repoProjects.map((p) => `#${p.number}`).join(", ")}]`,
    );
    this._outputChannel.appendLine(
      `  Org projects: ${uniqueOrgProjects.length} - [${uniqueOrgProjects.map((p) => `#${p.number}`).join(", ")}]`,
    );
    this._outputChannel.appendLine(
      `  Removed from org list: ${allOrgProjects.length - uniqueOrgProjects.length} duplicates`,
    );
    this._outputChannel.appendLine(`===================================\n`);

    // Print project names and numbers to Output panel
    this._outputChannel.clear();
    this._outputChannel.appendLine("========== PROJECTS REFRESH ==========");
    this._outputChannel.appendLine(`Repository: ${owner}/${repo}`);
    this._outputChannel.appendLine(
      `Mode: ${this._showOrgProjects ? "Organization Projects" : "Repository Projects"}`,
    );
    this._outputChannel.appendLine("");
    this._outputChannel.appendLine(
      `REPO-LINKED PROJECTS (${repoProjects.length}):`,
    );
    if (repoProjects.length === 0) {
      this._outputChannel.appendLine("  (none)");
    } else {
      repoProjects.forEach((p) =>
        this._outputChannel.appendLine(`  #${p.number}: ${p.title}`),
      );
    }
    this._outputChannel.appendLine("");
    this._outputChannel.appendLine(
      `ORG PROJECTS (not linked to any repo) (${uniqueOrgProjects.length}):`,
    );
    if (uniqueOrgProjects.length === 0) {
      this._outputChannel.appendLine("  (none)");
    } else {
      uniqueOrgProjects.forEach((p) =>
        this._outputChannel.appendLine(`  #${p.number}: ${p.title}`),
      );
    }
    this._outputChannel.appendLine("======================================");

    if (repoProjects.length === 0 && uniqueOrgProjects.length === 0) {
      const rawErrors = linkedResult.errors
        ? JSON.stringify(linkedResult.errors)
        : "None";
      const debugInfo = `Debug: Owner = ${owner}, Repo = ${repo}.RepoProjects = ${repoProjects.length}, OrgProjects = ${uniqueOrgProjects.length}.LinkedError = ${linkedResult.error || "None"}.RawErrors = ${rawErrors}`;
      this._view.webview.postMessage({
        type: "noProjects",
        message: `No linked projects found.${debugInfo}`,
      });
      return;
    }

    // PHASE 1: If no cache exists, send project metadata immediately for fast UI
    // This prevents timeout by showing projects before fetching all items
    if (!cached) {
      const quickRepoProjects = repoProjects.map((p) => ({
        ...p,
        phases: [],
        itemCount: 0,
        notDoneCount: 0,
        items: [],
        statusOptions: [],
        isLoading: true, // Flag to show loading state
      }));
      const quickOrgProjects = uniqueOrgProjects.map((p) => ({
        ...p,
        phases: [],
        itemCount: 0,
        notDoneCount: 0,
        items: [],
        statusOptions: [],
        isLoading: true,
      }));

      this._outputChannel.appendLine(
        `[claude-projects] Sending quick metadata for ${quickRepoProjects.length + quickOrgProjects.length} projects`,
      );
      this._hasDisplayedData = true;
      this._view.webview.postMessage({
        type: "data",
        repoProjects: quickRepoProjects,
        orgProjects: quickOrgProjects,
        statusOptions: [],
        isPartial: true, // Flag to indicate more data coming
      });
    }

    // PHASE 2: Now fetch full details for each project

    const processProjectList = async (projects: Project[]) => {
      const results = [];
      this._outputChannel.appendLine(
        `[claude-projects] Processing ${projects.length} projects...`,
      );

      for (const project of projects) {
        try {
          this._outputChannel.appendLine(
            `[claude-projects] Processing project #${project.number}...`,
          );
          const items = await this._githubAPI!.getProjectItems(project.id);
          this._outputChannel.appendLine(
            `[claude-projects] Project #${project.number}: ${items.length} items`,
          );
          const phases = groupItemsByPhase(items);

          // --- Auto-Update Fields Logic ---
          // 1. Fetch Fields to get IDs
          const fields = await this._githubAPI!.getProjectFields(project.id);
          const statusField = fields.find((f: any) => f.name === "Status");

          // Store status options for UI
          let statusOptions: any[] = [];
          if (statusField && statusField.options) {
            statusOptions = statusField.options.map((o: any) => ({
              id: o.id,
              name: o.name,
            }));

            const doneOption = statusField.options.find(
              (o: any) => o.name === "Done",
            );
            const inProgressOption = statusField.options.find(
              (o: any) => o.name === "In Progress",
            );
            // Map names to IDs
            const statusMap: Record<string, string> = {};
            if (doneOption) statusMap["Done"] = doneOption.id;
            if (inProgressOption)
              statusMap["In Progress"] = inProgressOption.id;

            for (const phase of phases.values()) {
              const targetStatusName = calculatePhaseStatus(phase);
              if (targetStatusName && phase.masterItem) {
                const currentStatus = phase.masterItem.fieldValues["Status"];
                if (
                  currentStatus !== targetStatusName &&
                  statusMap[targetStatusName]
                ) {
                  // UPDATE REQUIRED
                  console.log(
                    `Auto - updating Master ${phase.masterItem.id} to ${targetStatusName}`,
                  );

                  const success = await this._githubAPI!.updateItemFieldValue(
                    project.id,
                    phase.masterItem.id,
                    statusField.id,
                    statusMap[targetStatusName],
                  );

                  if (success) {
                    // Update local model so view is correct immediately
                    phase.masterItem.fieldValues["Status"] = targetStatusName;
                    vscode.window.showInformationMessage(
                      `Auto - updated phase "${phase.phaseName}" to ${targetStatusName}`,
                    );
                  }
                }
              }
            }
            // --- End Auto-Update Logic ---
          }

          // --- Auto-Close Issues Logic ---
          // Close GitHub issues for items marked as Done/Merged/Closed
          for (const item of items) {
            const status = item.fieldValues["Status"];
            const isDone = ["Done", "Merged", "Closed"].includes(status || "");

            // Only process if item is done and has actual issue content (not a draft)
            if (
              isDone &&
              item.content &&
              item.content.state &&
              item.content.number
            ) {
              const issueState = item.content.state;
              const issueNumber = item.content.number;

              // Check if the issue is still open
              if (issueState === "OPEN") {
                const owner = item.content.repository.owner.login;
                const repoName = item.content.repository.name;

                console.log(
                  `Auto-closing issue #${issueNumber} in ${owner}/${repoName} (project item marked as ${status})`,
                );

                const success = await this._githubAPI!.closeIssue(
                  owner,
                  repoName,
                  issueNumber,
                );

                if (success) {
                  // Update local model so view is correct immediately
                  item.content.state = "CLOSED";
                  vscode.window.showInformationMessage(
                    `Auto-closed issue #${issueNumber}: ${item.content.title}`,
                  );
                } else {
                  console.error(`Failed to close issue #${issueNumber}`);
                }
              }
            }
          }
          // --- End Auto-Close Issues Logic ---

          // Convert Map to Array for transport
          const sortedPhases = Array.from(phases.values()).sort(
            (a, b) => a.phaseNumber - b.phaseNumber,
          );

          // Identify "Ready" items (not done)
          const notDoneItems = items.filter((i) => {
            const status = i.fieldValues["Status"];
            return !["Done", "Merged", "Closed"].includes(status || "");
          });

          // Detect worktree status for this project
          let worktree = null;
          try {
            worktree = await this.getWorktreeStatus(project.number);
            if (worktree?.hasWorktree) {
              this.pushWorktreeStatusToAPI(project.number, worktree);
            }
          } catch (wtError) {
            this._outputChannel.appendLine(
              `[claude-projects] Worktree check failed for #${project.number}: ${wtError instanceof Error ? wtError.message : String(wtError)}`
            );
          }

          results.push({
            ...project,
            phases: sortedPhases,
            itemCount: items.length,
            notDoneCount: notDoneItems.length,
            items: notDoneItems,
            statusOptions: statusOptions,
            statusFieldId: statusField?.id,
            isLoading: false, // Explicitly clear loading state
            worktree: worktree,
          });
          this._outputChannel.appendLine(
            `[claude-projects] Project #${project.number} processed successfully${worktree?.hasWorktree ? ` (worktree: ${worktree.branch})` : ""}`,
          );
        } catch (error) {
          this._outputChannel.appendLine(
            `[claude-projects] ERROR processing project #${project.number}: ${error instanceof Error ? error.message : String(error)}`,
          );
          // Still include the project but with empty items and loading cleared
          results.push({
            ...project,
            phases: [],
            itemCount: 0,
            notDoneCount: 0,
            items: [],
            statusOptions: [],
            isLoading: false,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
      this._outputChannel.appendLine(
        `[claude-projects] Finished processing ${results.length} projects`,
      );
      return results;
    };

    let repoProjectsData: any[] = [];
    let orgProjectsData: any[] = [];

    try {
      repoProjectsData = await processProjectList(repoProjects);
      orgProjectsData = await processProjectList(uniqueOrgProjects);
    } catch (error) {
      this._outputChannel.appendLine(
        `[claude-projects] ERROR in processProjectList: ${error instanceof Error ? error.message : String(error)}`,
      );
      // Send what we have with loading cleared
      repoProjectsData = repoProjects.map((p) => ({
        ...p,
        phases: [],
        items: [],
        isLoading: false,
      }));
      orgProjectsData = uniqueOrgProjects.map((p) => ({
        ...p,
        phases: [],
        items: [],
        isLoading: false,
      }));
    }

    // Extract status options from first project (assuming all use same status field)
    const allProjects = [...repoProjectsData, ...orgProjectsData];
    const statusOptions =
      allProjects.length > 0 ? allProjects[0].statusOptions : [];

    // If we had cached data, calculate diff and check for changes
    if (cached) {
      const diff = calculateDataDiff(
        cached.repoProjects,
        cached.orgProjects,
        repoProjectsData,
        orgProjectsData,
      );

      if (hasChanges(diff)) {
        // Always do a full re-render when data changes
        // Incremental updates don't properly handle phase structures and status changes
        this._hasDisplayedData = true;
        this._view.webview.postMessage({
          type: "data",
          repoProjects: repoProjectsData,
          orgProjects: orgProjectsData,
          statusOptions: statusOptions,
        });
      } else {
        // No changes, just mark as fresh
        this._hasDisplayedData = true;
        this._view.webview.postMessage({
          type: "dataFresh",
        });
      }
    } else {
      // No cache, send full data
      this._hasDisplayedData = true;
      this._view.webview.postMessage({
        type: "data",
        repoProjects: repoProjectsData,
        orgProjects: orgProjectsData,
        statusOptions: statusOptions,
      });
    }

    // Save to cache
    await this._cacheManager.saveCache(
      owner,
      repo,
      repoProjectsData,
      orgProjectsData,
      statusOptions,
    );

    // Connect to WebSocket for real-time notifications
    await this.connectWebSocket(allProjects);
  }

  /**
   * Update project subscriptions for real-time notifications.
   * DEPRECATED: Old WebSocket notification client removed.
   * Project subscriptions now flow through OrchestrationWebSocketClient.
   */
  private async connectWebSocket(projects: any[]): Promise<void> {
    // Extract project numbers and update orchestration subscriptions
    const projectNumbers = projects.map((p: any) => p.number).filter((n: any) => n);
    this._activeProjectNumbers = projectNumbers;
    this.updateProjectSubscriptions(projectNumbers);
  }

  private _getHtmlForWebview(webview: vscode.Webview) {
    const scriptUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this._extensionUri, "media", "main.js"),
    );
    const styleUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this._extensionUri, "media", "style.css"),
    );

    return `<!DOCTYPE html>
            <html lang="en">
            <head>
                <meta charset="UTF-8">
                <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource}; script-src ${webview.cspSource};">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <link href="${styleUri}" rel="stylesheet">
                <title>Projects</title>
            </head>
            <body>
                <div id="app">
                    <div id="loading" class="loading-container">
                        <div class="loading-spinner"></div>
                        <div class="loading-text">Loading projects...</div>
                    </div>
                    <div id="error" class="error-container"></div>
                    <div id="content"></div>
                    <div id="task-history" class="task-history-overlay">
                        <div class="task-history-header">
                            <h2>Task History</h2>
                            <button class="task-history-close" id="task-history-close-btn">✕</button>
                        </div>
                        <div class="task-history-content">
                            <p>Task history will be displayed here...</p>
                        </div>
                    </div>
                </div>
                <script src="${scriptUri}"></script>
            </body>
            </html>`;
  }

  public viewActiveSessions() {
    if (!this._claudeMonitor) {
      vscode.window.showInformationMessage("No active Claude sessions");
      return;
    }

    const sessions = this._claudeMonitor.getActiveSessions();
    if (sessions.length === 0) {
      vscode.window.showInformationMessage("No active Claude sessions");
      return;
    }

    const items = sessions.map((s) => ({
      label: `Project #${s.projectNumber}`,
      description: `Session: ${s.sessionId}`,
      detail: `Started: ${new Date(s.lastModified).toLocaleString()}`,
      sessionId: s.sessionId,
      filePath: s.responseFilePath,
    }));

    vscode.window
      .showQuickPick(items, {
        placeHolder: "Select a session to view",
      })
      .then((selected) => {
        if (selected) {
          vscode.workspace.openTextDocument(selected.filePath).then((doc) => {
            vscode.window.showTextDocument(doc, { preview: false });
          });
        }
      });
  }

  public stopAllSessions() {
    if (!this._claudeMonitor) {
      vscode.window.showInformationMessage("No active Claude sessions");
      return;
    }

    const sessions = this._claudeMonitor.getActiveSessions();
    if (sessions.length === 0) {
      vscode.window.showInformationMessage("No active Claude sessions");
      return;
    }

    vscode.window
      .showWarningMessage(
        `Stop all ${sessions.length} active Claude session(s)?`,
        "Stop All",
        "Cancel",
      )
      .then((choice) => {
        if (choice === "Stop All") {
          this._claudeMonitor?.stopAllSessions();
          vscode.window.showInformationMessage("All Claude sessions stopped");
        }
      });
  }

  // ===== PROJECT FLOW HANDLERS =====

  private async handleStartProjectFlow() {
    if (!this._view || !this._projectFlowManager) return;

    try {
      // Start new session
      const sessionId = this._projectFlowManager.startSession();
      console.log(`Started project flow session: ${sessionId}`);

      // Show input dialog in webview
      this._view.webview.postMessage({ type: "showInputDialog" });
    } catch (error) {
      console.error("Error starting project flow:", error);
      this._view?.webview.postMessage({
        type: "flowError",
        error: `Failed to start project flow: ${error instanceof Error ? error.message : String(error)}`,
        recoverable: true,
      });
    }
  }

  private async handleInputSubmitted(input: string, detection: any) {
    if (!this._view || !this._projectFlowManager || !this._claudeAPI) return;

    try {
      // Get workspace root
      const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
      if (!workspaceRoot) {
        throw new Error("No workspace folder found");
      }

      // Extract input content
      const extractedInput = await extractInput(input, workspaceRoot);
      this._projectFlowManager.setInput(extractedInput);
      this._projectFlowManager.setPhase("design");

      // Show progress
      this._view.webview.postMessage({
        type: "projectCreationProgress",
        step: "Analyzing project...",
        current: 1,
        total: 5,
      });

      // Execute design analysis
      const result = await this._claudeAPI.executeDesignAnalysis(
        extractedInput.content,
      );

      // Store iteration
      this._projectFlowManager.addDesignIteration(
        extractedInput.content,
        result,
      );

      // Show design review dialog
      this._view.webview.postMessage({
        type: "showDesignReview",
        result,
        iteration: 1,
      });
    } catch (error) {
      console.error("Error processing input:", error);
      this._view?.webview.postMessage({
        type: "flowError",
        error: `Failed to process input: ${error instanceof Error ? error.message : String(error)}`,
        recoverable: true,
      });
    }
  }

  private async handleTypeaheadRequest(input: string) {
    if (!this._view) return;

    try {
      const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
      if (!workspaceRoot) {
        this._view.webview.postMessage({
          type: "typeaheadResponse",
          results: [],
        });
        return;
      }

      const results = getTypeaheadResults(input, workspaceRoot);
      this._view.webview.postMessage({
        type: "typeaheadResponse",
        results,
      });
    } catch (error) {
      console.error("Error getting typeahead results:", error);
      this._view.webview.postMessage({
        type: "typeaheadResponse",
        results: [],
      });
    }
  }

  private async handleDesignFeedback(feedback: string, skipReview: boolean) {
    if (!this._view || !this._projectFlowManager || !this._claudeAPI) return;

    try {
      const session = this._projectFlowManager.getCurrentSession();
      if (!session) {
        throw new Error("No active session");
      }

      // Update skip review preference
      if (skipReview) {
        this._projectFlowManager.setSkipProductReview(true);
      }

      // Show progress
      this._view.webview.postMessage({
        type: "projectCreationProgress",
        step: "Refining design...",
        current: 2,
        total: 5,
      });

      // Execute iteration
      const previousResult = session.designIterations.currentResult;
      const result = await this._claudeAPI.executeDesignIteration(
        previousResult,
        feedback,
      );

      // Store iteration
      this._projectFlowManager.addDesignIteration(feedback, result);

      // Show updated design review
      this._view.webview.postMessage({
        type: "showDesignReview",
        result,
        iteration: session.designIterations.iterations.length,
      });
    } catch (error) {
      console.error("Error processing feedback:", error);
      this._view?.webview.postMessage({
        type: "flowError",
        error: `Failed to process feedback: ${error instanceof Error ? error.message : String(error)}`,
        recoverable: true,
      });
    }
  }

  private async handleDesignAccepted(skipReview: boolean) {
    if (!this._view || !this._projectFlowManager || !this._claudeAPI) return;

    try {
      const session = this._projectFlowManager.getCurrentSession();
      if (!session) {
        throw new Error("No active session");
      }

      // Update skip review preference
      if (skipReview) {
        this._projectFlowManager.setSkipProductReview(true);
      }

      this._projectFlowManager.setPhase("structure");

      // Show progress
      this._view.webview.postMessage({
        type: "projectCreationProgress",
        step: "Creating project structure...",
        current: 3,
        total: 5,
      });

      // Execute project breakdown
      const approvedDesign = session.designIterations.currentResult;
      const breakdownResult =
        await this._claudeAPI.executeProjectBreakdown(approvedDesign);

      // Parse JSON response
      const config = this._claudeAPI.parseJSONResponse(breakdownResult);

      // Get current repo info
      if (!this._currentOwner || !this._currentRepo) {
        throw new Error("No repository context");
      }

      // Build project creation config
      const projectConfig = {
        isPublic: false, // Will be set by user
        repoOwner: this._currentOwner,
        repoName: this._currentRepo,
        projectTitle: config.projectTitle,
        epic: config.epic,
        tasks: config.tasks,
      };

      this._projectFlowManager.setFinalConfig(projectConfig);

      // Show project approval dialog
      this._view.webview.postMessage({
        type: "showProjectApproval",
        config: projectConfig,
      });
    } catch (error) {
      console.error("Error accepting design:", error);
      this._view?.webview.postMessage({
        type: "flowError",
        error: `Failed to create project structure: ${error instanceof Error ? error.message : String(error)}`,
        recoverable: true,
      });
    }
  }

  private async handleProjectApproved(isPublic: boolean) {
    if (!this._view || !this._projectFlowManager) return;

    try {
      const session = this._projectFlowManager.getCurrentSession();
      if (!session || !session.finalConfig) {
        throw new Error("No project configuration");
      }

      // Update visibility
      session.finalConfig.isPublic = isPublic;
      this._projectFlowManager.setPhase("creation");

      // TODO: Replace with MCP Server tools
      // - Use github_create_project MCP tool
      // - Use github_create_issue MCP tool
      // - Use github_link_issue_to_project MCP tool
      // See: docs/mcp-migration-guide.md

      throw new Error(
        "Project creation through extension UI has been deprecated.\n" +
          "Please use Claude Code with MCP Server tools instead:\n" +
          "  - github_create_project\n" +
          "  - github_create_issue\n" +
          "  - github_link_issue_to_project\n\n" +
          "See: docs/mcp-migration-guide.md for migration instructions.",
      );
    } catch (error) {
      console.error("Error creating project:", error);
      this._view?.webview.postMessage({
        type: "flowError",
        error: `Failed to create project: ${error instanceof Error ? error.message : String(error)}`,
        recoverable: false,
        action:
          error instanceof Error && error.message.includes("gh auth")
            ? error.message
            : undefined,
      });
    }
  }

  /**
   * Cleanup method to be called when extension deactivates
   */
  public dispose(): void {
    // Disconnect orchestration WebSocket
    if (this._orchestrationWsClient) {
      this._outputChannel.appendLine('[Cleanup] Disconnecting orchestration WebSocket');
      this._orchestrationWsClient.disconnect();
      this._orchestrationWsClient = undefined;
    }

    this._outputChannel.appendLine('[Cleanup] ProjectsViewProvider disposed');
  }
}

function getNonce() {
  let text = "";
  const possible =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  for (let i = 0; i < 32; i++) {
    text += possible.charAt(Math.floor(Math.random() * possible.length));
  }
  return text;
}
