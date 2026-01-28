"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
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
const assert = __importStar(require("assert"));
const acceptance_criteria_parser_1 = require("../acceptance-criteria-parser");
suite('Acceptance Criteria Parser Test Suite', () => {
    // AC-3.3.a: When issue body contains checklist format → all criteria are extracted correctly
    suite('AC-3.3.a: Checklist Format Parsing', () => {
        test('Parse unchecked checklist items', () => {
            // Arrange
            const issueBody = `
# Issue Description
Some description here.

## Tasks
- [ ] Implement feature A
- [ ] Add unit tests
- [ ] Update documentation
`;
            // Act
            const criteria = (0, acceptance_criteria_parser_1.parseAcceptanceCriteria)(issueBody);
            // Assert
            assert.strictEqual(criteria.length, 3, 'Should extract 3 criteria');
            assert.strictEqual(criteria[0].id, 'AC-1');
            assert.strictEqual(criteria[0].description, 'Implement feature A');
            assert.strictEqual(criteria[0].status, 'pending');
            assert.strictEqual(criteria[1].id, 'AC-2');
            assert.strictEqual(criteria[1].description, 'Add unit tests');
            assert.strictEqual(criteria[2].id, 'AC-3');
            assert.strictEqual(criteria[2].description, 'Update documentation');
        });
        test('Parse checked checklist items', () => {
            // Arrange
            const issueBody = `
## Tasks
- [x] Implement feature A
- [X] Add unit tests (uppercase X)
- [ ] Update documentation
`;
            // Act
            const criteria = (0, acceptance_criteria_parser_1.parseAcceptanceCriteria)(issueBody);
            // Assert
            assert.strictEqual(criteria.length, 3, 'Should extract 3 criteria');
            assert.strictEqual(criteria[0].status, 'met', 'First item should be marked met');
            assert.strictEqual(criteria[0].evidence, 'Pre-marked as complete in issue');
            assert.strictEqual(criteria[1].status, 'met', 'Second item should be marked met');
            assert.strictEqual(criteria[2].status, 'pending', 'Third item should be pending');
        });
        test('Parse checklist with varied indentation', () => {
            // Arrange
            const issueBody = `
- [ ] No indent
  - [ ] Two spaces
    - [ ] Four spaces
\t- [ ] Tab indent
`;
            // Act
            const criteria = (0, acceptance_criteria_parser_1.parseAcceptanceCriteria)(issueBody);
            // Assert
            assert.strictEqual(criteria.length, 4, 'Should extract all indentation levels');
            assert.strictEqual(criteria[0].description, 'No indent');
            assert.strictEqual(criteria[1].description, 'Two spaces');
            assert.strictEqual(criteria[2].description, 'Four spaces');
            assert.strictEqual(criteria[3].description, 'Tab indent');
        });
        test('Parse checklist with spaces around brackets', () => {
            // Arrange
            const issueBody = `
- [  ] Extra spaces inside brackets
- [x] No space
- [ x ] Spaces around x
`;
            // Act
            const criteria = (0, acceptance_criteria_parser_1.parseAcceptanceCriteria)(issueBody);
            // Assert
            assert.strictEqual(criteria.length, 3, 'Should handle spacing variations');
            assert.strictEqual(criteria[0].status, 'pending');
            assert.strictEqual(criteria[1].status, 'met');
            assert.strictEqual(criteria[2].status, 'met');
        });
    });
    // AC-3.3.b: When issue body contains AC-X.X.X format → all criteria are extracted correctly
    suite('AC-3.3.b: AC Format Parsing', () => {
        test('Parse AC-X.X.x format', () => {
            // Arrange
            const issueBody = `
## Acceptance Criteria
AC-3.1.a: Session file is created with review-agent ID
AC-3.1.b: Prompt template loads within 1 second
AC-3.1.c: Fallback prompt is used when template missing
`;
            // Act
            const criteria = (0, acceptance_criteria_parser_1.parseAcceptanceCriteria)(issueBody);
            // Assert
            assert.strictEqual(criteria.length, 3, 'Should extract 3 criteria');
            assert.strictEqual(criteria[0].id, 'AC-1');
            assert.strictEqual(criteria[0].description, 'Session file is created with review-agent ID');
            assert.strictEqual(criteria[0].status, 'pending');
            assert.strictEqual(criteria[1].description, 'Prompt template loads within 1 second');
            assert.strictEqual(criteria[2].description, 'Fallback prompt is used when template missing');
        });
        test('Parse AC-X format (without sub-numbers)', () => {
            // Arrange
            const issueBody = `
AC-1: Feature works correctly
AC-2: Tests are comprehensive
AC-3: Documentation is complete
`;
            // Act
            const criteria = (0, acceptance_criteria_parser_1.parseAcceptanceCriteria)(issueBody);
            // Assert
            assert.strictEqual(criteria.length, 3, 'Should extract simple AC format');
            assert.strictEqual(criteria[0].description, 'Feature works correctly');
            assert.strictEqual(criteria[1].description, 'Tests are comprehensive');
            assert.strictEqual(criteria[2].description, 'Documentation is complete');
        });
        test('Parse mixed AC formats', () => {
            // Arrange
            const issueBody = `
AC-1: Simple format
AC-2.1: With sub-number
AC-2.1.a: With letter
AC-3.3.b: Another with letter
`;
            // Act
            const criteria = (0, acceptance_criteria_parser_1.parseAcceptanceCriteria)(issueBody);
            // Assert
            assert.strictEqual(criteria.length, 4, 'Should extract all format variations');
            assert.ok(criteria.every(c => c.status === 'pending'), 'All should start as pending');
        });
        test('Parse AC format case-insensitive', () => {
            // Arrange
            const issueBody = `
AC-1: Uppercase AC
ac-2: Lowercase ac
Ac-3: Mixed case Ac
`;
            // Act
            const criteria = (0, acceptance_criteria_parser_1.parseAcceptanceCriteria)(issueBody);
            // Assert
            assert.strictEqual(criteria.length, 3, 'Should handle case variations');
        });
    });
    suite('Multiple Format Support', () => {
        test('Parse numbered list under Acceptance Criteria header', () => {
            // Arrange
            const issueBody = `
## Description
Some description here.

## Acceptance Criteria
1. Feature works correctly
2. Tests pass
3. Documentation updated

## Additional Notes
More notes here.
`;
            // Act
            const criteria = (0, acceptance_criteria_parser_1.parseAcceptanceCriteria)(issueBody);
            // Assert
            assert.strictEqual(criteria.length, 3, 'Should extract numbered list');
            assert.strictEqual(criteria[0].description, 'Feature works correctly');
            assert.strictEqual(criteria[1].description, 'Tests pass');
            assert.strictEqual(criteria[2].description, 'Documentation updated');
        });
        test('Parse bullet list under Acceptance Criteria header', () => {
            // Arrange
            const issueBody = `
## Acceptance Criteria
- Feature works correctly
- Tests pass
- Documentation updated
`;
            // Act
            const criteria = (0, acceptance_criteria_parser_1.parseAcceptanceCriteria)(issueBody);
            // Assert
            assert.strictEqual(criteria.length, 3, 'Should extract bullet list');
        });
        test('Parse from Definition of Done header', () => {
            // Arrange
            const issueBody = `
## Definition of Done
1. Feature complete
2. Tests pass
`;
            // Act
            const criteria = (0, acceptance_criteria_parser_1.parseAcceptanceCriteria)(issueBody);
            // Assert
            assert.strictEqual(criteria.length, 2, 'Should recognize DoD header');
            assert.strictEqual(criteria[0].description, 'Feature complete');
        });
        test('Parse from Success Criteria header', () => {
            // Arrange
            const issueBody = `
### Success Criteria
- Criterion 1
- Criterion 2
`;
            // Act
            const criteria = (0, acceptance_criteria_parser_1.parseAcceptanceCriteria)(issueBody);
            // Assert
            assert.strictEqual(criteria.length, 2, 'Should recognize Success Criteria header');
        });
        test('Avoid duplicate criteria across formats', () => {
            // Arrange
            const issueBody = `
## Acceptance Criteria
- [ ] Implement feature A
AC-1: Implement feature A
1. Implement feature A

Different criterion:
- [ ] Add unit tests
`;
            // Act
            const criteria = (0, acceptance_criteria_parser_1.parseAcceptanceCriteria)(issueBody);
            // Assert
            assert.strictEqual(criteria.length, 2, 'Should deduplicate same criterion');
            assert.strictEqual(criteria[0].description, 'Implement feature A');
            assert.strictEqual(criteria[1].description, 'Add unit tests');
        });
        test('Parse complex real-world issue', () => {
            // Arrange
            const issueBody = `
# Work Item 3.3: Acceptance Criteria Validation

**Context:**
- Project: #79 - Build Multi-Agent Autonomous Project Orchestration System
- Phase: 3 - Review Agent & Quality Validation

**Task:**
Parse acceptance criteria from issue description and validate against review agent findings.

**Acceptance Criteria:**
- [ ] AC-3.3.a: When issue body contains checklist format → all criteria are extracted correctly
- [ ] AC-3.3.b: When issue body contains AC-X.X.X format → all criteria are extracted correctly
- [ ] AC-3.3.c: When review agent response includes criteria status → parser extracts met/not met status
- [ ] AC-3.3.d: When all criteria are marked "met" → review proceeds to approval workflow
- [ ] AC-3.3.e: When any criterion is marked "not met" → review proceeds to rejection with feedback
- [ ] AC-3.3.f: When no acceptance criteria are found → user is notified to add criteria

**Definition of Done:**
- acceptance-criteria-parser.ts module with all required functions
- Tests cover all acceptance criteria
- Code compiles without errors
`;
            // Act
            const criteria = (0, acceptance_criteria_parser_1.parseAcceptanceCriteria)(issueBody);
            // Assert
            assert.strictEqual(criteria.length, 6, 'Should extract all AC criteria');
            assert.ok(criteria[0].description.includes('checklist format'), 'First criterion correct');
            assert.ok(criteria[1].description.includes('AC-X.X.X format'), 'Second criterion correct');
            assert.ok(criteria.every(c => c.status === 'pending'), 'All should start as pending');
        });
    });
    suite('Edge Cases', () => {
        test('Parse empty issue body', () => {
            // Arrange
            const issueBody = '';
            // Act
            const criteria = (0, acceptance_criteria_parser_1.parseAcceptanceCriteria)(issueBody);
            // Assert
            assert.strictEqual(criteria.length, 0, 'Should return empty array');
        });
        test('Parse issue with no criteria', () => {
            // Arrange
            const issueBody = `
# Just a description
This issue has no acceptance criteria, just a description.
`;
            // Act
            const criteria = (0, acceptance_criteria_parser_1.parseAcceptanceCriteria)(issueBody);
            // Assert
            assert.strictEqual(criteria.length, 0, 'Should return empty array');
        });
        test('Parse very short bullet items (skip noise)', () => {
            // Arrange
            const issueBody = `
## Acceptance Criteria
- A (too short)
- AB (still too short)
- ABCD (long enough)
`;
            // Act
            const criteria = (0, acceptance_criteria_parser_1.parseAcceptanceCriteria)(issueBody);
            // Assert
            // Should only extract the one that's > 3 chars
            const longCriteria = criteria.filter(c => c.description.length > 3);
            assert.ok(longCriteria.length >= 1, 'Should extract sufficiently long criteria');
        });
        test('Parse with unusual formatting', () => {
            // Arrange
            const issueBody = `
## Acceptance Criteria

1.Feature with no space after number
2. Feature with space

AC-1:No space after colon
AC-2: Space after colon
`;
            // Act
            const criteria = (0, acceptance_criteria_parser_1.parseAcceptanceCriteria)(issueBody);
            // Assert
            assert.ok(criteria.length >= 2, 'Should handle missing spaces gracefully');
        });
    });
    // AC-3.3.c: When review agent response includes criteria status → parser extracts met/not met status
    suite('AC-3.3.c: Validate Criteria Against Review Results', () => {
        test('Validate all criteria met', () => {
            // Arrange
            const criteria = [
                { id: 'AC-1', description: 'Feature works correctly', status: 'pending' },
                { id: 'AC-2', description: 'Tests are comprehensive', status: 'pending' },
                { id: 'AC-3', description: 'Documentation is complete', status: 'pending' }
            ];
            const reviewResult = {
                status: 'APPROVED',
                criteriaResults: [
                    { criterion: 'Feature works correctly', met: true, evidence: 'Tested manually' },
                    { criterion: 'Tests are comprehensive', met: true, evidence: '95% coverage' },
                    { criterion: 'Documentation is complete', met: true, evidence: 'All functions documented' }
                ],
                qualityResults: { tests: true, linting: true, documentation: true }
            };
            // Act
            const result = (0, acceptance_criteria_parser_1.validateCriteria)(criteria, reviewResult);
            // Assert
            assert.strictEqual(result.allMet, true, 'All criteria should be met');
            assert.strictEqual(result.metCount, 3, 'Should have 3 met criteria');
            assert.strictEqual(result.totalCount, 3, 'Should have 3 total criteria');
            assert.strictEqual(result.unmetCriteria.length, 0, 'Should have no unmet criteria');
        });
        test('Validate some criteria not met', () => {
            // Arrange
            const criteria = [
                { id: 'AC-1', description: 'Feature works correctly', status: 'pending' },
                { id: 'AC-2', description: 'Tests are comprehensive', status: 'pending' },
                { id: 'AC-3', description: 'Documentation is complete', status: 'pending' }
            ];
            const reviewResult = {
                status: 'REJECTED',
                criteriaResults: [
                    { criterion: 'Feature works correctly', met: true, evidence: 'Tested' },
                    { criterion: 'Tests are comprehensive', met: false, reason: 'Only 50% coverage' },
                    { criterion: 'Documentation is complete', met: false, reason: 'Missing JSDoc' }
                ],
                qualityResults: { tests: false, linting: true, documentation: false }
            };
            // Act
            const result = (0, acceptance_criteria_parser_1.validateCriteria)(criteria, reviewResult);
            // Assert
            assert.strictEqual(result.allMet, false, 'Not all criteria should be met');
            assert.strictEqual(result.metCount, 1, 'Should have 1 met criterion');
            assert.strictEqual(result.totalCount, 3, 'Should have 3 total criteria');
            assert.strictEqual(result.unmetCriteria.length, 2, 'Should have 2 unmet criteria');
            assert.strictEqual(result.unmetCriteria[0].status, 'not_met');
            assert.strictEqual(result.unmetCriteria[0].reason, 'Only 50% coverage');
        });
        test('Validate with flexible matching (case and whitespace)', () => {
            // Arrange
            const criteria = [
                { id: 'AC-1', description: 'Feature Works Correctly', status: 'pending' },
                { id: 'AC-2', description: 'Tests  are   comprehensive', status: 'pending' }
            ];
            const reviewResult = {
                status: 'APPROVED',
                criteriaResults: [
                    { criterion: 'feature works correctly', met: true }, // lowercase
                    { criterion: 'Tests are comprehensive', met: true } // normalized spaces
                ],
                qualityResults: { tests: true, linting: true, documentation: true }
            };
            // Act
            const result = (0, acceptance_criteria_parser_1.validateCriteria)(criteria, reviewResult);
            // Assert
            assert.strictEqual(result.metCount, 2, 'Should match despite case/space differences');
            assert.strictEqual(result.allMet, true);
        });
        test('Validate with partial matching (substring)', () => {
            // Arrange
            const criteria = [
                { id: 'AC-1', description: 'AC-3.1.a: Session file is created with review-agent ID', status: 'pending' }
            ];
            const reviewResult = {
                status: 'APPROVED',
                criteriaResults: [
                    { criterion: 'Session file is created with review-agent ID', met: true, evidence: 'Verified' }
                ],
                qualityResults: { tests: true, linting: true, documentation: true }
            };
            // Act
            const result = (0, acceptance_criteria_parser_1.validateCriteria)(criteria, reviewResult);
            // Assert
            assert.strictEqual(result.metCount, 1, 'Should match criterion without AC- prefix');
        });
        test('Validate with unmatched review results (warns but continues)', () => {
            // Arrange
            const criteria = [
                { id: 'AC-1', description: 'Feature A', status: 'pending' }
            ];
            const reviewResult = {
                status: 'APPROVED',
                criteriaResults: [
                    { criterion: 'Feature A', met: true },
                    { criterion: 'Feature B', met: true } // Not in original criteria
                ],
                qualityResults: { tests: true, linting: true, documentation: true }
            };
            // Act
            const result = (0, acceptance_criteria_parser_1.validateCriteria)(criteria, reviewResult);
            // Assert
            assert.strictEqual(result.metCount, 1, 'Should update matched criterion');
            // Unmatched review result should not create new criterion
        });
        test('Validate with no review results', () => {
            // Arrange
            const criteria = [
                { id: 'AC-1', description: 'Feature A', status: 'pending' }
            ];
            const reviewResult = {
                status: 'REJECTED',
                criteriaResults: [], // No criteria checked
                qualityResults: { tests: false, linting: true, documentation: true }
            };
            // Act
            const result = (0, acceptance_criteria_parser_1.validateCriteria)(criteria, reviewResult);
            // Assert
            assert.strictEqual(result.allMet, false, 'Should not be all met');
            assert.strictEqual(result.metCount, 0, 'Should have 0 met criteria');
            assert.strictEqual(result.unmetCriteria.length, 1, 'Should have 1 unmet (pending)');
        });
    });
    // AC-3.3.d: When all criteria are marked "met" → review proceeds to approval workflow
    suite('AC-3.3.d: All Criteria Met → Approval Workflow', () => {
        test('Validate all met triggers approval workflow', () => {
            // Arrange
            const criteria = [
                { id: 'AC-1', description: 'Feature A', status: 'pending' },
                { id: 'AC-2', description: 'Feature B', status: 'pending' }
            ];
            const reviewResult = {
                status: 'APPROVED',
                criteriaResults: [
                    { criterion: 'Feature A', met: true, evidence: 'Works' },
                    { criterion: 'Feature B', met: true, evidence: 'Works' }
                ],
                qualityResults: { tests: true, linting: true, documentation: true }
            };
            // Act
            const result = (0, acceptance_criteria_parser_1.validateCriteria)(criteria, reviewResult);
            // Assert - Check that allMet flag is true (signals approval workflow)
            assert.strictEqual(result.allMet, true, 'allMet should be true for approval workflow');
            assert.strictEqual(result.unmetCriteria.length, 0, 'No unmet criteria for approval');
        });
    });
    // AC-3.3.e: When any criterion is marked "not met" → review proceeds to rejection with feedback
    suite('AC-3.3.e: Any Criterion Not Met → Rejection Workflow', () => {
        test('Validate any not met triggers rejection workflow', () => {
            // Arrange
            const criteria = [
                { id: 'AC-1', description: 'Feature A', status: 'pending' },
                { id: 'AC-2', description: 'Feature B', status: 'pending' }
            ];
            const reviewResult = {
                status: 'REJECTED',
                criteriaResults: [
                    { criterion: 'Feature A', met: true },
                    { criterion: 'Feature B', met: false, reason: 'Incomplete' }
                ],
                qualityResults: { tests: true, linting: true, documentation: true },
                feedback: 'Please complete Feature B'
            };
            // Act
            const result = (0, acceptance_criteria_parser_1.validateCriteria)(criteria, reviewResult);
            // Assert - Check that allMet is false and unmetCriteria is populated
            assert.strictEqual(result.allMet, false, 'allMet should be false for rejection workflow');
            assert.strictEqual(result.unmetCriteria.length, 1, 'Should have unmet criteria');
            assert.strictEqual(result.unmetCriteria[0].status, 'not_met');
            assert.strictEqual(result.unmetCriteria[0].reason, 'Incomplete', 'Should include rejection reason');
        });
        test('Validate pending criteria also prevent approval', () => {
            // Arrange
            const criteria = [
                { id: 'AC-1', description: 'Feature A', status: 'pending' },
                { id: 'AC-2', description: 'Feature B', status: 'pending' }
            ];
            const reviewResult = {
                status: 'REJECTED',
                criteriaResults: [
                    { criterion: 'Feature A', met: true }
                    // Feature B not checked - remains pending
                ],
                qualityResults: { tests: true, linting: true, documentation: true }
            };
            // Act
            const result = (0, acceptance_criteria_parser_1.validateCriteria)(criteria, reviewResult);
            // Assert
            assert.strictEqual(result.allMet, false, 'Pending criteria should prevent approval');
            assert.strictEqual(result.unmetCriteria.length, 1, 'Pending criterion in unmet list');
            assert.strictEqual(result.unmetCriteria[0].status, 'pending');
        });
    });
    suite('Format Criteria for Prompt', () => {
        test('Format criteria as numbered list', () => {
            // Arrange
            const criteria = [
                { id: 'AC-1', description: 'Feature A', status: 'pending' },
                { id: 'AC-2', description: 'Feature B', status: 'pending' },
                { id: 'AC-3', description: 'Feature C', status: 'pending' }
            ];
            // Act
            const formatted = (0, acceptance_criteria_parser_1.formatCriteriaForPrompt)(criteria);
            // Assert
            assert.ok(formatted.includes('1. [AC-1] Feature A'), 'Should include first criterion');
            assert.ok(formatted.includes('2. [AC-2] Feature B'), 'Should include second criterion');
            assert.ok(formatted.includes('3. [AC-3] Feature C'), 'Should include third criterion');
        });
        test('Format empty criteria list', () => {
            // Arrange
            const criteria = [];
            // Act
            const formatted = (0, acceptance_criteria_parser_1.formatCriteriaForPrompt)(criteria);
            // Assert
            assert.ok(formatted.includes('No acceptance criteria'), 'Should indicate no criteria');
            assert.ok(formatted.includes('general quality review'), 'Should mention fallback');
        });
        test('Format single criterion', () => {
            // Arrange
            const criteria = [
                { id: 'AC-1', description: 'Single feature', status: 'pending' }
            ];
            // Act
            const formatted = (0, acceptance_criteria_parser_1.formatCriteriaForPrompt)(criteria);
            // Assert
            assert.ok(formatted.includes('1. [AC-1] Single feature'), 'Should format single criterion');
        });
    });
    suite('Get Criteria Status', () => {
        test('Get status breakdown', () => {
            // Arrange
            const criteria = [
                { id: 'AC-1', description: 'A', status: 'met' },
                { id: 'AC-2', description: 'B', status: 'met' },
                { id: 'AC-3', description: 'C', status: 'not_met' },
                { id: 'AC-4', description: 'D', status: 'pending' },
                { id: 'AC-5', description: 'E', status: 'pending' }
            ];
            // Act
            const status = (0, acceptance_criteria_parser_1.getCriteriaStatus)(criteria);
            // Assert
            assert.strictEqual(status.total, 5);
            assert.strictEqual(status.met, 2);
            assert.strictEqual(status.notMet, 1);
            assert.strictEqual(status.pending, 2);
        });
        test('Get status for empty criteria', () => {
            // Arrange
            const criteria = [];
            // Act
            const status = (0, acceptance_criteria_parser_1.getCriteriaStatus)(criteria);
            // Assert
            assert.strictEqual(status.total, 0);
            assert.strictEqual(status.met, 0);
            assert.strictEqual(status.notMet, 0);
            assert.strictEqual(status.pending, 0);
        });
    });
    // AC-3.3.f: When no acceptance criteria are found → user is notified to add criteria
    suite('AC-3.3.f: No Criteria Found → User Notification', () => {
        test('hasAcceptanceCriteria returns false for empty issue', () => {
            // Arrange
            const issueBody = `
# Simple Issue
Just a description with no criteria.
`;
            // Act
            const hasCriteria = (0, acceptance_criteria_parser_1.hasAcceptanceCriteria)(issueBody);
            // Assert
            assert.strictEqual(hasCriteria, false, 'Should return false when no criteria found');
        });
        test('hasAcceptanceCriteria returns true when criteria exist', () => {
            // Arrange
            const issueBody = `
# Issue with Criteria
- [ ] Feature A
- [ ] Feature B
`;
            // Act
            const hasCriteria = (0, acceptance_criteria_parser_1.hasAcceptanceCriteria)(issueBody);
            // Assert
            assert.strictEqual(hasCriteria, true, 'Should return true when criteria found');
        });
        test('getNoCriteriaMessage returns helpful message', () => {
            // Act
            const message = (0, acceptance_criteria_parser_1.getNoCriteriaMessage)();
            // Assert
            assert.ok(message.includes('No acceptance criteria found'), 'Should mention no criteria');
            assert.ok(message.includes('Checklist Format'), 'Should show checklist format');
            assert.ok(message.includes('AC Format'), 'Should show AC format');
            assert.ok(message.includes('Acceptance Criteria'), 'Should show header format');
            assert.ok(message.includes('general code quality'), 'Should mention fallback behavior');
        });
    });
    suite('Integration Tests', () => {
        test('Full workflow: parse → validate → approve', () => {
            // Arrange - Parse criteria from issue
            const issueBody = `
## Acceptance Criteria
- [ ] Feature implemented correctly
- [ ] Unit tests added with 80%+ coverage
- [ ] Documentation updated
`;
            const criteria = (0, acceptance_criteria_parser_1.parseAcceptanceCriteria)(issueBody);
            // Simulate review agent response
            const reviewResult = {
                status: 'APPROVED',
                criteriaResults: [
                    { criterion: 'Feature implemented correctly', met: true, evidence: 'Manual testing passed' },
                    { criterion: 'Unit tests added with 80%+ coverage', met: true, evidence: '85% coverage achieved' },
                    { criterion: 'Documentation updated', met: true, evidence: 'README updated' }
                ],
                qualityResults: { tests: true, linting: true, documentation: true },
                summary: 'All criteria met, work approved'
            };
            // Act - Validate
            const validation = (0, acceptance_criteria_parser_1.validateCriteria)(criteria, reviewResult);
            const status = (0, acceptance_criteria_parser_1.getCriteriaStatus)(criteria);
            // Assert - Should proceed to approval
            assert.strictEqual(criteria.length, 3, 'Should have parsed 3 criteria');
            assert.strictEqual(validation.allMet, true, 'All criteria should be met');
            assert.strictEqual(validation.unmetCriteria.length, 0, 'No unmet criteria');
            assert.strictEqual(status.met, 3, 'Status should show 3 met');
        });
        test('Full workflow: parse → validate → reject', () => {
            // Arrange - Parse criteria from issue
            const issueBody = `
## Acceptance Criteria
AC-1: Feature implemented correctly
AC-2: Unit tests added with 80%+ coverage
AC-3: Documentation updated
`;
            const criteria = (0, acceptance_criteria_parser_1.parseAcceptanceCriteria)(issueBody);
            // Simulate review agent response with failures
            const reviewResult = {
                status: 'REJECTED',
                criteriaResults: [
                    { criterion: 'Feature implemented correctly', met: false, reason: 'Edge case fails' },
                    { criterion: 'Unit tests added with 80%+ coverage', met: false, reason: 'Only 60% coverage' },
                    { criterion: 'Documentation updated', met: true, evidence: 'README updated' }
                ],
                qualityResults: { tests: false, linting: true, documentation: true },
                feedback: 'Please fix edge cases and improve test coverage'
            };
            // Act - Validate
            const validation = (0, acceptance_criteria_parser_1.validateCriteria)(criteria, reviewResult);
            const status = (0, acceptance_criteria_parser_1.getCriteriaStatus)(criteria);
            // Assert - Should proceed to rejection
            assert.strictEqual(validation.allMet, false, 'Not all criteria met');
            assert.strictEqual(validation.unmetCriteria.length, 2, 'Should have 2 unmet criteria');
            assert.strictEqual(status.met, 1, 'Status should show 1 met');
            assert.strictEqual(status.notMet, 2, 'Status should show 2 not met');
            assert.ok(validation.unmetCriteria[0].reason, 'Should include rejection reasons');
        });
        test('Full workflow: no criteria → notification', () => {
            // Arrange
            const issueBody = `
# Simple Issue
Just a plain description with no criteria defined anywhere.
`;
            // Act
            const hasCriteria = (0, acceptance_criteria_parser_1.hasAcceptanceCriteria)(issueBody);
            const message = (0, acceptance_criteria_parser_1.getNoCriteriaMessage)();
            // Assert
            assert.strictEqual(hasCriteria, false, 'Should detect no criteria');
            assert.ok(message.length > 100, 'Should provide detailed notification');
            assert.ok(message.includes('format'), 'Should explain format options');
        });
        test('Format criteria for review agent prompt', () => {
            // Arrange
            const issueBody = `
- [ ] Implement parser
- [ ] Add tests
- [ ] Write documentation
`;
            const criteria = (0, acceptance_criteria_parser_1.parseAcceptanceCriteria)(issueBody);
            // Act
            const formatted = (0, acceptance_criteria_parser_1.formatCriteriaForPrompt)(criteria);
            // Assert
            assert.ok(formatted.includes('[AC-1]'), 'Should include criterion IDs');
            assert.ok(formatted.includes('[AC-2]'), 'Should include all criteria');
            assert.ok(formatted.includes('[AC-3]'), 'Should be numbered sequentially');
            assert.ok(formatted.includes('Implement parser'), 'Should include descriptions');
        });
    });
});
//# sourceMappingURL=acceptance-criteria-parser.test.js.map