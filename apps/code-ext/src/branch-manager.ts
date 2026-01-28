import { exec } from 'child_process';
import { promisify } from 'util';
import * as vscode from 'vscode';

const execAsync = promisify(exec);

/**
 * Result of a branch operation
 */
export interface BranchResult {
    success: boolean;
    branchName: string;
    message?: string;
    error?: string;
}

/**
 * Result of a conflict detection check
 */
export interface ConflictResult {
    hasConflicts: boolean;
    conflictingFiles: string[];
    isMinor: boolean; // True if < 5 files
    autoRebaseAttempted: boolean;
    autoRebaseSucceeded: boolean;
    message?: string;
    error?: string;
}

/**
 * Branch Manager
 *
 * Manages per-agent branch creation, pushing, and pre-merge conflict detection
 * for the multi-agent autonomous project orchestration system.
 *
 * Branch naming convention: agent-{agentId}/project-{issueNumber}
 * Example: agent-1/project-42
 */
export class BranchManager {
    private workspaceRoot: string;

    constructor(workspaceRoot: string) {
        this.workspaceRoot = workspaceRoot;
    }

    /**
     * Generate standardized branch name for an agent working on a project
     * @param agentId - Numeric identifier for the agent
     * @param issueNumber - GitHub issue/project number
     * @returns Branch name in format: agent-{id}/project-{issue}
     */
    public getBranchName(agentId: number, issueNumber: number): string {
        return `agent-${agentId}/project-${issueNumber}`;
    }

    /**
     * Check if a branch exists (locally or remotely)
     * @param branchName - Name of the branch to check
     * @returns True if branch exists
     */
    public async branchExists(branchName: string): Promise<boolean> {
        try {
            // Check local branches
            const { stdout: localBranches } = await execAsync('git branch --list', {
                cwd: this.workspaceRoot
            });

            if (localBranches.includes(branchName)) {
                return true;
            }

            // Check remote branches
            const { stdout: remoteBranches } = await execAsync('git branch -r --list', {
                cwd: this.workspaceRoot
            });

            return remoteBranches.includes(`origin/${branchName}`);
        } catch (error) {
            console.error(`[BranchManager] Error checking if branch exists:`, error);
            return false;
        }
    }

    /**
     * Get the current branch name
     * @returns Current branch name
     */
    public async getCurrentBranch(): Promise<string> {
        try {
            const { stdout } = await execAsync('git branch --show-current', {
                cwd: this.workspaceRoot
            });
            return stdout.trim();
        } catch (error) {
            const errorMsg = error instanceof Error ? error.message : String(error);
            throw new Error(`Failed to get current branch: ${errorMsg}`);
        }
    }

    /**
     * Create a new agent branch from the latest main branch
     * @param agentId - Numeric identifier for the agent
     * @param issueNumber - GitHub issue/project number
     * @returns Result indicating success or failure
     *
     * AC-2.3.a: When agent starts work on project → new branch is created from latest main within 10 seconds
     */
    public async createAgentBranch(agentId: number, issueNumber: number): Promise<BranchResult> {
        const branchName = this.getBranchName(agentId, issueNumber);
        const startTime = Date.now();

        try {
            console.log(`[BranchManager] Creating branch ${branchName} for agent ${agentId}...`);

            // Check if branch already exists
            if (await this.branchExists(branchName)) {
                return {
                    success: false,
                    branchName,
                    error: `Branch ${branchName} already exists`
                };
            }

            // Fetch latest main to ensure we're up to date
            await execAsync('git fetch origin main', {
                cwd: this.workspaceRoot
            });

            // Create and checkout new branch from origin/main
            await execAsync(`git checkout -b ${branchName} origin/main`, {
                cwd: this.workspaceRoot
            });

            const elapsed = Date.now() - startTime;
            console.log(`[BranchManager] Branch ${branchName} created successfully in ${elapsed}ms`);

            // Verify creation was within 10 seconds (AC-2.3.a)
            if (elapsed > 10000) {
                console.warn(`[BranchManager] Branch creation took ${elapsed}ms, exceeding 10s threshold`);
            }

            return {
                success: true,
                branchName,
                message: `Branch ${branchName} created successfully from origin/main`
            };
        } catch (error) {
            const errorMsg = error instanceof Error ? error.message : String(error);
            console.error(`[BranchManager] Failed to create branch ${branchName}:`, errorMsg);

            return {
                success: false,
                branchName,
                error: `Failed to create branch: ${errorMsg}`
            };
        }
    }

