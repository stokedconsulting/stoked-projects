"use strict";
/**
 * Integration Example: Branch Manager with Agent Lifecycle
 *
 * This file demonstrates how BranchManager integrates with AgentLifecycleManager
 * for the multi-agent autonomous project orchestration system.
 *
 * USAGE EXAMPLE - NOT FOR PRODUCTION (demonstration only)
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.exampleAgentWorkflow = exampleAgentWorkflow;
exports.exampleMultiAgentWorkflow = exampleMultiAgentWorkflow;
exports.exampleConflictScenarios = exampleConflictScenarios;
exports.getIntegrationUsageExample = getIntegrationUsageExample;
const branch_manager_1 = require("./branch-manager");
const agent_lifecycle_1 = require("./agent-lifecycle");
/**
 * Example workflow: Agent starts work on a project
 *
 * This shows the integration between branch management and agent lifecycle.
 */
async function exampleAgentWorkflow(workspaceRoot, agentId, issueNumber) {
    // Initialize managers
    const branchManager = new branch_manager_1.BranchManager(workspaceRoot);
    const lifecycleManager = new agent_lifecycle_1.AgentLifecycleManager(workspaceRoot);
    try {
        console.log(`\n=== Starting Agent ${agentId} on Project ${issueNumber} ===\n`);
        // STEP 1: Create agent branch (AC-2.3.a)
        console.log('Step 1: Creating agent branch...');
        const branchResult = await branchManager.createAgentBranch(agentId, issueNumber);
        if (!branchResult.success) {
            throw new Error(`Failed to create branch: ${branchResult.error}`);
        }
        console.log(`✓ Branch created: ${branchResult.branchName}`);
        // STEP 2: Start agent process
        console.log('\nStep 2: Starting agent process...');
        await lifecycleManager.startAgent(agentId);
        console.log(`✓ Agent ${agentId} started successfully`);
        // STEP 3: Agent does work (simulated)
        console.log('\nStep 3: Agent working on project...');
        console.log('  (Agent would be executing tasks, making commits, etc.)');
        // STEP 4: Check for conflicts before marking "done" (AC-2.3.b, AC-2.3.c)
        console.log('\nStep 4: Checking for conflicts with main...');
        const conflictResult = await branchManager.checkForConflicts(agentId, issueNumber);
        if (conflictResult.hasConflicts) {
            console.log('✗ Conflicts detected!');
            console.log(`  Files: ${conflictResult.conflictingFiles.join(', ')}`);
            console.log(`  Minor conflict: ${conflictResult.isMinor}`);
            console.log(`  Auto-rebase attempted: ${conflictResult.autoRebaseAttempted}`);
            console.log(`  Auto-rebase succeeded: ${conflictResult.autoRebaseSucceeded}`);
            if (conflictResult.autoRebaseSucceeded) {
                // AC-2.3.e: Auto-rebase succeeded
                console.log('✓ Conflicts resolved via automatic rebase');
                console.log('✓ Branch pushed successfully');
                console.log('→ Proceeding to "done" status');
            }
            else {
                // AC-2.3.f: Auto-rebase failed
                console.log('✗ Auto-rebase failed');
                console.log('→ Setting label: needs-manual-resolution');
                console.log('→ User notified with conflict details');
                return; // Don't proceed to "done"
            }
        }
        else {
            console.log('✓ No conflicts detected');
            // STEP 5: Push branch to remote (AC-2.3.b)
            console.log('\nStep 5: Pushing branch to remote...');
            await branchManager.pushAgentBranch(agentId, issueNumber);
            console.log(`✓ Branch pushed successfully`);
        }
        // STEP 6: Mark project as "done" (if no unresolved conflicts)
        console.log('\nStep 6: Marking project as "done"...');
        console.log('✓ Project completed successfully');
        console.log(`→ Branch ${branchResult.branchName} ready for review`);
    }
    catch (error) {
        console.error('\n✗ Workflow failed:', error);
        throw error;
    }
}
/**
 * Example: Multiple agents working on different projects
 */
