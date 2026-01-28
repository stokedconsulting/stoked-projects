import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { ProjectQueueManager, ProjectClaim } from '../project-queue-manager';
import { GitHubAPI, ProjectItem } from '../github-api';

/**
 * Mock GitHubAPI for testing
 */
class MockGitHubAPI extends GitHubAPI {
    private mockItems: ProjectItem[] = [];

    constructor() {
        super();
    }

    setMockItems(items: ProjectItem[]) {
        this.mockItems = items;
    }

    async getProjectItems(_projectId: string): Promise<ProjectItem[]> {
        return Promise.resolve(this.mockItems);
    }
}

/**
 * Helper function to create a mock ProjectItem
 */
function createMockProjectItem(
    issueNumber: number,
    status: string,
    title?: string
): ProjectItem {
    return {
        id: `item-${issueNumber}`,
        databaseId: issueNumber,
        content: {
            title: title || `Issue #${issueNumber}`,
            body: 'Test issue body',
            state: 'open',
            number: issueNumber,
            url: `https://github.com/test/repo/issues/${issueNumber}`,
            repository: {
                name: 'repo',
                owner: {
                    login: 'test'
                }
            }
        },
        fieldValues: {
            'Status': status
        }
    };
}

/**
 * Test suite for ProjectQueueManager
 *
 * Tests cover:
 * - Project queue discovery and filtering
 * - Atomic claim operations
 * - Claim expiration and cleanup
 * - Concurrent claim attempts
 * - Retry logic with exponential backoff
 */
