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
exports.HealthMonitor = void 0;
const vscode = __importStar(require("vscode"));
const cost_tracker_1 = require("./cost-tracker");
/**
 * Health Monitor
 *
 * Proactive health checks and user notifications for agent issues.
 *
 * AC-5.2.a: When health check runs → all agent health statuses are evaluated within 5 seconds
 * AC-5.2.b: When agent becomes unresponsive (heartbeat > 120s ago) → error notification is displayed
 * AC-5.2.c: When agent error rate exceeds 10 errors/hour → error notification with details
 * AC-5.2.d: When budget reaches 90% → critical notification and pause new claims
 * AC-5.2.e: When agent is stuck for > 30 minutes → error notification with "Restart Agent" action
 * AC-5.2.f: When health check fails due to API error → error is logged and check is skipped
 */
class HealthMonitor {
    HEALTH_CHECK_INTERVAL_MS = 60000; // 60 seconds
    NOTIFICATION_COOLDOWN_MS = 300000; // 5 minutes
    ERROR_RATE_WINDOW_MS = 3600000; // 1 hour
    ERROR_RATE_DEGRADED_THRESHOLD = 3;
    ERROR_RATE_CRITICAL_THRESHOLD = 10;
    heartbeatManager;
    loopValidator;
    queueManager;
    sessionManager;
    healthCheckTimer = null;
    alertHistory = [];
    lastNotificationTime = new Map();
    agentErrorTracking = new Map();
    budgetPausedClaims = false;
    constructor(heartbeatManager, loopValidator, queueManager, sessionManager) {
        this.heartbeatManager = heartbeatManager;
        this.loopValidator = loopValidator;
        this.queueManager = queueManager;
        this.sessionManager = sessionManager;
    }
    /**
     * Generate unique alert ID based on type and context
     */
    generateAlertId(source, context) {
        return `${source}-${context}-${Date.now()}`;
    }
    /**
     * Check if notification cooldown period has passed
     */
    canSendNotification(alertType) {
        const lastTime = this.lastNotificationTime.get(alertType);
        if (!lastTime) {
            return true;
        }
        const elapsed = Date.now() - lastTime;
        return elapsed >= this.NOTIFICATION_COOLDOWN_MS;
    }
    /**
     * Record notification sent time
     */
    recordNotification(alertType) {
        this.lastNotificationTime.set(alertType, Date.now());
    }
    /**
     * Create and log an alert
     */
    createAlert(level, message, source) {
        const alert = {
            id: this.generateAlertId(source, message.substring(0, 20)),
            level,
            message,
            source,
            timestamp: new Date().toISOString(),
            dismissed: false
        };
        this.alertHistory.push(alert);
        // Keep only last 100 alerts
        if (this.alertHistory.length > 100) {
            this.alertHistory = this.alertHistory.slice(-100);
        }
        return alert;
    }
    /**
     * Send VS Code notification based on alert level
     */
    async sendNotification(alert) {
        const alertType = `${alert.source}-${alert.level}`;
        if (!this.canSendNotification(alertType)) {
            console.log(`[HealthMonitor] Skipping notification (cooldown): ${alert.message}`);
            return;
        }
        this.recordNotification(alertType);
        switch (alert.level) {
            case 'info':
                // Info alerts shown in dashboard only, no toast
                break;
            case 'warning':
                vscode.window.showWarningMessage(alert.message);
                break;
            case 'error':
                // Show error with optional actions
                if (alert.source === 'agent-stuck') {
                    const action = await vscode.window.showErrorMessage(alert.message, 'Restart Agent', 'Dismiss');
                    if (action === 'Restart Agent') {
                        // TODO: Implement agent restart logic
                        console.log('[HealthMonitor] Restart agent action triggered');
                    }
                }
                else {
                    vscode.window.showErrorMessage(alert.message);
                }
                break;
            case 'critical':
                vscode.window.showErrorMessage(alert.message, { modal: true });
                break;
        }
    }
    /**
     * Evaluate agent health based on heartbeat
     * AC-5.2.b: Unresponsive agent detection
     */
    async checkAgentHealth() {
        const healthStatuses = await this.heartbeatManager.getAllAgentHealthStatuses();
        const alerts = [];
        for (const [agentId, healthResult] of healthStatuses.entries()) {
            const agentIdStr = `agent-${agentId}`;
            if (healthResult.status === 'unresponsive') {
                const alert = this.createAlert('error', `Agent ${agentIdStr} is unresponsive (last heartbeat: ${healthResult.timeSinceLastHeartbeat ? Math.round(healthResult.timeSinceLastHeartbeat / 1000) : 'N/A'}s ago)`, 'agent-health');
                alerts.push(alert);
                await this.sendNotification(alert);
            }
            else if (healthResult.status === 'degraded') {
                const alert = this.createAlert('warning', `Agent ${agentIdStr} is degraded (last heartbeat: ${healthResult.timeSinceLastHeartbeat ? Math.round(healthResult.timeSinceLastHeartbeat / 1000) : 'N/A'}s ago)`, 'agent-health');
                alerts.push(alert);
            }
        }
        // Convert Map<number, HealthStatusResult> to Map<string, HealthStatusResult>
        const stringKeyedMap = new Map();
        for (const [agentId, healthResult] of healthStatuses.entries()) {
            stringKeyedMap.set(`agent-${agentId}`, healthResult);
        }
        return stringKeyedMap;
    }
    /**
     * Track agent errors and calculate error rate
     * AC-5.2.c: High error rate detection
     */
    async checkAgentErrorRate() {
        const sessions = await this.sessionManager.listAgentSessions();
        const alerts = [];
        const now = Date.now();
        const windowStart = now - this.ERROR_RATE_WINDOW_MS;
        for (const session of sessions) {
            // Get or create error tracking for this agent
            let tracking = this.agentErrorTracking.get(session.agentId);
            if (!tracking) {
                tracking = { agentId: session.agentId, errors: [] };
                this.agentErrorTracking.set(session.agentId, tracking);
            }
            // Update error count from session
            if (session.errorCount > 0 && session.lastError) {
                // Add error if not already tracked
                const errorExists = tracking.errors.some(e => e.message === session.lastError);
                if (!errorExists) {
                    tracking.errors.push({
                        timestamp: Date.now(),
                        message: session.lastError || 'Unknown error'
                    });
                }
            }
            // Filter errors within the time window
            tracking.errors = tracking.errors.filter(e => e.timestamp >= windowStart);
            // Check error rate thresholds
            const errorCount = tracking.errors.length;
            if (errorCount >= this.ERROR_RATE_CRITICAL_THRESHOLD) {
                const alert = this.createAlert('error', `Agent ${session.agentId} has ${errorCount} errors in the last hour (last error: ${session.lastError || 'N/A'})`, 'agent-error-rate');
                alerts.push(alert);
                await this.sendNotification(alert);
            }
            else if (errorCount >= this.ERROR_RATE_DEGRADED_THRESHOLD) {
                const alert = this.createAlert('warning', `Agent ${session.agentId} has ${errorCount} errors in the last hour`, 'agent-error-rate');
                alerts.push(alert);
            }
        }
        return alerts;
    }
    /**
     * Check queue depth health
     */
    async checkQueueHealth() {
        const queueDepth = await this.loopValidator.getQueueDepth();
        const depth = queueDepth.projectQueueDepth;
        let level;
        if (depth < 3) {
            level = 'low';
            const alert = this.createAlert('info', `Project queue depth is low (${depth} projects)`, 'queue-depth');
            // Info alerts don't trigger notifications
        }
        else if (depth > 10) {
            level = 'high';
            const alert = this.createAlert('warning', `Project queue depth is high (${depth} projects). Consider pausing ideation.`, 'queue-depth');
            await this.sendNotification(alert);
        }
        else {
            level = 'healthy';
        }
        return {
            depth,
            level,
            lastChecked: new Date().toISOString()
        };
    }
    /**
     * Check budget health
     * AC-5.2.d: Budget threshold detection
     */
    async checkBudgetHealth() {
        const budgetStatus = await (0, cost_tracker_1.checkBudget)();
        const dailyPercent = budgetStatus.dailyPercentUsed;
        const monthlyPercent = budgetStatus.monthlyPercentUsed;
        let level;
        if (dailyPercent >= 90 || monthlyPercent >= 90) {
            level = 'critical';
            const alert = this.createAlert('critical', `Budget critical: ${dailyPercent.toFixed(1)}% daily, ${monthlyPercent.toFixed(1)}% monthly. New project claims paused.`, 'budget');
            await this.sendNotification(alert);
            // Pause new claims
            if (!this.budgetPausedClaims) {
                this.budgetPausedClaims = true;
                console.log('[HealthMonitor] Budget limit reached, pausing new project claims');
            }
        }
        else if (dailyPercent >= 75 || monthlyPercent >= 75) {
            level = 'warning';
            const alert = this.createAlert('warning', `Budget warning: ${dailyPercent.toFixed(1)}% daily, ${monthlyPercent.toFixed(1)}% monthly used.`, 'budget');
            await this.sendNotification(alert);
        }
        else if (dailyPercent >= 50 || monthlyPercent >= 50) {
            level = 'warning';
            const alert = this.createAlert('info', `Budget notice: ${dailyPercent.toFixed(1)}% daily, ${monthlyPercent.toFixed(1)}% monthly used.`, 'budget');
            // Info level - no notification
        }
        else {
            level = 'healthy';
            // Re-enable claims if budget is back under threshold
            if (this.budgetPausedClaims) {
                this.budgetPausedClaims = false;
                console.log('[HealthMonitor] Budget under limit, resuming project claims');
            }
        }
        return {
            dailyPercentUsed: dailyPercent,
            monthlyPercentUsed: monthlyPercent,
            level,
            lastChecked: new Date().toISOString()
        };
    }
    /**
     * Check for stuck agents
     * AC-5.2.e: Stuck agent detection
     */
    async checkStuckAgents() {
        const stuckAgents = await this.loopValidator.detectStuckAgents();
        const alerts = [];
        for (const stuck of stuckAgents) {
            const alert = this.createAlert('error', `Agent ${stuck.agentId} is stuck in ${stuck.currentStatus} state for ${stuck.stuckDuration} minutes`, 'agent-stuck');
            alerts.push(alert);
            await this.sendNotification(alert);
        }
        return alerts;
    }
    /**
     * Run comprehensive health check
     * AC-5.2.a: Complete health evaluation within 5 seconds
     * AC-5.2.f: Handle API errors gracefully
     */
    async runHealthCheck() {
        const startTime = Date.now();
        console.log('[HealthMonitor] Running health check...');
        const alerts = [];
        let agentHealth = new Map();
        let queueHealth = {
            depth: 0,
            level: 'healthy',
            lastChecked: new Date().toISOString()
        };
        let budgetHealth = {
            dailyPercentUsed: 0,
            monthlyPercentUsed: 0,
            level: 'healthy',
            lastChecked: new Date().toISOString()
        };
        try {
            // Run all health checks
            agentHealth = await this.checkAgentHealth();
            const errorRateAlerts = await this.checkAgentErrorRate();
            alerts.push(...errorRateAlerts);
            queueHealth = await this.checkQueueHealth();
            budgetHealth = await this.checkBudgetHealth();
            const stuckAgentAlerts = await this.checkStuckAgents();
            alerts.push(...stuckAgentAlerts);
        }
        catch (error) {
            // AC-5.2.f: Handle API errors gracefully
            console.error('[HealthMonitor] Health check failed:', error);
            const alert = this.createAlert('error', `Health check failed: ${error instanceof Error ? error.message : 'Unknown error'}`, 'health-check');
            alerts.push(alert);
        }
        // Determine overall status
        let overallStatus = 'healthy';
        for (const alert of alerts) {
            if (alert.level === 'critical' && overallStatus !== 'critical') {
                overallStatus = 'critical';
            }
            else if (alert.level === 'error' && overallStatus !== 'critical') {
                overallStatus = 'error';
            }
            else if (alert.level === 'warning' && overallStatus === 'healthy') {
                overallStatus = 'warning';
            }
        }
        const duration = Date.now() - startTime;
        console.log(`[HealthMonitor] Health check completed in ${duration}ms, status: ${overallStatus}`);
        return {
            timestamp: new Date().toISOString(),
            agentHealth,
            queueHealth,
            budgetHealth,
            overallStatus,
            alerts
        };
    }
    /**
     * Start periodic health monitoring
     */
    startHealthMonitoring() {
        if (this.healthCheckTimer) {
            console.log('[HealthMonitor] Health monitoring already running');
            return;
        }
        console.log(`[HealthMonitor] Starting health monitoring (interval: ${this.HEALTH_CHECK_INTERVAL_MS}ms)`);
        // Run initial health check
        void this.runHealthCheck();
        // Schedule periodic checks
        this.healthCheckTimer = setInterval(() => {
            void this.runHealthCheck();
        }, this.HEALTH_CHECK_INTERVAL_MS);
    }
    /**
     * Stop health monitoring
     */
    stopHealthMonitoring() {
        if (this.healthCheckTimer) {
            clearInterval(this.healthCheckTimer);
            this.healthCheckTimer = null;
            console.log('[HealthMonitor] Stopped health monitoring');
        }
    }
    /**
     * Get alert history
     */
    getAlertHistory() {
        return [...this.alertHistory];
    }
    /**
     * Clear/dismiss a specific alert
     */
    clearAlert(alertId) {
        const alert = this.alertHistory.find(a => a.id === alertId);
        if (alert) {
            alert.dismissed = true;
            console.log(`[HealthMonitor] Dismissed alert: ${alertId}`);
        }
    }
    /**
     * Check if budget has paused new claims
     */
    isBudgetPaused() {
        return this.budgetPausedClaims;
    }
    /**
     * Clear all alerts (for testing)
     */
    clearAllAlerts() {
        this.alertHistory = [];
        console.log('[HealthMonitor] Cleared all alerts');
    }
}
exports.HealthMonitor = HealthMonitor;
//# sourceMappingURL=health-monitor.js.map