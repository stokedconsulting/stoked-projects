"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.parseAcceptanceCriteria = parseAcceptanceCriteria;
exports.validateCriteria = validateCriteria;
exports.formatCriteriaForPrompt = formatCriteriaForPrompt;
exports.getCriteriaStatus = getCriteriaStatus;
exports.hasAcceptanceCriteria = hasAcceptanceCriteria;
exports.getNoCriteriaMessage = getNoCriteriaMessage;
/**
 * Acceptance Criteria Parser
 *
 * Parses acceptance criteria from issue descriptions and validates against review results.
 *
 * Supported Formats:
 * - Checklist: `- [ ] criterion` or `- [x] criterion`
 * - AC format: `AC-X.X.x: criterion` or `AC-X: criterion`
 * - Numbered: `1. criterion` (under "Acceptance Criteria" header)
 * - Bullet: `- criterion` (under "Acceptance Criteria" header)
 *
 * AC-3.3.a: When issue body contains checklist format → all criteria are extracted correctly
 * AC-3.3.b: When issue body contains AC-X.X.X format → all criteria are extracted correctly
 * AC-3.3.c: When review agent response includes criteria status → parser extracts met/not met status
 * AC-3.3.d: When all criteria are marked "met" → review proceeds to approval workflow
 * AC-3.3.e: When any criterion is marked "not met" → review proceeds to rejection with feedback
 * AC-3.3.f: When no acceptance criteria are found → user is notified to add criteria
 */
/**
 * Parse acceptance criteria from issue body text
 *
 * Supports multiple formats:
 * - Checklist: `- [ ] description` or `- [x] description`
 * - AC format: `AC-1.1.a: description` or `AC-1: description`
 * - Numbered: `1. description` (under "Acceptance Criteria" header)
 * - Bullet: `- description` (under "Acceptance Criteria" header)
 *
 * AC-3.3.a: When issue body contains checklist format → all criteria are extracted correctly
 * AC-3.3.b: When issue body contains AC-X.X.X format → all criteria are extracted correctly
 *
 * @param issueBody - The full issue description text
 * @returns Array of acceptance criteria with auto-generated IDs
 */
function parseAcceptanceCriteria(issueBody) {
    const criteria = [];
    let criterionCounter = 1;
    // Strategy 1: Find checklist format anywhere in body
    // Matches: - [ ] text or - [x] text
    const checklistRegex = /^[\s]*-[\s]*\[([ xX])\][\s]+(.+)$/gm;
    let match;
    while ((match = checklistRegex.exec(issueBody)) !== null) {
        const isChecked = match[1].toLowerCase() === 'x';
        const description = match[2].trim();
        criteria.push({
            id: `AC-${criterionCounter}`,
            description,
            status: isChecked ? 'met' : 'pending',
            evidence: isChecked ? 'Pre-marked as complete in issue' : undefined
        });
        criterionCounter++;
    }
    // Strategy 2: Find AC-X.X.x: format anywhere in body
    // Matches: AC-1.1.a: text, AC-3.3.b: text, AC-1: text
    const acFormatRegex = /AC-[\d.]+[a-z]?:\s+(.+?)(?=\n|$)/gi;
    while ((match = acFormatRegex.exec(issueBody)) !== null) {
        const description = match[1].trim();
        // Avoid duplicates if already found in checklist
        const isDuplicate = criteria.some(c => c.description === description);
        if (!isDuplicate) {
            criteria.push({
                id: `AC-${criterionCounter}`,
                description,
                status: 'pending'
            });
            criterionCounter++;
        }
    }
    // Strategy 3: Find criteria under "Acceptance Criteria" header
    // Look for header variations, then extract numbered or bulleted lists
    const headerRegex = /(?:^|\n)#{1,6}\s*(?:Acceptance Criteria|Definition of Done|Success Criteria)[\s]*\n([\s\S]*?)(?=\n#{1,6}|\n\n[A-Z]|$)/i;
    const headerMatch = headerRegex.exec(issueBody);
    if (headerMatch) {
        const sectionText = headerMatch[1];
        // Extract numbered items: 1. text, 2. text
        const numberedRegex = /^[\s]*\d+\.[\s]+(.+?)(?=\n|$)/gm;
        while ((match = numberedRegex.exec(sectionText)) !== null) {
            const description = match[1].trim();
            // Avoid duplicates
            const isDuplicate = criteria.some(c => c.description === description);
            if (!isDuplicate) {
                criteria.push({
                    id: `AC-${criterionCounter}`,
                    description,
                    status: 'pending'
                });
                criterionCounter++;
            }
        }
        // Extract bullet items: - text (but not checklists, already handled)
        const bulletRegex = /^[\s]*-[\s]+(?!\[[ xX]\])(.+?)(?=\n|$)/gm;
        while ((match = bulletRegex.exec(sectionText)) !== null) {
            const description = match[1].trim();
            // Avoid duplicates and skip if looks like a sub-item
            const isDuplicate = criteria.some(c => c.description === description);
            if (!isDuplicate && description.length > 3) {
                criteria.push({
                    id: `AC-${criterionCounter}`,
                    description,
                    status: 'pending'
                });
                criterionCounter++;
            }
        }
    }
    console.log(`[AcceptanceCriteriaParser] Parsed ${criteria.length} acceptance criteria`);
    return criteria;
}
/**
 * Validate acceptance criteria against review agent results
 *
 * Updates criteria status based on review agent findings.
 * Matches criteria by description (case-insensitive, flexible matching).
 *
 * AC-3.3.c: When review agent response includes criteria status → parser extracts met/not met status
 * AC-3.3.d: When all criteria are marked "met" → review proceeds to approval workflow
 * AC-3.3.e: When any criterion is marked "not met" → review proceeds to rejection with feedback
 *
 * @param criteria - Original acceptance criteria from issue
 * @param reviewResult - Parsed review agent response
 * @returns Validation result with updated criteria and overall status
 */
