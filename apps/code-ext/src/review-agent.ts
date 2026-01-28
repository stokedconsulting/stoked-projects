import * as fs from 'fs';
import * as path from 'path';
import { AgentSessionManager, AgentSession } from './agent-session-manager';

/**
 * Review agent status values
 * Distinct from execution agent statuses
 */
export type ReviewAgentStatus = 'idle' | 'reviewing' | 'paused' | 'stopped';

/**
 * Review context required to generate a review prompt
 */
export interface ReviewContext {
    projectNumber: number;
    issueNumber: number;
    issueTitle: string;
    issueBody: string;
    branchName: string;
    fileList: string[];
    acceptanceCriteria: string[];
}

/**
 * Single acceptance criterion review result
 */
export interface CriterionResult {
    criterion: string;
    met: boolean;
    evidence?: string;
    reason?: string;
}

/**
 * Code quality check results
 */
export interface QualityResults {
    tests: boolean;
    linting: boolean;
    documentation: boolean;
    testsExplanation?: string;
    lintingExplanation?: string;
    documentationExplanation?: string;
}

/**
 * Complete review result parsed from agent response
 */
export interface ReviewResult {
    status: 'APPROVED' | 'REJECTED';
    criteriaResults: CriterionResult[];
    qualityResults: QualityResults;
    summary?: string;
    feedback?: string;
}

/**
 * Review agent session state
 * Extends AgentSession but uses string agentId instead of numeric
 */
export interface ReviewAgentSession extends Omit<AgentSession, 'agentId' | 'status'> {
    agentId: 'review-agent';
    status: ReviewAgentStatus;
}

/**
 * Review Agent
 *
 * Manages dedicated review agent for quality validation and acceptance criteria checking.
 *
 * AC-3.1.a: When review agent is initialized → dedicated session file is created with `review-agent` ID
 * AC-3.1.b: When review task begins → prompt template is loaded from file within 1 second
 * AC-3.1.c: When prompt template is missing → fallback inline prompt is used and warning is logged
 * AC-3.1.d: When review is executed → prompt includes full issue context, acceptance criteria, and file list
 * AC-3.1.e: When review agent response is parsed → status (APPROVED/REJECTED) and criteria checklist are extracted correctly
 */
export class ReviewAgent {
    private workspaceRoot: string;
    private sessionManager: AgentSessionManager;
    private readonly REVIEW_AGENT_ID = 'review-agent';
    private readonly PROMPT_TEMPLATE_PATH: string;
    private cachedTemplate: string | null = null;

    constructor(workspaceRoot: string) {
        this.workspaceRoot = workspaceRoot;
        this.sessionManager = new AgentSessionManager(workspaceRoot);
        this.PROMPT_TEMPLATE_PATH = path.join(
            workspaceRoot,
            'apps/code-ext/commands/review-agent-prompt.md'
        );
    }

    /**
     * Get the session file path for the review agent
     */
    private getReviewAgentSessionPath(): string {
        const sessionsDir = this.sessionManager.getSessionsDirectory();
        return path.join(sessionsDir, `${this.REVIEW_AGENT_ID}.session`);
    }

    /**
     * Initialize review agent session
     * Creates dedicated session file with `review-agent` ID
     *
     * AC-3.1.a: When review agent is initialized → dedicated session file is created with `review-agent` ID
     */
    public async initializeReviewAgent(): Promise<void> {
        console.log('[ReviewAgent] Initializing review agent session');

        // Ensure sessions directory exists
        const sessionsDir = this.sessionManager.getSessionsDirectory();
        if (!fs.existsSync(sessionsDir)) {
            fs.mkdirSync(sessionsDir, { recursive: true });
        }

        // Create review agent session file
        const session: ReviewAgentSession = {
            agentId: this.REVIEW_AGENT_ID,
            status: 'idle',
            currentProjectNumber: null,
            currentPhase: null,
            branchName: null,
            lastHeartbeat: new Date().toISOString(),
            tasksCompleted: 0,
            currentTaskDescription: null,
            errorCount: 0,
            lastError: null
        };

        const sessionPath = this.getReviewAgentSessionPath();
        const content = JSON.stringify(session, null, 2);

        // Write atomically using temp file + rename pattern
        const tempPath = `${sessionPath}.tmp`;
        fs.writeFileSync(tempPath, content, 'utf-8');
        fs.renameSync(tempPath, sessionPath);

        console.log(`[ReviewAgent] Initialized review agent session at: ${sessionPath}`);
    }

    /**
     * Get current review agent status
     * Returns the full session object or null if not initialized
     */
    public getReviewAgentStatus(): ReviewAgentSession | null {
        const sessionPath = this.getReviewAgentSessionPath();

        if (!fs.existsSync(sessionPath)) {
            console.log('[ReviewAgent] Review agent session not found');
            return null;
        }

        try {
            const content = fs.readFileSync(sessionPath, 'utf-8');
            const session = JSON.parse(content) as ReviewAgentSession;
            return session;
        } catch (error) {
            console.error('[ReviewAgent] Failed to read review agent session:', error);
            return null;
        }
    }

