import * as vscode from 'vscode';
import { ProjectsViewProvider } from './projects-view-provider';

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
}

export function deactivate() { }

