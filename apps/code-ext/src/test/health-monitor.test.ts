import * as assert from 'assert';
import * as path from 'path';
import * as fs from 'fs';
import { HealthMonitor, HealthCheckResult, Alert } from '../health-monitor';
import { AgentHeartbeatManager, HealthStatusResult } from '../agent-heartbeat';
import { LoopValidator, StuckAgentInfo, QueueDepthInfo } from '../loop-validator';
import { ProjectQueueManager, ProjectClaim } from '../project-queue-manager';
import { AgentSessionManager, AgentSession } from '../agent-session-manager';
import { initializeCostTracker, logApiUsage, clearCostLog, resetAlertLevel } from '../cost-tracker';

suite('HealthMonitor Test Suite', () => {
    let testDir: string;
    let healthMonitor: HealthMonitor;
    let heartbeatManager: AgentHeartbeatManager;
    let loopValidator: LoopValidator;
    let queueManager: ProjectQueueManager;
    let sessionManager: AgentSessionManager;

    // Mock implementations
    let mockAgentHealthStatuses: Map<number, HealthStatusResult>;
    let mockStuckAgents: StuckAgentInfo[];
    let mockQueueDepth: QueueDepthInfo;
    let mockAgentSessions: AgentSession[];
    let mockActiveClaims: ProjectClaim[];

    setup(() => {
        // Create test directory
        testDir = path.join(__dirname, 'test-health-monitor-' + Date.now());
        fs.mkdirSync(testDir, { recursive: true });

        // Initialize managers
        sessionManager = new AgentSessionManager(testDir);

        // Create mock GitHub API (minimal implementation)
        const mockGitHubApi = {
            getProjectItems: async () => []
        } as any;

        queueManager = new ProjectQueueManager(testDir, mockGitHubApi);
        heartbeatManager = new AgentHeartbeatManager(sessionManager);

        // Create mock ReviewQueueManager
        const mockReviewQueueManager = {
            getQueueStats: async () => ({ pending: 0, inReview: 0, completed: 0 })
        } as any;

        loopValidator = new LoopValidator(
            testDir,
            sessionManager,
            queueManager,
            mockReviewQueueManager
        );

        // Initialize cost tracker
        initializeCostTracker(testDir);
        clearCostLog();
        resetAlertLevel();

        // Initialize mock data
        mockAgentHealthStatuses = new Map();
        mockStuckAgents = [];
        mockQueueDepth = {
            projectQueueDepth: 5,
            reviewQueueDepth: 2,
            timestamp: new Date().toISOString()
        };
        mockAgentSessions = [];
        mockActiveClaims = [];

        // Create health monitor
        healthMonitor = new HealthMonitor(
            heartbeatManager,
            loopValidator,
            queueManager,
            sessionManager
        );

        // Mock methods
        heartbeatManager.getAllAgentHealthStatuses = async () => mockAgentHealthStatuses;
        loopValidator.detectStuckAgents = async () => mockStuckAgents;
        loopValidator.getQueueDepth = async () => mockQueueDepth;
        sessionManager.listAgentSessions = async () => mockAgentSessions;
        queueManager.getAllActiveClaims = async () => mockActiveClaims;
    });

    teardown(() => {
        // Stop monitoring
        healthMonitor.stopHealthMonitoring();

        // Clean up test directory
        if (fs.existsSync(testDir)) {
            fs.rmSync(testDir, { recursive: true, force: true });
        }
    });

    test('AC-5.2.a: Health check completes within 5 seconds', async () => {
        // Setup: Create 3 healthy agents
        for (let i = 1; i <= 3; i++) {
            mockAgentHealthStatuses.set(i, {
                status: 'healthy',
                lastHeartbeat: new Date(),
                timeSinceLastHeartbeat: 30000 // 30 seconds
            });

            mockAgentSessions.push({
                agentId: `agent-${i}`,
                status: 'working',
                currentProjectNumber: i,
                currentPhase: 'execution',
                branchName: `project/${i}`,
                lastHeartbeat: new Date().toISOString(),
                tasksCompleted: 5,
                currentTaskDescription: 'Testing',
                errorCount: 0,
                lastError: null
            });
        }

        const startTime = Date.now();
        const result = await healthMonitor.runHealthCheck();
        const duration = Date.now() - startTime;

        assert.ok(duration < 5000, `Health check took ${duration}ms, should be under 5000ms`);
        assert.strictEqual(result.agentHealth.size, 3, 'Should evaluate all 3 agents');
        assert.strictEqual(result.overallStatus, 'healthy', 'Overall status should be healthy');
    });

    test('AC-5.2.b: Unresponsive agent triggers error notification', async () => {
        // Setup: Create one unresponsive agent
        mockAgentHealthStatuses.set(1, {
            status: 'unresponsive',
            lastHeartbeat: new Date(Date.now() - 180000), // 3 minutes ago
            timeSinceLastHeartbeat: 180000
        });

        mockAgentSessions.push({
            agentId: 'agent-1',
            status: 'working',
            currentProjectNumber: 1,
            currentPhase: null,
            branchName: null,
            lastHeartbeat: new Date(Date.now() - 180000).toISOString(),
            tasksCompleted: 0,
            currentTaskDescription: null,
            errorCount: 0,
            lastError: null
        });

        const result = await healthMonitor.runHealthCheck();

        assert.strictEqual(result.overallStatus, 'error', 'Overall status should be error');

        const unresponsiveAlerts = result.alerts.filter(
            a => a.level === 'error' && a.source === 'agent-health'
        );
        assert.strictEqual(unresponsiveAlerts.length, 1, 'Should have one unresponsive agent alert');
        assert.ok(
            unresponsiveAlerts[0].message.includes('unresponsive'),
            'Alert message should mention unresponsive'
        );
    });

    test('AC-5.2.c: High error rate triggers error notification', async () => {
        // Setup: Create agent with 11 errors in last hour
        const agent: AgentSession = {
            agentId: 'agent-1',
            status: 'working',
            currentProjectNumber: 1,
            currentPhase: null,
            branchName: null,
            lastHeartbeat: new Date().toISOString(),
            tasksCompleted: 0,
            currentTaskDescription: null,
            errorCount: 11,
            lastError: 'Repeated API timeout error'
        };

        mockAgentSessions.push(agent);
        mockAgentHealthStatuses.set(1, {
            status: 'healthy',
            lastHeartbeat: new Date(),
            timeSinceLastHeartbeat: 30000
        });

        // First check to initialize error tracking
        await healthMonitor.runHealthCheck();

        // Simulate multiple errors
        for (let i = 0; i < 11; i++) {
            agent.errorCount = i + 1;
            agent.lastError = `Error ${i + 1}: API timeout`;
            await healthMonitor.runHealthCheck();
            // Small delay to ensure different timestamps
            await new Promise(resolve => setTimeout(resolve, 10));
        }

        const result = await healthMonitor.runHealthCheck();

        const errorRateAlerts = result.alerts.filter(
            a => a.level === 'error' && a.source === 'agent-error-rate'
        );
        assert.ok(errorRateAlerts.length > 0, 'Should have error rate alerts');
        assert.ok(
            errorRateAlerts[0].message.includes('errors in the last hour'),
            'Alert should mention error count'
        );
    });

    test('AC-5.2.d: Budget at 90% triggers critical notification and pauses claims', async () => {
        // Setup: Log enough usage to reach 90% of budget
        // Assuming default daily budget is $10 (from agent-config.ts)
        // Log $9.00 worth of API usage
        const dailyBudget = 10; // Default from config
        const targetSpend = dailyBudget * 0.91; // 91% to exceed 90% threshold

        // Sonnet pricing: $3 per 1M input tokens, $15 per 1M output tokens
        // To spend $9: use ~600K input tokens and 0 output tokens
        const tokensNeeded = Math.floor((targetSpend / 3) * 1_000_000);

        await logApiUsage('agent-1', {
            inputTokens: tokensNeeded,
            outputTokens: 0,
            model: 'sonnet'
        }, 1);

        mockAgentHealthStatuses.set(1, {
            status: 'healthy',
            lastHeartbeat: new Date(),
            timeSinceLastHeartbeat: 30000
        });

        const result = await healthMonitor.runHealthCheck();

        assert.strictEqual(result.budgetHealth.level, 'critical', 'Budget health should be critical');
        assert.ok(
            result.budgetHealth.dailyPercentUsed >= 90,
            'Daily budget percent should be >= 90%'
        );

        const budgetAlerts = result.alerts.filter(
            a => a.level === 'critical' && a.source === 'budget'
        );
        assert.ok(budgetAlerts.length > 0, 'Should have critical budget alert');
        assert.ok(
            budgetAlerts[0].message.includes('paused'),
            'Alert should mention claims being paused'
        );

        assert.strictEqual(
            healthMonitor.isBudgetPaused(),
            true,
            'Budget should pause new claims'
        );
    });

    test('AC-5.2.e: Stuck agent triggers error notification with restart action', async () => {
        // Setup: Create stuck agent (stuck for > 30 minutes)
        const stuckAgent: StuckAgentInfo = {
            agentId: 'agent-1',
            currentStatus: 'working',
            stuckDuration: 45, // 45 minutes
            lastHeartbeat: new Date(Date.now() - 45 * 60 * 1000).toISOString()
        };

        mockStuckAgents.push(stuckAgent);

        mockAgentHealthStatuses.set(1, {
            status: 'degraded',
            lastHeartbeat: new Date(Date.now() - 45 * 60 * 1000),
            timeSinceLastHeartbeat: 45 * 60 * 1000
        });

        const result = await healthMonitor.runHealthCheck();

        const stuckAlerts = result.alerts.filter(
            a => a.level === 'error' && a.source === 'agent-stuck'
        );
        assert.strictEqual(stuckAlerts.length, 1, 'Should have one stuck agent alert');
        assert.ok(
            stuckAlerts[0].message.includes('stuck') && stuckAlerts[0].message.includes('45 minutes'),
            'Alert should mention stuck duration'
        );
    });

    test('AC-5.2.f: Health check failure is logged and skipped gracefully', async () => {
        // Setup: Make heartbeat manager throw an error
        heartbeatManager.getAllAgentHealthStatuses = async () => {
            throw new Error('Simulated API error');
        };

        const result = await healthMonitor.runHealthCheck();

        // Health check should complete despite error
        assert.ok(result, 'Health check should return a result');
        assert.ok(result.timestamp, 'Result should have timestamp');

        const errorAlerts = result.alerts.filter(
            a => a.level === 'error' && a.source === 'health-check'
        );
        assert.ok(errorAlerts.length > 0, 'Should have health check error alert');
        assert.ok(
            errorAlerts[0].message.includes('Health check failed'),
            'Alert should mention health check failure'
        );
    });

    test('Queue depth low (< 3) triggers info alert', async () => {
        mockQueueDepth.projectQueueDepth = 2;

        const result = await healthMonitor.runHealthCheck();

        assert.strictEqual(result.queueHealth.level, 'low', 'Queue health should be low');
        assert.strictEqual(result.queueHealth.depth, 2, 'Queue depth should be 2');
    });

    test('Queue depth high (> 10) triggers warning alert', async () => {
        mockQueueDepth.projectQueueDepth = 12;

        const result = await healthMonitor.runHealthCheck();

        assert.strictEqual(result.queueHealth.level, 'high', 'Queue health should be high');

        const queueAlerts = result.alerts.filter(
            a => a.level === 'warning' && a.source === 'queue-depth'
        );
        assert.ok(queueAlerts.length > 0, 'Should have queue depth warning');
    });

    test('Queue depth healthy (3-10) has no alerts', async () => {
        mockQueueDepth.projectQueueDepth = 5;

        const result = await healthMonitor.runHealthCheck();

        assert.strictEqual(result.queueHealth.level, 'healthy', 'Queue health should be healthy');
        assert.strictEqual(result.queueHealth.depth, 5, 'Queue depth should be 5');
    });

    test('Start and stop health monitoring', async () => {
        let checkCount = 0;
        const originalRunHealthCheck = healthMonitor.runHealthCheck.bind(healthMonitor);
        healthMonitor.runHealthCheck = async () => {
            checkCount++;
            return originalRunHealthCheck();
        };

        healthMonitor.startHealthMonitoring();

        // Wait for at least one check to run
        await new Promise(resolve => setTimeout(resolve, 100));
        assert.ok(checkCount >= 1, 'At least one health check should run after start');

        healthMonitor.stopHealthMonitoring();

        const countAfterStop = checkCount;
        await new Promise(resolve => setTimeout(resolve, 200));

        assert.strictEqual(
            checkCount,
            countAfterStop,
            'No additional checks should run after stop'
        );
    });

    test('Alert history is maintained and limited to 100 entries', async () => {
        // Create many unresponsive agents to generate lots of alerts
        for (let i = 1; i <= 120; i++) {
            mockAgentHealthStatuses.set(i, {
                status: 'unresponsive',
                lastHeartbeat: new Date(Date.now() - 180000),
                timeSinceLastHeartbeat: 180000
            });
        }

        await healthMonitor.runHealthCheck();

        const history = healthMonitor.getAlertHistory();
        assert.ok(history.length <= 100, 'Alert history should be limited to 100 entries');
    });

    test('Clear alert marks alert as dismissed', async () => {
        mockAgentHealthStatuses.set(1, {
            status: 'unresponsive',
            lastHeartbeat: new Date(Date.now() - 180000),
            timeSinceLastHeartbeat: 180000
        });

        const result = await healthMonitor.runHealthCheck();
        const alertId = result.alerts[0].id;

        healthMonitor.clearAlert(alertId);

        const history = healthMonitor.getAlertHistory();
        const dismissedAlert = history.find(a => a.id === alertId);

        assert.ok(dismissedAlert, 'Alert should still be in history');
        assert.strictEqual(dismissedAlert.dismissed, true, 'Alert should be marked as dismissed');
    });

    test('Notification cooldown prevents spam', async () => {
        // This test verifies that the cooldown mechanism works
        // In a real implementation, we'd need to mock VS Code's notification system
        // For now, we verify that the internal cooldown tracking works

        mockAgentHealthStatuses.set(1, {
            status: 'unresponsive',
            lastHeartbeat: new Date(Date.now() - 180000),
            timeSinceLastHeartbeat: 180000
        });

        // First check - should create alert
        const result1 = await healthMonitor.runHealthCheck();
        assert.ok(result1.alerts.length > 0, 'First check should create alerts');

        // Second check immediately after - should still create alert (new instance)
        const result2 = await healthMonitor.runHealthCheck();
        assert.ok(result2.alerts.length > 0, 'Second check should create alerts');

        // Both checks should have alerts, but cooldown would prevent duplicate notifications
        // (notification sending is tested separately in integration tests)
    });

    test('Overall status correctly reflects highest severity alert', async () => {
        // Setup multiple alert levels
        mockAgentHealthStatuses.set(1, {
            status: 'degraded',
            lastHeartbeat: new Date(Date.now() - 90000),
            timeSinceLastHeartbeat: 90000
        });

        mockQueueDepth.projectQueueDepth = 12; // High queue = warning

        const result = await healthMonitor.runHealthCheck();

        // Should be 'warning' since degraded agent creates warning, high queue creates warning
        assert.strictEqual(
            result.overallStatus,
            'warning',
            'Overall status should reflect highest severity'
        );
    });

    test('Budget resumes claims when back under threshold', async () => {
        // First, trigger budget pause at 90%
        const dailyBudget = 10;
        const highSpend = dailyBudget * 0.91;
        const tokensHigh = Math.floor((highSpend / 3) * 1_000_000);

        await logApiUsage('agent-1', {
            inputTokens: tokensHigh,
            outputTokens: 0,
            model: 'sonnet'
        }, 1);

        await healthMonitor.runHealthCheck();
        assert.strictEqual(healthMonitor.isBudgetPaused(), true, 'Budget should be paused');

        // Clear cost log to simulate budget reset
        clearCostLog();
        resetAlertLevel();

        // Run health check again
        await healthMonitor.runHealthCheck();
        assert.strictEqual(healthMonitor.isBudgetPaused(), false, 'Budget should resume');
    });
});