async function exampleMultiAgentWorkflow(workspaceRoot) {
    console.log('\n=== Multi-Agent Workflow Example ===\n');
    const branchManager = new branch_manager_1.BranchManager(workspaceRoot);
    // Agent 1 working on Project 42
    const branch1 = await branchManager.createAgentBranch(1, 42);
    console.log(`Agent 1: ${branch1.branchName}`);
    // Agent 2 working on Project 43
    const branch2 = await branchManager.createAgentBranch(2, 43);
    console.log(`Agent 2: ${branch2.branchName}`);
    // Agent 3 working on Project 44
    const branch3 = await branchManager.createAgentBranch(3, 44);
    console.log(`Agent 3: ${branch3.branchName}`);
    console.log('\n✓ All agents have their own isolated branches');
    console.log('→ Agents can work in parallel without conflicts');
}
/**
 * Example: Conflict detection scenarios
 */
async function exampleConflictScenarios(workspaceRoot, agentId, issueNumber) {
    console.log('\n=== Conflict Detection Scenarios ===\n');
    const branchManager = new branch_manager_1.BranchManager(workspaceRoot);
    const result = await branchManager.checkForConflicts(agentId, issueNumber);
    if (!result.hasConflicts) {
        console.log('Scenario: No conflicts');
        console.log('→ Branch can be merged safely');
        console.log('→ Proceed to push and mark "done"');
    }
    else if (result.isMinor && result.autoRebaseAttempted) {
        if (result.autoRebaseSucceeded) {
            console.log('Scenario: Minor conflicts, auto-rebase succeeded');
            console.log('→ Conflicts resolved automatically');
            console.log('→ Branch pushed successfully');
            console.log('→ Proceed to "done" status');
        }
        else {
            console.log('Scenario: Minor conflicts, auto-rebase failed');
            console.log('→ Could not resolve conflicts automatically');
            console.log('→ User notified with file list');
            console.log('→ Set label: needs-manual-resolution');
            console.log('→ Do not proceed to "done"');
        }
    }
    else {
        console.log('Scenario: Major conflicts (>= 5 files)');
        console.log('→ Too many conflicts for auto-rebase');
        console.log('→ User notified with file list');
        console.log('→ Set label: needs-manual-resolution');
        console.log('→ Do not proceed to "done"');
    }
}
/**
 * Example usage in extension.ts
 */
function getIntegrationUsageExample() {
    return `
// In extension.ts or agent orchestration code:

import { initializeBranchManager, getBranchManager } from './branch-manager';
import { initializeLifecycleManager, getLifecycleManager } from './agent-lifecycle';

// During extension activation:
export function activate(context: vscode.ExtensionContext) {
    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;

    if (workspaceRoot) {
        // Initialize global managers
        initializeBranchManager(workspaceRoot);
        initializeLifecycleManager(workspaceRoot);
    }

    // Register agent start command
    context.subscriptions.push(
        vscode.commands.registerCommand('claudeProjects.startAgentWork', async (agentId, issueNumber) => {
            const branchManager = getBranchManager();
            const lifecycleManager = getLifecycleManager();

            // Create branch for agent
            const branchResult = await branchManager.createAgentBranch(agentId, issueNumber);

            if (!branchResult.success) {
                vscode.window.showErrorMessage(\`Failed to create branch: \${branchResult.error}\`);
                return;
            }

            // Start agent process
            await lifecycleManager.startAgent(agentId);

            vscode.window.showInformationMessage(\`Agent \${agentId} started on \${branchResult.branchName}\`);
        })
    );

    // Register agent completion command
    context.subscriptions.push(
        vscode.commands.registerCommand('claudeProjects.completeAgentWork', async (agentId, issueNumber) => {
            const branchManager = getBranchManager();

            // Check for conflicts
            const conflictResult = await branchManager.checkForConflicts(agentId, issueNumber);

            if (conflictResult.hasConflicts && !conflictResult.autoRebaseSucceeded) {
                vscode.window.showWarningMessage(\`Cannot complete: Conflicts detected in \${conflictResult.conflictingFiles.length} files\`);
                return;
            }

            // Push branch
            await branchManager.pushAgentBranch(agentId, issueNumber);

            // Mark issue as done (GitHub API call)
            // ...

            vscode.window.showInformationMessage(\`Project \${issueNumber} completed by agent \${agentId}\`);
        })
    );
}
`;
}
//# sourceMappingURL=branch-integration-example.js.map