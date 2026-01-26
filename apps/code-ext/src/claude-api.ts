import { exec } from "child_process";
import { promisify } from "util";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

const execAsync = promisify(exec);

/**
 * Claude API integration for design analysis
 */
export class ClaudeAPI {
  private tempDir: string;

  constructor() {
    this.tempDir = path.join(os.tmpdir(), "claude-projects-claude");
    // Ensure temp directory exists
    if (!fs.existsSync(this.tempDir)) {
      fs.mkdirSync(this.tempDir, { recursive: true });
    }
  }

  /**
   * Execute design analysis prompt
   */
  public async executeDesignAnalysis(
    projectDescription: string,
  ): Promise<string> {
    const prompt = this.buildDesignPrompt(projectDescription);
    return await this.executeClaude(prompt);
  }

  /**
   * Execute design iteration with feedback
   */
  public async executeDesignIteration(
    previousResult: string,
    userFeedback: string,
  ): Promise<string> {
    const prompt = this.buildIterationPrompt(previousResult, userFeedback);
    return await this.executeClaude(prompt);
  }

  /**
   * Execute project structure breakdown
   */
  public async executeProjectBreakdown(
    approvedDesign: string,
  ): Promise<string> {
    const prompt = this.buildProjectBreakdownPrompt(approvedDesign);
    return await this.executeClaude(prompt);
  }

  /**
   * Build design analysis prompt
   */
  private buildDesignPrompt(description: string): string {
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
  private buildIterationPrompt(
    previousResult: string,
    feedback: string,
  ): string {
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
  private buildProjectBreakdownPrompt(approvedDesign: string): string {
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
  private async executeClaude(prompt: string): Promise<string> {
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
    } catch (error: any) {
      console.error("Claude execution error:", error);
      throw new Error(`Claude command failed: ${error.message}`);
    } finally {
      // Cleanup prompt file
      try {
        await fs.promises.unlink(promptFile);
      } catch (e) {
        // Ignore cleanup errors
      }
    }
  }

  /**
   * Parse JSON response from Claude
   */
  public parseJSONResponse(response: string): any {
    // Try to extract JSON from response (Claude might include extra text)
    const jsonMatch = response.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error("No JSON found in response");
    }

    try {
      return JSON.parse(jsonMatch[0]);
    } catch (error) {
      throw new Error("Invalid JSON in response");
    }
  }

  /**
   * Cleanup temp directory
   */
  public cleanup(): void {
    try {
      if (fs.existsSync(this.tempDir)) {
        fs.rmSync(this.tempDir, { recursive: true, force: true });
      }
    } catch (error) {
      console.error("Cleanup error:", error);
    }
  }
}
