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
exports.ActivityTracker = void 0;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
/**
 * Activity Tracker
 *
 * Tracks and manages agent activity events for the dashboard.
 * Events are stored in `.claude-sessions/activity-log.json`.
 */
class ActivityTracker {
    ACTIVITY_LOG_FILE = 'activity-log.json';
    MAX_EVENTS = 50;
    LOG_VERSION = 1;
    workspaceRoot;
    constructor(workspaceRoot) {
        this.workspaceRoot = workspaceRoot;
    }
    /**
     * Get the full path to the activity log file
     */
    getActivityLogPath() {
        return path.join(this.workspaceRoot, '.claude-sessions', this.ACTIVITY_LOG_FILE);
    }
    /**
     * Ensure the .claude-sessions directory exists
     */
    ensureSessionsDirectory() {
        const sessionsPath = path.join(this.workspaceRoot, '.claude-sessions');
        if (!fs.existsSync(sessionsPath)) {
            fs.mkdirSync(sessionsPath, { recursive: true });
        }
    }
    /**
     * Load activity log from file
     */
    loadActivityLog() {
        const logPath = this.getActivityLogPath();
        if (!fs.existsSync(logPath)) {
            return {
                events: [],
                version: this.LOG_VERSION
            };
        }
        try {
            const content = fs.readFileSync(logPath, 'utf-8');
            const log = JSON.parse(content);
            // Validate version
            if (log.version !== this.LOG_VERSION) {
                console.warn('[ActivityTracker] Log version mismatch, resetting log');
                return {
                    events: [],
                    version: this.LOG_VERSION
                };
            }
            return log;
        }
        catch (error) {
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
    saveActivityLog(log) {
        this.ensureSessionsDirectory();
        const logPath = this.getActivityLogPath();
        try {
            fs.writeFileSync(logPath, JSON.stringify(log, null, 2), 'utf-8');
        }
        catch (error) {
            console.error('[ActivityTracker] Failed to save activity log:', error);
            throw error;
        }
    }
    /**
     * Log an agent activity event
     */
    logAgentActivity(event) {
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
    getRecentActivity(limit = this.MAX_EVENTS) {
        const log = this.loadActivityLog();
        // Return most recent events (reverse chronological)
        return log.events.slice(-limit).reverse();
    }
    /**
     * Clear old activity (resets the log)
     */
    clearOldActivity() {
        const log = {
            events: [],
            version: this.LOG_VERSION
        };
        this.saveActivityLog(log);
        console.log('[ActivityTracker] Activity log cleared');
    }
    /**
     * Get activity event count
     */
    getActivityCount() {
        const log = this.loadActivityLog();
        return log.events.length;
    }
}
exports.ActivityTracker = ActivityTracker;
//# sourceMappingURL=activity-tracker.js.map