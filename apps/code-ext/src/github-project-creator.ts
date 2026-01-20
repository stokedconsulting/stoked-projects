import { exec } from 'child_process';
import { promisify } from 'util';
import {
    ProjectCreationConfig,
    ProjectCreationResult,
    IssueDefinition,
    FailedTask
} from './project-flow-types';

const execAsync = promisify(exec);

/**
 * Callback for progress updates
 */
export type ProgressCallback = (step: string, current: number, total: number) => void;

/**
 * Configuration for retry behavior
 */
interface RetryConfig {
    maxRetries: number;
    baseDelayMs: number;
    rateLimitDelayMs: number;
}

const DEFAULT_RETRY_CONFIG: RetryConfig = {
    maxRetries: 3,
    baseDelayMs: 1000,
    rateLimitDelayMs: 500
};

/**
 * GitHub Project creator using gh CLI
 */
export class GitHubProjectCreator {
    private retryConfig: RetryConfig;

    constructor(retryConfig?: Partial<RetryConfig>) {
        this.retryConfig = { ...DEFAULT_RETRY_CONFIG, ...retryConfig };
    }

    /**
     * Validate project creation configuration
     */
    public validateConfig(config: ProjectCreationConfig): void {
        if (!config.projectTitle?.trim()) {
            throw new Error('Project title is required');
        }
        if (!config.repoOwner?.trim()) {
            throw new Error('Repository owner is required');
        }
        if (!config.repoName?.trim()) {
            throw new Error('Repository name is required');
        }
        if (!config.epic?.title?.trim()) {
            throw new Error('Epic issue title is required');
        }
        if (!config.tasks || config.tasks.length === 0) {
            throw new Error('At least one task is required');
        }
        for (let i = 0; i < config.tasks.length; i++) {
            if (!config.tasks[i].title?.trim()) {
                throw new Error(`Task ${i + 1} must have a title`);
            }
        }
    }

    /**
     * Execute a function with retry logic and exponential backoff
     */
    private async executeWithRetry<T>(
        fn: () => Promise<T>,
        operationName: string
    ): Promise<T> {
        let lastError: Error | null = null;

        for (let attempt = 1; attempt <= this.retryConfig.maxRetries; attempt++) {
            try {
                return await fn();
            } catch (error: any) {
                lastError = error;
                console.warn(
                    `${operationName} failed (attempt ${attempt}/${this.retryConfig.maxRetries}):`,
                    error.message
                );

                if (attempt < this.retryConfig.maxRetries) {
                    // Exponential backoff
                    const delay = this.retryConfig.baseDelayMs * Math.pow(2, attempt - 1);
                    await this.sleep(delay);
                }
            }
        }

        throw lastError || new Error(`${operationName} failed after ${this.retryConfig.maxRetries} attempts`);
    }