function validateCriteria(criteria, reviewResult) {
    console.log('[AcceptanceCriteriaParser] Validating criteria against review results');
    // Create a mutable copy of criteria for status updates
    const updatedCriteria = criteria.map(c => ({ ...c }));
    // Match review results to criteria
    for (const reviewCriterion of reviewResult.criteriaResults) {
        // Try to find matching criterion by description
        // Use flexible matching: normalize whitespace, case-insensitive
        const normalizedReviewDesc = normalizeDescription(reviewCriterion.criterion);
        const matchingCriterion = updatedCriteria.find(c => {
            const normalizedCriterionDesc = normalizeDescription(c.description);
            // Check for exact match or if one contains the other
            return normalizedCriterionDesc === normalizedReviewDesc ||
                normalizedCriterionDesc.includes(normalizedReviewDesc) ||
                normalizedReviewDesc.includes(normalizedCriterionDesc);
        });
        if (matchingCriterion) {
            matchingCriterion.status = reviewCriterion.met ? 'met' : 'not_met';
            matchingCriterion.evidence = reviewCriterion.evidence;
            matchingCriterion.reason = reviewCriterion.reason;
            console.log(`[AcceptanceCriteriaParser] Matched criterion: ${matchingCriterion.id} - ${reviewCriterion.met ? 'MET' : 'NOT MET'}`);
        }
        else {
            console.warn(`[AcceptanceCriteriaParser] Could not match review criterion: ${reviewCriterion.criterion}`);
        }
    }
    // Calculate validation results
    const metCount = updatedCriteria.filter(c => c.status === 'met').length;
    const totalCount = updatedCriteria.length;
    const unmetCriteria = updatedCriteria.filter(c => c.status === 'not_met' || c.status === 'pending');
    const allMet = metCount === totalCount && totalCount > 0;
    const result = {
        allMet,
        metCount,
        totalCount,
        unmetCriteria
    };
    console.log(`[AcceptanceCriteriaParser] Validation result: ${metCount}/${totalCount} criteria met, allMet=${allMet}`);
    return result;
}
/**
 * Normalize description for flexible matching
 * Removes extra whitespace, converts to lowercase, removes punctuation
 */
function normalizeDescription(desc) {
    return desc
        .toLowerCase()
        .replace(/[^\w\s]/g, '') // Remove punctuation
        .replace(/\s+/g, ' ') // Normalize whitespace
        .trim();
}
/**
 * Format acceptance criteria for review agent prompt
 *
 * Formats criteria as a numbered list for inclusion in review prompt.
 * Each criterion includes its ID for traceability.
 *
 * @param criteria - Acceptance criteria to format
 * @returns Formatted string ready for prompt inclusion
 */
function formatCriteriaForPrompt(criteria) {
    if (criteria.length === 0) {
        return 'No acceptance criteria defined. Perform general quality review only.';
    }
    const formatted = criteria
        .map((criterion, index) => `${index + 1}. [${criterion.id}] ${criterion.description}`)
        .join('\n');
    console.log('[AcceptanceCriteriaParser] Formatted criteria for prompt');
    return formatted;
}
/**
 * Get overall criteria status summary
 *
 * Provides a breakdown of criteria by status (met, not met, pending).
 *
 * @param criteria - Acceptance criteria to summarize
 * @returns Status breakdown
 */
function getCriteriaStatus(criteria) {
    const status = {
        total: criteria.length,
        met: criteria.filter(c => c.status === 'met').length,
        notMet: criteria.filter(c => c.status === 'not_met').length,
        pending: criteria.filter(c => c.status === 'pending').length
    };
    return status;
}
/**
 * Check if issue has acceptance criteria
 *
 * Returns true if any criteria were successfully parsed from the issue body.
 *
 * AC-3.3.f: When no acceptance criteria are found → user is notified to add criteria
 *
 * @param issueBody - Issue description text
 * @returns True if criteria found, false otherwise
 */
function hasAcceptanceCriteria(issueBody) {
    const criteria = parseAcceptanceCriteria(issueBody);
    return criteria.length > 0;
}
/**
 * Generate user-friendly message when no criteria found
 *
 * AC-3.3.f: When no acceptance criteria are found → user is notified to add criteria
 *
 * @returns User notification message
 */
function getNoCriteriaMessage() {
    return `No acceptance criteria found in issue description.

Please add acceptance criteria in one of these formats:

**Checklist Format:**
- [ ] Criterion 1
- [ ] Criterion 2

**AC Format:**
AC-1.1.a: Criterion 1
AC-1.1.b: Criterion 2

**Under "Acceptance Criteria" Header:**
## Acceptance Criteria
1. Criterion 1
2. Criterion 2

Without defined criteria, only general code quality checks will be performed.`;
}
//# sourceMappingURL=acceptance-criteria-parser.js.map