import * as vscode from 'vscode';
import { ProjectsViewProvider } from './projects-view-provider';
import { GitHubAPI } from './github-api';

export function activate(context: vscode.ExtensionContext) {
    console.log('Congratulations, your extension "gh-projects-vscode" is now active!');

    const provider = new ProjectsViewProvider(context.extensionUri, context);

    context.subscriptions.push(
        vscode.window.registerWebviewViewProvider(ProjectsViewProvider.viewType, provider)
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('ghProjects.refresh', () => {
            provider.refresh();
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('ghProjects.viewActiveSessions', () => {
            provider.viewActiveSessions();
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('ghProjects.stopAllSessions', () => {
            provider.stopAllSessions();
        })
    );

    // Debug command to diagnose API responses
    context.subscriptions.push(
        vscode.commands.registerCommand('ghProjects.debugApi', async () => {
            const api = new GitHubAPI();
            const initialized = await api.initialize();
            if (!initialized) {
                vscode.window.showErrorMessage('Failed to initialize GitHub API');
                return;
            }

            // Get the current repo info
            const gitExtension = vscode.extensions.getExtension('vscode.git');
            if (!gitExtension) {
                vscode.window.showErrorMessage('Git extension not found');
                return;
            }

            if (!gitExtension.isActive) {
                await gitExtension.activate();
            }
            const git = gitExtension.exports.getAPI(1);

            if (git.repositories.length === 0) {
                vscode.window.showErrorMessage('No git repositories found');
                return;
            }

            const repo = git.repositories[0];
            const remote = repo.state.remotes.find((r: any) => r.name === 'origin') || repo.state.remotes[0];

            if (!remote?.fetchUrl) {
                vscode.window.showErrorMessage('No remote found');
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
                `=== Linked (Repo) Projects (${linkedResult.projects.length}) ===${linkedResult.error ? ` ERROR: ${linkedResult.error}` : ''}`,
                ...linkedResult.projects.map(p => `  #${p.number}: ${p.title}`),
                ``,
                `=== Organization Projects (${orgProjects.length}) ===`,
                ...orgProjects.map(p => `  #${p.number}: ${p.title}`),
                ``,
                `=== Filtered Unique Org Projects ===`,
            ];

            const repoProjectIds = new Set(linkedResult.projects.map(p => p.id));
            const uniqueOrgProjects = orgProjects.filter(p => !repoProjectIds.has(p.id));
            debugInfo.push(...uniqueOrgProjects.map(p => `  #${p.number}: ${p.title}`));

            // Create output channel and show
            const outputChannel = vscode.window.createOutputChannel('GH Projects Debug');
            outputChannel.clear();
            outputChannel.appendLine(debugInfo.join('\n'));

            vscode.window.showInformationMessage(`Found ${linkedResult.projects.length} repo projects, ${orgProjects.length} org projects`);
        })
    );
}

export function deactivate() { }

