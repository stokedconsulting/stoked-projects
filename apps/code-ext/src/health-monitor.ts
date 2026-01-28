import * as vscode from 'vscode';
import { AgentHeartbeatManager, AgentHealthStatus, HealthStatusResult } from './agent-heartbeat';
import { LoopValidator, StuckAgentInfo } from './loop-validator';
import { checkBudget, BudgetStatus } from './cost-tracker';
import { ProjectQueueManager } from './project-queue-manager';
import { AgentSessionManager } from './agent-session-manager';

/**
 * Queue health status
 */
export interface QueueHealthStatus {
    depth: number;
    level: 'low' | 'healthy' | 'high';
    lastChecked: string;
}

/**
 * Budget health status
 */
export interface BudgetHealthStatus {
    dailyPercentUsed: number;
    monthlyPercentUsed: number;
    level: 'healthy' | 'warning' | 'critical';
    lastChecked: string;
}

/**
 * Alert information
 */
export interface Alert {
    id: string;
    level: 'info' | 'warning' | 'error' | 'critical';
    message: string;
    source: string;
    timestamp: string;
    dismissed: boolean;
}

/**
 * Health check result
 */
export interface HealthCheckResult {
    timestamp: string;
    agentHealth: Map<string, HealthStatusResult>;
    queueHealth: QueueHealthStatus;
    budgetHealth: BudgetHealthStatus;
    overallStatus: 'healthy' | 'warning' | 'error' | 'critical';
    alerts: Alert[];
}

/**
 * Agent error tracking
 */
interface AgentErrorTracking {
    agentId: string;
    errors: { timestamp: number; message: string }[];
}

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
export class HealthMonitor {
    private readonly HEALTH_CHECK_INTERVAL_MS = 60000; // 60 seconds
    private readonly NOTIFICATION_COOLDOWN_MS = 300000; // 5 minutes
    private readonly ERROR_RATE_WINDOW_MS = 3600000; // 1 hour
    private readonly ERROR_RATE_DEGRADED_THRESHOLD = 3;
    private readonly ERROR_RATE_CRITICAL_THRESHOLD = 10;

    private heartbeatManager: AgentHeartbeatManager;
    private loopValidator: LoopValidator;
    private queueManager: ProjectQueueManager;
    private sessionManager: AgentSessionManager;

    private healthCheckTimer: NodeJS.Timeout | null = null;
    private alertHistory: Alert[] = [];
    private lastNotificationTime: Map<string, number> = new Map();
    private agentErrorTracking: Map<string, AgentErrorTracking> = new Map();
    private budgetPausedClaims: boolean = false;

    constructor(
        heartbeatManager: AgentHeartbeatManager,
        loopValidator: LoopValidator,
        queueManager: ProjectQueueManager,
        sessionManager: AgentSessionManager
    ) {
        this.heartbeatManager = heartbeatManager;
        this.loopValidator = loopValidator;
        this.queueManager = queueManager;
        this.sessionManager = sessionManager;
    }

    /**
     * Generate unique alert ID based on type and context
     */
    private generateAlertId(source: string, context: string): string {
        return `${source}-${context}-${Date.now()}`;
    }

