"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function (o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
        desc = { enumerable: true, get: function () { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function (o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function (o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function (o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function (o) {
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
exports.ProjectsViewProvider = void 0;
const vscode = __importStar(require("vscode"));
const github_api_1 = require("./github-api");
const api_client_1 = require("./api-client");
const phase_logic_1 = require("./phase-logic");
const claude_monitor_1 = require("./claude-monitor");
const cache_manager_1 = require("./cache-manager");
const diff_calculator_1 = require("./diff-calculator");
const project_flow_manager_1 = require("./project-flow-manager");
const claude_api_1 = require("./claude-api");
// DEPRECATED: GitHubProjectCreator removed - use MCP Server tools instead
// See: docs/mcp-migration-guide.md
const input_detection_1 = require("./input-detection");
const child_process_1 = require("child_process");
const util_1 = require("util");
const execAsync = (0, util_1.promisify)(child_process_1.exec);
class ProjectsViewProvider {
    _extensionUri;
    _context;
    static viewType = "ghProjects.view";
    _view;
    _githubAPI;
    _orchestrationClient; // Separate client for orchestration (always uses API)
    _claudeMonitor;
    _cacheManager;
    _currentOwner;
    _currentRepo;
    _currentRepoId; // Cache the repository node ID
    _lastRepoCheck; // Track last checked repo for debouncing
    _projectFlowManager;
    _claudeAPI;
    // DEPRECATED: _projectCreator removed - use MCP Server tools instead
    _outputChannel;
    _showOrgProjects = true;
    _wsClient;
    _activeProjectNumbers = [];
    _orchestrationData;
    constructor(_extensionUri, _context, wsClient) {
        this._extensionUri = _extensionUri;
        this._context = _context;
        this._outputChannel = vscode.window.createOutputChannel("Stoked Projects");
        // Check configuration for API service usage
        const config = vscode.workspace.getConfiguration("claudeProjects");
        const useAPIService = config.get("useAPIService", false);
        const apiBaseUrl = config.get("apiBaseUrl", "http://localhost:8167");
        // ALWAYS create orchestration client for API (orchestration doesn't need GitHub token)
        this._orchestrationClient = new api_client_1.APIClient({ baseUrl: apiBaseUrl }, this._outputChannel);
        this._outputChannel.appendLine("[Init] Orchestration client created (always uses API)");
        // Create GitHub client based on config (for projects)
        if (useAPIService) {
            this._outputChannel.appendLine("[Init] Using HTTP API client for projects (will fallback to GraphQL if unreachable)");
            this._githubAPI = new api_client_1.APIClient({ baseUrl: apiBaseUrl }, this._outputChannel);
        }
        else {
            this._outputChannel.appendLine("[Init] Using direct GraphQL client for projects");
            this._githubAPI = new github_api_1.GitHubAPI(this._outputChannel);
        }
        this._cacheManager = new cache_manager_1.CacheManager(_context);
        this._projectFlowManager = new project_flow_manager_1.ProjectFlowManager(_context);
        this._claudeAPI = new claude_api_1.ClaudeAPI();
        // DEPRECATED: _projectCreator removed - use MCP Server tools instead
        this._wsClient = wsClient;
        // Initialize orchestration data from context or defaults
        const savedOrchestration = _context.workspaceState.get('orchestrationData');
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
        // Register WebSocket event handlers
        if (this._wsClient) {
            this.setupWebSocketHandlers();
        }
    }
    /**
     * Setup WebSocket event handlers for real-time updates
     */
    setupWebSocketHandlers() {
        if (!this._wsClient)
            return;
        // Handle issue created events
        this._wsClient.on("issue.created", (event) => {
            this._outputChannel.appendLine(`[WS] Issue created: ${event.data.title}`);
            // Refresh the entire project tree (could be optimized to just add the new issue)
            this.handleWebSocketUpdate("issue.created", event.data);
        });
        // Handle issue updated events
        this._wsClient.on("issue.updated", (event) => {
            this._outputChannel.appendLine(`[WS] Issue updated: ${event.data.title}`);
            // Update specific issue in UI without full refresh
            this.handleWebSocketUpdate("issue.updated", event.data);
        });
        // Handle issue deleted events
        this._wsClient.on("issue.deleted", (event) => {
            this._outputChannel.appendLine(`[WS] Issue deleted: ${event.data.id}`);
            // Remove issue from UI
            this.handleWebSocketUpdate("issue.deleted", event.data);
        });
        // Handle project updated events
        this._wsClient.on("project.updated", (event) => {
            this._outputChannel.appendLine(`[WS] Project updated: ${event.data.title}`);
            // Refresh project metadata
            this.handleWebSocketUpdate("project.updated", event.data);
        });
        // Handle phase updated events
        this._wsClient.on("phase.updated", (event) => {
            this._outputChannel.appendLine(`[WS] Phase updated: ${event.data.phase}`);
            // Refresh phase structure
            this.handleWebSocketUpdate("phase.updated", event.data);
        });
        // Handle global orchestration updates
        this._wsClient.on("orchestration.global", (event) => {
            this._outputChannel.appendLine(`[WS] Global orchestration updated: running=${event.data.running}, desired=${event.data.desired}`);
            // Update global orchestration data
            this.setOrchestrationData({
                global: {
                    running: event.data.running,
                    desired: event.data.desired,
                },
            });
        });
    }
    /**
     * Handle WebSocket update events
     */
    async handleWebSocketUpdate(eventType, data) {
        // For now, just refresh the entire view
        // Could be optimized to update only specific items
        try {
            // Clear cache for affected project
            if (data.projectNumber && this._currentOwner && this._currentRepo) {
                await this._cacheManager.clearCache(this._currentOwner, this._currentRepo);
            }
            // Refresh the view
            await this.refresh();
            // Notify user of the update
            if (this._view) {
                this._view.webview.postMessage({
                    type: "notification",
                    eventType,
                    data,
                });
            }
        }
        catch (error) {
            this._outputChannel.appendLine(`[WS] Error handling update: ${error}`);
        }
    }
    /**
     * Get orchestration data
     */
    getOrchestrationData() {
        return this._orchestrationData;
    }
    /**
     * Update orchestration data (e.g., from API or external source)
     */
    setOrchestrationData(data) {
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
    sendOrchestrationData() {
        if (!this._view)
            return;
        const data = this.getOrchestrationData();
        this._view.webview.postMessage({
            type: "orchestrationData",
            data,
        });
    }
    /**
     * Test API connectivity by making a health check request
     */
    async testAPIConnection() {
        try {
            const config = vscode.workspace.getConfiguration("claudeProjects");
            const apiBaseUrl = config.get("apiBaseUrl", "http://localhost:8167");
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 2000); // 2 second timeout
            const response = await fetch(`${apiBaseUrl}/health`, {
                signal: controller.signal,
            });
            clearTimeout(timeoutId);
            return response.ok;
        }
        catch (error) {
            this._outputChannel.appendLine(`[Init] API health check failed: ${error}`);
            return false;
        }
    }
    /**
     * Fetch orchestration data from API on startup
     */
    async fetchOrchestrationData() {
        try {
            const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
            if (!workspaceFolder) {
                return;
            }
            const workspaceId = workspaceFolder.uri.fsPath;
            this._outputChannel.appendLine(`[Orchestration] Fetching initial data for workspace: ${workspaceId}`);
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
                this._outputChannel.appendLine(`[Orchestration] Fetched initial data. Workspace: running=${result.workspace.running}, desired=${result.workspace.desired}. Global: running=${result.global.running}, desired=${result.global.desired}`);
            }
        }
        catch (error) {
            this._outputChannel.appendLine(`[Orchestration] Error fetching initial data: ${error}`);
        }
    }
    /**
     * Update workspace currently running count (called from API or external source)
     */
    updateWorkspaceRunning(count) {
        this.setOrchestrationData({
            workspace: { running: count }
        });
    }
    /**
     * Update desired LLMs count for workspace
     */
    async updateOrchestrationDesired(scope, desired) {
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
                this._outputChannel.appendLine(`[Orchestration] Updating workspace ${workspaceId} desired to ${clampedDesired}`);
                // Call API to update workspace orchestration using dedicated orchestration client
                const result = await this._orchestrationClient.updateWorkspaceDesired(workspaceId, clampedDesired);
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
                    this._outputChannel.appendLine(`[Orchestration] Updated successfully. Global: running=${result.global.running}, desired=${result.global.desired}`);
                }
                else {
                    throw new Error('API returned null response');
                }
            }
        }
        catch (error) {
            this._outputChannel.appendLine(`[Orchestration] Error updating desired count: ${error}`);
            vscode.window.showErrorMessage(`Failed to update orchestration settings: ${error}`);
        }
    }
    async resolveWebviewView(webviewView, context, _token) {
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
                    await this.handleStatusUpdate(data.projectId, data.itemId, data.statusOptionId);
                    break;
                }
                case "deleteItem": {
                    await this.handleDeleteItem(data.projectId, data.itemId, data.itemTitle);
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
                        placeHolder: 'e.g., Focus on dark mode fixes, or "resuming from yesterday"',
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
                    await this.handleMarkPhaseDone(data.projectId, data.itemIds, data.phaseName);
                    break;
                }
                case "modeChanged": {
                    this._showOrgProjects = data.showOrgProjects;
                    this._outputChannel.appendLine(`\n>>> MODE SWITCHED: Now showing ${this._showOrgProjects ? "ORGANIZATION" : "REPOSITORY"} projects`);
                    this.updateViewTitle();
                    break;
                }
                case "refreshProject": {
                    await this.handleRefreshProject(data.projectId, data.projectNumber);
                    break;
                }
                case "linkProjectToRepo": {
                    await this.handleLinkProjectToRepo(data.projectId, data.projectNumber);
                    break;
                }
                case "unlinkProjectFromRepo": {
                    await this.handleUnlinkProjectFromRepo(data.projectId, data.projectNumber);
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
                case "ready": {
                    // Webview is ready, send initial data
                    this._outputChannel.appendLine("[WebView] Webview ready, triggering refresh");
                    this.refresh().catch((e) => {
                        this._outputChannel.appendLine(`[WebView] Initial refresh failed: ${e}`);
                    });
                    break;
                }
            }
        });
        // Send orchestration data immediately
        this.sendOrchestrationData();
        // Fetch initial orchestration data from API
        this.fetchOrchestrationData();
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
                        }
                        else {
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
                            message: e instanceof Error
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
    updateViewTitle() {
        if (!this._view)
            return;
        if (this._showOrgProjects) {
            // Org mode: show just the org/owner name
            this._view.title = this._currentOwner || "Projects";
        }
        else {
            // Repo mode: show owner/repo
            if (this._currentOwner && this._currentRepo) {
                this._view.title = `${this._currentOwner}/${this._currentRepo}`;
            }
            else {
                this._view.title = "Projects";
            }
        }
    }
    async handleStatusUpdate(projectId, itemId, statusOptionId) {
        if (!this._view)
            return;
        // Find the project to get the status field ID
        // We'll need to fetch fields again or store them
        const fields = await this._githubAPI.getProjectFields(projectId);
        const statusField = fields.find((f) => f.name === "Status");
        if (!statusField) {
            vscode.window.showErrorMessage("Status field not found");
            return;
        }
        const success = await this._githubAPI.updateItemFieldValue(projectId, itemId, statusField.id, statusOptionId);
        if (success) {
            vscode.window.showInformationMessage("Status updated successfully");
            // Refresh the view to show updated status
            await this.refresh();
        }
        else {
            vscode.window.showErrorMessage("Failed to update status");
        }
    }
    async handleDeleteItem(projectId, itemId, itemTitle) {
        if (!this._view)
            return;
        const confirm = await vscode.window.showWarningMessage(`Are you sure you want to delete "${itemTitle}" from this project?`, { modal: true }, "Delete");
        if (confirm !== "Delete") {
            return;
        }
        const success = await this._githubAPI.deleteProjectItem(projectId, itemId);
        if (success) {
            vscode.window.showInformationMessage(`Deleted "${itemTitle}" from project`);
            // Send message to remove item from UI instead of full refresh
            this._view.webview.postMessage({
                type: "removeItem",
                projectId: projectId,
                itemId: itemId,
            });
        }
        else {
            vscode.window.showErrorMessage("Failed to delete item");
        }
    }
    async handleDeleteProject(projectId, projectTitle) {
        if (!this._view)
            return;
        const confirm = await vscode.window.showWarningMessage(`Are you sure you want to DELETE the entire project "${projectTitle}"? This action cannot be undone.`, { modal: true }, "Delete Project");
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
        }
        else {
            vscode.window.showErrorMessage("Failed to delete project");
        }
    }
    async handleMarkAllDone(projectId, projectTitle) {
        if (!this._view)
            return;
        const confirm = await vscode.window.showWarningMessage(`Mark ALL items in "${projectTitle}" as Done?`, { modal: true }, "Mark All Done");
        if (confirm !== "Mark All Done") {
            return;
        }
        try {
            // Get project fields
            const fields = await this._githubAPI.getProjectFields(projectId);
            const statusField = fields.find((f) => f.name === "Status");
            if (!statusField) {
                vscode.window.showErrorMessage("Status field not found");
                return;
            }
            const doneOption = statusField.options?.find((o) => o.name === "Done");
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
                    const success = await this._githubAPI.updateItemFieldValue(projectId, item.id, statusField.id, doneOption.id);
                    if (success)
                        updatedCount++;
                }
            }
            vscode.window.showInformationMessage(`Marked ${updatedCount} items as Done`);
            await this.refresh();
        }
        catch (error) {
            vscode.window.showErrorMessage(`Failed to mark items as Done: ${error instanceof Error ? error.message : String(error)}`);
        }
    }
    async handleMarkPhaseDone(projectId, itemIds, phaseName) {
        if (!this._view)
            return;
        const confirm = await vscode.window.showWarningMessage(`Mark all items in phase "${phaseName}" as Done?`, { modal: true }, "Mark Done");
        if (confirm !== "Mark Done") {
            return;
        }
        try {
            // Get project fields
            const fields = await this._githubAPI.getProjectFields(projectId);
            const statusField = fields.find((f) => f.name === "Status");
            if (!statusField) {
                vscode.window.showErrorMessage("Status field not found");
                return;
            }
            const doneOption = statusField.options?.find((o) => o.name === "Done");
            if (!doneOption) {
                vscode.window.showErrorMessage("Done status option not found");
                return;
            }
            // Update each item
            let updatedCount = 0;
            for (const itemId of itemIds) {
                const success = await this._githubAPI.updateItemFieldValue(projectId, itemId, statusField.id, doneOption.id);
                if (success)
                    updatedCount++;
            }
            vscode.window.showInformationMessage(`Marked ${updatedCount} items in "${phaseName}" as Done`);
            await this.refresh();
        }
        catch (error) {
            vscode.window.showErrorMessage(`Failed to mark phase items as Done: ${error instanceof Error ? error.message : String(error)}`);
        }
    }
    async handleRefreshProject(projectId, projectNumber) {
        if (!this._view)
            return;
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
            const linkedResult = await this._githubAPI.getLinkedProjects(this._currentOwner, this._currentRepo);
            const isNowLinked = linkedResult.projects.some((p) => p.id === projectId);
            // Check if this project was unlinked from the repo
            if (!isNowLinked) {
                this._outputChannel.appendLine(`[stoked-projects] Project #${projectNumber} is not linked to ${this._currentOwner}/${this._currentRepo}`);
                // Load current cache
                const cached = await this._cacheManager.loadCache(this._currentOwner, this._currentRepo);
                if (cached) {
                    // Check if it's still an org project
                    const allOrgProjects = await this._githubAPI.getOrganizationProjects(this._currentOwner);
                    const isOrgProject = allOrgProjects.some((p) => p.id === projectId);
                    if (!isOrgProject) {
                        // Not in org or repo - project was deleted or moved
                        this._outputChannel.appendLine(`[stoked-projects] Project #${projectNumber} no longer exists in org - removing`);
                        // Remove from both lists
                        const updatedRepoProjects = cached.repoProjects.filter((p) => p.id !== projectId);
                        const updatedOrgProjects = cached.orgProjects.filter((p) => p.id !== projectId);
                        // Update cache
                        await this._cacheManager.saveCache(this._currentOwner, this._currentRepo, updatedRepoProjects, updatedOrgProjects, cached.statusOptions);
                        // Tell UI to remove the project
                        this._view.webview.postMessage({
                            type: "projectRemoved",
                            projectId: projectId,
                        });
                        return; // Don't send projectUpdate
                    }
                    else {
                        // It's an org project - update cache to ensure it's in the right list
                        this._outputChannel.appendLine(`[stoked-projects] Project #${projectNumber} is an org project - refreshing data`);
                        const updatedRepoProjects = cached.repoProjects.filter((p) => p.id !== projectId);
                        let updatedOrgProjects = cached.orgProjects;
                        // Ensure it's in orgProjects
                        const alreadyInOrgProjects = updatedOrgProjects.some((p) => p.id === projectId);
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
                        await this._cacheManager.saveCache(this._currentOwner, this._currentRepo, updatedRepoProjects, updatedOrgProjects, cached.statusOptions);
                        // Continue to fetch fresh data below (don't return here!)
                    }
                }
            }
            // Fetch fresh items for this specific project
            const items = await this._githubAPI.getProjectItems(projectId);
            const phases = (0, phase_logic_1.groupItemsByPhase)(items);
            // Fetch fields for status options
            const fields = await this._githubAPI.getProjectFields(projectId);
            const statusField = fields.find((f) => f.name === "Status");
            let statusOptions = [];
            if (statusField && statusField.options) {
                statusOptions = statusField.options.map((o) => ({
                    id: o.id,
                    name: o.name,
                }));
            }
            // Sort phases and calculate counts
            const sortedPhases = Array.from(phases.values()).sort((a, b) => a.phaseNumber - b.phaseNumber);
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
            const cached = await this._cacheManager.loadCache(this._currentOwner, this._currentRepo);
            if (cached) {
                // Update the project in repoProjects or orgProjects
                const updatedRepoProjects = cached.repoProjects.map((p) => p.id === projectId ? { ...p, ...projectData } : p);
                const updatedOrgProjects = cached.orgProjects.map((p) => p.id === projectId ? { ...p, ...projectData } : p);
                await this._cacheManager.saveCache(this._currentOwner, this._currentRepo, updatedRepoProjects, updatedOrgProjects, cached.statusOptions);
            }
            // Send update for this project
            this._view.webview.postMessage({
                type: "projectUpdate",
                projectId: projectId,
                projectData: projectData,
                statusOptions: statusOptions,
                isLinked: isNowLinked,
            });
        }
        catch (error) {
            console.error(`[stoked-projects] Error refreshing project #${projectNumber}:`, error);
            // Clear loading state even on error
            this._view.webview.postMessage({
                type: "projectRefreshError",
                projectId: projectId,
                error: error instanceof Error ? error.message : String(error),
            });
        }
    }
    async handleLinkProjectToRepo(projectId, projectNumber) {
        if (!this._currentOwner || !this._currentRepo) {
            vscode.window.showErrorMessage("No repository context available. Please open a repository first.");
            return;
        }
        if (!this._currentRepoId) {
            vscode.window.showErrorMessage("Repository ID not available. Please refresh the extension first.");
            return;
        }
        try {
            this._outputChannel.appendLine(`[stoked-projects] Linking project #${projectNumber} to ${this._currentOwner}/${this._currentRepo} (repo ID: ${this._currentRepoId})`);
            const repositoryId = this._currentRepoId;
            // Link the project to the repository
            const success = await this._githubAPI.linkProjectToRepository(projectId, repositoryId);
            if (success) {
                vscode.window.showInformationMessage(`Project #${projectNumber} linked to ${this._currentOwner}/${this._currentRepo}`);
                // Clear cache FIRST to prevent stale data from being sent
                await this._cacheManager.clearCache(this._currentOwner, this._currentRepo);
                // Show loading indicator
                this._view?.webview.postMessage({ type: "loading" });
                // Do full refresh (no optimistic update to avoid race conditions)
                await this.refresh();
            }
            else {
                vscode.window.showErrorMessage("Failed to link project to repository");
            }
        }
        catch (error) {
            console.error("[stoked-projects] Error linking project to repository:", error);
            vscode.window.showErrorMessage(`Failed to link project: ${error instanceof Error ? error.message : String(error)}`);
        }
    }
    async handleUnlinkProjectFromRepo(projectId, projectNumber) {
        if (!this._currentOwner || !this._currentRepo) {
            vscode.window.showErrorMessage("No repository context available. Please open a repository first.");
            return;
        }
        if (!this._currentRepoId) {
            vscode.window.showErrorMessage("Repository ID not available. Please refresh the extension first.");
            return;
        }
        try {
            this._outputChannel.appendLine(`[stoked-projects] Unlinking project #${projectNumber} from ${this._currentOwner}/${this._currentRepo} (repo ID: ${this._currentRepoId})`);
            const repositoryId = this._currentRepoId;
            // Unlink the project from the repository
            const success = await this._githubAPI.unlinkProjectFromRepository(projectId, repositoryId);
            if (success) {
                vscode.window.showInformationMessage(`Project #${projectNumber} unlinked from ${this._currentOwner}/${this._currentRepo}`);
                // Clear cache FIRST to prevent stale data from being sent
                await this._cacheManager.clearCache(this._currentOwner, this._currentRepo);
                // Show loading indicator
                this._view?.webview.postMessage({ type: "loading" });
                // Do full refresh (no optimistic update to avoid race conditions)
                await this.refresh();
            }
            else {
                vscode.window.showErrorMessage("Failed to unlink project from repository");
            }
        }
        catch (error) {
            console.error("[stoked-projects] Error unlinking project from repository:", error);
            vscode.window.showErrorMessage(`Failed to unlink project: ${error instanceof Error ? error.message : String(error)}`);
        }
    }
    async handleReviewProject(projectNumber) {
        const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
        if (!workspaceRoot) {
            vscode.window.showErrorMessage("No workspace folder found");
            return;
        }
        // Find existing terminal or create new one
        let terminal = vscode.window.terminals.find((t) => t.name === `Review Project #${projectNumber}`);
        if (!terminal) {
            terminal = vscode.window.createTerminal({
                name: `Review Project #${projectNumber}`,
                cwd: workspaceRoot,
            });
        }
        terminal.show();
        terminal.sendText(`claude --dangerously-skip-permissions /review-project ${projectNumber}`);
    }
    async handleReviewPhase(projectNumber, phaseNumber) {
        const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
        if (!workspaceRoot) {
            vscode.window.showErrorMessage("No workspace folder found");
            return;
        }
        // Find existing terminal or create new one
        let terminal = vscode.window.terminals.find((t) => t.name === `Review Phase ${phaseNumber} - Project #${projectNumber}`);
        if (!terminal) {
            terminal = vscode.window.createTerminal({
                name: `Review Phase ${phaseNumber} - Project #${projectNumber}`,
                cwd: workspaceRoot,
            });
        }
        terminal.show();
        terminal.sendText(`claude --dangerously-skip-permissions /review-phase ${projectNumber} ${phaseNumber}`);
    }
    async handleReviewItem(projectNumber, phaseItemNumber) {
        const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
        if (!workspaceRoot) {
            vscode.window.showErrorMessage("No workspace folder found");
            return;
        }
        // Find existing terminal or create new one
        let terminal = vscode.window.terminals.find((t) => t.name === `Review Item ${phaseItemNumber} - Project #${projectNumber}`);
        if (!terminal) {
            terminal = vscode.window.createTerminal({
                name: `Review Item ${phaseItemNumber} - Project #${projectNumber}`,
                cwd: workspaceRoot,
            });
        }
        terminal.show();
        terminal.sendText(`claude --dangerously-skip-permissions /review-item ${projectNumber} ${phaseItemNumber}`);
    }
    async handleOpenTaskHistory() {
        // Send message to webview to show task history overlay
        if (this._view) {
            this._view.webview.postMessage({
                type: 'showTaskHistory'
            });
        }
    }
    async handleStartProject(projectNumber, context) {
        const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
        if (!workspaceRoot) {
            vscode.window.showErrorMessage("No workspace folder found");
            return;
        }
        // Initialize ClaudeMonitor if not already done
        if (!this._claudeMonitor) {
            this._claudeMonitor = new claude_monitor_1.ClaudeMonitor(workspaceRoot);
            // Set up callback for project updates
            this._claudeMonitor.setProjectUpdateCallback(async (signal) => {
                console.log("[stoked-projects] Received project update signal:", signal.project_update);
                // Clear cache and refresh to show updated data
                if (this._currentOwner && this._currentRepo) {
                    await this._cacheManager.clearCache(this._currentOwner, this._currentRepo);
                    await this.refresh();
                    vscode.window
                        .showInformationMessage(`Project updated: ${signal.project_update?.type || "unknown"}`, "View Projects")
                        .then((selection) => {
                            if (selection === "View Projects") {
                                vscode.commands.executeCommand("ghProjects.view.focus");
                            }
                        });
                }
            });
        }
        let terminal = vscode.window.terminals.find((t) => t.name === `Project #${projectNumber}`);
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
        const wrapperScript = `${workspaceRoot}/examples/claude-session-wrapper.sh`;
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
                if (currentPath &&
                    (currentPath.includes(`project-${projectNumber}`) ||
                        currentPath.includes(`task/${projectNumber}`))) {
                    worktreePath = currentPath;
                    existingWorktree = true;
                    break;
                }
            }
        }
        catch (error) {
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
        }
        else {
            // New project start: instruct agent to initialize environment and use correct location
            const repoName = workspaceRoot.split("/").pop();
            const targetWorktreePath = `../${repoName}-project-${projectNumber}`;
            claudePrompt += ` (IMPORTANT: Create the new worktree at '${targetWorktreePath}' (sibling directory). After creating it, you MUST run 'env-cp ${workspaceRoot} <new_worktree_path>' to initialize the environment (certs/env files) before starting work.)`;
        }
        let command;
        if (useWrapper) {
            // Make wrapper executable
            terminal.sendText(`chmod +x "${wrapperScript}"`);
            // Use wrapper script
            command = `"${wrapperScript}" "${sessionFile}" --dangerously-skip-permissions "${claudePrompt}"`;
        }
        else {
            // Fall back to direct command (monitoring will be less accurate)
            command = `claude --dangerously-skip-permissions "${claudePrompt}"`;
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
                }
                else if (selection === "Stop Monitoring") {
                    this._claudeMonitor?.stopSession(sessionId);
                }
            });
    }
    async handleAddProject() {
        const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
        if (!workspaceRoot) {
            vscode.window.showErrorMessage("No workspace folder found");
            return;
        }
        // Initialize ClaudeMonitor if not already done
        if (!this._claudeMonitor) {
            this._claudeMonitor = new claude_monitor_1.ClaudeMonitor(workspaceRoot);
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
        // Wait for the user to close the document
        const disposable = vscode.workspace.onDidCloseTextDocument(async (closedDoc) => {
            if (closedDoc.uri.fsPath === tmpFile) {
                disposable.dispose();
                // Read the file contents
                const content = fs.readFileSync(tmpFile, "utf8");
                // Remove the instruction header
                const projectText = content
                    .replace(/^# New Project Description[\s\S]*?---\s*\n/, "")
                    .trim();
                // Clean up temp file
                try {
                    fs.unlinkSync(tmpFile);
                }
                catch (e) {
                    // Ignore cleanup errors
                }
                if (!projectText) {
                    vscode.window.showWarningMessage("Project description was empty. Cancelled.");
                    return;
                }
                // Create a new terminal with the Claude command
                const shortTitle = projectText.substring(0, 30) +
                    (projectText.length > 30 ? "..." : "");
                const terminal = vscode.window.createTerminal({
                    name: `Creating: ${shortTitle}`,
                    cwd: workspaceRoot,
                });
                terminal.show();
                // Start monitoring the creation session
                const sessionId = this._claudeMonitor.startCreationSession(projectText, terminal);
                const sessionFile = `.claude-sessions/${sessionId}.response.md`;
                // Escape the project text for shell
                const escapedText = projectText.replace(/"/g, '\\"');
                // Send the command
                const command = `claude --dangerously-skip-permissions "/project-create ${escapedText}"`;
                terminal.sendText(command);
                vscode.window
                    .showInformationMessage(`Creating project with auto-continuation: ${shortTitle}`, "View Session Log", "Stop Monitoring")
                    .then((selection) => {
                        if (selection === "View Session Log") {
                            const sessionPath = `${workspaceRoot}/${sessionFile}`;
                            vscode.workspace.openTextDocument(sessionPath).then((doc) => {
                                vscode.window.showTextDocument(doc, { preview: false });
                            });
                        }
                        else if (selection === "Stop Monitoring") {
                            this._claudeMonitor?.stopSession(sessionId);
                        }
                    });
            }
        });
        // Show a message to guide the user
        vscode.window.showInformationMessage("Write your project description in the editor, then save and close the file to continue.");
    }
    /**
     * Get the current repository owner and name from git remote
     */
    async getRepoContext() {
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
        const remote = repo.state.remotes.find((r) => r.name === "origin") ||
            repo.state.remotes[0];
        if (!remote || !remote.fetchUrl) {
            throw new Error("No remote found in current repository");
        }
        // Extract owner/repo from URL
        const match = remote.fetchUrl.match(/github\.com[:/]([^/]+)\/(.+?)(?:\.git)?$/);
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
    shouldRefreshOnEditorChange() {
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
    async refresh() {
        if (!this._view)
            return;
        try {
            const { owner, repo } = await this.getRepoContext();
            await this.loadData(owner, repo);
        }
        catch (error) {
            this._view.webview.postMessage({
                type: "error",
                message: error instanceof Error
                    ? error.message
                    : "Could not determine GitHub repository. Ensure a folder with a git remote is open.",
            });
        }
    }
    async loadData(owner, repo) {
        if (!this._view)
            return;
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
            this._view.webview.postMessage({
                type: "cachedData",
                repoProjects: cached.repoProjects,
                orgProjects: cached.orgProjects,
                statusOptions: cached.statusOptions,
                isStale,
                cacheAge,
            });
        }
        else {
            // No cache, show loading
            this._view.webview.postMessage({ type: "loading" });
        }
        // Now fetch fresh data asynchronously
        if (!this._githubAPI) {
            // Should not happen if initialized
            const api = new github_api_1.GitHubAPI(this._outputChannel);
            const success = await api.initialize();
            if (success) {
                this._githubAPI = api;
            }
            else {
                return;
            }
        }
        const initialized = await this._githubAPI.initialize();
        if (!initialized) {
            // If API client failed, try fallback to GraphQL
            if (this._githubAPI instanceof api_client_1.APIClient) {
                this._outputChannel.appendLine("[Init] API client failed, falling back to direct GraphQL");
                this._githubAPI = new github_api_1.GitHubAPI(this._outputChannel);
                const graphqlInit = await this._githubAPI.initialize();
                if (!graphqlInit) {
                    this._view.webview.postMessage({
                        type: "error",
                        message: "GitHub connection failed.",
                    });
                    return;
                }
            }
            else {
                this._view.webview.postMessage({
                    type: "error",
                    message: "GitHub connection failed.",
                });
                return;
            }
        }
        let linkedResult = await this._githubAPI.getLinkedProjects(owner, repo);
        // If API returned an error and we're using APIClient, fall back to GraphQL
        if (linkedResult.error && this._githubAPI instanceof api_client_1.APIClient) {
            this._outputChannel.appendLine(`[Fallback] API error: ${linkedResult.error}. Switching to direct GraphQL mode.`);
            // Switch to direct GraphQL client
            this._githubAPI = new github_api_1.GitHubAPI(this._outputChannel);
            const graphqlInit = await this._githubAPI.initialize();
            if (!graphqlInit) {
                this._view.webview.postMessage({
                    type: "error",
                    message: "Failed to connect to GitHub after API fallback.",
                });
                return;
            }
            // Retry with GraphQL client
            linkedResult = await this._githubAPI.getLinkedProjects(owner, repo);
        }
        if (linkedResult.error) {
            this._view.webview.postMessage({
                type: "error",
                message: linkedResult.error,
            });
            return;
        }
        // Fetch repository-linked projects (projects linked to this specific repo)
        const repoProjects = linkedResult.projects;
        // Cache the repository ID for link/unlink operations
        if (linkedResult.repositoryId) {
            this._currentRepoId = linkedResult.repositoryId;
            this._outputChannel.appendLine(`[stoked-projects] Cached repository ID: ${this._currentRepoId}`);
        }
        this._outputChannel.appendLine(`\n========== REFRESH DEBUG ==========`);
        this._outputChannel.appendLine(`[stoked-projects] RAW REPO PROJECTS (from getLinkedProjects):`);
        repoProjects.forEach((p) => this._outputChannel.appendLine(`  - #${p.number}: ${p.title} (id: ${p.id})`));
        // Fetch organization projects NOT linked to ANY repository
        // These are mutually exclusive with repoProjects, but we deduplicate as a safety net
        const allOrgProjects = await this._githubAPI.getOrganizationProjects(owner);
        this._outputChannel.appendLine(`[stoked-projects] RAW ORG PROJECTS (from getOrganizationProjects):`);
        allOrgProjects.forEach((p) => this._outputChannel.appendLine(`  - #${p.number}: ${p.title} (id: ${p.id})`));
        // Safety deduplication: filter out any org projects that might also be in repo projects
        // (Should already be filtered by the API, but this is a defensive check)
        const repoProjectIds = new Set(repoProjects.map((p) => p.id));
        const uniqueOrgProjects = allOrgProjects.filter((p) => !repoProjectIds.has(p.id));
        this._outputChannel.appendLine(`[stoked-projects] AFTER DEDUPLICATION:`);
        this._outputChannel.appendLine(`  Repo projects: ${repoProjects.length} - [${repoProjects.map((p) => `#${p.number}`).join(", ")}]`);
        this._outputChannel.appendLine(`  Org projects: ${uniqueOrgProjects.length} - [${uniqueOrgProjects.map((p) => `#${p.number}`).join(", ")}]`);
        this._outputChannel.appendLine(`  Removed from org list: ${allOrgProjects.length - uniqueOrgProjects.length} duplicates`);
        this._outputChannel.appendLine(`===================================\n`);
        // Print project names and numbers to Output panel
        this._outputChannel.clear();
        this._outputChannel.appendLine("========== PROJECTS REFRESH ==========");
        this._outputChannel.appendLine(`Repository: ${owner}/${repo}`);
        this._outputChannel.appendLine(`Mode: ${this._showOrgProjects ? "Organization Projects" : "Repository Projects"}`);
        this._outputChannel.appendLine("");
        this._outputChannel.appendLine(`REPO-LINKED PROJECTS (${repoProjects.length}):`);
        if (repoProjects.length === 0) {
            this._outputChannel.appendLine("  (none)");
        }
        else {
            repoProjects.forEach((p) => this._outputChannel.appendLine(`  #${p.number}: ${p.title}`));
        }
        this._outputChannel.appendLine("");
        this._outputChannel.appendLine(`ORG PROJECTS (not linked to any repo) (${uniqueOrgProjects.length}):`);
        if (uniqueOrgProjects.length === 0) {
            this._outputChannel.appendLine("  (none)");
        }
        else {
            uniqueOrgProjects.forEach((p) => this._outputChannel.appendLine(`  #${p.number}: ${p.title}`));
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
            this._outputChannel.appendLine(`[stoked-projects] Sending quick metadata for ${quickRepoProjects.length + quickOrgProjects.length} projects`);
            this._view.webview.postMessage({
                type: "data",
                repoProjects: quickRepoProjects,
                orgProjects: quickOrgProjects,
                statusOptions: [],
                isPartial: true, // Flag to indicate more data coming
            });
        }
        // PHASE 2: Now fetch full details for each project
        const processProjectList = async (projects) => {
            const results = [];
            this._outputChannel.appendLine(`[stoked-projects] Processing ${projects.length} projects...`);
            for (const project of projects) {
                try {
                    this._outputChannel.appendLine(`[stoked-projects] Processing project #${project.number}...`);
                    const items = await this._githubAPI.getProjectItems(project.id);
                    this._outputChannel.appendLine(`[stoked-projects] Project #${project.number}: ${items.length} items`);
                    const phases = (0, phase_logic_1.groupItemsByPhase)(items);
                    // --- Auto-Update Fields Logic ---
                    // 1. Fetch Fields to get IDs
                    const fields = await this._githubAPI.getProjectFields(project.id);
                    const statusField = fields.find((f) => f.name === "Status");
                    // Store status options for UI
                    let statusOptions = [];
                    if (statusField && statusField.options) {
                        statusOptions = statusField.options.map((o) => ({
                            id: o.id,
                            name: o.name,
                        }));
                        const doneOption = statusField.options.find((o) => o.name === "Done");
                        const inProgressOption = statusField.options.find((o) => o.name === "In Progress");
                        // Map names to IDs
                        const statusMap = {};
                        if (doneOption)
                            statusMap["Done"] = doneOption.id;
                        if (inProgressOption)
                            statusMap["In Progress"] = inProgressOption.id;
                        for (const phase of phases.values()) {
                            const targetStatusName = (0, phase_logic_1.calculatePhaseStatus)(phase);
                            if (targetStatusName && phase.masterItem) {
                                const currentStatus = phase.masterItem.fieldValues["Status"];
                                if (currentStatus !== targetStatusName &&
                                    statusMap[targetStatusName]) {
                                    // UPDATE REQUIRED
                                    console.log(`Auto - updating Master ${phase.masterItem.id} to ${targetStatusName}`);
                                    const success = await this._githubAPI.updateItemFieldValue(project.id, phase.masterItem.id, statusField.id, statusMap[targetStatusName]);
                                    if (success) {
                                        // Update local model so view is correct immediately
                                        phase.masterItem.fieldValues["Status"] = targetStatusName;
                                        vscode.window.showInformationMessage(`Auto - updated phase "${phase.phaseName}" to ${targetStatusName}`);
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
                        if (isDone &&
                            item.content &&
                            item.content.state &&
                            item.content.number) {
                            const issueState = item.content.state;
                            const issueNumber = item.content.number;
                            // Check if the issue is still open
                            if (issueState === "OPEN") {
                                const owner = item.content.repository.owner.login;
                                const repoName = item.content.repository.name;
                                console.log(`Auto-closing issue #${issueNumber} in ${owner}/${repoName} (project item marked as ${status})`);
                                const success = await this._githubAPI.closeIssue(owner, repoName, issueNumber);
                                if (success) {
                                    // Update local model so view is correct immediately
                                    item.content.state = "CLOSED";
                                    vscode.window.showInformationMessage(`Auto-closed issue #${issueNumber}: ${item.content.title}`);
                                }
                                else {
                                    console.error(`Failed to close issue #${issueNumber}`);
                                }
                            }
                        }
                    }
                    // --- End Auto-Close Issues Logic ---
                    // Convert Map to Array for transport
                    const sortedPhases = Array.from(phases.values()).sort((a, b) => a.phaseNumber - b.phaseNumber);
                    // Identify "Ready" items (not done)
                    const notDoneItems = items.filter((i) => {
                        const status = i.fieldValues["Status"];
                        return !["Done", "Merged", "Closed"].includes(status || "");
                    });
                    results.push({
                        ...project,
                        phases: sortedPhases,
                        itemCount: items.length,
                        notDoneCount: notDoneItems.length,
                        items: notDoneItems,
                        statusOptions: statusOptions,
                        statusFieldId: statusField?.id,
                        isLoading: false, // Explicitly clear loading state
                    });
                    this._outputChannel.appendLine(`[stoked-projects] Project #${project.number} processed successfully`);
                }
                catch (error) {
                    this._outputChannel.appendLine(`[stoked-projects] ERROR processing project #${project.number}: ${error instanceof Error ? error.message : String(error)}`);
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
            this._outputChannel.appendLine(`[stoked-projects] Finished processing ${results.length} projects`);
            return results;
        };
        let repoProjectsData = [];
        let orgProjectsData = [];
        try {
            repoProjectsData = await processProjectList(repoProjects);
            orgProjectsData = await processProjectList(uniqueOrgProjects);
        }
        catch (error) {
            this._outputChannel.appendLine(`[stoked-projects] ERROR in processProjectList: ${error instanceof Error ? error.message : String(error)}`);
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
        const statusOptions = allProjects.length > 0 ? allProjects[0].statusOptions : [];
        // If we had cached data, calculate diff and check for changes
        if (cached) {
            const diff = (0, diff_calculator_1.calculateDataDiff)(cached.repoProjects, cached.orgProjects, repoProjectsData, orgProjectsData);
            if ((0, diff_calculator_1.hasChanges)(diff)) {
                // Always do a full re-render when data changes
                // Incremental updates don't properly handle phase structures and status changes
                this._view.webview.postMessage({
                    type: "data",
                    repoProjects: repoProjectsData,
                    orgProjects: orgProjectsData,
                    statusOptions: statusOptions,
                });
            }
            else {
                // No changes, just mark as fresh
                this._view.webview.postMessage({
                    type: "dataFresh",
                });
            }
        }
        else {
            // No cache, send full data
            this._view.webview.postMessage({
                type: "data",
                repoProjects: repoProjectsData,
                orgProjects: orgProjectsData,
                statusOptions: statusOptions,
            });
        }
        // Save to cache
        await this._cacheManager.saveCache(owner, repo, repoProjectsData, orgProjectsData, statusOptions);
        // Connect to WebSocket for real-time notifications
        await this.connectWebSocket(allProjects);
    }
    /**
     * Connect to WebSocket server for real-time notifications
     */
    async connectWebSocket(projects) {
        if (!this._wsClient)
            return;
        // Check if notifications are enabled
        const wsEnabled = vscode.workspace
            .getConfiguration("ghProjects.notifications")
            .get("enabled", true);
        if (!wsEnabled) {
            this._outputChannel.appendLine("[WebSocket] Notifications disabled in settings");
            return;
        }
        // Get configuration
        const wsUrl = vscode.workspace
            .getConfiguration("ghProjects.notifications")
            .get("websocketUrl", "ws://localhost:8080/notifications");
        const apiKey = vscode.workspace
            .getConfiguration("ghProjects.mcp")
            .get("apiKey", "");
        if (!apiKey) {
            this._outputChannel.appendLine("[WebSocket] No API key configured");
            return;
        }
        // Extract project numbers
        const projectNumbers = projects.map((p) => p.number).filter((n) => n);
        this._activeProjectNumbers = projectNumbers;
        if (projectNumbers.length === 0) {
            this._outputChannel.appendLine("[WebSocket] No projects to subscribe to");
            return;
        }
        // Connect if not already connected
        if (!this._wsClient.isConnected()) {
            try {
                await this._wsClient.connect({
                    url: wsUrl,
                    apiKey: apiKey,
                    projectNumbers: projectNumbers,
                });
                this._outputChannel.appendLine(`[WebSocket] Connected and subscribed to ${projectNumbers.length} projects`);
            }
            catch (error) {
                this._outputChannel.appendLine(`[WebSocket] Connection failed: ${error}`);
                vscode.window
                    .showErrorMessage(`Failed to connect to notification server. Check WebSocket URL in settings: ${wsUrl}`, "Open Settings")
                    .then((selection) => {
                        if (selection === "Open Settings") {
                            vscode.commands.executeCommand("workbench.action.openSettings", "ghProjects.notifications");
                        }
                    });
            }
        }
        else {
            // Already connected, just update subscriptions
            this._wsClient.subscribe(projectNumbers);
        }
    }
    _getHtmlForWebview(webview) {
        const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, "media", "main.js"));
        const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, "media", "style.css"));
        const nonce = getNonce();
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
                            <button class="task-history-close" onclick="closeTaskHistory()">✕</button>
                        </div>
                        <div class="task-history-content">
                            <p>Task history will be displayed here...</p>
                        </div>
                    </div>
                </div>
                <script nonce="${nonce}" src="${scriptUri}"></script>
            </body>
            </html>`;
    }
    viewActiveSessions() {
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
    stopAllSessions() {
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
            .showWarningMessage(`Stop all ${sessions.length} active Claude session(s)?`, "Stop All", "Cancel")
            .then((choice) => {
                if (choice === "Stop All") {
                    this._claudeMonitor?.stopAllSessions();
                    vscode.window.showInformationMessage("All Claude sessions stopped");
                }
            });
    }
    // ===== PROJECT FLOW HANDLERS =====
    async handleStartProjectFlow() {
        if (!this._view || !this._projectFlowManager)
            return;
        try {
            // Start new session
            const sessionId = this._projectFlowManager.startSession();
            console.log(`Started project flow session: ${sessionId}`);
            // Show input dialog in webview
            this._view.webview.postMessage({ type: "showInputDialog" });
        }
        catch (error) {
            console.error("Error starting project flow:", error);
            this._view?.webview.postMessage({
                type: "flowError",
                error: `Failed to start project flow: ${error instanceof Error ? error.message : String(error)}`,
                recoverable: true,
            });
        }
    }
    async handleInputSubmitted(input, detection) {
        if (!this._view || !this._projectFlowManager || !this._claudeAPI)
            return;
        try {
            // Get workspace root
            const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
            if (!workspaceRoot) {
                throw new Error("No workspace folder found");
            }
            // Extract input content
            const extractedInput = await (0, input_detection_1.extractInput)(input, workspaceRoot);
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
            const result = await this._claudeAPI.executeDesignAnalysis(extractedInput.content);
            // Store iteration
            this._projectFlowManager.addDesignIteration(extractedInput.content, result);
            // Show design review dialog
            this._view.webview.postMessage({
                type: "showDesignReview",
                result,
                iteration: 1,
            });
        }
        catch (error) {
            console.error("Error processing input:", error);
            this._view?.webview.postMessage({
                type: "flowError",
                error: `Failed to process input: ${error instanceof Error ? error.message : String(error)}`,
                recoverable: true,
            });
        }
    }
    async handleTypeaheadRequest(input) {
        if (!this._view)
            return;
        try {
            const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
            if (!workspaceRoot) {
                this._view.webview.postMessage({
                    type: "typeaheadResponse",
                    results: [],
                });
                return;
            }
            const results = (0, input_detection_1.getTypeaheadResults)(input, workspaceRoot);
            this._view.webview.postMessage({
                type: "typeaheadResponse",
                results,
            });
        }
        catch (error) {
            console.error("Error getting typeahead results:", error);
            this._view.webview.postMessage({
                type: "typeaheadResponse",
                results: [],
            });
        }
    }
    async handleDesignFeedback(feedback, skipReview) {
        if (!this._view || !this._projectFlowManager || !this._claudeAPI)
            return;
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
            const result = await this._claudeAPI.executeDesignIteration(previousResult, feedback);
            // Store iteration
            this._projectFlowManager.addDesignIteration(feedback, result);
            // Show updated design review
            this._view.webview.postMessage({
                type: "showDesignReview",
                result,
                iteration: session.designIterations.iterations.length,
            });
        }
        catch (error) {
            console.error("Error processing feedback:", error);
            this._view?.webview.postMessage({
                type: "flowError",
                error: `Failed to process feedback: ${error instanceof Error ? error.message : String(error)}`,
                recoverable: true,
            });
        }
    }
    async handleDesignAccepted(skipReview) {
        if (!this._view || !this._projectFlowManager || !this._claudeAPI)
            return;
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
            const breakdownResult = await this._claudeAPI.executeProjectBreakdown(approvedDesign);
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
        }
        catch (error) {
            console.error("Error accepting design:", error);
            this._view?.webview.postMessage({
                type: "flowError",
                error: `Failed to create project structure: ${error instanceof Error ? error.message : String(error)}`,
                recoverable: true,
            });
        }
    }
    async handleProjectApproved(isPublic) {
        if (!this._view || !this._projectFlowManager)
            return;
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
            throw new Error("Project creation through extension UI has been deprecated.\n" +
                "Please use Claude Code with MCP Server tools instead:\n" +
                "  - github_create_project\n" +
                "  - github_create_issue\n" +
                "  - github_link_issue_to_project\n\n" +
                "See: docs/mcp-migration-guide.md for migration instructions.");
        }
        catch (error) {
            console.error("Error creating project:", error);
            this._view?.webview.postMessage({
                type: "flowError",
                error: `Failed to create project: ${error instanceof Error ? error.message : String(error)}`,
                recoverable: false,
                action: error instanceof Error && error.message.includes("gh auth")
                    ? error.message
                    : undefined,
            });
        }
    }
}
exports.ProjectsViewProvider = ProjectsViewProvider;
function getNonce() {
    let text = "";
    const possible = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
    for (let i = 0; i < 32; i++) {
        text += possible.charAt(Math.floor(Math.random() * possible.length));
    }
    return text;
}
//# sourceMappingURL=projects-view-provider.js.map