    /**
     * Push agent branch to remote repository
     * @param agentId - Numeric identifier for the agent
     * @param issueNumber - GitHub issue/project number
     * @throws Error if push fails
     *
     * AC-2.3.b: When project completes and no conflicts with main → code is pushed to agent branch successfully
     */
    public async pushAgentBranch(agentId: number, issueNumber: number): Promise<void> {
        const branchName = this.getBranchName(agentId, issueNumber);

        try {
            console.log(`[BranchManager] Pushing branch ${branchName} to remote...`);

            // Verify we're on the correct branch
            const currentBranch = await this.getCurrentBranch();
            if (currentBranch !== branchName) {
                throw new Error(`Not on branch ${branchName}, currently on ${currentBranch}`);
            }

            // Push branch to remote with upstream tracking
            await execAsync(`git push -u origin ${branchName}`, {
                cwd: this.workspaceRoot
            });

            console.log(`[BranchManager] Branch ${branchName} pushed successfully`);
        } catch (error) {
            const errorMsg = error instanceof Error ? error.message : String(error);
            console.error(`[BranchManager] Failed to push branch ${branchName}:`, errorMsg);
            throw new Error(`Failed to push branch: ${errorMsg}`);
        }
    }

    /**
     * Check for merge conflicts with main branch before merging
     * Attempts automatic rebase if conflicts are minor (< 5 files)
     *
     * @param agentId - Numeric identifier for the agent
     * @param issueNumber - GitHub issue/project number
     * @returns Conflict detection result with file list and rebase status
     *
     * AC-2.3.c: When project completes but conflicts exist with main → user is notified with list of conflicting files
     * AC-2.3.d: When conflicts involve < 5 files → automatic rebase is attempted before escalation
     * AC-2.3.e: When automatic rebase succeeds → branch is pushed and proceeds to "done" status
     * AC-2.3.f: When automatic rebase fails → rebase is aborted, conflict is escalated, no force-push occurs
     */
    public async checkForConflicts(agentId: number, issueNumber: number): Promise<ConflictResult> {
        const branchName = this.getBranchName(agentId, issueNumber);

        try {
            console.log(`[BranchManager] Checking for conflicts with main for ${branchName}...`);

            // Verify we're on the correct branch
            const currentBranch = await this.getCurrentBranch();
            if (currentBranch !== branchName) {
                throw new Error(`Not on branch ${branchName}, currently on ${currentBranch}`);
            }

            // Fetch latest main
            await execAsync('git fetch origin main', {
                cwd: this.workspaceRoot
            });

            // Attempt dry-run merge to detect conflicts
            let hasConflicts = false;
            let conflictingFiles: string[] = [];

            try {
                await execAsync('git merge --no-commit --no-ff origin/main', {
                    cwd: this.workspaceRoot
                });

                // No conflicts - abort the merge
                await execAsync('git merge --abort', {
                    cwd: this.workspaceRoot
                });

                console.log(`[BranchManager] No conflicts detected for ${branchName}`);

                return {
                    hasConflicts: false,
                    conflictingFiles: [],
                    isMinor: true,
                    autoRebaseAttempted: false,
                    autoRebaseSucceeded: false,
                    message: 'No conflicts detected with main branch'
                };
            } catch (mergeError) {
                // Merge failed - conflicts detected
                hasConflicts = true;

                // Get list of conflicting files
                try {
                    const { stdout: statusOutput } = await execAsync('git status --short', {
                        cwd: this.workspaceRoot
                    });

                    // Parse conflicting files (lines starting with UU, AA, DD, or containing conflict markers)
                    conflictingFiles = statusOutput
                        .split('\n')
                        .filter(line => line.match(/^(UU|AA|DD|AU|UA|DU|UD)/))
                        .map(line => line.substring(3).trim())
                        .filter(file => file.length > 0);

                    console.log(`[BranchManager] Detected ${conflictingFiles.length} conflicting files:`, conflictingFiles);
                } catch (statusError) {
                    console.error(`[BranchManager] Failed to get conflict status:`, statusError);
                }

                // Abort the merge
                await execAsync('git merge --abort', {
                    cwd: this.workspaceRoot
                });

                const isMinor = conflictingFiles.length > 0 && conflictingFiles.length < 5;

                // AC-2.3.d: Attempt automatic rebase if conflicts are minor (< 5 files)
                if (isMinor) {
                    console.log(`[BranchManager] Conflicts are minor (${conflictingFiles.length} files), attempting automatic rebase...`);

                    const rebaseResult = await this.attemptAutoRebase(branchName);

                    if (rebaseResult.success) {
                        // AC-2.3.e: Auto-rebase succeeded
                        console.log(`[BranchManager] Auto-rebase succeeded for ${branchName}`);

                        // Push the rebased branch
                        try {
                            await this.pushAgentBranch(agentId, issueNumber);

                            return {
                                hasConflicts: false, // Resolved via rebase
                                conflictingFiles: [],
                                isMinor: true,
                                autoRebaseAttempted: true,
                                autoRebaseSucceeded: true,
                                message: 'Conflicts resolved via automatic rebase and pushed successfully'
                            };
                        } catch (pushError) {
                            // Rebase succeeded but push failed
                            return {
                                hasConflicts: true,
                                conflictingFiles,
                                isMinor: true,
                                autoRebaseAttempted: true,
                                autoRebaseSucceeded: true,
                                error: `Auto-rebase succeeded but push failed: ${pushError instanceof Error ? pushError.message : String(pushError)}`
                            };
                        }
                    } else {
                        // AC-2.3.f: Auto-rebase failed, escalate
                        console.log(`[BranchManager] Auto-rebase failed for ${branchName}, escalating conflict`);

                        // Show VS Code notification
                        this.showConflictNotification(branchName, conflictingFiles, true);

                        return {
                            hasConflicts: true,
                            conflictingFiles,
                            isMinor: true,
                            autoRebaseAttempted: true,
                            autoRebaseSucceeded: false,
                            error: `Auto-rebase failed: ${rebaseResult.error}`
                        };
                    }
                } else {
                    // AC-2.3.c: Conflicts exist, notify user
                    console.log(`[BranchManager] Conflicts detected (${conflictingFiles.length} files), escalating to user`);

                    // Show VS Code notification
                    this.showConflictNotification(branchName, conflictingFiles, false);

                    return {
                        hasConflicts: true,
                        conflictingFiles,
                        isMinor: false,
                        autoRebaseAttempted: false,
                        autoRebaseSucceeded: false,
                        error: `Merge conflicts detected in ${conflictingFiles.length} files`
                    };
                }
            }
        } catch (error) {
            const errorMsg = error instanceof Error ? error.message : String(error);
            console.error(`[BranchManager] Error checking for conflicts:`, errorMsg);

            return {
                hasConflicts: false,
                conflictingFiles: [],
                isMinor: false,
                autoRebaseAttempted: false,
                autoRebaseSucceeded: false,
                error: `Failed to check for conflicts: ${errorMsg}`
            };
        }
    }

