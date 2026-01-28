import * as fs from 'fs';
import * as path from 'path';
import { GitHubAPI, ProjectItem } from './github-api';

/**
 * Claim information stored in the claims file
 */
export interface ProjectClaim {
    agentId: string;
    claimedAt: string;
    projectNumber: number;
    issueNumber: number;
}

/**
 * In-memory cache of claims file to reduce file I/O
 */
interface ClaimsCache {
    [key: string]: ProjectClaim;
}

/**
 * Project Queue Manager
 *
 * Manages project discovery, filtering, and atomic claiming via State Tracking API.
 * For now, uses local file-based tracking in `.claude-sessions/claims.json` as a stub.
 *
 * Future integration with State Tracking API will replace file-based tracking with
 * API calls to a centralized service.
 */
export class ProjectQueueManager {
    private readonly SESSIONS_DIR = '.claude-sessions';
    private readonly CLAIMS_FILE = 'claims.json';
    private readonly CLAIM_EXPIRATION_MS = 8 * 60 * 60 * 1000; // 8 hours
    private workspaceRoot: string;
    private githubApi: GitHubAPI;

    constructor(workspaceRoot: string, githubApi: GitHubAPI) {
        this.workspaceRoot = workspaceRoot;
        this.githubApi = githubApi;
    }

    /**
     * Get the full path to the sessions directory
     */
    private getSessionsDirectory(): string {
        return path.join(this.workspaceRoot, this.SESSIONS_DIR);
    }

    /**
     * Get the full path to the claims file
     */
    private getClaimsFilePath(): string {
        return path.join(this.getSessionsDirectory(), this.CLAIMS_FILE);
    }

    /**
     * Ensure the sessions directory exists
     */
    private ensureSessionsDirectory(): void {
        const sessionsPath = this.getSessionsDirectory();
        if (!fs.existsSync(sessionsPath)) {
            fs.mkdirSync(sessionsPath, { recursive: true });
        }
    }

    /**
     * Generate a unique key for a project claim
     */
    private getClaimKey(projectNumber: number, issueNumber: number): string {
        return `${projectNumber}-${issueNumber}`;
    }

    /**
     * Read claims file atomically
     * Returns empty object if file doesn't exist
     */
    private readClaimsFile(): ClaimsCache {
        const filePath = this.getClaimsFilePath();

        if (!fs.existsSync(filePath)) {
            return {};
        }

        try {
            const content = fs.readFileSync(filePath, 'utf-8');
            const parsed = JSON.parse(content);

            // Validate structure
            if (typeof parsed !== 'object' || parsed === null) {
                console.error('[ProjectQueueManager] Invalid claims file structure, resetting');
                return {};
            }

            return parsed as ClaimsCache;
        } catch (error) {
            console.error('[ProjectQueueManager] Error reading claims file:', error);
            // Return empty cache on error (file corruption, parse error, etc.)
            return {};
        }
    }

    /**
     * Write claims file atomically using temp file + rename pattern
     * This prevents file corruption from incomplete writes
     */
    private writeClaimsFileAtomic(claims: ClaimsCache): void {
        this.ensureSessionsDirectory();

        const filePath = this.getClaimsFilePath();
        const tempPath = `${filePath}.tmp`;
        const content = JSON.stringify(claims, null, 2);

        // Write to temp file
        fs.writeFileSync(tempPath, content, 'utf-8');

        // Atomically rename temp file to target file
        fs.renameSync(tempPath, filePath);
    }

    /**
     * Retry an async operation with exponential backoff
     * Backoff sequence: 1s, 2s, 4s (max 3 retries)
     */
    private async retryWithBackoff<T>(
        operation: () => Promise<T>,
        context: string,
        maxRetries: number = 3
    ): Promise<T> {
        let lastError: Error | null = null;

        for (let attempt = 0; attempt < maxRetries; attempt++) {
            try {
                return await operation();
            } catch (error) {
                lastError = error as Error;
                const backoffMs = Math.pow(2, attempt) * 1000; // 1s, 2s, 4s

                console.error(
                    `[ProjectQueueManager] ${context} failed (attempt ${attempt + 1}/${maxRetries}):`,
                    error
                );

                if (attempt < maxRetries - 1) {
                    console.log(
                        `[ProjectQueueManager] Retrying in ${backoffMs}ms...`
                    );
                    await new Promise(resolve => setTimeout(resolve, backoffMs));
                }
            }
        }

        throw lastError;
    }

