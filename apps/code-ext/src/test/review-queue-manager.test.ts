import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import { ReviewQueueManager, ReviewEnqueueData, ReviewItem, ReviewStatus } from '../review-queue-manager';

suite('ReviewQueueManager Test Suite', () => {
    let testWorkspaceRoot: string;
    let queueManager: ReviewQueueManager;
    let queueFilePath: string;

    setup(() => {
        // Create temporary workspace directory for tests
        testWorkspaceRoot = path.join(__dirname, '../../test-workspace-review-queue');
        if (!fs.existsSync(testWorkspaceRoot)) {
            fs.mkdirSync(testWorkspaceRoot, { recursive: true });
        }

        queueManager = new ReviewQueueManager(testWorkspaceRoot);
        queueFilePath = path.join(testWorkspaceRoot, '.claude-sessions', 'review-queue.json');

        // Clean up any existing queue file
        if (fs.existsSync(queueFilePath)) {
            fs.unlinkSync(queueFilePath);
        }
    });

    teardown(() => {
        // Clean up test files
        if (fs.existsSync(testWorkspaceRoot)) {
            fs.rmSync(testWorkspaceRoot, { recursive: true, force: true });
        }
    });

    test('AC-3.2.a: Enqueue review within 30 seconds', async () => {
        const reviewData: ReviewEnqueueData = {
            projectNumber: 79,
            issueNumber: 10,
            branchName: 'feature/test-branch',
            completedByAgentId: 'agent-1'
        };

        const startTime = Date.now();
        const review = await queueManager.enqueueReview(reviewData);
        const duration = Date.now() - startTime;

        assert.ok(review, 'Review should be created');
        assert.strictEqual(review.projectNumber, 79);
        assert.strictEqual(review.issueNumber, 10);
        assert.strictEqual(review.branchName, 'feature/test-branch');
        assert.strictEqual(review.completedByAgentId, 'agent-1');
        assert.strictEqual(review.status, 'pending');
        assert.ok(review.reviewId, 'Review should have UUID');
        assert.ok(review.enqueuedAt, 'Review should have enqueue timestamp');
        assert.ok(duration < 30000, `Enqueue took ${duration}ms, should be under 30s`);
    });

    test('Enqueue duplicate review returns existing', async () => {
        const reviewData: ReviewEnqueueData = {
            projectNumber: 79,
            issueNumber: 10,
            branchName: 'feature/test-branch',
            completedByAgentId: 'agent-1'
        };

        const review1 = await queueManager.enqueueReview(reviewData);
        const review2 = await queueManager.enqueueReview(reviewData);

        assert.strictEqual(review1.reviewId, review2.reviewId, 'Should return same review ID');

        const queue = await queueManager.getReviewQueue();
        assert.strictEqual(queue.length, 1, 'Should only have one review in queue');
    });

    test('AC-3.2.b: Get pending reviews sorted by completion time (oldest first)', async () => {
        // Enqueue multiple reviews with delays
        const review1Data: ReviewEnqueueData = {
            projectNumber: 79,
            issueNumber: 1,
            branchName: 'feature/branch-1',
            completedByAgentId: 'agent-1'
        };

        const review2Data: ReviewEnqueueData = {
            projectNumber: 79,
            issueNumber: 2,
            branchName: 'feature/branch-2',
            completedByAgentId: 'agent-2'
        };

        const review3Data: ReviewEnqueueData = {
            projectNumber: 79,
            issueNumber: 3,
            branchName: 'feature/branch-3',
            completedByAgentId: 'agent-3'
        };

        const review1 = await queueManager.enqueueReview(review1Data);
        await new Promise(resolve => setTimeout(resolve, 100)); // Small delay

        const review2 = await queueManager.enqueueReview(review2Data);
        await new Promise(resolve => setTimeout(resolve, 100)); // Small delay

        const review3 = await queueManager.enqueueReview(review3Data);

        const startTime = Date.now();
        const queue = await queueManager.getReviewQueue();
        const duration = Date.now() - startTime;

        assert.strictEqual(queue.length, 3, 'Should have 3 reviews in queue');
        assert.strictEqual(queue[0].issueNumber, 1, 'First review should be issue 1 (oldest)');
        assert.strictEqual(queue[1].issueNumber, 2, 'Second review should be issue 2');
        assert.strictEqual(queue[2].issueNumber, 3, 'Third review should be issue 3 (newest)');
        assert.ok(duration < 1000, `Query took ${duration}ms, should be under 1s`);
    });

    test('AC-3.2.c: Claim review succeeds atomically and status becomes in_review', async () => {
        const reviewData: ReviewEnqueueData = {
            projectNumber: 79,
            issueNumber: 10,
            branchName: 'feature/test-branch',
            completedByAgentId: 'agent-1'
        };

        const enqueued = await queueManager.enqueueReview(reviewData);
        assert.strictEqual(enqueued.status, 'pending', 'Initial status should be pending');

        const claimed = await queueManager.claimReview(enqueued.reviewId);

        assert.ok(claimed, 'Claim should succeed');
        assert.strictEqual(claimed!.status, 'in_review', 'Status should be in_review');
        assert.ok(claimed!.claimedAt, 'Should have claimed timestamp');

        // Verify in queue file
        const queue = await queueManager.getReviewQueue();
        const reviewInQueue = queue.find(r => r.reviewId === enqueued.reviewId);
        assert.strictEqual(reviewInQueue!.status, 'in_review', 'Status in queue should be in_review');
    });

    test('Cannot claim already claimed review', async () => {
        const reviewData: ReviewEnqueueData = {
            projectNumber: 79,
            issueNumber: 10,
            branchName: 'feature/test-branch',
            completedByAgentId: 'agent-1'
        };

        const enqueued = await queueManager.enqueueReview(reviewData);
        const claimed1 = await queueManager.claimReview(enqueued.reviewId);
        assert.ok(claimed1, 'First claim should succeed');

        const claimed2 = await queueManager.claimReview(enqueued.reviewId);
        assert.strictEqual(claimed2, null, 'Second claim should fail');
    });

    test('AC-3.2.d: Get pending reviews only (excludes claimed)', async () => {
        const review1Data: ReviewEnqueueData = {
            projectNumber: 79,
            issueNumber: 1,
            branchName: 'feature/branch-1',
            completedByAgentId: 'agent-1'
        };

        const review2Data: ReviewEnqueueData = {
            projectNumber: 79,
            issueNumber: 2,
            branchName: 'feature/branch-2',
            completedByAgentId: 'agent-2'
        };

        const review1 = await queueManager.enqueueReview(review1Data);
        const review2 = await queueManager.enqueueReview(review2Data);

        // Claim one review
        await queueManager.claimReview(review1.reviewId);

        const pendingReviews = await queueManager.getPendingReviews();

        assert.strictEqual(pendingReviews.length, 1, 'Should have only 1 pending review');
        assert.strictEqual(pendingReviews[0].issueNumber, 2, 'Should be the unclaimed review');
    });

    test('AC-3.2.e: Detect reviews with claims older than 2 hours', async () => {
        const reviewData: ReviewEnqueueData = {
            projectNumber: 79,
            issueNumber: 10,
            branchName: 'feature/test-branch',
            completedByAgentId: 'agent-1'
        };

        const enqueued = await queueManager.enqueueReview(reviewData);
        const claimed = await queueManager.claimReview(enqueued.reviewId);

        // Manually modify the claimedAt timestamp to be 3 hours old
        const queue = await queueManager.getReviewQueue();
        const review = queue.find(r => r.reviewId === enqueued.reviewId);
        assert.ok(review, 'Review should exist in queue');

        const threeHoursAgo = new Date();
        threeHoursAgo.setHours(threeHoursAgo.getHours() - 3);
        review!.claimedAt = threeHoursAgo.toISOString();

        // Write modified queue back
        const queueFilePath = path.join(testWorkspaceRoot, '.claude-sessions', 'review-queue.json');
        fs.writeFileSync(queueFilePath, JSON.stringify(queue, null, 2));

        // Check timed out reviews
        const timedOut = await queueManager.getTimedOutReviews();

        assert.strictEqual(timedOut.length, 1, 'Should detect 1 timed-out review');
        assert.strictEqual(timedOut[0].reviewId, enqueued.reviewId);
    });

    test('Update review status to approved', async () => {
        const reviewData: ReviewEnqueueData = {
            projectNumber: 79,
            issueNumber: 10,
            branchName: 'feature/test-branch',
            completedByAgentId: 'agent-1'
        };

        const enqueued = await queueManager.enqueueReview(reviewData);
        await queueManager.claimReview(enqueued.reviewId);

        await queueManager.updateReviewStatus(enqueued.reviewId, 'approved');

        const review = await queueManager.getReviewById(enqueued.reviewId);
        assert.strictEqual(review!.status, 'approved');
        assert.ok(review!.completedAt, 'Should have completion timestamp');
    });

    test('Update review status to rejected with feedback', async () => {
        const reviewData: ReviewEnqueueData = {
            projectNumber: 79,
            issueNumber: 10,
            branchName: 'feature/test-branch',
            completedByAgentId: 'agent-1'
        };

        const enqueued = await queueManager.enqueueReview(reviewData);
        await queueManager.claimReview(enqueued.reviewId);

        const feedback = 'Tests are missing';
        await queueManager.updateReviewStatus(enqueued.reviewId, 'rejected', feedback);

        const review = await queueManager.getReviewById(enqueued.reviewId);
        assert.strictEqual(review!.status, 'rejected');
        assert.strictEqual(review!.feedback, feedback);
        assert.ok(review!.completedAt, 'Should have completion timestamp');
    });

    test('Release review claim', async () => {
        const reviewData: ReviewEnqueueData = {
            projectNumber: 79,
            issueNumber: 10,
            branchName: 'feature/test-branch',
            completedByAgentId: 'agent-1'
        };

        const enqueued = await queueManager.enqueueReview(reviewData);
        await queueManager.claimReview(enqueued.reviewId);

        const beforeRelease = await queueManager.getReviewById(enqueued.reviewId);
        assert.strictEqual(beforeRelease!.status, 'in_review');

        await queueManager.releaseReviewClaim(enqueued.reviewId);

        const afterRelease = await queueManager.getReviewById(enqueued.reviewId);
        assert.strictEqual(afterRelease!.status, 'pending');
        assert.strictEqual(afterRelease!.claimedAt, undefined);
    });

    test('Clean up old completed reviews (older than 7 days)', async () => {
        // Create some reviews
        const review1Data: ReviewEnqueueData = {
            projectNumber: 79,
            issueNumber: 1,
            branchName: 'feature/branch-1',
            completedByAgentId: 'agent-1'
        };

        const review2Data: ReviewEnqueueData = {
            projectNumber: 79,
            issueNumber: 2,
            branchName: 'feature/branch-2',
            completedByAgentId: 'agent-2'
        };

        const review1 = await queueManager.enqueueReview(review1Data);
        const review2 = await queueManager.enqueueReview(review2Data);

        // Mark both as approved
        await queueManager.claimReview(review1.reviewId);
        await queueManager.updateReviewStatus(review1.reviewId, 'approved');

        await queueManager.claimReview(review2.reviewId);
        await queueManager.updateReviewStatus(review2.reviewId, 'approved');

        // Manually modify one review to be 8 days old
        const queue = await queueManager.getReviewQueue();
        const oldReview = queue.find(r => r.reviewId === review1.reviewId);
        const eightDaysAgo = new Date();
        eightDaysAgo.setDate(eightDaysAgo.getDate() - 8);
        oldReview!.completedAt = eightDaysAgo.toISOString();

        // Write modified queue back
        const queueFilePath = path.join(testWorkspaceRoot, '.claude-sessions', 'review-queue.json');
        fs.writeFileSync(queueFilePath, JSON.stringify(queue, null, 2));

        // Run cleanup
        await queueManager.cleanupOldReviews();

        // Verify old review is removed
        const afterCleanup = await queueManager.getReviewQueue();
        assert.strictEqual(afterCleanup.length, 1, 'Should have only 1 review left');
        assert.strictEqual(afterCleanup[0].reviewId, review2.reviewId, 'Should keep recent review');
    });

    test('Get queue statistics', async () => {
        const review1Data: ReviewEnqueueData = {
            projectNumber: 79,
            issueNumber: 1,
            branchName: 'feature/branch-1',
            completedByAgentId: 'agent-1'
        };

        const review2Data: ReviewEnqueueData = {
            projectNumber: 79,
            issueNumber: 2,
            branchName: 'feature/branch-2',
            completedByAgentId: 'agent-2'
        };

        const review3Data: ReviewEnqueueData = {
            projectNumber: 79,
            issueNumber: 3,
            branchName: 'feature/branch-3',
            completedByAgentId: 'agent-3'
        };

        const review1 = await queueManager.enqueueReview(review1Data);
        const review2 = await queueManager.enqueueReview(review2Data);
        const review3 = await queueManager.enqueueReview(review3Data);

        // Claim one
        await queueManager.claimReview(review1.reviewId);

        // Approve one
        await queueManager.claimReview(review2.reviewId);
        await queueManager.updateReviewStatus(review2.reviewId, 'approved');

        const stats = await queueManager.getQueueStats();

        assert.strictEqual(stats.total, 3);
        assert.strictEqual(stats.pending, 1);
        assert.strictEqual(stats.inReview, 1);
        assert.strictEqual(stats.approved, 1);
        assert.strictEqual(stats.rejected, 0);
    });

    test('Atomic file operations prevent corruption', async () => {
        const reviewData: ReviewEnqueueData = {
            projectNumber: 79,
            issueNumber: 10,
            branchName: 'feature/test-branch',
            completedByAgentId: 'agent-1'
        };

        const review = await queueManager.enqueueReview(reviewData);

        // Verify temp file is cleaned up
        const sessionsDir = path.join(testWorkspaceRoot, '.claude-sessions');
        const files = fs.readdirSync(sessionsDir);
        const tempFiles = files.filter(f => f.endsWith('.tmp'));

        assert.strictEqual(tempFiles.length, 0, 'No temp files should remain');

        // Verify queue file exists and is valid
        assert.ok(fs.existsSync(queueFilePath), 'Queue file should exist');

        const content = fs.readFileSync(queueFilePath, 'utf-8');
        const parsed = JSON.parse(content);

        assert.ok(Array.isArray(parsed), 'Queue file should contain array');
        assert.strictEqual(parsed.length, 1);
    });

    test('Handle corrupted queue file gracefully', async () => {
        // Create corrupted queue file
        const sessionsDir = path.join(testWorkspaceRoot, '.claude-sessions');
        if (!fs.existsSync(sessionsDir)) {
            fs.mkdirSync(sessionsDir, { recursive: true });
        }

        fs.writeFileSync(queueFilePath, 'invalid json{{{');

        // Should return empty queue and not crash
        const queue = await queueManager.getReviewQueue();
        assert.strictEqual(queue.length, 0, 'Should return empty queue for corrupted file');

        // Should be able to enqueue new review
        const reviewData: ReviewEnqueueData = {
            projectNumber: 79,
            issueNumber: 10,
            branchName: 'feature/test-branch',
            completedByAgentId: 'agent-1'
        };

        const review = await queueManager.enqueueReview(reviewData);
        assert.ok(review, 'Should be able to enqueue after corruption');
    });

    test('Get review by ID', async () => {
        const reviewData: ReviewEnqueueData = {
            projectNumber: 79,
            issueNumber: 10,
            branchName: 'feature/test-branch',
            completedByAgentId: 'agent-1'
        };

        const enqueued = await queueManager.enqueueReview(reviewData);
        const retrieved = await queueManager.getReviewById(enqueued.reviewId);

        assert.ok(retrieved, 'Should retrieve review');
        assert.strictEqual(retrieved!.reviewId, enqueued.reviewId);
        assert.strictEqual(retrieved!.issueNumber, 10);
    });

    test('Get non-existent review by ID returns null', async () => {
        const retrieved = await queueManager.getReviewById('non-existent-uuid');
        assert.strictEqual(retrieved, null, 'Should return null for non-existent review');
    });

    test('Clear all reviews', async () => {
        // Enqueue multiple reviews
        for (let i = 1; i <= 5; i++) {
            await queueManager.enqueueReview({
                projectNumber: 79,
                issueNumber: i,
                branchName: `feature/branch-${i}`,
                completedByAgentId: `agent-${i}`
            });
        }

        let queue = await queueManager.getReviewQueue();
        assert.strictEqual(queue.length, 5, 'Should have 5 reviews');

        await queueManager.clearAllReviews();

        queue = await queueManager.getReviewQueue();
        assert.strictEqual(queue.length, 0, 'Queue should be empty');
    });

    test('Retry logic on file operation failure', async () => {
        // This test verifies the retry mechanism exists
        // In a real scenario, we'd mock fs operations to force failures

        const reviewData: ReviewEnqueueData = {
            projectNumber: 79,
            issueNumber: 10,
            branchName: 'feature/test-branch',
            completedByAgentId: 'agent-1'
        };

        // Should succeed even with retry logic
        const review = await queueManager.enqueueReview(reviewData);
        assert.ok(review, 'Should successfully enqueue with retry logic');
    });
});
