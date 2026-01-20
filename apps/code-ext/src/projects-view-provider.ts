import * as vscode from 'vscode';
import { GitHubAPI, Project, ProjectItem } from './github-api';
import { groupItemsByPhase, calculatePhaseStatus } from './phase-logic';
import { ClaudeMonitor } from './claude-monitor';
import { CacheManager } from './cache-manager';
import { calculateDataDiff, hasChanges } from './diff-calculator';
import { ProjectFlowManager } from './project-flow-manager';
import { ClaudeAPI } from './claude-api';
import { GitHubProjectCreator } from './github-project-creator';
import { detectFilePath, getTypeaheadResults, extractInput } from './input-detection';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

export class ProjectsViewProvider implements vscode.WebviewViewProvider {
    public static readonly viewType = 'ghProjects.view';
    private _view?: vscode.WebviewView;
    private _githubAPI: GitHubAPI;
    private _claudeMonitor?: ClaudeMonitor;
    private _cacheManager: CacheManager;
    private _currentOwner?: string;
    private _currentRepo?: string;
    private _projectFlowManager?: ProjectFlowManager;
    private _claudeAPI?: ClaudeAPI;
    private _projectCreator?: GitHubProjectCreator;
    private _outputChannel: vscode.OutputChannel;
    private _showOrgProjects: boolean = true;

    constructor(
        private readonly _extensionUri: vscode.Uri,
        private readonly _context: vscode.ExtensionContext,
    ) {
        this._githubAPI = new GitHubAPI();
        this._cacheManager = new CacheManager(_context);
        this._projectFlowManager = new ProjectFlowManager(_context);
        this._claudeAPI = new ClaudeAPI();
        this._projectCreator = new GitHubProjectCreator();
        this._outputChannel = vscode.window.createOutputChannel('Claude Projects');
    }

    public async resolveWebviewView(
        webviewView: vscode.WebviewView,
        context: vscode.WebviewViewResolveContext,
        _token: vscode.CancellationToken,
    ) {
        this._view = webviewView;

        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [
                this._extensionUri
            ]
        };

        webviewView.webview.html = this._getHtmlForWebview(webviewView.webview);

        webviewView.webview.onDidReceiveMessage(async (data) => {
            switch (data.type) {
                case 'refresh': {
                    // Background refresh - don't clear cache, keep existing UI while fetching
                    // Send refreshing indicator so UI shows subtle loading state
                    this._view?.webview.postMessage({ type: 'refreshing' });
                    await this.refresh();
                    break;
                }
                case 'clearCache': {
                    // Clear cache and refresh
                    await this._cacheManager.clearAllCaches();
                    vscode.window.showInformationMessage('Cache cleared');
                    await this.refresh();
                    break;
                }
                case 'openUrl': {
                    if (data.url) {
                        vscode.env.openExternal(vscode.Uri.parse(data.url));
                    }
                    break;
                }
                case 'updateStatus': {
                    await this.handleStatusUpdate(data.projectId, data.itemId, data.statusOptionId);
                    break;
                }
                case 'deleteItem': {
                    await this.handleDeleteItem(data.projectId, data.itemId, data.itemTitle);
                    break;
                }
                case 'deleteProject': {
                    await this.handleDeleteProject(data.projectId, data.projectTitle);
                    break;
                }
                case 'startProject': {
                    await this.handleStartProject(data.projectNumber);
                    break;
                }
                case 'startProjectWithContext': {
                    const context = await vscode.window.showInputBox({
                        prompt: 'Add context checking/setup instructions',
                        placeHolder: 'e.g., Focus on dark mode fixes, or "resuming from yesterday"',
                        ignoreFocusOut: true
                    });
                    if (context !== undefined) {
                        await this.handleStartProject(data.projectNumber, context);
                    }
                    break;
                }
                case 'addProject': {
                    await this.handleAddProject();
                    break;
                }
                case 'startProjectFlow': {
                    await this.handleStartProjectFlow();
                    break;
                }
                case 'inputSubmitted': {
                    await this.handleInputSubmitted(data.input, data.detection);
                    break;
                }
                case 'typeaheadRequest': {
                    await this.handleTypeaheadRequest(data.input);
                    break;
                }
                case 'designFeedback': {
                    await this.handleDesignFeedback(data.feedback, data.skipReview);
                    break;
                }
                case 'designAccepted': {
                    await this.handleDesignAccepted(data.skipReview);
                    break;
                }
                case 'projectApproved': {
                    await this.handleProjectApproved(data.isPublic);
                    break;
                }
                case 'markAllDone': {
                    await this.handleMarkAllDone(data.projectId, data.projectTitle);
                    break;
                }
                case 'markPhaseDone': {
                    await this.handleMarkPhaseDone(data.projectId, data.itemIds, data.phaseName);
                    break;
                }
                case 'modeChanged': {
                    this._showOrgProjects = data.showOrgProjects;
                    this.updateViewTitle();
                    break;
                }
                case 'refreshProject': {
                    await this.handleRefreshProject(data.projectId, data.projectNumber);
                    break;
                }
                case 'linkProjectToRepo': {
                    await this.handleLinkProjectToRepo(data.projectId, data.projectNumber);
                    break;
                }
                case 'unlinkProjectFromRepo': {
                    await this.handleUnlinkProjectFromRepo(data.projectId, data.projectNumber);
                    break;
                }
            }
        });