    /**
     * Update review agent session status
     */
    public async updateReviewAgentStatus(
        status: ReviewAgentStatus,
        updates?: Partial<ReviewAgentSession>
    ): Promise<void> {
        const sessionPath = this.getReviewAgentSessionPath();

        if (!fs.existsSync(sessionPath)) {
            throw new Error('Review agent session not initialized. Call initializeReviewAgent first.');
        }

        const currentSession = this.getReviewAgentStatus();
        if (!currentSession) {
            throw new Error('Failed to read current review agent session');
        }

        // Merge updates with current session
        const updatedSession: ReviewAgentSession = {
            ...currentSession,
            ...updates,
            status,
            lastHeartbeat: new Date().toISOString()
        };

        // Write atomically
        const tempPath = `${sessionPath}.tmp`;
        const content = JSON.stringify(updatedSession, null, 2);
        fs.writeFileSync(tempPath, content, 'utf-8');
        fs.renameSync(tempPath, sessionPath);

        console.log(`[ReviewAgent] Updated review agent status to: ${status}`);
    }

    /**
     * Load review prompt template from file
     *
     * AC-3.1.b: When review task begins → prompt template is loaded from file within 1 second
     * AC-3.1.c: When prompt template is missing → fallback inline prompt is used and warning is logged
     */
    public async loadReviewPromptTemplate(): Promise<string> {
        // Return cached template if available
        if (this.cachedTemplate) {
            return this.cachedTemplate;
        }

        try {
            const startTime = Date.now();

            // Try to load from file
            if (fs.existsSync(this.PROMPT_TEMPLATE_PATH)) {
                const content = fs.readFileSync(this.PROMPT_TEMPLATE_PATH, 'utf-8');
                const loadTime = Date.now() - startTime;

                console.log(`[ReviewAgent] Loaded prompt template in ${loadTime}ms`);

                // Cache the template
                this.cachedTemplate = content;
                return content;
            } else {
                // AC-3.1.c: Fallback to inline prompt if file missing
                console.warn(
                    `[ReviewAgent] Prompt template not found at: ${this.PROMPT_TEMPLATE_PATH}`
                );
                console.warn('[ReviewAgent] Using fallback inline prompt');

                const fallbackPrompt = this.getFallbackPrompt();
                this.cachedTemplate = fallbackPrompt;
                return fallbackPrompt;
            }
        } catch (error) {
            // AC-3.1.c: Fallback on read error
            console.warn('[ReviewAgent] Error loading prompt template:', error);
            console.warn('[ReviewAgent] Using fallback inline prompt');

            const fallbackPrompt = this.getFallbackPrompt();
            this.cachedTemplate = fallbackPrompt;
            return fallbackPrompt;
        }
    }

    /**
     * Get fallback inline prompt template
     */
    private getFallbackPrompt(): string {
        return `# Review Agent - Code Quality Validation

You are a Code Review Specialist Agent. Review the completed work against acceptance criteria.

**Project:** {{projectNumber}}
**Issue:** {{issueNumber}} - {{issueTitle}}
**Branch:** {{branchName}}

## Acceptance Criteria
{{acceptanceCriteria}}

## Files Changed
{{fileList}}

## Your Task
1. Validate each acceptance criterion is met
2. Check code quality (tests, linting, documentation)
3. Respond with APPROVED or REJECTED

**Response Format:**
\`\`\`
**Status:** APPROVED | REJECTED

**Acceptance Criteria Review:**
- [x] Criterion 1: Met (evidence: ...)
- [ ] Criterion 2: Not met (reason: ...)

**Code Quality Review:**
- Tests: PASS | FAIL
- Linting: PASS | FAIL
- Documentation: PASS | FAIL

**Feedback for Execution Agent:**
(Only if rejected)
\`\`\`
`;
    }

    /**
     * Generate full review prompt by interpolating context into template
     *
     * AC-3.1.d: When review is executed → prompt includes full issue context, acceptance criteria, and file list
     */
    public async generateReviewPrompt(context: ReviewContext): Promise<string> {
        const template = await this.loadReviewPromptTemplate();

        // Format acceptance criteria as numbered list
        const formattedCriteria = context.acceptanceCriteria
            .map((criterion, index) => `${index + 1}. ${criterion}`)
            .join('\n');

        // Format file list
        const formattedFiles = context.fileList
            .map(file => `- ${file}`)
            .join('\n');

        // Interpolate variables
        let prompt = template
            .replace(/\{\{projectNumber\}\}/g, String(context.projectNumber))
            .replace(/\{\{issueNumber\}\}/g, String(context.issueNumber))
            .replace(/\{\{issueTitle\}\}/g, context.issueTitle)
            .replace(/\{\{issueBody\}\}/g, context.issueBody)
            .replace(/\{\{branchName\}\}/g, context.branchName)
            .replace(/\{\{acceptanceCriteria\}\}/g, formattedCriteria)
            .replace(/\{\{fileList\}\}/g, formattedFiles);

        console.log('[ReviewAgent] Generated review prompt with context');

        return prompt;
    }