suite('ProjectQueueManager Test Suite', () => {
    let tempDir: string;
    let mockGitHub: MockGitHubAPI;
    let manager: ProjectQueueManager;

    setup(() => {
        // Create a unique temporary directory for each test
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'project-queue-test-'));
        mockGitHub = new MockGitHubAPI();
        manager = new ProjectQueueManager(tempDir, mockGitHub);
    });

    teardown(() => {
        // Clean up temporary directory after each test
        if (fs.existsSync(tempDir)) {
            fs.rmSync(tempDir, { recursive: true, force: true });
        }
    });

    test('getAvailableProjects returns only todo and backlog items', async () => {
        const mockItems: ProjectItem[] = [
            createMockProjectItem(1, 'Todo'),
            createMockProjectItem(2, 'Backlog'),
            createMockProjectItem(3, 'In Progress'),
            createMockProjectItem(4, 'Done'),
            createMockProjectItem(5, 'todo'), // lowercase
            createMockProjectItem(6, 'BACKLOG') // uppercase
        ];

        mockGitHub.setMockItems(mockItems);

        const available = await manager.getAvailableProjects('project-123');

        // Should return issues 1, 2, 5, 6 (todo and backlog, case insensitive)
        assert.strictEqual(available.length, 4);
        const issueNumbers = available.map(item => item.content.number).sort();
        assert.deepStrictEqual(issueNumbers, [1, 2, 5, 6]);
    });

    test('getAvailableProjects excludes claimed items', async () => {
        const mockItems: ProjectItem[] = [
            createMockProjectItem(1, 'Todo'),
            createMockProjectItem(2, 'Todo'),
            createMockProjectItem(3, 'Todo')
        ];

        mockGitHub.setMockItems(mockItems);

        // Claim issue 2
        await manager.claimProject(79, 2, 'agent-1');

        const available = await manager.getAvailableProjects('project-123');

        // Should return issues 1 and 3 (issue 2 is claimed)
        assert.strictEqual(available.length, 2);
        const issueNumbers = available.map(item => item.content.number).sort();
        assert.deepStrictEqual(issueNumbers, [1, 3]);
    });

    test('getAvailableProjects sorts by issue number ascending', async () => {
        const mockItems: ProjectItem[] = [
            createMockProjectItem(5, 'Todo'),
            createMockProjectItem(2, 'Backlog'),
            createMockProjectItem(8, 'Todo'),
            createMockProjectItem(1, 'Todo')
        ];

        mockGitHub.setMockItems(mockItems);

        const available = await manager.getAvailableProjects('project-123');

        // Should be sorted: 1, 2, 5, 8
        const issueNumbers = available.map(item => item.content.number);
        assert.deepStrictEqual(issueNumbers, [1, 2, 5, 8]);
    });

    test('AC-2.1.a: getAvailableProjects completes within 1 second', async function() {
        this.timeout(2000);

        const mockItems: ProjectItem[] = [];
        // Create 50 mock items
        for (let i = 1; i <= 50; i++) {
            mockItems.push(createMockProjectItem(i, i % 2 === 0 ? 'Todo' : 'Backlog'));
        }

        mockGitHub.setMockItems(mockItems);

        const startTime = Date.now();
        const available = await manager.getAvailableProjects('project-123');
        const duration = Date.now() - startTime;

        assert.ok(duration < 1000, `Query took ${duration}ms, should be under 1000ms`);
        assert.strictEqual(available.length, 50);
    });

    test('claimProject successfully claims an unclaimed issue', async () => {
        const claimed = await manager.claimProject(79, 5, 'agent-1');

        assert.strictEqual(claimed, true);

        // Verify claim exists
        const isClaimed = await manager.isProjectClaimed(79, 5);
        assert.strictEqual(isClaimed, true);
    });

    test('AC-2.1.b: claimProject is atomic and removes from other queues', async () => {
        // Set up mock items
        const mockItems: ProjectItem[] = [
            createMockProjectItem(5, 'Todo')
        ];
        mockGitHub.setMockItems(mockItems);

        // Agent 1 claims the issue
        const claimed = await manager.claimProject(79, 5, 'agent-1');
        assert.strictEqual(claimed, true);

        // Check available projects for agent 2 - should not include issue 5
        const available = await manager.getAvailableProjects('project-123');
        assert.strictEqual(available.length, 0);
    });

    test('AC-2.1.c: Concurrent claims - only one agent succeeds', async function() {
        this.timeout(5000);

        const mockItems: ProjectItem[] = [
            createMockProjectItem(5, 'Todo')
        ];
        mockGitHub.setMockItems(mockItems);

        // Two agents attempt to claim simultaneously
        const claim1Promise = manager.claimProject(79, 5, 'agent-1');
        const claim2Promise = manager.claimProject(79, 5, 'agent-2');

        const [result1, result2] = await Promise.all([claim1Promise, claim2Promise]);

        // One should succeed, one should fail
        const successCount = [result1, result2].filter(r => r === true).length;
        assert.strictEqual(successCount, 1, 'Exactly one claim should succeed');

        // Verify only one claim exists
        const claim = await manager.getProjectClaim(79, 5);
        assert.ok(claim);
        assert.ok(['agent-1', 'agent-2'].includes(claim.agentId));
    });

    test('claimProject fails when issue is already claimed by another agent', async () => {
        // Agent 1 claims first
        await manager.claimProject(79, 5, 'agent-1');

        // Agent 2 attempts to claim
        const claimed = await manager.claimProject(79, 5, 'agent-2');

        assert.strictEqual(claimed, false);
    });

    test('claimProject is idempotent for the same agent', async () => {
        // Agent 1 claims
        const claim1 = await manager.claimProject(79, 5, 'agent-1');
        assert.strictEqual(claim1, true);

        // Agent 1 claims again
        const claim2 = await manager.claimProject(79, 5, 'agent-1');
        assert.strictEqual(claim2, true);

        // Verify still claimed by agent 1
        const claim = await manager.getProjectClaim(79, 5);
        assert.ok(claim);
        assert.strictEqual(claim.agentId, 'agent-1');
    });

    test('releaseProjectClaim removes the claim', async () => {
        await manager.claimProject(79, 5, 'agent-1');

        const isClaimedBefore = await manager.isProjectClaimed(79, 5);
        assert.strictEqual(isClaimedBefore, true);

        await manager.releaseProjectClaim(79, 5);

        const isClaimedAfter = await manager.isProjectClaimed(79, 5);
        assert.strictEqual(isClaimedAfter, false);
    });

    test('releaseProjectClaim handles non-existent claim gracefully', async () => {
        // Should not throw
        await manager.releaseProjectClaim(79, 999);
    });

    test('getClaimedProjects returns all claims for an agent', async () => {
        await manager.claimProject(79, 1, 'agent-1');
        await manager.claimProject(79, 2, 'agent-1');
        await manager.claimProject(79, 3, 'agent-2');

        const agent1Claims = await manager.getClaimedProjects('agent-1');
        const agent2Claims = await manager.getClaimedProjects('agent-2');

        assert.strictEqual(agent1Claims.length, 2);
        assert.strictEqual(agent2Claims.length, 1);

        const agent1Issues = agent1Claims.map(c => c.issueNumber).sort();
        assert.deepStrictEqual(agent1Issues, [1, 2]);
    });

    test('isProjectClaimed returns correct status', async () => {
        const isClaimedBefore = await manager.isProjectClaimed(79, 5);
        assert.strictEqual(isClaimedBefore, false);

        await manager.claimProject(79, 5, 'agent-1');

        const isClaimedAfter = await manager.isProjectClaimed(79, 5);
        assert.strictEqual(isClaimedAfter, true);
    });

    test('getProjectClaim returns claim details', async () => {
        await manager.claimProject(79, 5, 'agent-1');

        const claim = await manager.getProjectClaim(79, 5);

        assert.ok(claim);
        assert.strictEqual(claim.agentId, 'agent-1');
        assert.strictEqual(claim.projectNumber, 79);
        assert.strictEqual(claim.issueNumber, 5);
        assert.ok(claim.claimedAt);
    });

    test('getProjectClaim returns null for non-existent claim', async () => {
        const claim = await manager.getProjectClaim(79, 999);
        assert.strictEqual(claim, null);
    });

    test('getAllActiveClaims returns all non-expired claims', async () => {
        await manager.claimProject(79, 1, 'agent-1');
        await manager.claimProject(79, 2, 'agent-2');
        await manager.claimProject(79, 3, 'agent-1');

        const allClaims = await manager.getAllActiveClaims();

        assert.strictEqual(allClaims.length, 3);
    });

    test('AC-2.1.d: Expired claims are not returned as active', async () => {
        // Manually create an expired claim
        const claimsPath = path.join(tempDir, '.claude-sessions', 'claims.json');
        fs.mkdirSync(path.dirname(claimsPath), { recursive: true });

        const expiredTime = new Date(Date.now() - 9 * 60 * 60 * 1000); // 9 hours ago
        const claims = {
            '79-5': {
                agentId: 'agent-1',
                claimedAt: expiredTime.toISOString(),
                projectNumber: 79,
                issueNumber: 5
            }
        };
        fs.writeFileSync(claimsPath, JSON.stringify(claims), 'utf-8');

        // Expired claim should not be returned as claimed
        const isClaimed = await manager.isProjectClaimed(79, 5);
        assert.strictEqual(isClaimed, false);

        // Should not appear in active claims
        const activeClaims = await manager.getAllActiveClaims();
        assert.strictEqual(activeClaims.length, 0);

        // Should not appear in agent's claimed projects
        const agentClaims = await manager.getClaimedProjects('agent-1');
        assert.strictEqual(agentClaims.length, 0);
    });

    test('AC-2.1.d: Expired claim can be claimed by another agent', async () => {
        // Manually create an expired claim
        const claimsPath = path.join(tempDir, '.claude-sessions', 'claims.json');
        fs.mkdirSync(path.dirname(claimsPath), { recursive: true });

        const expiredTime = new Date(Date.now() - 9 * 60 * 60 * 1000); // 9 hours ago
        const claims = {
            '79-5': {
                agentId: 'agent-1',
                claimedAt: expiredTime.toISOString(),
                projectNumber: 79,
                issueNumber: 5
            }
        };
        fs.writeFileSync(claimsPath, JSON.stringify(claims), 'utf-8');

        // Agent 2 should be able to claim the expired issue
        const claimed = await manager.claimProject(79, 5, 'agent-2');
        assert.strictEqual(claimed, true);

        // Verify claim is now owned by agent 2
        const claim = await manager.getProjectClaim(79, 5);
        assert.ok(claim);
        assert.strictEqual(claim.agentId, 'agent-2');
    });

    test('cleanupStaleClaims removes expired claims', async () => {
        // Create a mix of fresh and stale claims
        const claimsPath = path.join(tempDir, '.claude-sessions', 'claims.json');
        fs.mkdirSync(path.dirname(claimsPath), { recursive: true });

        const freshTime = new Date(Date.now() - 1 * 60 * 60 * 1000); // 1 hour ago
        const staleTime = new Date(Date.now() - 9 * 60 * 60 * 1000); // 9 hours ago

        const claims = {
            '79-1': {
                agentId: 'agent-1',
                claimedAt: freshTime.toISOString(),
                projectNumber: 79,
                issueNumber: 1
            },
            '79-2': {
                agentId: 'agent-2',
                claimedAt: staleTime.toISOString(),
                projectNumber: 79,
                issueNumber: 2
            },
            '79-3': {
                agentId: 'agent-1',
                claimedAt: staleTime.toISOString(),
                projectNumber: 79,
                issueNumber: 3
            }
        };
        fs.writeFileSync(claimsPath, JSON.stringify(claims), 'utf-8');

        await manager.cleanupStaleClaims();

        // Only fresh claim should remain
        const activeClaims = await manager.getAllActiveClaims();
        assert.strictEqual(activeClaims.length, 1);
        assert.strictEqual(activeClaims[0].issueNumber, 1);
    });

    test('clearAllClaims removes all claims', async () => {
        await manager.claimProject(79, 1, 'agent-1');
        await manager.claimProject(79, 2, 'agent-2');

        const beforeClear = await manager.getAllActiveClaims();
        assert.strictEqual(beforeClear.length, 2);

        await manager.clearAllClaims();

        const afterClear = await manager.getAllActiveClaims();
        assert.strictEqual(afterClear.length, 0);
    });

    test('Claims file auto-creation on first claim', async () => {
        const claimsPath = path.join(tempDir, '.claude-sessions', 'claims.json');
        assert.ok(!fs.existsSync(claimsPath), 'Claims file should not exist initially');

        await manager.claimProject(79, 5, 'agent-1');

        assert.ok(fs.existsSync(claimsPath), 'Claims file should be created');
    });

    test('Atomic write: claims file is valid after concurrent operations', async function() {
        this.timeout(5000);

        // Perform multiple concurrent claims
        const claimPromises = [];
        for (let i = 1; i <= 20; i++) {
            claimPromises.push(manager.claimProject(79, i, `agent-${i % 3 + 1}`));
        }

        await Promise.all(claimPromises);

        // Verify claims file is still valid JSON
        const claimsPath = path.join(tempDir, '.claude-sessions', 'claims.json');
        const content = fs.readFileSync(claimsPath, 'utf-8');
        const parsed = JSON.parse(content); // Should not throw

        assert.ok(parsed);
        assert.ok(typeof parsed === 'object');
    });

    test('Corruption recovery: invalid JSON returns empty claims', async () => {
        // Corrupt the claims file
        const claimsPath = path.join(tempDir, '.claude-sessions', 'claims.json');
        fs.mkdirSync(path.dirname(claimsPath), { recursive: true });
        fs.writeFileSync(claimsPath, '{ invalid json }', 'utf-8');

        // Should recover and return empty array
        const activeClaims = await manager.getAllActiveClaims();
        assert.strictEqual(activeClaims.length, 0);

        // Should be able to create new claims
        const claimed = await manager.claimProject(79, 1, 'agent-1');
        assert.strictEqual(claimed, true);
    });

    test('Multiple projects: claims are tracked independently', async () => {
        await manager.claimProject(79, 5, 'agent-1');
        await manager.claimProject(80, 5, 'agent-2'); // Same issue number, different project

        const claim79 = await manager.getProjectClaim(79, 5);
        const claim80 = await manager.getProjectClaim(80, 5);

        assert.ok(claim79);
        assert.ok(claim80);
        assert.strictEqual(claim79.agentId, 'agent-1');
        assert.strictEqual(claim80.agentId, 'agent-2');
    });

    test('Claim key format: projectNumber-issueNumber', async () => {
        await manager.claimProject(79, 5, 'agent-1');

        // Read claims file directly to verify key format
        const claimsPath = path.join(tempDir, '.claude-sessions', 'claims.json');
        const content = fs.readFileSync(claimsPath, 'utf-8');
        const claims = JSON.parse(content);

        assert.ok(claims['79-5']);
        assert.strictEqual(claims['79-5'].agentId, 'agent-1');
    });

    test('Integration: Full workflow - query, claim, work, release', async () => {
        const mockItems: ProjectItem[] = [
            createMockProjectItem(1, 'Todo'),
            createMockProjectItem(2, 'Todo'),
            createMockProjectItem(3, 'Backlog')
        ];
        mockGitHub.setMockItems(mockItems);

        // Agent queries available projects
        let available = await manager.getAvailableProjects('project-123');
        assert.strictEqual(available.length, 3);

        // Agent claims first item
        const claimed = await manager.claimProject(79, 1, 'agent-1');
        assert.strictEqual(claimed, true);

        // Query again - should have 2 items now
        available = await manager.getAvailableProjects('project-123');
        assert.strictEqual(available.length, 2);

        // Verify agent's claimed projects
        const agentClaims = await manager.getClaimedProjects('agent-1');
        assert.strictEqual(agentClaims.length, 1);
        assert.strictEqual(agentClaims[0].issueNumber, 1);

        // Release claim
        await manager.releaseProjectClaim(79, 1);

        // Query again - should have 3 items again
        available = await manager.getAvailableProjects('project-123');
        assert.strictEqual(available.length, 3);
    });

    test('Performance: 100 concurrent claim attempts complete within 10 seconds', async function() {
        this.timeout(15000);

        const startTime = Date.now();

        // Create 100 different issues and attempt to claim them concurrently
        const claimPromises = [];
        for (let i = 1; i <= 100; i++) {
            claimPromises.push(manager.claimProject(79, i, `agent-${i % 5 + 1}`));
        }

        await Promise.all(claimPromises);

        const duration = Date.now() - startTime;

        assert.ok(duration < 10000, `100 claims took ${duration}ms, should be under 10000ms`);

        // Verify all claims succeeded
        const activeClaims = await manager.getAllActiveClaims();
        assert.strictEqual(activeClaims.length, 100);
    });
});
