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
exports.ReviewAgent = void 0;
exports.initializeReviewAgent = initializeReviewAgent;
exports.getReviewAgent = getReviewAgent;
exports.cleanupReviewAgent = cleanupReviewAgent;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const agent_session_manager_1 = require("./agent-session-manager");
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
class ReviewAgent {
    workspaceRoot;
    sessionManager;
    REVIEW_AGENT_ID = 'review-agent';
    PROMPT_TEMPLATE_PATH;
    cachedTemplate = null;
    constructor(workspaceRoot) {
        this.workspaceRoot = workspaceRoot;
        this.sessionManager = new agent_session_manager_1.AgentSessionManager(workspaceRoot);
        this.PROMPT_TEMPLATE_PATH = path.join(workspaceRoot, 'apps/code-ext/commands/review-agent-prompt.md');
    }
    /**
     * Get the session file path for the review agent
     */
    getReviewAgentSessionPath() {
        const sessionsDir = this.sessionManager.getSessionsDirectory();
        return path.join(sessionsDir, `${this.REVIEW_AGENT_ID}.session`);
    }
    /**
     * Initialize review agent session
     * Creates dedicated session file with `review-agent` ID
     *
     * AC-3.1.a: When review agent is initialized → dedicated session file is created with `review-agent` ID
     */
    async initializeReviewAgent() {
        console.log('[ReviewAgent] Initializing review agent session');
        // Ensure sessions directory exists
        const sessionsDir = this.sessionManager.getSessionsDirectory();
        if (!fs.existsSync(sessionsDir)) {
            fs.mkdirSync(sessionsDir, { recursive: true });
        }
        // Create review agent session file
        const session = {
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
    getReviewAgentStatus() {
        const sessionPath = this.getReviewAgentSessionPath();
        if (!fs.existsSync(sessionPath)) {
            console.log('[ReviewAgent] Review agent session not found');
            return null;
        }
        try {
            const content = fs.readFileSync(sessionPath, 'utf-8');
            const session = JSON.parse(content);
            return session;
        }
        catch (error) {
            console.error('[ReviewAgent] Failed to read review agent session:', error);
            return null;
        }
    }
    /**
     * Update review agent session status
     */
    async updateReviewAgentStatus(status, updates) {
        const sessionPath = this.getReviewAgentSessionPath();
        if (!fs.existsSync(sessionPath)) {
            throw new Error('Review agent session not initialized. Call initializeReviewAgent first.');
        }
        const currentSession = this.getReviewAgentStatus();
        if (!currentSession) {
            throw new Error('Failed to read current review agent session');
        }
        // Merge updates with current session
        const updatedSession = {
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
    async loadReviewPromptTemplate() {
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
            }
            else {
                // AC-3.1.c: Fallback to inline prompt if file missing
                console.warn(`[ReviewAgent] Prompt template not found at: ${this.PROMPT_TEMPLATE_PATH}`);
                console.warn('[ReviewAgent] Using fallback inline prompt');
                const fallbackPrompt = this.getFallbackPrompt();
                this.cachedTemplate = fallbackPrompt;
                return fallbackPrompt;
            }
        }
        catch (error) {
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
    getFallbackPrompt() {
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
    async generateReviewPrompt(context) {
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
    parseReviewResponse(response) {
        console.log('[ReviewAgent] Parsing review response');
        // Extract status (APPROVED or REJECTED)
        const statusMatch = response.match(/\*\*Status:\*\*\s+(APPROVED|REJECTED)/i);
        const status = statusMatch
            ? statusMatch[1].toUpperCase()
            : 'REJECTED'; // Default to rejected if not found
        // Extract acceptance criteria results
        const criteriaResults = [];
        const criteriaSection = response.match(/\*\*Acceptance Criteria Review:\*\*([\s\S]*?)(?:\*\*|$)/i);
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
        const qualityResults = {
            tests: false,
            linting: false,
            documentation: false
        };
        const qualitySection = response.match(/\*\*Code Quality Review:\*\*([\s\S]*?)(?:\*\*|$)/i);
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
        const feedbackMatch = response.match(/\*\*Feedback for Execution Agent:\*\*\s*([\s\S]+?)(?:\n\n---|\n\n\*\*|$)/i);
        const feedback = feedbackMatch ? feedbackMatch[1].trim() : undefined;
        const result = {
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
    clearTemplateCache() {
        this.cachedTemplate = null;
    }
}
exports.ReviewAgent = ReviewAgent;
/**
 * Singleton instance for global access
 */
let reviewAgentInstance = null;
/**
 * Initialize the review agent with workspace root
 * Should be called during extension activation
 */
function initializeReviewAgent(workspaceRoot) {
    reviewAgentInstance = new ReviewAgent(workspaceRoot);
    return reviewAgentInstance;
}
/**
 * Get the singleton review agent instance
 * @throws Error if not initialized
 */
function getReviewAgent() {
    if (!reviewAgentInstance) {
        throw new Error('ReviewAgent not initialized. Call initializeReviewAgent first.');
    }
    return reviewAgentInstance;
}
/**
 * Cleanup and reset the review agent
 * Should be called during extension deactivation
 */
function cleanupReviewAgent() {
    reviewAgentInstance = null;
}
//# sourceMappingURL=review-agent.js.map