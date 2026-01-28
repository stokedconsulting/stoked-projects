import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { exec } from 'child_process';
import { promisify } from 'util';
import { BranchManager, initializeBranchManager, cleanupBranchManager, getBranchManager } from '../branch-manager';

const execAsync = promisify(exec);

/**
 * Test suite for BranchManager
 *
 * Tests cover all acceptance criteria:
 * - AC-2.3.a: Branch creation from latest main within 10 seconds
 * - AC-2.3.b: Branch push when no conflicts exist
 * - AC-2.3.c: User notification when conflicts exist with file list
 * - AC-2.3.d: Automatic rebase attempted for minor conflicts (< 5 files)
 * - AC-2.3.e: Auto-rebase success → push and proceed to "done"
 * - AC-2.3.f: Auto-rebase failure → abort, escalate, no force-push
 */
suite('BranchManager Test Suite', () => {
    let tempDir: string;
    let branchManager: BranchManager;

    /**
     * Initialize a git repository in the temp directory
     */
    async function initGitRepo(): Promise<void> {
        await execAsync('git init', { cwd: tempDir });
        await execAsync('git config user.name "Test User"', { cwd: tempDir });
        await execAsync('git config user.email "test@example.com"', { cwd: tempDir });

        // Create initial commit on main
        const testFile = path.join(tempDir, 'README.md');
        fs.writeFileSync(testFile, '# Test Repository\n');
        await execAsync('git add README.md', { cwd: tempDir });
        await execAsync('git commit -m "Initial commit"', { cwd: tempDir });

        // Ensure we're on main branch
        try {
            await execAsync('git branch -M main', { cwd: tempDir });
        } catch (error) {
            // Branch may already be named main
            console.log('Branch already named main');
        }
    }

    /**
     * Create a mock remote by setting up a bare repository
     */
    async function setupMockRemote(): Promise<string> {
        const remotePath = path.join(os.tmpdir(), `git-remote-${Date.now()}`);
        fs.mkdirSync(remotePath, { recursive: true });

        await execAsync('git init --bare', { cwd: remotePath });
        await execAsync(`git remote add origin ${remotePath}`, { cwd: tempDir });
        await execAsync('git push -u origin main', { cwd: tempDir });

        return remotePath;
    }

    setup(async () => {
        // Create a unique temporary directory for each test
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'branch-manager-test-'));
        await initGitRepo();
        branchManager = new BranchManager(tempDir);
    });

    teardown(() => {
        // Clean up temporary directory after each test
        if (fs.existsSync(tempDir)) {
            fs.rmSync(tempDir, { recursive: true, force: true });
        }
        cleanupBranchManager();
    });

    // Helper function to get current branch
    async function getCurrentBranch(): Promise<string> {
        const { stdout } = await execAsync('git branch --show-current', { cwd: tempDir });
        return stdout.trim();
    }

    // ========================================================================
    // Branch Name Generation Tests
    // ========================================================================

    test('getBranchName generates correct format', () => {
        const branchName = branchManager.getBranchName(1, 42);
        assert.strictEqual(branchName, 'agent-1/project-42');

        const branchName2 = branchManager.getBranchName(5, 123);
        assert.strictEqual(branchName2, 'agent-5/project-123');
    });

    // ========================================================================
    // Branch Existence Tests
    // ========================================================================

    test('branchExists returns false for non-existent branch', async function() {
        this.timeout(5000);

        const exists = await branchManager.branchExists('agent-1/project-99');
        assert.strictEqual(exists, false);
    });

    test('branchExists returns true for existing local branch', async function() {
        this.timeout(5000);

        // Create a branch
        await execAsync('git checkout -b agent-1/project-42', { cwd: tempDir });
        await execAsync('git checkout main', { cwd: tempDir });

        const exists = await branchManager.branchExists('agent-1/project-42');
        assert.strictEqual(exists, true);
    });

    // ========================================================================
    // Current Branch Tests
    // ========================================================================

    test('getCurrentBranch returns current branch name', async function() {
        this.timeout(5000);

        const currentBranch = await branchManager.getCurrentBranch();
        assert.strictEqual(currentBranch, 'main');

        // Switch to a new branch
        await execAsync('git checkout -b test-branch', { cwd: tempDir });

        const newCurrentBranch = await branchManager.getCurrentBranch();
        assert.strictEqual(newCurrentBranch, 'test-branch');

        // Switch back
        await execAsync('git checkout main', { cwd: tempDir });
    });

    // ========================================================================
    // AC-2.3.a: Branch Creation Tests
    // ========================================================================

    test('AC-2.3.a: createAgentBranch creates branch from latest main within 10 seconds', async function() {
        this.timeout(15000);

        const remotePath = await setupMockRemote();

        const agentId = 1;
        const issueNumber = 42;
        const startTime = Date.now();

        const result = await branchManager.createAgentBranch(agentId, issueNumber);

        const elapsed = Date.now() - startTime;

        // Verify timing requirement (AC-2.3.a)
        assert.ok(elapsed < 10000, `Branch creation should complete within 10 seconds, took ${elapsed}ms`);

        // Verify result
        assert.ok(result.success, 'Branch creation should succeed');
        assert.strictEqual(result.branchName, 'agent-1/project-42');
        assert.ok(result.message, 'Should include success message');

        // Verify we're on the new branch
        const currentBranch = await getCurrentBranch();
        assert.strictEqual(currentBranch, 'agent-1/project-42');

        // Cleanup remote
        fs.rmSync(remotePath, { recursive: true, force: true });
    });

    test('createAgentBranch fails if branch already exists', async function() {
        this.timeout(10000);

        const remotePath = await setupMockRemote();

        const agentId = 1;
        const issueNumber = 42;

        // Create branch first time
        const result1 = await branchManager.createAgentBranch(agentId, issueNumber);
        assert.ok(result1.success);

        // Switch back to main
        await execAsync('git checkout main', { cwd: tempDir });

        // Try to create same branch again
        const result2 = await branchManager.createAgentBranch(agentId, issueNumber);
        assert.strictEqual(result2.success, false);
        assert.ok(result2.error?.includes('already exists'));

        // Cleanup remote
        fs.rmSync(remotePath, { recursive: true, force: true });
    });

    // ========================================================================
    // AC-2.3.b: Branch Push Tests
    // ========================================================================

    test('AC-2.3.b: pushAgentBranch pushes branch to remote successfully', async function() {
        this.timeout(10000);

        const remotePath = await setupMockRemote();

        const agentId = 2;
        const issueNumber = 50;

        // Create and checkout branch
        await branchManager.createAgentBranch(agentId, issueNumber);

        // Make a commit
        const testFile = path.join(tempDir, 'test.txt');
        fs.writeFileSync(testFile, 'test content');
        await execAsync('git add test.txt', { cwd: tempDir });
        await execAsync('git commit -m "Test commit"', { cwd: tempDir });

        // Push branch
        await branchManager.pushAgentBranch(agentId, issueNumber);

        // Verify branch exists on remote
        const { stdout } = await execAsync('git ls-remote --heads origin', { cwd: tempDir });
        assert.ok(stdout.includes('agent-2/project-50'), 'Branch should exist on remote');

        // Cleanup remote
        fs.rmSync(remotePath, { recursive: true, force: true });
    });

    test('pushAgentBranch fails if not on correct branch', async function() {
        this.timeout(10000);

        const remotePath = await setupMockRemote();

        const agentId = 3;
        const issueNumber = 60;

        // Create branch but switch away from it
        await branchManager.createAgentBranch(agentId, issueNumber);
        await execAsync('git checkout main', { cwd: tempDir });

        // Try to push - should fail
        await assert.rejects(
            async () => await branchManager.pushAgentBranch(agentId, issueNumber),
            /Not on branch/,
            'Should fail when not on the correct branch'
        );

        // Cleanup remote
        fs.rmSync(remotePath, { recursive: true, force: true });
    });

    // ========================================================================
    // AC-2.3.c: Conflict Detection Tests
    // ========================================================================

    test('AC-2.3.c: checkForConflicts detects no conflicts when branches are compatible', async function() {
        this.timeout(15000);

        const remotePath = await setupMockRemote();

        const agentId = 4;
        const issueNumber = 70;

        // Create and checkout branch
        await branchManager.createAgentBranch(agentId, issueNumber);

        // Make a non-conflicting commit on agent branch
        const testFile = path.join(tempDir, 'agent-file.txt');
        fs.writeFileSync(testFile, 'agent work');
        await execAsync('git add agent-file.txt', { cwd: tempDir });
        await execAsync('git commit -m "Agent work"', { cwd: tempDir });

        // Check for conflicts (AC-2.3.c)
        const result = await branchManager.checkForConflicts(agentId, issueNumber);

        assert.strictEqual(result.hasConflicts, false, 'Should not detect conflicts');
        assert.strictEqual(result.conflictingFiles.length, 0);
        assert.ok(result.message?.includes('No conflicts'));

        // Cleanup remote
        fs.rmSync(remotePath, { recursive: true, force: true });
    });

    test('AC-2.3.c: checkForConflicts detects conflicts and provides file list', async function() {
        this.timeout(15000);

        const remotePath = await setupMockRemote();

        const agentId = 5;
        const issueNumber = 80;

        // Create and checkout branch
        await branchManager.createAgentBranch(agentId, issueNumber);

        // Make a commit on agent branch
        const conflictFile = path.join(tempDir, 'shared.txt');
        fs.writeFileSync(conflictFile, 'agent version\n');
        await execAsync('git add shared.txt', { cwd: tempDir });
        await execAsync('git commit -m "Agent changes"', { cwd: tempDir });

        // Switch to main and make conflicting commit
        await execAsync('git checkout main', { cwd: tempDir });
        fs.writeFileSync(conflictFile, 'main version\n');
        await execAsync('git add shared.txt', { cwd: tempDir });
        await execAsync('git commit -m "Main changes"', { cwd: tempDir });
        await execAsync('git push origin main', { cwd: tempDir });

        // Switch back to agent branch
        await execAsync(`git checkout agent-${agentId}/project-${issueNumber}`, { cwd: tempDir });

        // Check for conflicts (AC-2.3.c)
        const result = await branchManager.checkForConflicts(agentId, issueNumber);

        // With < 5 files, auto-rebase will be attempted, which will fail
        assert.strictEqual(result.hasConflicts, true, 'Should detect conflicts');
        assert.ok(result.conflictingFiles.length > 0, 'Should include conflicting files');
        assert.strictEqual(result.isMinor, true, 'Should recognize as minor conflict');
        assert.strictEqual(result.autoRebaseAttempted, true, 'Should attempt auto-rebase for minor conflicts');
        assert.strictEqual(result.autoRebaseSucceeded, false, 'Auto-rebase should fail');

        // Cleanup remote
        fs.rmSync(remotePath, { recursive: true, force: true });
    });

    // ========================================================================
    // AC-2.3.d, AC-2.3.e, AC-2.3.f: Auto-rebase Tests
    // ========================================================================

    test('AC-2.3.d: Auto-rebase is attempted for minor conflicts (< 5 files)', async function() {
        this.timeout(15000);

        const remotePath = await setupMockRemote();

        const agentId = 6;
        const issueNumber = 90;

        // Create and checkout branch
        await branchManager.createAgentBranch(agentId, issueNumber);

        // Create 3 conflicting files (minor conflict)
        for (let i = 1; i <= 3; i++) {
            const file = path.join(tempDir, `conflict${i}.txt`);
            fs.writeFileSync(file, `agent version ${i}\n`);
        }
        await execAsync('git add .', { cwd: tempDir });
        await execAsync('git commit -m "Agent changes to 3 files"', { cwd: tempDir });

        // Switch to main and create conflicts
        await execAsync('git checkout main', { cwd: tempDir });
        for (let i = 1; i <= 3; i++) {
            const file = path.join(tempDir, `conflict${i}.txt`);
            fs.writeFileSync(file, `main version ${i}\n`);
        }
        await execAsync('git add .', { cwd: tempDir });
        await execAsync('git commit -m "Main changes to 3 files"', { cwd: tempDir });
        await execAsync('git push origin main', { cwd: tempDir });

        // Switch back to agent branch
        await execAsync(`git checkout agent-${agentId}/project-${issueNumber}`, { cwd: tempDir });

        // Check for conflicts (AC-2.3.d)
        const result = await branchManager.checkForConflicts(agentId, issueNumber);

        // Verify auto-rebase was attempted
        assert.strictEqual(result.isMinor, true, 'Should recognize as minor conflict (< 5 files)');
        assert.strictEqual(result.autoRebaseAttempted, true, 'Should attempt auto-rebase for minor conflicts');

        // In this case, rebase will fail due to actual conflicts
        assert.strictEqual(result.autoRebaseSucceeded, false, 'Auto-rebase should fail with real conflicts');
        assert.strictEqual(result.hasConflicts, true);

        // Cleanup remote
        fs.rmSync(remotePath, { recursive: true, force: true });
    });

    test('AC-2.3.d: Auto-rebase is NOT attempted for major conflicts (>= 5 files)', async function() {
        this.timeout(15000);

        const remotePath = await setupMockRemote();

        const agentId = 7;
        const issueNumber = 100;

        // Create and checkout branch
        await branchManager.createAgentBranch(agentId, issueNumber);

        // Create 6 conflicting files (major conflict)
        for (let i = 1; i <= 6; i++) {
            const file = path.join(tempDir, `conflict${i}.txt`);
            fs.writeFileSync(file, `agent version ${i}\n`);
        }
        await execAsync('git add .', { cwd: tempDir });
        await execAsync('git commit -m "Agent changes to 6 files"', { cwd: tempDir });

        // Switch to main and create conflicts
        await execAsync('git checkout main', { cwd: tempDir });
        for (let i = 1; i <= 6; i++) {
            const file = path.join(tempDir, `conflict${i}.txt`);
            fs.writeFileSync(file, `main version ${i}\n`);
        }
        await execAsync('git add .', { cwd: tempDir });
        await execAsync('git commit -m "Main changes to 6 files"', { cwd: tempDir });
        await execAsync('git push origin main', { cwd: tempDir });

        // Switch back to agent branch
        await execAsync(`git checkout agent-${agentId}/project-${issueNumber}`, { cwd: tempDir });

        // Check for conflicts
        const result = await branchManager.checkForConflicts(agentId, issueNumber);

        // Verify auto-rebase was NOT attempted for major conflicts
        assert.strictEqual(result.isMinor, false, 'Should recognize as major conflict (>= 5 files)');
        assert.strictEqual(result.autoRebaseAttempted, false, 'Should NOT attempt auto-rebase for major conflicts');
        assert.strictEqual(result.hasConflicts, true);

        // Cleanup remote
        fs.rmSync(remotePath, { recursive: true, force: true });
    });

    test('AC-2.3.e: Auto-rebase succeeds for non-conflicting changes', async function() {
        this.timeout(15000);

        const remotePath = await setupMockRemote();

        const agentId = 8;
        const issueNumber = 110;

        // Create and checkout branch
        await branchManager.createAgentBranch(agentId, issueNumber);

        // Make changes on agent branch
        const agentFile = path.join(tempDir, 'agent-feature.txt');
        fs.writeFileSync(agentFile, 'agent feature\n');
        await execAsync('git add agent-feature.txt', { cwd: tempDir });
        await execAsync('git commit -m "Add agent feature"', { cwd: tempDir });

        // Switch to main and make non-conflicting changes
        await execAsync('git checkout main', { cwd: tempDir });
        const mainFile = path.join(tempDir, 'main-feature.txt');
        fs.writeFileSync(mainFile, 'main feature\n');
        await execAsync('git add main-feature.txt', { cwd: tempDir });
        await execAsync('git commit -m "Add main feature"', { cwd: tempDir });
        await execAsync('git push origin main', { cwd: tempDir });

        // Switch back to agent branch
        await execAsync(`git checkout agent-${agentId}/project-${issueNumber}`, { cwd: tempDir });

        // Check for conflicts (AC-2.3.e)
        const result = await branchManager.checkForConflicts(agentId, issueNumber);

        // Verify no conflicts detected (merge should succeed)
        assert.strictEqual(result.hasConflicts, false, 'Should not detect conflicts');
        assert.strictEqual(result.autoRebaseAttempted, false, 'Should not attempt rebase when merge succeeds');
        assert.ok(result.message?.includes('No conflicts'));

        // Cleanup remote
        fs.rmSync(remotePath, { recursive: true, force: true });
    });

    test('AC-2.3.f: Auto-rebase aborts on failure, no force-push', async function() {
        this.timeout(15000);

        const remotePath = await setupMockRemote();

        const agentId = 9;
        const issueNumber = 120;

        // Create and checkout branch
        await branchManager.createAgentBranch(agentId, issueNumber);

        // Push initial version of branch
        await execAsync('git push -u origin agent-9/project-120', { cwd: tempDir });

        // Create conflicting change on agent branch
        const conflictFile = path.join(tempDir, 'conflict.txt');
        fs.writeFileSync(conflictFile, 'agent version\n');
        await execAsync('git add conflict.txt', { cwd: tempDir });
        await execAsync('git commit -m "Agent change"', { cwd: tempDir });

        // Switch to main and create conflict
        await execAsync('git checkout main', { cwd: tempDir });
        fs.writeFileSync(conflictFile, 'main version\n');
        await execAsync('git add conflict.txt', { cwd: tempDir });
        await execAsync('git commit -m "Main change"', { cwd: tempDir });
        await execAsync('git push origin main', { cwd: tempDir });

        // Switch back to agent branch
        await execAsync(`git checkout agent-${agentId}/project-${issueNumber}`, { cwd: tempDir });

        // Get remote commit hash before conflict check
        const { stdout: remoteBefore } = await execAsync(
            `git ls-remote origin agent-${agentId}/project-${issueNumber}`,
            { cwd: tempDir }
        );
        const remoteHashBefore = remoteBefore.split('\t')[0];

        // Check for conflicts (AC-2.3.f)
        const result = await branchManager.checkForConflicts(agentId, issueNumber);

        // Verify rebase was attempted and failed
        assert.strictEqual(result.autoRebaseAttempted, true);
        assert.strictEqual(result.autoRebaseSucceeded, false);
        assert.strictEqual(result.hasConflicts, true);

        // Verify repository is in clean state (rebase was aborted)
        const { stdout: status } = await execAsync('git status --porcelain', { cwd: tempDir });
        assert.strictEqual(status.trim(), '', 'Repository should be clean after rebase abort');

        // Verify no force-push occurred (remote hash should be unchanged)
        const { stdout: remoteAfter } = await execAsync(
            `git ls-remote origin agent-${agentId}/project-${issueNumber}`,
            { cwd: tempDir }
        );
        const remoteHashAfter = remoteAfter.split('\t')[0];
        assert.strictEqual(remoteHashBefore, remoteHashAfter, 'Remote should not have been force-pushed');

        // Cleanup remote
        fs.rmSync(remotePath, { recursive: true, force: true });
    });

    // ========================================================================
    // Singleton Pattern Tests
    // ========================================================================

    test('initializeBranchManager creates global instance', () => {
        const manager = initializeBranchManager(tempDir);
        assert.ok(manager instanceof BranchManager);

        const retrieved = getBranchManager();
        assert.strictEqual(manager, retrieved, 'Should return same instance');

        cleanupBranchManager();
    });

    test('getBranchManager throws error when not initialized', () => {
        cleanupBranchManager();

        assert.throws(
            () => getBranchManager(),
            /not been initialized/,
            'Should throw error when manager not initialized'
        );
    });

    test('cleanupBranchManager clears global instance', () => {
        initializeBranchManager(tempDir);
        cleanupBranchManager();

        assert.throws(
            () => getBranchManager(),
            /not been initialized/,
            'Should throw error after cleanup'
        );
    });
});
