import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import { ReviewAgent, ReviewContext, ReviewResult } from '../review-agent';

suite('ReviewAgent Test Suite', () => {
    let reviewAgent: ReviewAgent;
    let testWorkspaceRoot: string;
    let sessionsDir: string;
    let reviewAgentSessionPath: string;
    let promptTemplatePath: string;

    setup(() => {
        // Create temporary test workspace
        testWorkspaceRoot = path.join(__dirname, 'test-workspace-review-agent');
        sessionsDir = path.join(testWorkspaceRoot, '.claude-sessions');
        reviewAgentSessionPath = path.join(sessionsDir, 'review-agent.session');
        promptTemplatePath = path.join(testWorkspaceRoot, 'apps/code-ext/commands/review-agent-prompt.md');

        // Clean up from previous tests
        if (fs.existsSync(testWorkspaceRoot)) {
            fs.rmSync(testWorkspaceRoot, { recursive: true, force: true });
        }

        // Create test workspace structure
        fs.mkdirSync(testWorkspaceRoot, { recursive: true });
        fs.mkdirSync(path.join(testWorkspaceRoot, 'apps/code-ext/commands'), { recursive: true });

        // Initialize review agent
        reviewAgent = new ReviewAgent(testWorkspaceRoot);
    });

    teardown(() => {
        // Clean up test workspace
        if (fs.existsSync(testWorkspaceRoot)) {
            fs.rmSync(testWorkspaceRoot, { recursive: true, force: true });
        }
    });

    // AC-3.1.a: When review agent is initialized → dedicated session file is created with `review-agent` ID
    test('AC-3.1.a: Initialize review agent creates session file with review-agent ID', async () => {
        // Act
        await reviewAgent.initializeReviewAgent();

        // Assert
        assert.strictEqual(fs.existsSync(reviewAgentSessionPath), true, 'Session file should exist');

        const content = fs.readFileSync(reviewAgentSessionPath, 'utf-8');
        const session = JSON.parse(content);

        assert.strictEqual(session.agentId, 'review-agent', 'Agent ID should be review-agent');
        assert.strictEqual(session.status, 'idle', 'Initial status should be idle');
        assert.strictEqual(session.currentProjectNumber, null);
        assert.strictEqual(session.tasksCompleted, 0);
        assert.strictEqual(session.errorCount, 0);
    });

    test('AC-3.1.a: Get review agent status returns session data', async () => {
        // Arrange
        await reviewAgent.initializeReviewAgent();

        // Act
        const status = reviewAgent.getReviewAgentStatus();

        // Assert
        assert.notStrictEqual(status, null, 'Status should not be null');
        assert.strictEqual(status?.agentId, 'review-agent');
        assert.strictEqual(status?.status, 'idle');
    });

    test('AC-3.1.a: Get review agent status returns null when not initialized', () => {
        // Act
        const status = reviewAgent.getReviewAgentStatus();

        // Assert
        assert.strictEqual(status, null, 'Status should be null when not initialized');
    });

    test('AC-3.1.a: Update review agent status changes status field', async () => {
        // Arrange
        await reviewAgent.initializeReviewAgent();

        // Act
        await reviewAgent.updateReviewAgentStatus('reviewing', {
            currentProjectNumber: 79,
            currentTaskDescription: 'Reviewing work item 3.1'
        });

        // Assert
        const status = reviewAgent.getReviewAgentStatus();
        assert.strictEqual(status?.status, 'reviewing');
        assert.strictEqual(status?.currentProjectNumber, 79);
        assert.strictEqual(status?.currentTaskDescription, 'Reviewing work item 3.1');
    });

    // AC-3.1.b: When review task begins → prompt template is loaded from file within 1 second
    test('AC-3.1.b: Load prompt template from file within 1 second', async () => {
        // Arrange
        const templateContent = '# Review Agent Template\nProject: {{projectNumber}}';
        fs.writeFileSync(promptTemplatePath, templateContent, 'utf-8');

        // Act
        const startTime = Date.now();
        const template = await reviewAgent.loadReviewPromptTemplate();
        const loadTime = Date.now() - startTime;

        // Assert
        assert.strictEqual(template, templateContent, 'Template content should match file');
        assert.ok(loadTime < 1000, `Load time ${loadTime}ms should be less than 1 second`);
    });

    test('AC-3.1.b: Load prompt template uses cache on subsequent calls', async () => {
        // Arrange
        const templateContent = '# Review Agent Template\nProject: {{projectNumber}}';
        fs.writeFileSync(promptTemplatePath, templateContent, 'utf-8');

        // Act
        const template1 = await reviewAgent.loadReviewPromptTemplate();
        const startTime = Date.now();
        const template2 = await reviewAgent.loadReviewPromptTemplate();
        const loadTime = Date.now() - startTime;

        // Assert
        assert.strictEqual(template1, template2, 'Templates should match');
        assert.ok(loadTime < 10, `Cached load time ${loadTime}ms should be very fast`);
    });

    // AC-3.1.c: When prompt template is missing → fallback inline prompt is used and warning is logged
    test('AC-3.1.c: Load prompt template uses fallback when file missing', async () => {
        // Arrange - no template file created

        // Act
        const template = await reviewAgent.loadReviewPromptTemplate();

        // Assert
        assert.ok(template.includes('Review Agent'), 'Fallback should include review agent header');
        assert.ok(template.includes('{{projectNumber}}'), 'Fallback should include projectNumber variable');
        assert.ok(template.includes('{{acceptanceCriteria}}'), 'Fallback should include acceptanceCriteria variable');
        assert.ok(template.includes('APPROVED | REJECTED'), 'Fallback should include status options');
    });

    test('AC-3.1.c: Load prompt template uses fallback when file has read error', async () => {
        // Arrange - create directory instead of file (will cause read error)
        fs.mkdirSync(promptTemplatePath, { recursive: true });

        // Act
        const template = await reviewAgent.loadReviewPromptTemplate();

        // Assert
        assert.ok(template.includes('Review Agent'), 'Fallback should be used on read error');
        assert.ok(template.length > 0, 'Fallback should not be empty');
    });

    // AC-3.1.d: When review is executed → prompt includes full issue context, acceptance criteria, and file list
    test('AC-3.1.d: Generate review prompt includes full context', async () => {
        // Arrange
        const templateContent = `# Review
Project: {{projectNumber}}
Issue: {{issueNumber}} - {{issueTitle}}
Branch: {{branchName}}

## Description
{{issueBody}}

## Acceptance Criteria
{{acceptanceCriteria}}

## Files Changed
{{fileList}}`;
        fs.writeFileSync(promptTemplatePath, templateContent, 'utf-8');

        const context: ReviewContext = {
            projectNumber: 79,
            issueNumber: 45,
            issueTitle: 'Implement review agent',
            issueBody: 'Create dedicated review agent for quality validation',
            branchName: 'feature/review-agent',
            fileList: ['src/review-agent.ts', 'src/test/review-agent.test.ts'],
            acceptanceCriteria: [
                'Session file is created with review-agent ID',
                'Prompt template loads within 1 second',
                'Response parser extracts status correctly'
            ]
        };

        // Act
        const prompt = await reviewAgent.generateReviewPrompt(context);

        // Assert
        assert.ok(prompt.includes('Project: 79'), 'Should include project number');
        assert.ok(prompt.includes('Issue: 45 - Implement review agent'), 'Should include issue title');
        assert.ok(prompt.includes('Branch: feature/review-agent'), 'Should include branch name');
        assert.ok(prompt.includes('Create dedicated review agent'), 'Should include issue body');
        assert.ok(prompt.includes('1. Session file is created'), 'Should include numbered criteria');
        assert.ok(prompt.includes('2. Prompt template loads'), 'Should include all criteria');
        assert.ok(prompt.includes('- src/review-agent.ts'), 'Should include file list');
        assert.ok(prompt.includes('- src/test/review-agent.test.ts'), 'Should include all files');
    });

    test('AC-3.1.d: Generate review prompt handles empty acceptance criteria', async () => {
        // Arrange
        const templateContent = 'Criteria: {{acceptanceCriteria}}';
        fs.writeFileSync(promptTemplatePath, templateContent, 'utf-8');

        const context: ReviewContext = {
            projectNumber: 79,
            issueNumber: 45,
            issueTitle: 'Test',
            issueBody: 'Test body',
            branchName: 'test-branch',
            fileList: [],
            acceptanceCriteria: []
        };

        // Act
        const prompt = await reviewAgent.generateReviewPrompt(context);

        // Assert
        assert.ok(prompt.includes('Criteria:'), 'Should still include criteria header');
    });

    // AC-3.1.e: When review agent response is parsed → status and criteria checklist are extracted correctly
    test('AC-3.1.e: Parse APPROVED review response', () => {
        // Arrange
        const response = `
**Status:** APPROVED

**Acceptance Criteria Review:**
- [x] AC-3.1.a: Session file created - Met (evidence: verified in test)
- [x] AC-3.1.b: Prompt loads fast - Met (evidence: <100ms load time)

**Code Quality Review:**
- Tests: PASS (15 unit tests, 95% coverage)
- Linting: PASS (no compilation errors)
- Documentation: PASS (all functions documented)

**Summary:**
Work item complete and meets all requirements.

**Feedback for Execution Agent:**
N/A - Work approved.
`;

        // Act
        const result = reviewAgent.parseReviewResponse(response);

        // Assert
        assert.strictEqual(result.status, 'APPROVED', 'Status should be APPROVED');
        assert.strictEqual(result.criteriaResults.length, 2, 'Should extract 2 criteria');
        assert.strictEqual(result.criteriaResults[0].met, true, 'First criterion should be met');
        assert.strictEqual(result.criteriaResults[0].evidence, 'verified in test');
        assert.strictEqual(result.criteriaResults[1].met, true, 'Second criterion should be met');
        assert.strictEqual(result.qualityResults.tests, true, 'Tests should pass');
        assert.strictEqual(result.qualityResults.linting, true, 'Linting should pass');
        assert.strictEqual(result.qualityResults.documentation, true, 'Documentation should pass');
        assert.ok(result.summary?.includes('complete'), 'Should include summary');
    });

    test('AC-3.1.e: Parse REJECTED review response', () => {
        // Arrange
        const response = `
**Status:** REJECTED

**Acceptance Criteria Review:**
- [x] AC-3.1.a: Session file created - Met (evidence: verified)
- [ ] AC-3.1.b: Prompt loads fast - Not met (reason: takes 2 seconds)
- [ ] AC-3.1.e: Parser works - Not met (reason: missing regex for status)

**Code Quality Review:**
- Tests: FAIL (missing edge case tests)
- Linting: PASS
- Documentation: FAIL (no JSDoc on parseResponse)

**Summary:**
Work incomplete, missing critical functionality.

**Feedback for Execution Agent:**
Please add tests for edge cases and optimize prompt loading to under 1 second.
`;

        // Act
        const result = reviewAgent.parseReviewResponse(response);

        // Assert
        assert.strictEqual(result.status, 'REJECTED', 'Status should be REJECTED');
        assert.strictEqual(result.criteriaResults.length, 3, 'Should extract 3 criteria');
        assert.strictEqual(result.criteriaResults[0].met, true, 'First criterion should be met');
        assert.strictEqual(result.criteriaResults[1].met, false, 'Second criterion should not be met');
        assert.strictEqual(result.criteriaResults[1].reason, 'takes 2 seconds');
        assert.strictEqual(result.criteriaResults[2].met, false, 'Third criterion should not be met');
        assert.strictEqual(result.qualityResults.tests, false, 'Tests should fail');
        assert.strictEqual(result.qualityResults.linting, true, 'Linting should pass');
        assert.strictEqual(result.qualityResults.documentation, false, 'Documentation should fail');
        assert.ok(result.feedback?.includes('edge cases'), 'Should include feedback');
    });

    test('AC-3.1.e: Parse review response with quality explanations', () => {
        // Arrange
        const response = `
**Status:** REJECTED

**Acceptance Criteria Review:**
- [ ] AC-1: Not met (reason: incomplete)

**Code Quality Review:**
- Tests: FAIL (missing tests for parseReviewResponse function)
- Linting: PASS (all TypeScript checks passed)
- Documentation: FAIL (missing JSDoc comments on public methods)

**Summary:**
Needs work.
`;

        // Act
        const result = reviewAgent.parseReviewResponse(response);

        // Assert
        assert.strictEqual(result.qualityResults.testsExplanation, 'missing tests for parseReviewResponse function');
        assert.strictEqual(result.qualityResults.lintingExplanation, 'all TypeScript checks passed');
        assert.strictEqual(result.qualityResults.documentationExplanation, 'missing JSDoc comments on public methods');
    });

    test('AC-3.1.e: Parse review response handles missing sections gracefully', () => {
        // Arrange
        const response = `
**Status:** APPROVED
Some other text without proper sections.
`;

        // Act
        const result = reviewAgent.parseReviewResponse(response);

        // Assert
        assert.strictEqual(result.status, 'APPROVED', 'Should extract status');
        assert.strictEqual(result.criteriaResults.length, 0, 'Should handle missing criteria section');
        assert.strictEqual(result.qualityResults.tests, false, 'Should default to false');
        assert.strictEqual(result.qualityResults.linting, false, 'Should default to false');
        assert.strictEqual(result.qualityResults.documentation, false, 'Should default to false');
    });

    test('AC-3.1.e: Parse review response defaults to REJECTED if status not found', () => {
        // Arrange
        const response = 'Some response without a status field';

        // Act
        const result = reviewAgent.parseReviewResponse(response);

        // Assert
        assert.strictEqual(result.status, 'REJECTED', 'Should default to REJECTED for safety');
    });

    test('AC-3.1.e: Parse review response handles criteria without AC- prefix', () => {
        // Arrange
        const response = `
**Status:** APPROVED

**Acceptance Criteria Review:**
- [x] Feature works correctly - Met (evidence: tested manually)
- [ ] Tests are comprehensive - Not met (reason: only 50% coverage)
`;

        // Act
        const result = reviewAgent.parseReviewResponse(response);

        // Assert
        assert.strictEqual(result.criteriaResults.length, 2, 'Should extract criteria without AC- prefix');
        assert.strictEqual(result.criteriaResults[0].criterion, 'Feature works correctly');
        assert.strictEqual(result.criteriaResults[0].met, true);
        assert.strictEqual(result.criteriaResults[1].criterion, 'Tests are comprehensive');
        assert.strictEqual(result.criteriaResults[1].met, false);
    });

    test('Clear template cache resets cached template', async () => {
        // Arrange
        const templateContent = '# Original Template';
        fs.writeFileSync(promptTemplatePath, templateContent, 'utf-8');
        await reviewAgent.loadReviewPromptTemplate();

        // Update file
        fs.writeFileSync(promptTemplatePath, '# Updated Template', 'utf-8');

        // Act - should still return cached version
        const cached = await reviewAgent.loadReviewPromptTemplate();
        assert.strictEqual(cached, '# Original Template', 'Should use cached version');

        // Clear cache and reload
        reviewAgent.clearTemplateCache();
        const updated = await reviewAgent.loadReviewPromptTemplate();

        // Assert
        assert.strictEqual(updated, '# Updated Template', 'Should load updated template after cache clear');
    });

    test('Integration: Full review workflow', async () => {
        // Arrange
        const templateContent = `Project {{projectNumber}}, Issue {{issueNumber}}: {{issueTitle}}
Criteria: {{acceptanceCriteria}}
Files: {{fileList}}`;
        fs.writeFileSync(promptTemplatePath, templateContent, 'utf-8');

        await reviewAgent.initializeReviewAgent();

        const context: ReviewContext = {
            projectNumber: 79,
            issueNumber: 45,
            issueTitle: 'Review agent implementation',
            issueBody: 'Full description here',
            branchName: 'feature/review',
            fileList: ['src/review-agent.ts'],
            acceptanceCriteria: ['All tests pass', 'Code is documented']
        };

        // Act
        await reviewAgent.updateReviewAgentStatus('reviewing');
        const prompt = await reviewAgent.generateReviewPrompt(context);

        const mockResponse = `
**Status:** APPROVED

**Acceptance Criteria Review:**
- [x] All tests pass - Met (evidence: npm test passed)
- [x] Code is documented - Met (evidence: JSDoc on all functions)

**Code Quality Review:**
- Tests: PASS
- Linting: PASS
- Documentation: PASS

**Summary:** All criteria met.
`;

        const result = reviewAgent.parseReviewResponse(mockResponse);
        await reviewAgent.updateReviewAgentStatus('idle');

        // Assert
        assert.ok(prompt.includes('Project 79, Issue 45'), 'Prompt should be generated');
        assert.ok(prompt.includes('All tests pass'), 'Prompt should include criteria');
        assert.strictEqual(result.status, 'APPROVED', 'Result should be approved');
        assert.strictEqual(result.criteriaResults.length, 2, 'Should have 2 criteria results');

        const finalStatus = reviewAgent.getReviewAgentStatus();
        assert.strictEqual(finalStatus?.status, 'idle', 'Should be back to idle');
    });
});