        // Initial load
        // Don't await refresh so the view resolves immediately. Errors are handled via postMessage.
        this.refresh().catch(e => {
            console.error('Initial refresh failed:', e);
            if (this._view) {
                this._view.webview.postMessage({ type: 'error', message: `Initial load failed: ${e instanceof Error ? e.message : String(e)}` });
            }
        });
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
            this._view.title = this._currentOwner || 'Projects';
        } else {
            // Repo mode: show owner/repo
            if (this._currentOwner && this._currentRepo) {
                this._view.title = `${this._currentOwner}/${this._currentRepo}`;
            } else {
                this._view.title = 'Projects';
            }
        }
    }

    private async handleStatusUpdate(projectId: string, itemId: string, statusOptionId: string) {
        if (!this._view) return;

        // Find the project to get the status field ID
        // We'll need to fetch fields again or store them
        const fields = await this._githubAPI.getProjectFields(projectId);
        const statusField = fields.find((f: any) => f.name === 'Status');

        if (!statusField) {
            vscode.window.showErrorMessage('Status field not found');
            return;
        }

        const success = await this._githubAPI.updateItemFieldValue(
            projectId,
            itemId,
            statusField.id,
            statusOptionId
        );

        if (success) {
            vscode.window.showInformationMessage('Status updated successfully');
            // Refresh the view to show updated status
            await this.refresh();
        } else {
            vscode.window.showErrorMessage('Failed to update status');
        }
    }

    private async handleDeleteItem(projectId: string, itemId: string, itemTitle: string) {
        if (!this._view) return;

        const confirm = await vscode.window.showWarningMessage(
            `Are you sure you want to delete "${itemTitle}" from this project?`,
            { modal: true },
            'Delete'
        );

        if (confirm !== 'Delete') {
            return;
        }

        const success = await this._githubAPI.deleteProjectItem(projectId, itemId);

        if (success) {
            vscode.window.showInformationMessage(`Deleted "${itemTitle}" from project`);
            // Send message to remove item from UI instead of full refresh
            this._view.webview.postMessage({
                type: 'removeItem',
                projectId: projectId,
                itemId: itemId
            });
        } else {
            vscode.window.showErrorMessage('Failed to delete item');
        }
    }

    private async handleDeleteProject(projectId: string, projectTitle: string) {
        if (!this._view) return;

        const confirm = await vscode.window.showWarningMessage(
            `Are you sure you want to DELETE the entire project "${projectTitle}"? This action cannot be undone.`,
            { modal: true },
            'Delete Project'
        );

        if (confirm !== 'Delete Project') {
            return;
        }

        const success = await this._githubAPI.deleteProject(projectId);

        if (success) {
            vscode.window.showInformationMessage(`Deleted project "${projectTitle}"`);
            // Send message to remove project from UI instead of full refresh
            this._view.webview.postMessage({
                type: 'removeProject',
                projectId: projectId
            });
        } else {
            vscode.window.showErrorMessage('Failed to delete project');
        }
    }

    private async handleMarkAllDone(projectId: string, projectTitle: string) {
        if (!this._view) return;

        const confirm = await vscode.window.showWarningMessage(
            `Mark ALL items in "${projectTitle}" as Done?`,
            { modal: true },
            'Mark All Done'
        );

        if (confirm !== 'Mark All Done') {
            return;
        }

        try {
            // Get project fields
            const fields = await this._githubAPI.getProjectFields(projectId);
            const statusField = fields.find((f: any) => f.name === 'Status');

            if (!statusField) {
                vscode.window.showErrorMessage('Status field not found');
                return;
            }

            const doneOption = statusField.options?.find((o: any) => o.name === 'Done');
            if (!doneOption) {
                vscode.window.showErrorMessage('Done status option not found');
                return;
            }

            // Get all project items
            const items = await this._githubAPI.getProjectItems(projectId);

            // Update each item that isn't already done
            let updatedCount = 0;
            for (const item of items) {
                const currentStatus = item.fieldValues['Status'];
                if (!['Done', 'Merged', 'Closed'].includes(currentStatus || '')) {
                    const success = await this._githubAPI.updateItemFieldValue(
                        projectId,
                        item.id,
                        statusField.id,
                        doneOption.id
                    );
                    if (success) updatedCount++;
                }
            }

            vscode.window.showInformationMessage(`Marked ${updatedCount} items as Done`);
            await this.refresh();
        } catch (error) {
            vscode.window.showErrorMessage(`Failed to mark items as Done: ${error instanceof Error ? error.message : String(error)}`);
        }
    }

    private async handleMarkPhaseDone(projectId: string, itemIds: string[], phaseName: string) {
        if (!this._view) return;

        const confirm = await vscode.window.showWarningMessage(
            `Mark all items in phase "${phaseName}" as Done?`,
            { modal: true },
            'Mark Done'
        );

        if (confirm !== 'Mark Done') {
            return;
        }

        try {
            // Get project fields
            const fields = await this._githubAPI.getProjectFields(projectId);
            const statusField = fields.find((f: any) => f.name === 'Status');

            if (!statusField) {
                vscode.window.showErrorMessage('Status field not found');
                return;
            }

            const doneOption = statusField.options?.find((o: any) => o.name === 'Done');
            if (!doneOption) {
                vscode.window.showErrorMessage('Done status option not found');
                return;
            }

            // Update each item
            let updatedCount = 0;
            for (const itemId of itemIds) {
                const success = await this._githubAPI.updateItemFieldValue(
                    projectId,
                    itemId,
                    statusField.id,
                    doneOption.id
                );
                if (success) updatedCount++;
            }

            vscode.window.showInformationMessage(`Marked ${updatedCount} items in "${phaseName}" as Done`);
            await this.refresh();
        } catch (error) {
            vscode.window.showErrorMessage(`Failed to mark phase items as Done: ${error instanceof Error ? error.message : String(error)}`);
        }
    }

    private async handleRefreshProject(projectId: string, projectNumber: number) {
        if (!this._view) return;

        // Send message to show loading state on just this project
        this._view.webview.postMessage({
            type: 'projectRefreshing',
            projectId: projectId
        });

        try {
            // Fetch fresh items for this specific project
            const items = await this._githubAPI.getProjectItems(projectId);
            const phases = groupItemsByPhase(items);

            // Fetch fields for status options
            const fields = await this._githubAPI.getProjectFields(projectId);
            const statusField = fields.find((f: any) => f.name === 'Status');

            let statusOptions: any[] = [];
            if (statusField && statusField.options) {
                statusOptions = statusField.options.map((o: any) => ({ id: o.id, name: o.name }));
            }

            // Sort phases and calculate counts
            const sortedPhases = Array.from(phases.values())
                .sort((a, b) => a.phaseNumber - b.phaseNumber);

            const notDoneItems = items.filter(i => {
                const status = i.fieldValues['Status'];
                return !['Done', 'Merged', 'Closed'].includes(status || '');
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
                isLoading: false
            };

            // Send update for just this project
            this._view.webview.postMessage({
                type: 'projectUpdate',
                projectId: projectId,
                projectData: projectData,
                statusOptions: statusOptions
            });

        } catch (error) {
            console.error(`[gh-projects] Error refreshing project #${projectNumber}:`, error);
            // Clear loading state even on error
            this._view.webview.postMessage({
                type: 'projectRefreshError',
                projectId: projectId,
                error: error instanceof Error ? error.message : String(error)
            });
        }
    }

    private async handleLinkProjectToRepo(projectId: string, projectNumber: number) {
        if (!this._currentOwner || !this._currentRepo) {
            vscode.window.showErrorMessage('No repository context available. Please open a repository first.');
            return;
        }

        try {
            // Get the repository ID
            const repositoryId = await this._githubAPI.getRepositoryId(this._currentOwner, this._currentRepo);
            if (!repositoryId) {
                vscode.window.showErrorMessage('Failed to get repository ID');
                return;
            }

            // Link the project to the repository
            const success = await this._githubAPI.linkProjectToRepository(projectId, repositoryId);

            if (success) {
                vscode.window.showInformationMessage(`Project #${projectNumber} linked to ${this._currentOwner}/${this._currentRepo}`);
                // Clear cache to force fresh data fetch
                await this._cacheManager.clearCache(this._currentOwner, this._currentRepo);
                // Refresh the view to show updated project status
                await this.refresh();
            } else {
                vscode.window.showErrorMessage('Failed to link project to repository');
            }
        } catch (error) {
            console.error('[gh-projects] Error linking project to repository:', error);
            vscode.window.showErrorMessage(`Failed to link project: ${error instanceof Error ? error.message : String(error)}`);
        }
    }

    private async handleUnlinkProjectFromRepo(projectId: string, projectNumber: number) {
        if (!this._currentOwner || !this._currentRepo) {
            vscode.window.showErrorMessage('No repository context available. Please open a repository first.');
            return;
        }

        try {
            // Get the repository ID
            const repositoryId = await this._githubAPI.getRepositoryId(this._currentOwner, this._currentRepo);
            if (!repositoryId) {
                vscode.window.showErrorMessage('Failed to get repository ID');
                return;
            }

            // Unlink the project from the repository
            const success = await this._githubAPI.unlinkProjectFromRepository(projectId, repositoryId);

            if (success) {
                vscode.window.showInformationMessage(`Project #${projectNumber} unlinked from ${this._currentOwner}/${this._currentRepo}`);
                // Clear cache to force fresh data fetch
                await this._cacheManager.clearCache(this._currentOwner, this._currentRepo);
                // Refresh the view to show updated project status
                await this.refresh();
            } else {
                vscode.window.showErrorMessage('Failed to unlink project from repository');
            }
        } catch (error) {
            console.error('[gh-projects] Error unlinking project from repository:', error);
            vscode.window.showErrorMessage(`Failed to unlink project: ${error instanceof Error ? error.message : String(error)}`);
        }
    }

    private async handleStartProject(projectNumber: number, context?: string) {
        const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
        if (!workspaceRoot) {
            vscode.window.showErrorMessage('No workspace folder found');
            return;
        }

        // Initialize ClaudeMonitor if not already done
        if (!this._claudeMonitor) {
            this._claudeMonitor = new ClaudeMonitor(workspaceRoot);
            // Set up callback for project updates
            this._claudeMonitor.setProjectUpdateCallback(async (signal) => {
                console.log('[gh-projects] Received project update signal:', signal.project_update);
                // Clear cache and refresh to show updated data
                if (this._currentOwner && this._currentRepo) {
                    await this._cacheManager.clearCache(this._currentOwner, this._currentRepo);
                    await this.refresh();
                    vscode.window.showInformationMessage(
                        `Project updated: ${signal.project_update?.type || 'unknown'}`,
                        'View Projects'
                    ).then(selection => {
                        if (selection === 'View Projects') {
                            vscode.commands.executeCommand('ghProjects.view.focus');
                        }
                    });
                }
            });
        }

        let terminal = vscode.window.terminals.find(t => t.name === `Project #${projectNumber}`);
        if (!terminal) {
            terminal = vscode.window.createTerminal({
                name: `Project #${projectNumber}`,
                cwd: workspaceRoot
            });
        }

        terminal.show();

        // Start monitoring the session
        const sessionId = this._claudeMonitor.startSession(projectNumber, terminal);

        // Build the command
        const sessionFile = `.claude-sessions/${sessionId}.response.md`;
        const wrapperScript = `${workspaceRoot}/examples/claude-session-wrapper.sh`;

        // Check if wrapper script exists
        const fs = require('fs');
        const useWrapper = fs.existsSync(wrapperScript);

        // Check for existing worktree
        let worktreePath = '';
        let existingWorktree = false;
        try {
            const { stdout } = await execAsync('git worktree list --porcelain', { cwd: workspaceRoot });
            // Parse worktree output:
            // worktree /path/to/wt
            // HEAD ...
            // branch ...
            // 
            // worktree ...

            const lines = stdout.split('\n');
            let currentPath = '';

            for (const line of lines) {
                if (line.startsWith('worktree ')) {
                    currentPath = line.substring(9).trim();
                }
                // Check if this worktree relates to the project
                // Assumption: worktree path or branch contains project number, e.g., "project-123"
                if (currentPath && (currentPath.includes(`project-${projectNumber}`) || currentPath.includes(`task/${projectNumber}`))) {
                    worktreePath = currentPath;
                    existingWorktree = true;
                    break;
                }
            }
        } catch (error) {
            console.error('Error checking worktrees:', error);
        }

        let claudePrompt = `/do ${projectNumber}`;

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
            const repoName = workspaceRoot.split('/').pop();
            const targetWorktreePath = `../${repoName}-project-${projectNumber}`;
            claudePrompt += ` (IMPORTANT: Create the new worktree at '${targetWorktreePath}' (sibling directory). After creating it, you MUST run 'env-cp ${workspaceRoot} <new_worktree_path>' to initialize the environment (certs/env files) before starting work.)`;
        }

        let command: string;
        if (useWrapper) {
            // Make wrapper executable
            terminal.sendText(`chmod +x "${wrapperScript}"`);
            // Use wrapper script
            command = `"${wrapperScript}" "${sessionFile}" --dangerously-skip-permissions "${claudePrompt}"`;
        } else {
            // Fall back to direct command (monitoring will be less accurate)
            command = `claude --dangerously-skip-permissions "${claudePrompt}"`;
        }

        terminal.sendText(command);

        // Show instructions to the user
        const message = useWrapper
            ? `Started Project #${projectNumber} with session wrapper and auto-continuation`
            : `Started Project #${projectNumber} with auto-continuation (install wrapper for better tracking)`;

        vscode.window.showInformationMessage(
            message,
            'View Session Log',
            'Stop Monitoring'
        ).then(selection => {
            if (selection === 'View Session Log') {
                const sessionPath = `${workspaceRoot}/${sessionFile}`;
                vscode.workspace.openTextDocument(sessionPath).then(doc => {
                    vscode.window.showTextDocument(doc, { preview: false });
                });
            } else if (selection === 'Stop Monitoring') {
                this._claudeMonitor?.stopSession(sessionId);
            }
        });
    }

    private async handleAddProject() {
        const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
        if (!workspaceRoot) {
            vscode.window.showErrorMessage('No workspace folder found');
            return;
        }

        // Initialize ClaudeMonitor if not already done
        if (!this._claudeMonitor) {
            this._claudeMonitor = new ClaudeMonitor(workspaceRoot);
        }

        // Prompt user for markup text
        const projectText = await vscode.window.showInputBox({
            prompt: 'Enter project description (supports markup)',
            placeHolder: 'e.g., Add authentication feature with OAuth2',
            ignoreFocusOut: true,
            validateInput: (value) => {
                if (!value || value.trim().length === 0) {
                    return 'Project description cannot be empty';
                }
                return null;
            }
        });

        if (!projectText) {
            return; // User cancelled
        }

        // Create a new terminal with the Claude command
        const shortTitle = projectText.substring(0, 30) + (projectText.length > 30 ? '...' : '');
        const terminal = vscode.window.createTerminal({
            name: `Creating: ${shortTitle}`,
            cwd: workspaceRoot
        });

        terminal.show();

        // Start monitoring the creation session
        const sessionId = this._claudeMonitor.startCreationSession(projectText, terminal);
        const sessionFile = `.claude-sessions/${sessionId}.response.md`;

        // Send the command
        const command = `claude --dangerously-skip-permissions "/project ${projectText}"`;
        terminal.sendText(command);

        vscode.window.showInformationMessage(
            `Creating project with auto-continuation: ${shortTitle}`,
            'View Session Log',
            'Stop Monitoring'
        ).then(selection => {
            if (selection === 'View Session Log') {
                const sessionPath = `${workspaceRoot}/${sessionFile}`;
                vscode.workspace.openTextDocument(sessionPath).then(doc => {
                    vscode.window.showTextDocument(doc, { preview: false });
                });
            } else if (selection === 'Stop Monitoring') {
                this._claudeMonitor?.stopSession(sessionId);
            }
        });
    }

    public async refresh() {
        if (!this._view) return;

        // Determine current repo owner/test
        // For MVP, we'll try to get it from the workspace git config or just ask user?
        // Better: use the git extension API or just assume first workspace folder has a git repo

        // Simplest for now: User must have a workspace
        const folders = vscode.workspace.workspaceFolders;
        if (!folders || folders.length === 0) {
            this._view.webview.postMessage({ type: 'error', message: 'No workspace folder open.' });
            return;
        }

        // Try to get owner/repo from git extension? 
        // Or just parse .git/config? 
        // Let's rely on a hardcoded test or config for now given the prompt didn't specify discovery
        // Actually, the user said "projects linked to the existing repo".
        // Let's try to infer from git remote.

        const gitExtension = vscode.extensions.getExtension('vscode.git');
        if (gitExtension) {
            if (!gitExtension.isActive) {
                await gitExtension.activate();
            }
            const git = gitExtension.exports.getAPI(1);

            // Poll for repositories if not immediately available (race condition after activation)
            let retries = 5;
            while (git.repositories.length === 0 && retries > 0) {
                await new Promise(resolve => setTimeout(resolve, 500));
                retries--;
            }

            if (git.repositories.length > 0) {
                const repo = git.repositories[0];

                // Wait for remotes to populate
                let remoteRetries = 10;
                while (repo.state.remotes.length === 0 && remoteRetries > 0) {
                    await new Promise(resolve => setTimeout(resolve, 500));
                    remoteRetries--;
                }

                const remote = repo.state.remotes.find((r: any) => r.name === 'origin') || repo.state.remotes[0]; // fallback to first remote if origin missing

                if (remote && remote.fetchUrl) {
                    // Extract owner/repo from URL
                    // Regex handles:
                    // git@github.com:owner/repo.with.dots.git
                    // https://github.com/owner/repo.git
                    const match = remote.fetchUrl.match(/github\.com[:/]([^/]+)\/(.+?)(?:\.git)?$/);
                    if (match) {
                        const owner = match[1];
                        const repoName = match[2];
                        await this.loadData(owner, repoName);
                        return;
                    } else {
                        // Log regex failure for debugging
                        this._view.webview.postMessage({ type: 'error', message: `Could not parse GitHub URL: ${remote.fetchUrl}` });
                        return;
                    }
                } else {
                    const repoRoot = repo.rootUri.fsPath;
                    const remoteCount = repo.state.remotes.length;
                    this._view.webview.postMessage({ type: 'error', message: `No remote found in current repository.Root: ${repoRoot}, Remotes: ${remoteCount}` });
                    return;
                }
            }
        } else {
            console.warn('VS Code Git extension not found.');
        }

        // Fallback or error
        this._view.webview.postMessage({ type: 'error', message: 'Could not determine GitHub repository. Ensure a folder with a git remote is open.' });
    }

    private async loadData(owner: string, repo: string) {
        if (!this._view) return;

        this._currentOwner = owner;
        this._currentRepo = repo;

        // Update the view title based on current mode
        this.updateViewTitle();

        // Try to load from cache first
        const cached = await this._cacheManager.loadCache(owner, repo);
        if (cached) {
            const isStale = this._cacheManager.isCacheStale(cached);
            const cacheAge = this._cacheManager.getCacheAge(cached);

            // Send cached data immediately
            this._view.webview.postMessage({
                type: 'cachedData',
                repoProjects: cached.repoProjects,
                orgProjects: cached.orgProjects,
                statusOptions: cached.statusOptions,
                isStale,
                cacheAge,
            });
        } else {
            // No cache, show loading
            this._view.webview.postMessage({ type: 'loading' });
        }

        // Now fetch fresh data asynchronously
        if (!this._githubAPI) { // Should not happen if initialized
            const api = new GitHubAPI();
            const success = await api.initialize();
            if (success) {
                this._githubAPI = api;
            } else {
                return;
            }
        }

        const initialized = await this._githubAPI.initialize();
        if (!initialized) {
            this._view.webview.postMessage({ type: 'error', message: 'GitHub connection failed.' });
            return;
        }

        const linkedResult = await this._githubAPI!.getLinkedProjects(owner, repo);

        if (linkedResult.error) {
            this._view.webview.postMessage({ type: 'error', message: linkedResult.error });
            return;
        }
        // Fetch repository-linked projects (includes both repo-level and org projects linked to this repo)
        const repoProjects = linkedResult.projects;

        // Fetch all organization projects (includes projects linked and not linked to this repo)
        const allOrgProjects = await this._githubAPI!.getOrganizationProjects(owner);

        // Deduplicate: only show org projects NOT already in repo-linked projects
        const repoProjectIds = new Set(repoProjects.map(p => p.id));
        const uniqueOrgProjects = allOrgProjects.filter(p => !repoProjectIds.has(p.id));

        console.log(`[gh-projects] Fetched ${repoProjects.length} repo-linked projects and ${allOrgProjects.length} org projects (${uniqueOrgProjects.length} unique)`);
        console.log(`[gh-projects] Repo-linked projects: ${repoProjects.map(p => `#${p.number}`).join(', ')}`);
        console.log(`[gh-projects] Unique org projects: ${uniqueOrgProjects.map(p => `#${p.number}`).join(', ')}`);

        // Print project names and numbers to Output panel
        this._outputChannel.clear();
        this._outputChannel.appendLine('=== Claude Projects ===');
        this._outputChannel.appendLine(`\nRepo-linked projects (${repoProjects.length}):`);
        repoProjects.forEach(p => this._outputChannel.appendLine(`  #${p.number}: ${p.title}`));
        this._outputChannel.appendLine(`\nUnique organization projects (${uniqueOrgProjects.length}):`);
        uniqueOrgProjects.forEach(p => this._outputChannel.appendLine(`  #${p.number}: ${p.title}`));
        // Don't force panel switch - user can open Output panel manually if needed

        if (repoProjects.length === 0 && uniqueOrgProjects.length === 0) {
            const rawErrors = linkedResult.errors ? JSON.stringify(linkedResult.errors) : 'None';
            const debugInfo = `Debug: Owner = ${owner}, Repo = ${repo}.RepoProjects = ${repoProjects.length}, OrgProjects = ${uniqueOrgProjects.length}.LinkedError = ${linkedResult.error || 'None'}.RawErrors = ${rawErrors}`;
            this._view.webview.postMessage({ type: 'noProjects', message: `No linked projects found.${debugInfo}` });
            return;
        }

        // PHASE 1: If no cache exists, send project metadata immediately for fast UI
        // This prevents timeout by showing projects before fetching all items
        if (!cached) {
            const quickRepoProjects = repoProjects.map(p => ({
                ...p,
                phases: [],
                itemCount: 0,
                notDoneCount: 0,
                items: [],
                statusOptions: [],
                isLoading: true  // Flag to show loading state
            }));
            const quickOrgProjects = uniqueOrgProjects.map(p => ({
                ...p,
                phases: [],
                itemCount: 0,
                notDoneCount: 0,
                items: [],
                statusOptions: [],
                isLoading: true
            }));

            console.log(`[gh-projects] Sending quick metadata for ${quickRepoProjects.length + quickOrgProjects.length} projects`);
            this._view.webview.postMessage({
                type: 'data',
                repoProjects: quickRepoProjects,
                orgProjects: quickOrgProjects,
                statusOptions: [],
                isPartial: true  // Flag to indicate more data coming
            });
        }

        // PHASE 2: Now fetch full details for each project

        const processProjectList = async (projects: Project[]) => {
            const results = [];
            console.log(`[gh-projects] Processing ${projects.length} projects...`);

            for (const project of projects) {
                try {
                    console.log(`[gh-projects] Processing project #${project.number}...`);
                    const items = await this._githubAPI!.getProjectItems(project.id);
                    console.log(`[gh-projects] Project #${project.number}: ${items.length} items`);
                    const phases = groupItemsByPhase(items);

                    // --- Auto-Update Fields Logic ---
                    // 1. Fetch Fields to get IDs
                    const fields = await this._githubAPI!.getProjectFields(project.id);
                    const statusField = fields.find((f: any) => f.name === 'Status');

                    // Store status options for UI
                    let statusOptions: any[] = [];
                    if (statusField && statusField.options) {
                        statusOptions = statusField.options.map((o: any) => ({ id: o.id, name: o.name }));

                        const doneOption = statusField.options.find((o: any) => o.name === 'Done');
                        const inProgressOption = statusField.options.find((o: any) => o.name === 'In Progress');
                        // Map names to IDs
                        const statusMap: Record<string, string> = {};
                        if (doneOption) statusMap['Done'] = doneOption.id;
                        if (inProgressOption) statusMap['In Progress'] = inProgressOption.id;

                        for (const phase of phases.values()) {
                            const targetStatusName = calculatePhaseStatus(phase);
                            if (targetStatusName && phase.masterItem) {
                                const currentStatus = phase.masterItem.fieldValues['Status'];
                                if (currentStatus !== targetStatusName && statusMap[targetStatusName]) {
                                    // UPDATE REQUIRED
                                    console.log(`Auto - updating Master ${phase.masterItem.id} to ${targetStatusName}`);

                                    const success = await this._githubAPI!.updateItemFieldValue(
                                        project.id,
                                        phase.masterItem.id,
                                        statusField.id,
                                        statusMap[targetStatusName]
                                    );

                                    if (success) {
                                        // Update local model so view is correct immediately
                                        phase.masterItem.fieldValues['Status'] = targetStatusName;
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
                        const status = item.fieldValues['Status'];
                        const isDone = ['Done', 'Merged', 'Closed'].includes(status || '');

                        // Only process if item is done and has actual issue content (not a draft)
                        if (isDone && item.content && item.content.state && item.content.number) {
                            const issueState = item.content.state;
                            const issueNumber = item.content.number;

                            // Check if the issue is still open
                            if (issueState === 'OPEN') {
                                const owner = item.content.repository.owner.login;
                                const repoName = item.content.repository.name;

                                console.log(`Auto-closing issue #${issueNumber} in ${owner}/${repoName} (project item marked as ${status})`);

                                const success = await this._githubAPI!.closeIssue(owner, repoName, issueNumber);

                                if (success) {
                                    // Update local model so view is correct immediately
                                    item.content.state = 'CLOSED';
                                    vscode.window.showInformationMessage(`Auto-closed issue #${issueNumber}: ${item.content.title}`);
                                } else {
                                    console.error(`Failed to close issue #${issueNumber}`);
                                }
                            }
                        }
                    }
                    // --- End Auto-Close Issues Logic ---

                    // Convert Map to Array for transport
                    const sortedPhases = Array.from(phases.values())
                        .sort((a, b) => a.phaseNumber - b.phaseNumber);

                    // Identify "Ready" items (not done)
                    const notDoneItems = items.filter(i => {
                        const status = i.fieldValues['Status'];
                        return !['Done', 'Merged', 'Closed'].includes(status || '');
                    });

                    results.push({
                        ...project,
                        phases: sortedPhases,
                        itemCount: items.length,
                        notDoneCount: notDoneItems.length,
                        items: notDoneItems,
                        statusOptions: statusOptions,
                        statusFieldId: statusField?.id,
                        isLoading: false  // Explicitly clear loading state
                    });
                    console.log(`[gh-projects] Project #${project.number} processed successfully`);
                } catch (error) {
                    console.error(`[gh-projects] Error processing project #${project.number}:`, error);
                    // Still include the project but with empty items and loading cleared
                    results.push({
                        ...project,
                        phases: [],
                        itemCount: 0,
                        notDoneCount: 0,
                        items: [],
                        statusOptions: [],
                        isLoading: false,
                        error: error instanceof Error ? error.message : String(error)
                    });
                }
            }
            console.log(`[gh-projects] Finished processing ${results.length} projects`);
            return results;
        };

        let repoProjectsData: any[] = [];
        let orgProjectsData: any[] = [];

        try {
            repoProjectsData = await processProjectList(repoProjects);
            orgProjectsData = await processProjectList(uniqueOrgProjects);
        } catch (error) {
            console.error('[gh-projects] Error in processProjectList:', error);
            // Send what we have with loading cleared
            repoProjectsData = repoProjects.map(p => ({ ...p, phases: [], items: [], isLoading: false }));
            orgProjectsData = uniqueOrgProjects.map(p => ({ ...p, phases: [], items: [], isLoading: false }));
        }

        // Extract status options from first project (assuming all use same status field)
        const allProjects = [...repoProjectsData, ...orgProjectsData];
        const statusOptions = allProjects.length > 0 ? allProjects[0].statusOptions : [];

        // If we had cached data, calculate diff and check for changes
        if (cached) {
            const diff = calculateDataDiff(
                cached.repoProjects,
                cached.orgProjects,
                repoProjectsData,
                orgProjectsData
            );

            if (hasChanges(diff)) {
                // Always do a full re-render when data changes
                // Incremental updates don't properly handle phase structures and status changes
                this._view.webview.postMessage({
                    type: 'data',
                    repoProjects: repoProjectsData,
                    orgProjects: orgProjectsData,
                    statusOptions: statusOptions
                });
            } else {
                // No changes, just mark as fresh
                this._view.webview.postMessage({
                    type: 'dataFresh',
                });
            }
        } else {
            // No cache, send full data
            this._view.webview.postMessage({
                type: 'data',
                repoProjects: repoProjectsData,
                orgProjects: orgProjectsData,
                statusOptions: statusOptions
            });
        }

        // Save to cache
        await this._cacheManager.saveCache(
            owner,
            repo,
            repoProjectsData,
            orgProjectsData,
            statusOptions
        );
    }


    private _getHtmlForWebview(webview: vscode.Webview) {
        const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'media', 'main.js'));
        const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'media', 'style.css'));

        const nonce = getNonce();

        return `<!DOCTYPE html>
            <html lang="en">
            <head>
                <meta charset="UTF-8">
                <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource}; script-src 'nonce-${nonce}';">
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
                </div>
                <script nonce="${nonce}" src="${scriptUri}"></script>
            </body>
            </html>`;
    }

    public viewActiveSessions() {
        if (!this._claudeMonitor) {
            vscode.window.showInformationMessage('No active Claude sessions');
            return;
        }

        const sessions = this._claudeMonitor.getActiveSessions();
        if (sessions.length === 0) {
            vscode.window.showInformationMessage('No active Claude sessions');
            return;
        }

        const items = sessions.map(s => ({
            label: `Project #${s.projectNumber}`,
            description: `Session: ${s.sessionId}`,
            detail: `Started: ${new Date(s.lastModified).toLocaleString()}`,
            sessionId: s.sessionId,
            filePath: s.responseFilePath
        }));

        vscode.window.showQuickPick(items, {
            placeHolder: 'Select a session to view'
        }).then(selected => {
            if (selected) {
                vscode.workspace.openTextDocument(selected.filePath).then(doc => {
                    vscode.window.showTextDocument(doc, { preview: false });
                });
            }
        });
    }

    public stopAllSessions() {
        if (!this._claudeMonitor) {
            vscode.window.showInformationMessage('No active Claude sessions');
            return;
        }

        const sessions = this._claudeMonitor.getActiveSessions();
        if (sessions.length === 0) {
            vscode.window.showInformationMessage('No active Claude sessions');
            return;
        }

        vscode.window.showWarningMessage(
            `Stop all ${sessions.length} active Claude session(s)?`,
            'Stop All',
            'Cancel'
        ).then(choice => {
            if (choice === 'Stop All') {
                this._claudeMonitor?.stopAllSessions();
                vscode.window.showInformationMessage('All Claude sessions stopped');
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
            this._view.webview.postMessage({ type: 'showInputDialog' });
        } catch (error) {
            console.error('Error starting project flow:', error);
            this._view?.webview.postMessage({
                type: 'flowError',
                error: `Failed to start project flow: ${error instanceof Error ? error.message : String(error)}`,
                recoverable: true
            });
        }
    }

    private async handleInputSubmitted(input: string, detection: any) {
        if (!this._view || !this._projectFlowManager || !this._claudeAPI) return;

        try {
            // Get workspace root
            const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
            if (!workspaceRoot) {
                throw new Error('No workspace folder found');
            }

            // Extract input content
            const extractedInput = await extractInput(input, workspaceRoot);
            this._projectFlowManager.setInput(extractedInput);
            this._projectFlowManager.setPhase('design');

            // Show progress
            this._view.webview.postMessage({
                type: 'projectCreationProgress',
                step: 'Analyzing project...',
                current: 1,
                total: 5
            });

            // Execute design analysis
            const result = await this._claudeAPI.executeDesignAnalysis(extractedInput.content);

            // Store iteration
            this._projectFlowManager.addDesignIteration(extractedInput.content, result);

            // Show design review dialog
            this._view.webview.postMessage({
                type: 'showDesignReview',
                result,
                iteration: 1
            });
        } catch (error) {
            console.error('Error processing input:', error);
            this._view?.webview.postMessage({
                type: 'flowError',
                error: `Failed to process input: ${error instanceof Error ? error.message : String(error)}`,
                recoverable: true
            });
        }
    }

    private async handleTypeaheadRequest(input: string) {
        if (!this._view) return;

        try {
            const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
            if (!workspaceRoot) {
                this._view.webview.postMessage({
                    type: 'typeaheadResponse',
                    results: []
                });
                return;
            }

            const results = getTypeaheadResults(input, workspaceRoot);
            this._view.webview.postMessage({
                type: 'typeaheadResponse',
                results
            });
        } catch (error) {
            console.error('Error getting typeahead results:', error);
            this._view.webview.postMessage({
                type: 'typeaheadResponse',
                results: []
            });
        }
    }

    private async handleDesignFeedback(feedback: string, skipReview: boolean) {
        if (!this._view || !this._projectFlowManager || !this._claudeAPI) return;

        try {
            const session = this._projectFlowManager.getCurrentSession();
            if (!session) {
                throw new Error('No active session');
            }

            // Update skip review preference
            if (skipReview) {
                this._projectFlowManager.setSkipProductReview(true);
            }

            // Show progress
            this._view.webview.postMessage({
                type: 'projectCreationProgress',
                step: 'Refining design...',
                current: 2,
                total: 5
            });

            // Execute iteration
            const previousResult = session.designIterations.currentResult;
            const result = await this._claudeAPI.executeDesignIteration(previousResult, feedback);

            // Store iteration
            this._projectFlowManager.addDesignIteration(feedback, result);

            // Show updated design review
            this._view.webview.postMessage({
                type: 'showDesignReview',
                result,
                iteration: session.designIterations.iterations.length
            });
        } catch (error) {
            console.error('Error processing feedback:', error);
            this._view?.webview.postMessage({
                type: 'flowError',
                error: `Failed to process feedback: ${error instanceof Error ? error.message : String(error)}`,
                recoverable: true
            });
        }
    }

    private async handleDesignAccepted(skipReview: boolean) {
        if (!this._view || !this._projectFlowManager || !this._claudeAPI) return;

        try {
            const session = this._projectFlowManager.getCurrentSession();
            if (!session) {
                throw new Error('No active session');
            }

            // Update skip review preference
            if (skipReview) {
                this._projectFlowManager.setSkipProductReview(true);
            }

            this._projectFlowManager.setPhase('structure');

            // Show progress
            this._view.webview.postMessage({
                type: 'projectCreationProgress',
                step: 'Creating project structure...',
                current: 3,
                total: 5
            });

            // Execute project breakdown
            const approvedDesign = session.designIterations.currentResult;
            const breakdownResult = await this._claudeAPI.executeProjectBreakdown(approvedDesign);

            // Parse JSON response
            const config = this._claudeAPI.parseJSONResponse(breakdownResult);

            // Get current repo info
            if (!this._currentOwner || !this._currentRepo) {
                throw new Error('No repository context');
            }

            // Build project creation config
            const projectConfig = {
                isPublic: false, // Will be set by user
                repoOwner: this._currentOwner,
                repoName: this._currentRepo,
                projectTitle: config.projectTitle,
                epic: config.epic,
                tasks: config.tasks
            };

            this._projectFlowManager.setFinalConfig(projectConfig);

            // Show project approval dialog
            this._view.webview.postMessage({
                type: 'showProjectApproval',
                config: projectConfig
            });
        } catch (error) {
            console.error('Error accepting design:', error);
            this._view?.webview.postMessage({
                type: 'flowError',
                error: `Failed to create project structure: ${error instanceof Error ? error.message : String(error)}`,
                recoverable: true
            });
        }
    }

    private async handleProjectApproved(isPublic: boolean) {
        if (!this._view || !this._projectFlowManager || !this._projectCreator) return;

        try {
            const session = this._projectFlowManager.getCurrentSession();
            if (!session || !session.finalConfig) {
                throw new Error('No project configuration');
            }

            // Update visibility
            session.finalConfig.isPublic = isPublic;
            this._projectFlowManager.setPhase('creation');

            // Check auth and scope
            const authCheck = await this._projectCreator.checkAuth();
            if (!authCheck.authenticated) {
                throw new Error('GitHub CLI not authenticated. Run: gh auth login');
            }

            const scopeCheck = await this._projectCreator.checkProjectScope();
            if (!scopeCheck.hasScope) {
                throw new Error(scopeCheck.error || 'Missing project scope');
            }

            // Create project with progress updates
            const result = await this._projectCreator.createProject(
                session.finalConfig,
                (step, current, total) => {
                    this._view?.webview.postMessage({
                        type: 'projectCreationProgress',
                        step,
                        current,
                        total
                    });
                }
            );

            // Update last used repo
            this._projectFlowManager.updateLastUsedRepo(
                session.finalConfig.repoOwner,
                session.finalConfig.repoName
            );

            // Mark complete
            this._projectFlowManager.setPhase('complete');

            // Send success message
            this._view.webview.postMessage({
                type: 'projectCreated',
                result
            });

            // Refresh the projects view
            await this.refresh();

            // Clear session
            this._projectFlowManager.clearSession();

            // Show success notification
            if (result.failedTasks && result.failedTasks.length > 0) {
                // Partial success - show warning
                const failedCount = result.failedTasks.length;
                const successCount = result.taskUrls.length;
                vscode.window.showWarningMessage(
                    `Project created with ${successCount} tasks. ${failedCount} task(s) failed to create.`,
                    'Open Project',
                    'View Failed Tasks'
                ).then(choice => {
                    if (choice === 'Open Project') {
                        vscode.env.openExternal(vscode.Uri.parse(result.projectUrl));
                    } else if (choice === 'View Failed Tasks') {
                        const failedList = result.failedTasks!.map(f => `- ${f.task.title}: ${f.error}`).join('\n');
                        vscode.window.showErrorMessage(`Failed tasks:\n${failedList}`, { modal: true });
                    }
                });
            } else {
                // Full success
                vscode.window.showInformationMessage(
                    `Project created successfully!`,
                    'Open Project'
                ).then(choice => {
                    if (choice === 'Open Project') {
                        vscode.env.openExternal(vscode.Uri.parse(result.projectUrl));
                    }
                });
            }
        } catch (error) {
            console.error('Error creating project:', error);
            this._view?.webview.postMessage({
                type: 'flowError',
                error: `Failed to create project: ${error instanceof Error ? error.message : String(error)}`,
                recoverable: false,
                action: error instanceof Error && error.message.includes('gh auth')
                    ? error.message
                    : undefined
            });
        }
    }
}

function getNonce() {
    let text = '';
    const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    for (let i = 0; i < 32; i++) {
        text += possible.charAt(Math.floor(Math.random() * possible.length));
    }
    return text;
}