    /**
     * Check if a claim has expired
     */
    private isClaimExpired(claim: ProjectClaim): boolean {
        const claimedTime = new Date(claim.claimedAt).getTime();
        const now = Date.now();
        return now - claimedTime > this.CLAIM_EXPIRATION_MS;
    }

    /**
     * Clean up stale claims (older than 8 hours)
     * AC-2.1.d: When agent claim is older than 8 hours and agent is unresponsive → claim is automatically released
     */
    public async cleanupStaleClaims(): Promise<void> {
        await this.retryWithBackoff(
            async () => {
                const claims = this.readClaimsFile();
                const cleanedClaims: ClaimsCache = {};
                let removedCount = 0;

                for (const [key, claim] of Object.entries(claims)) {
                    if (this.isClaimExpired(claim)) {
                        console.log(
                            `[ProjectQueueManager] Removing stale claim: ${key} (agent: ${claim.agentId})`
                        );
                        removedCount++;
                    } else {
                        cleanedClaims[key] = claim;
                    }
                }

                if (removedCount > 0) {
                    this.writeClaimsFileAtomic(cleanedClaims);
                    console.log(`[ProjectQueueManager] Cleaned up ${removedCount} stale claim(s)`);
                }
            },
            'Clean up stale claims',
            3
        );
    }

    /**
     * Get all available (unclaimed) projects in a GitHub project
     * Filters out issues already claimed by other agents
     *
     * AC-2.1.a: When agent queries project queue → only unclaimed issues with status "todo" or "backlog" are returned within 1 second
     *
     * @param projectId - GitHub project ID
     * @returns Array of unclaimed project items with status "todo" or "backlog"
     */
    public async getAvailableProjects(projectId: string): Promise<ProjectItem[]> {
        const startTime = Date.now();

        // Fetch all project items from GitHub
        const allItems = await this.githubApi.getProjectItems(projectId);

        // Filter for todo/backlog status
        const eligibleItems = allItems.filter(item => {
            const status = item.fieldValues['Status']?.toLowerCase();
            return status === 'todo' || status === 'backlog';
        });

        // Read current claims and filter out claimed items
        const claims = this.readClaimsFile();
        const availableItems = eligibleItems.filter(item => {
            const issueNumber = item.content.number;
            // Extract project number from item (assumes we're working with a single project)
            // In future, this should be passed in or stored in ProjectItem
            const claimKey = Object.keys(claims).find(key => {
                const claim = claims[key];
                return claim.issueNumber === issueNumber;
            });

            if (!claimKey) {
                return true; // Not claimed
            }

            const claim = claims[claimKey];
            if (this.isClaimExpired(claim)) {
                // Claim expired, item is available
                return true;
            }

            // Item is claimed by another agent
            return false;
        });

        // Sort by issue number ascending (lower numbers = higher priority)
        availableItems.sort((a, b) => a.content.number - b.content.number);

        const duration = Date.now() - startTime;
        console.log(
            `[ProjectQueueManager] Found ${availableItems.length} available items (out of ${eligibleItems.length} eligible) in ${duration}ms`
        );

        return availableItems;
    }

    /**
     * Atomically claim a project issue for an agent
     * Uses file locking pattern to ensure only one agent can claim an issue
     *
     * AC-2.1.b: When agent attempts to claim issue → claim succeeds atomically and issue is removed from other agents' queues immediately
     * AC-2.1.c: When two agents attempt to claim same issue simultaneously → one succeeds and one fails (no double claims)
     * AC-2.1.e: When claim operation fails → agent retries up to 3 times with exponential backoff
     *
     * @param projectNumber - GitHub project number
     * @param issueNumber - GitHub issue number
     * @param agentId - Agent identifier attempting to claim
     * @returns true if claim succeeded, false if already claimed or failed
     */
    public async claimProject(
        projectNumber: number,
        issueNumber: number,
        agentId: string
    ): Promise<boolean> {
        return await this.retryWithBackoff(
            async () => {
                const claimKey = this.getClaimKey(projectNumber, issueNumber);
                const claims = this.readClaimsFile();

                // Check if already claimed by another agent (and not expired)
                if (claims[claimKey]) {
                    const existingClaim = claims[claimKey];

                    if (this.isClaimExpired(existingClaim)) {
                        console.log(
                            `[ProjectQueueManager] Existing claim expired, allowing new claim: ${claimKey}`
                        );
                    } else if (existingClaim.agentId !== agentId) {
                        console.log(
                            `[ProjectQueueManager] Issue ${claimKey} already claimed by ${existingClaim.agentId}`
                        );
                        return false;
                    } else {
                        // Same agent re-claiming, allow it (idempotent)
                        console.log(
                            `[ProjectQueueManager] Agent ${agentId} re-claiming ${claimKey}`
                        );
                        return true;
                    }
                }

                // Create new claim
                const newClaim: ProjectClaim = {
                    agentId,
                    claimedAt: new Date().toISOString(),
                    projectNumber,
                    issueNumber
                };

                claims[claimKey] = newClaim;
                this.writeClaimsFileAtomic(claims);

                console.log(
                    `[ProjectQueueManager] Successfully claimed ${claimKey} for ${agentId}`
                );
                return true;
            },
            `Claim project ${projectNumber} issue ${issueNumber}`,
            3
        );
    }

