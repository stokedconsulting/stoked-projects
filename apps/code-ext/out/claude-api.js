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
exports.ClaudeAPI = void 0;
const child_process_1 = require("child_process");
const util_1 = require("util");
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const os = __importStar(require("os"));
const execAsync = (0, util_1.promisify)(child_process_1.exec);
/**
 * Claude API integration for design analysis
 */
class ClaudeAPI {
    tempDir;
    constructor() {
        this.tempDir = path.join(os.tmpdir(), "stoked-projects-claude");
        // Ensure temp directory exists
        if (!fs.existsSync(this.tempDir)) {
            fs.mkdirSync(this.tempDir, { recursive: true });
        }
    }
    /**
     * Execute design analysis prompt
     */
    async executeDesignAnalysis(projectDescription) {
        const prompt = this.buildDesignPrompt(projectDescription);
        return await this.executeClaude(prompt);
    }
    /**
     * Execute design iteration with feedback
     */
    async executeDesignIteration(previousResult, userFeedback) {
        const prompt = this.buildIterationPrompt(previousResult, userFeedback);
        return await this.executeClaude(prompt);
    }
    /**
     * Execute project structure breakdown
     */
    async executeProjectBreakdown(approvedDesign) {
        const prompt = this.buildProjectBreakdownPrompt(approvedDesign);
        return await this.executeClaude(prompt);
    }
    /**
     * Build design analysis prompt
     */
    buildDesignPrompt(description) {
        return `You are running with --ultrathink enabled. Use maximum analysis depth (~32K tokens).

## Design Task
Design the following project feature with comprehensive specifications:

${description}

## Requirements
1. **Architecture Design**: System components, data flow, dependencies
2. **API Specification**: Endpoints, request/response schemas, error handling
3. **Component Breakdown**: Frontend/backend components, interfaces, contracts
4. **Database Schema**: Models, relationships, migrations needed
5. **Implementation Phases**: Logical breakdown into implementable chunks
6. **Risk Assessment**: Technical risks, dependencies, blockers
7. **Acceptance Criteria**: Clear, testable criteria for each component

## Output Format
Provide a structured breakdown with:
- Epic summary
- User stories with acceptance criteria
- Technical tasks with estimates (XS/S/M/L/XL)
- Dependencies between tasks
- Priority ordering (Critical/High/Medium/Low)

Think deeply about edge cases, scalability, security implications, and maintainability.`;
    }
    /**
     * Build iteration prompt with feedback
     */
    buildIterationPrompt(previousResult, feedback) {
        return `# Previous Design Analysis
${previousResult}

# User Feedback
${feedback}

# Task
Revise the design analysis based on the feedback above. Maintain the same output format with:
- Epic summary
- User stories with acceptance criteria
- Technical tasks with estimates (XS/S/M/L/XL)
- Dependencies between tasks
- Priority ordering (Critical/High/Medium/Low)`;
    }
    /**
     * Build project breakdown prompt
     */
    buildProjectBreakdownPrompt(approvedDesign) {
        return `# Approved Design
${approvedDesign}

# Task
Create a detailed project structure breakdown for GitHub Project creation.

## Output Format (JSON)
Return a valid JSON object with this exact structure:
{
  "projectTitle": "[Feature] {name}",
  "epic": {
    "title": "Epic: {feature name}",
    "body": "{full specification}",
    "labels": ["enhancement"]
  },
  "tasks": [
    {
      "title": "{task title}",
      "body": "{task description with acceptance criteria}",
      "labels": ["{area}", "{size}"],
      "dependencies": []
    }
  ]
}

IMPORTANT: Return ONLY the JSON object, no additional text or formatting.`;
    }
    /**
     * Execute Claude command
     */
    async executeClaude(prompt) {
        // Write prompt to temp file
        const promptFile = path.join(this.tempDir, `prompt-${Date.now()}.txt`);
        await fs.promises.writeFile(promptFile, prompt, "utf-8");
        try {
            // Execute Claude with the prompt
            const command = `claude --dangerously-skip-permissions -p "${promptFile}"`;
            const { stdout, stderr } = await execAsync(command, {
                maxBuffer: 10 * 1024 * 1024, // 10MB buffer for large responses
                timeout: 300000, // 5 minute timeout
            });
            if (stderr && !stderr.includes("Warning")) {
                console.error("Claude stderr:", stderr);
            }
            return stdout.trim();
        }
        catch (error) {
            console.error("Claude execution error:", error);
            throw new Error(`Claude command failed: ${error.message}`);
        }
        finally {
            // Cleanup prompt file
            try {
                await fs.promises.unlink(promptFile);
            }
            catch (e) {
                // Ignore cleanup errors
            }
        }
    }
    /**
     * Parse JSON response from Claude
     */
    parseJSONResponse(response) {
        // Try to extract JSON from response (Claude might include extra text)
        const jsonMatch = response.match(/\{[\s\S]*\}/);
        if (!jsonMatch) {
            throw new Error("No JSON found in response");
        }
        try {
            return JSON.parse(jsonMatch[0]);
        }
        catch (error) {
            throw new Error("Invalid JSON in response");
        }
    }
    /**
     * Cleanup temp directory
     */
    cleanup() {
        try {
            if (fs.existsSync(this.tempDir)) {
                fs.rmSync(this.tempDir, { recursive: true, force: true });
            }
        }
        catch (error) {
            console.error("Cleanup error:", error);
        }
    }
}
exports.ClaudeAPI = ClaudeAPI;
//# sourceMappingURL=claude-api.js.map