    /**
     * Check if notification cooldown period has passed
     */
    private canSendNotification(alertType: string): boolean {
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
    private recordNotification(alertType: string): void {
        this.lastNotificationTime.set(alertType, Date.now());
    }

    /**
     * Create and log an alert
     */
    private createAlert(
        level: 'info' | 'warning' | 'error' | 'critical',
        message: string,
        source: string
    ): Alert {
        const alert: Alert = {
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
    private async sendNotification(alert: Alert): Promise<void> {
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
                    const action = await vscode.window.showErrorMessage(
                        alert.message,
                        'Restart Agent',
                        'Dismiss'
                    );
                    if (action === 'Restart Agent') {
                        // TODO: Implement agent restart logic
                        console.log('[HealthMonitor] Restart agent action triggered');
                    }
                } else {
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
    private async checkAgentHealth(): Promise<Map<string, HealthStatusResult>> {
        const healthStatuses = await this.heartbeatManager.getAllAgentHealthStatuses();
        const alerts: Alert[] = [];

        for (const [agentId, healthResult] of healthStatuses.entries()) {
            const agentIdStr = `agent-${agentId}`;

            if (healthResult.status === 'unresponsive') {
                const alert = this.createAlert(
                    'error',
                    `Agent ${agentIdStr} is unresponsive (last heartbeat: ${healthResult.timeSinceLastHeartbeat ? Math.round(healthResult.timeSinceLastHeartbeat / 1000) : 'N/A'}s ago)`,
                    'agent-health'
                );
                alerts.push(alert);
                await this.sendNotification(alert);
            } else if (healthResult.status === 'degraded') {
                const alert = this.createAlert(
                    'warning',
                    `Agent ${agentIdStr} is degraded (last heartbeat: ${healthResult.timeSinceLastHeartbeat ? Math.round(healthResult.timeSinceLastHeartbeat / 1000) : 'N/A'}s ago)`,
                    'agent-health'
                );
                alerts.push(alert);
            }
        }

        // Convert Map<number, HealthStatusResult> to Map<string, HealthStatusResult>
        const stringKeyedMap = new Map<string, HealthStatusResult>();
        for (const [agentId, healthResult] of healthStatuses.entries()) {
            stringKeyedMap.set(`agent-${agentId}`, healthResult);
        }

        return stringKeyedMap;
    }

    /**
     * Track agent errors and calculate error rate
     * AC-5.2.c: High error rate detection
     */
    private async checkAgentErrorRate(): Promise<Alert[]> {
        const sessions = await this.sessionManager.listAgentSessions();
        const alerts: Alert[] = [];
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
                const alert = this.createAlert(
                    'error',
                    `Agent ${session.agentId} has ${errorCount} errors in the last hour (last error: ${session.lastError || 'N/A'})`,
                    'agent-error-rate'
                );
                alerts.push(alert);
                await this.sendNotification(alert);
            } else if (errorCount >= this.ERROR_RATE_DEGRADED_THRESHOLD) {
                const alert = this.createAlert(
                    'warning',
                    `Agent ${session.agentId} has ${errorCount} errors in the last hour`,
                    'agent-error-rate'
                );
                alerts.push(alert);
            }
        }

        return alerts;
    }

    /**
     * Check queue depth health
     */
    private async checkQueueHealth(): Promise<QueueHealthStatus> {
        const queueDepth = await this.loopValidator.getQueueDepth();
        const depth = queueDepth.projectQueueDepth;

        let level: 'low' | 'healthy' | 'high';
        if (depth < 3) {
            level = 'low';
            const alert = this.createAlert(
                'info',
                `Project queue depth is low (${depth} projects)`,
                'queue-depth'
            );
            // Info alerts don't trigger notifications
        } else if (depth > 10) {
            level = 'high';
            const alert = this.createAlert(
                'warning',
                `Project queue depth is high (${depth} projects). Consider pausing ideation.`,
                'queue-depth'
            );
            await this.sendNotification(alert);
        } else {
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
    private async checkBudgetHealth(): Promise<BudgetHealthStatus> {
        const budgetStatus: BudgetStatus = await checkBudget();
        const dailyPercent = budgetStatus.dailyPercentUsed;
        const monthlyPercent = budgetStatus.monthlyPercentUsed;

        let level: 'healthy' | 'warning' | 'critical';

        if (dailyPercent >= 90 || monthlyPercent >= 90) {
            level = 'critical';
            const alert = this.createAlert(
                'critical',
                `Budget critical: ${dailyPercent.toFixed(1)}% daily, ${monthlyPercent.toFixed(1)}% monthly. New project claims paused.`,
                'budget'
            );
            await this.sendNotification(alert);

            // Pause new claims
            if (!this.budgetPausedClaims) {
                this.budgetPausedClaims = true;
                console.log('[HealthMonitor] Budget limit reached, pausing new project claims');
            }
        } else if (dailyPercent >= 75 || monthlyPercent >= 75) {
            level = 'warning';
            const alert = this.createAlert(
                'warning',
                `Budget warning: ${dailyPercent.toFixed(1)}% daily, ${monthlyPercent.toFixed(1)}% monthly used.`,
                'budget'
            );
            await this.sendNotification(alert);
        } else if (dailyPercent >= 50 || monthlyPercent >= 50) {
            level = 'warning';
            const alert = this.createAlert(
                'info',
                `Budget notice: ${dailyPercent.toFixed(1)}% daily, ${monthlyPercent.toFixed(1)}% monthly used.`,
                'budget'
            );
            // Info level - no notification
        } else {
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
    private async checkStuckAgents(): Promise<Alert[]> {
        const stuckAgents: StuckAgentInfo[] = await this.loopValidator.detectStuckAgents();
        const alerts: Alert[] = [];

        for (const stuck of stuckAgents) {
            const alert = this.createAlert(
                'error',
                `Agent ${stuck.agentId} is stuck in ${stuck.currentStatus} state for ${stuck.stuckDuration} minutes`,
                'agent-stuck'
            );
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
    public async runHealthCheck(): Promise<HealthCheckResult> {
        const startTime = Date.now();
        console.log('[HealthMonitor] Running health check...');

        const alerts: Alert[] = [];
        let agentHealth = new Map<string, HealthStatusResult>();
        let queueHealth: QueueHealthStatus = {
            depth: 0,
            level: 'healthy',
            lastChecked: new Date().toISOString()
        };
        let budgetHealth: BudgetHealthStatus = {
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

        } catch (error) {
            // AC-5.2.f: Handle API errors gracefully
            console.error('[HealthMonitor] Health check failed:', error);
            const alert = this.createAlert(
                'error',
                `Health check failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
                'health-check'
            );
            alerts.push(alert);
        }

        // Determine overall status
        let overallStatus: 'healthy' | 'warning' | 'error' | 'critical' = 'healthy';

        for (const alert of alerts) {
            if (alert.level === 'critical' && overallStatus !== 'critical') {
                overallStatus = 'critical';
            } else if (alert.level === 'error' && overallStatus !== 'critical') {
                overallStatus = 'error';
            } else if (alert.level === 'warning' && overallStatus === 'healthy') {
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
    public startHealthMonitoring(): void {
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
    public stopHealthMonitoring(): void {
        if (this.healthCheckTimer) {
            clearInterval(this.healthCheckTimer);
            this.healthCheckTimer = null;
            console.log('[HealthMonitor] Stopped health monitoring');
        }
    }

    /**
     * Get alert history
     */
    public getAlertHistory(): Alert[] {
        return [...this.alertHistory];
    }

    /**
     * Clear/dismiss a specific alert
     */
    public clearAlert(alertId: string): void {
        const alert = this.alertHistory.find(a => a.id === alertId);
        if (alert) {
            alert.dismissed = true;
            console.log(`[HealthMonitor] Dismissed alert: ${alertId}`);
        }
    }

    /**
     * Check if budget has paused new claims
     */
    public isBudgetPaused(): boolean {
        return this.budgetPausedClaims;
    }

    /**
     * Clear all alerts (for testing)
     */
    public clearAllAlerts(): void {
        this.alertHistory = [];
        console.log('[HealthMonitor] Cleared all alerts');
    }
}