    /**
     * Sleep for specified milliseconds
     */
    private sleep(ms: number): Promise<void> {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    /**
     * Create GitHub Project with issues
     */
    public async createProject(
        config: ProjectCreationConfig,
        onProgress?: ProgressCallback
    ): Promise<ProjectCreationResult> {
        // Validate configuration first
        this.validateConfig(config);

        const totalSteps = 5 + config.tasks.length;
        let currentStep = 0;
        const failedTasks: FailedTask[] = [];

        try {
            // Step 1: Create project
            if (onProgress) {
                onProgress('Creating GitHub Project...', ++currentStep, totalSteps);
            }

            const createCmd = config.isPublic
                ? `gh project create --owner ${config.repoOwner} --title "${config.projectTitle}" --public --format json`
                : `gh project create --owner ${config.repoOwner} --title "${config.projectTitle}" --format json`;

            const createResult = await this.executeWithRetry(
                () => execAsync(createCmd),
                'Create project'
            );
            const projectData = JSON.parse(createResult.stdout);
            const projectUrl = projectData.url;

            // Extract project number from URL (e.g., https://github.com/orgs/owner/projects/123)
            const projectNumMatch = projectUrl.match(/projects\/(\d+)/);
            if (!projectNumMatch) {
                throw new Error('Could not extract project number from URL');
            }
            const projectNum = parseInt(projectNumMatch[1], 10);

            // Step 2: Get project number (alternative method if above fails)
            if (onProgress) {
                onProgress('Getting project details...', ++currentStep, totalSteps);
            }

            // Step 3: Link project to repository
            if (onProgress) {
                onProgress('Linking project to repository...', ++currentStep, totalSteps);
            }

            await this.executeWithRetry(
                () => execAsync(
                    `gh project link ${projectNum} --owner ${config.repoOwner} --repo ${config.repoOwner}/${config.repoName}`
                ),
                'Link project to repository'
            );

            // Rate limit delay
            await this.sleep(this.retryConfig.rateLimitDelayMs);

            // Step 4: Create epic issue
            if (onProgress) {
                onProgress('Creating epic issue...', ++currentStep, totalSteps);
            }

            const epicUrl = await this.executeWithRetry(
                () => this.createIssue(config.repoOwner, config.repoName, config.epic),
                'Create epic issue'
            );

            await this.executeWithRetry(
                () => this.addItemToProject(projectNum, config.repoOwner, epicUrl),
                'Add epic to project'
            );

            // Rate limit delay
            await this.sleep(this.retryConfig.rateLimitDelayMs);

            // Step 5+: Create task issues with per-task error handling
            const taskUrls: string[] = [];
            for (let i = 0; i < config.tasks.length; i++) {
                const task = config.tasks[i];
                if (onProgress) {
                    onProgress(
                        `Creating task issue ${i + 1}/${config.tasks.length}...`,
                        ++currentStep,
                        totalSteps
                    );
                }

                try {
                    const taskUrl = await this.executeWithRetry(
                        () => this.createIssue(config.repoOwner, config.repoName, task),
                        `Create task "${task.title}"`
                    );
                    taskUrls.push(taskUrl);

                    await this.executeWithRetry(
                        () => this.addItemToProject(projectNum, config.repoOwner, taskUrl),
                        `Add task to project`
                    );
                } catch (error: any) {
                    // Log error but continue with remaining tasks
                    console.error(`Failed to create task "${task.title}":`, error.message);
                    failedTasks.push({
                        task,
                        error: error.message
                    });
                }

                // Rate limit delay between tasks
                await this.sleep(this.retryConfig.rateLimitDelayMs);
            }

            // Final step
            if (onProgress) {
                const successCount = config.tasks.length - failedTasks.length;
                const message = failedTasks.length > 0
                    ? `Project created with ${successCount}/${config.tasks.length} tasks (${failedTasks.length} failed)`
                    : 'Project created successfully!';
                onProgress(message, totalSteps, totalSteps);
            }

            return {
                projectNum,
                projectUrl,
                epicUrl,
                taskUrls,
                failedTasks: failedTasks.length > 0 ? failedTasks : undefined
            };
        } catch (error: any) {
            console.error('Project creation error:', error);

            // Parse error message for better user feedback
            if (error.stderr && error.stderr.includes('missing required scopes')) {
                throw new Error(
                    'Missing required GitHub scopes. Run: gh auth refresh -s project'
                );
            }

            throw new Error(`Failed to create project: ${error.message}`);
        }
    }

    /**
     * Create a single issue
     */
    private async createIssue(
        owner: string,
        repo: string,
        issue: IssueDefinition
    ): Promise<string> {
        const labelsArg = issue.labels.map(l => `--label "${l}"`).join(' ');

        // Escape body for command line
        const bodyEscaped = issue.body.replace(/"/g, '\\"').replace(/\$/g, '\\$');

        const command = `gh issue create \\
            --repo ${owner}/${repo} \\
            --title "${issue.title}" \\
            --body "${bodyEscaped}" \\
            ${labelsArg}`;

        const result = await execAsync(command);
        // Extract URL from output (e.g., "https://github.com/owner/repo/issues/123")
        const urlMatch = result.stdout.match(/https:\/\/github\.com\/[^\s]+/);
        if (!urlMatch) {
            throw new Error('Could not extract issue URL from output');
        }
        return urlMatch[0].trim();
    }

    /**
     * Add item to project
     */
    private async addItemToProject(
        projectNum: number,
        owner: string,
        itemUrl: string
    ): Promise<void> {
        await execAsync(
            `gh project item-add ${projectNum} --owner ${owner} --url ${itemUrl}`
        );
    }

    /**
     * Check if gh CLI is authenticated
     */
    public async checkAuth(): Promise<{ authenticated: boolean; error?: string }> {
        try {
            await execAsync('gh auth status');
            return { authenticated: true };
        } catch (error: any) {
            return {
                authenticated: false,
                error: error.stderr || error.message
            };
        }
    }

    /**
     * Check if gh CLI has project scope
     */
    public async checkProjectScope(): Promise<{ hasScope: boolean; error?: string }> {
        try {
            // Try to list projects - this will fail if scope is missing
            await execAsync('gh project list --limit 1');
            return { hasScope: true };
        } catch (error: any) {
            const stderr = error.stderr || '';
            if (stderr.includes('missing required scopes')) {
                return {
                    hasScope: false,
                    error: 'Missing project scope. Run: gh auth refresh -s project'
                };
            }
            return {
                hasScope: false,
                error: stderr || error.message
            };
        }
    }
}