    /**
     * Parse review response to extract status and results
     *
     * AC-3.1.e: When review agent response is parsed → status (APPROVED/REJECTED) and criteria checklist are extracted correctly
     */
    public parseReviewResponse(response: string): ReviewResult {
        console.log('[ReviewAgent] Parsing review response');

        // Extract status (APPROVED or REJECTED)
        const statusMatch = response.match(/\*\*Status:\*\*\s+(APPROVED|REJECTED)/i);
        const status: 'APPROVED' | 'REJECTED' = statusMatch
            ? (statusMatch[1].toUpperCase() as 'APPROVED' | 'REJECTED')
            : 'REJECTED'; // Default to rejected if not found

        // Extract acceptance criteria results
        const criteriaResults: CriterionResult[] = [];
        const criteriaSection = response.match(
            /\*\*Acceptance Criteria Review:\*\*([\s\S]*?)(?:\*\*|$)/i
        );

        if (criteriaSection) {
            const criteriaText = criteriaSection[1];
            // Match lines like: - [x] AC-3.1.a: Description - Met (evidence: ...)
            // Or: - [ ] AC-3.1.b: Description - Not met (reason: ...)
            const criterionRegex = /- \[(x| )\]\s+(?:AC-[\d.]+:\s+)?(.+?)\s+-\s+(Met|Not met)\s*(?:\((?:evidence|reason):\s*(.+?)\))?$/gim;

            let match;
            while ((match = criterionRegex.exec(criteriaText)) !== null) {
                const met = match[1].toLowerCase() === 'x';
                const criterion = match[2].trim();
                const metText = match[3];
                const explanation = match[4]?.trim();

                criteriaResults.push({
                    criterion,
                    met,
                    evidence: met ? explanation : undefined,
                    reason: !met ? explanation : undefined
                });
            }
        }

        // Extract quality results
        const qualityResults: QualityResults = {
            tests: false,
            linting: false,
            documentation: false
        };

        const qualitySection = response.match(
            /\*\*Code Quality Review:\*\*([\s\S]*?)(?:\*\*|$)/i
        );

        if (qualitySection) {
            const qualityText = qualitySection[1];

            // Parse Tests
            const testsMatch = qualityText.match(/Tests:\s+(PASS|FAIL)(?:\s*\((.+?)\))?/i);
            if (testsMatch) {
                qualityResults.tests = testsMatch[1].toUpperCase() === 'PASS';
                qualityResults.testsExplanation = testsMatch[2]?.trim();
            }

            // Parse Linting
            const lintingMatch = qualityText.match(/Linting:\s+(PASS|FAIL)(?:\s*\((.+?)\))?/i);
            if (lintingMatch) {
                qualityResults.linting = lintingMatch[1].toUpperCase() === 'PASS';
                qualityResults.lintingExplanation = lintingMatch[2]?.trim();
            }

            // Parse Documentation
            const docsMatch = qualityText.match(/Documentation:\s+(PASS|FAIL)(?:\s*\((.+?)\))?/i);
            if (docsMatch) {
                qualityResults.documentation = docsMatch[1].toUpperCase() === 'PASS';
                qualityResults.documentationExplanation = docsMatch[2]?.trim();
            }
        }

        // Extract summary
        const summaryMatch = response.match(/\*\*Summary:\*\*\s*(.+?)(?:\n\n|\*\*|$)/is);
        const summary = summaryMatch ? summaryMatch[1].trim() : undefined;

        // Extract feedback
        const feedbackMatch = response.match(
            /\*\*Feedback for Execution Agent:\*\*\s*([\s\S]+?)(?:\n\n---|\n\n\*\*|$)/i
        );
        const feedback = feedbackMatch ? feedbackMatch[1].trim() : undefined;

        const result: ReviewResult = {
            status,
            criteriaResults,
            qualityResults,
            summary,
            feedback
        };

        console.log(`[ReviewAgent] Parsed review: ${status}, ${criteriaResults.length} criteria checked`);

        return result;
    }

    /**
     * Clear cached template (useful for testing)
     */
    public clearTemplateCache(): void {
        this.cachedTemplate = null;
    }
}

/**
 * Singleton instance for global access
 */
let reviewAgentInstance: ReviewAgent | null = null;

/**
 * Initialize the review agent with workspace root
 * Should be called during extension activation
 */
export function initializeReviewAgent(workspaceRoot: string): ReviewAgent {
    reviewAgentInstance = new ReviewAgent(workspaceRoot);
    return reviewAgentInstance;
}

/**
 * Get the singleton review agent instance
 * @throws Error if not initialized
 */
export function getReviewAgent(): ReviewAgent {
    if (!reviewAgentInstance) {
        throw new Error('ReviewAgent not initialized. Call initializeReviewAgent first.');
    }
    return reviewAgentInstance;
}

/**
 * Cleanup and reset the review agent
 * Should be called during extension deactivation
 */
export function cleanupReviewAgent(): void {
    reviewAgentInstance = null;
}