    /**
     * Attempt automatic rebase onto origin/main
     * If rebase fails, abort and return failure
     *
     * @param branchName - Name of the branch to rebase
     * @returns Result indicating success or failure
     */
    private async attemptAutoRebase(branchName: string): Promise<{ success: boolean; error?: string }> {
        try {
            console.log(`[BranchManager] Attempting automatic rebase of ${branchName} onto origin/main...`);

            // Attempt rebase
            await execAsync('git rebase origin/main', {
                cwd: this.workspaceRoot
            });

            console.log(`[BranchManager] Auto-rebase succeeded for ${branchName}`);
            return { success: true };
        } catch (rebaseError) {
            // Rebase failed - abort it
            console.error(`[BranchManager] Auto-rebase failed:`, rebaseError);

            try {
                await execAsync('git rebase --abort', {
                    cwd: this.workspaceRoot
                });
                console.log(`[BranchManager] Rebase aborted successfully`);
            } catch (abortError) {
                console.error(`[BranchManager] Failed to abort rebase:`, abortError);
            }

            return {
                success: false,
                error: rebaseError instanceof Error ? rebaseError.message : String(rebaseError)
            };
        }
    }

    /**
     * Show VS Code notification about merge conflicts
     * AC-2.3.c: When conflicts exist, notify user with list of conflicting files
     *
     * @param branchName - Name of the branch with conflicts
     * @param conflictingFiles - List of files with conflicts
     * @param rebaseAttempted - Whether automatic rebase was attempted
     */
    private showConflictNotification(
        branchName: string,
        conflictingFiles: string[],
        rebaseAttempted: boolean
    ): void {
        const fileList = conflictingFiles.slice(0, 10).join(', ');
        const extraFiles = conflictingFiles.length > 10 ? ` (+${conflictingFiles.length - 10} more)` : '';

        let message = `Merge conflicts detected in branch ${branchName}`;
        if (rebaseAttempted) {
            message = `Auto-rebase failed for ${branchName}`;
        }

        message += `\n\nConflicting files (${conflictingFiles.length}): ${fileList}${extraFiles}`;

        vscode.window.showWarningMessage(
            message,
            'View Conflicts',
            'Resolve Manually'
        ).then(selection => {
            if (selection === 'View Conflicts') {
                // Open source control view
                vscode.commands.executeCommand('workbench.view.scm');
            } else if (selection === 'Resolve Manually') {
                // Open integrated terminal
                vscode.commands.executeCommand('workbench.action.terminal.new');
            }
        });

        console.log(`[BranchManager] Conflict notification shown to user for ${branchName}`);
    }
}

/**
 * Global branch manager instance (singleton pattern)
 */
let globalBranchManager: BranchManager | null = null;

/**
 * Initialize the global branch manager instance
 * @param workspaceRoot - Root directory of the workspace
 */
export function initializeBranchManager(workspaceRoot: string): BranchManager {
    globalBranchManager = new BranchManager(workspaceRoot);
    return globalBranchManager;
}

/**
 * Get the global branch manager instance
 * @throws Error if branch manager has not been initialized
 */
export function getBranchManager(): BranchManager {
    if (!globalBranchManager) {
        throw new Error('BranchManager has not been initialized. Call initializeBranchManager() first.');
    }
    return globalBranchManager;
}

/**
 * Cleanup the global branch manager instance
 */
export function cleanupBranchManager(): void {
    globalBranchManager = null;
}
