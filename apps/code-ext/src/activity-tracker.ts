import * as fs from 'fs';
import * as path from 'path';

/**
 * Types of agent activity events
 */
export type AgentActivityEventType =
    | 'claimed'
    | 'completed'
    | 'reviewed'
    | 'ideated'
    | 'created'
    | 'paused'
    | 'resumed'
    | 'error';

/**
 * Agent activity event
 */
export interface AgentActivityEvent {
    timestamp: string;
    agentId: string;
    eventType: AgentActivityEventType;
    projectNumber?: number;
    issueNumber?: number;
    details?: string;
}

/**
 * Activity log storage
 */
interface ActivityLog {
    events: AgentActivityEvent[];
    version: number;
}

/**
 * Activity Tracker
 *
 * Tracks and manages agent activity events for the dashboard.
 * Events are stored in `.claude-sessions/activity-log.json`.
 */
export class ActivityTracker {
    private readonly ACTIVITY_LOG_FILE = 'activity-log.json';
    private readonly MAX_EVENTS = 50;
    private readonly LOG_VERSION = 1;
    private workspaceRoot: string;

    constructor(workspaceRoot: string) {
        this.workspaceRoot = workspaceRoot;
    }

    /**
     * Get the full path to the activity log file
     */
    private getActivityLogPath(): string {
        return path.join(this.workspaceRoot, '.claude-sessions', this.ACTIVITY_LOG_FILE);
    }

    /**
     * Ensure the .claude-sessions directory exists
     */
    private ensureSessionsDirectory(): void {
        const sessionsPath = path.join(this.workspaceRoot, '.claude-sessions');
        if (!fs.existsSync(sessionsPath)) {
            fs.mkdirSync(sessionsPath, { recursive: true });
        }
    }

    /**
     * Load activity log from file
     */
    private loadActivityLog(): ActivityLog {
        const logPath = this.getActivityLogPath();

        if (!fs.existsSync(logPath)) {
            return {
                events: [],
                version: this.LOG_VERSION
            };
        }

        try {
            const content = fs.readFileSync(logPath, 'utf-8');
            const log = JSON.parse(content) as ActivityLog;

            // Validate version
            if (log.version !== this.LOG_VERSION) {
                console.warn('[ActivityTracker] Log version mismatch, resetting log');
                return {
                    events: [],
                    version: this.LOG_VERSION
                };
            }

            return log;
        } catch (error) {
            console.error('[ActivityTracker] Failed to load activity log:', error);
            return {
                events: [],
                version: this.LOG_VERSION
            };
        }
    }

    /**
     * Save activity log to file
     */
    private saveActivityLog(log: ActivityLog): void {
        this.ensureSessionsDirectory();

        const logPath = this.getActivityLogPath();

        try {
            fs.writeFileSync(logPath, JSON.stringify(log, null, 2), 'utf-8');
        } catch (error) {
            console.error('[ActivityTracker] Failed to save activity log:', error);
            throw error;
        }
    }

    /**
     * Log an agent activity event
     */
    public logAgentActivity(event: AgentActivityEvent): void {
        const log = this.loadActivityLog();

        // Add the new event
        log.events.push(event);

        // Trim to max events (FIFO)
        if (log.events.length > this.MAX_EVENTS) {
            log.events = log.events.slice(-this.MAX_EVENTS);
        }

        // Save
        this.saveActivityLog(log);

        console.log('[ActivityTracker] Logged event:', event.eventType, event.agentId);
    }

    /**
     * Get recent activity events
     */
    public getRecentActivity(limit: number = this.MAX_EVENTS): AgentActivityEvent[] {
        const log = this.loadActivityLog();

        // Return most recent events (reverse chronological)
        return log.events.slice(-limit).reverse();
    }

    /**
     * Clear old activity (resets the log)
     */
    public clearOldActivity(): void {
        const log: ActivityLog = {
            events: [],
            version: this.LOG_VERSION
        };

        this.saveActivityLog(log);
        console.log('[ActivityTracker] Activity log cleared');
    }

    /**
     * Get activity event count
     */
    public getActivityCount(): number {
        const log = this.loadActivityLog();
        return log.events.length;
    }
}