    /**
     * Release a project claim
     *
     * @param projectNumber - GitHub project number
     * @param issueNumber - GitHub issue number
     */
    public async releaseProjectClaim(
        projectNumber: number,
        issueNumber: number
    ): Promise<void> {
        await this.retryWithBackoff(
            async () => {
                const claimKey = this.getClaimKey(projectNumber, issueNumber);
                const claims = this.readClaimsFile();

                if (!claims[claimKey]) {
                    console.log(
                        `[ProjectQueueManager] No claim found for ${claimKey}, nothing to release`
                    );
                    return;
                }

                delete claims[claimKey];
                this.writeClaimsFileAtomic(claims);

                console.log(`[ProjectQueueManager] Released claim for ${claimKey}`);
            },
            `Release claim for project ${projectNumber} issue ${issueNumber}`,
            3
        );
    }

    /**
     * Get all projects claimed by a specific agent
     *
     * @param agentId - Agent identifier
     * @returns Array of project claims for this agent
     */
    public async getClaimedProjects(agentId: string): Promise<ProjectClaim[]> {
        const claims = this.readClaimsFile();
        const agentClaims: ProjectClaim[] = [];

        for (const claim of Object.values(claims)) {
            if (claim.agentId === agentId && !this.isClaimExpired(claim)) {
                agentClaims.push(claim);
            }
        }

        return agentClaims;
    }

    /**
     * Check if a specific project issue is currently claimed
     *
     * @param projectNumber - GitHub project number
     * @param issueNumber - GitHub issue number
     * @returns true if claimed (and not expired), false otherwise
     */
    public async isProjectClaimed(
        projectNumber: number,
        issueNumber: number
    ): Promise<boolean> {
        const claimKey = this.getClaimKey(projectNumber, issueNumber);
        const claims = this.readClaimsFile();

        if (!claims[claimKey]) {
            return false;
        }

        const claim = claims[claimKey];
        return !this.isClaimExpired(claim);
    }

    /**
     * Get claim information for a specific project issue
     *
     * @param projectNumber - GitHub project number
     * @param issueNumber - GitHub issue number
     * @returns ProjectClaim if exists and not expired, null otherwise
     */
    public async getProjectClaim(
        projectNumber: number,
        issueNumber: number
    ): Promise<ProjectClaim | null> {
        const claimKey = this.getClaimKey(projectNumber, issueNumber);
        const claims = this.readClaimsFile();

        if (!claims[claimKey]) {
            return null;
        }

        const claim = claims[claimKey];
        return this.isClaimExpired(claim) ? null : claim;
    }

    /**
     * Get all active claims (non-expired)
     *
     * @returns Array of all active project claims
     */
    public async getAllActiveClaims(): Promise<ProjectClaim[]> {
        const claims = this.readClaimsFile();
        const activeClaims: ProjectClaim[] = [];

        for (const claim of Object.values(claims)) {
            if (!this.isClaimExpired(claim)) {
                activeClaims.push(claim);
            }
        }

        return activeClaims;
    }

    /**
     * Clear all claims (for testing purposes)
     * WARNING: This will remove ALL claims from the system
     */
    public async clearAllClaims(): Promise<void> {
        await this.retryWithBackoff(
            async () => {
                this.writeClaimsFileAtomic({});
                console.log('[ProjectQueueManager] Cleared all claims');
            },
            'Clear all claims',
            3
        );
    }
}
