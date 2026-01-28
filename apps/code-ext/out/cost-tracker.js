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
exports.initializeCostTracker = initializeCostTracker;
exports.logApiUsage = logApiUsage;
exports.getDailySpend = getDailySpend;
exports.getMonthlySpend = getMonthlySpend;
exports.getProjectSpend = getProjectSpend;
exports.getAgentSpend = getAgentSpend;
exports.checkBudget = checkBudget;
exports.getBudgetAlertLevel = getBudgetAlertLevel;
exports.resetAlertLevel = resetAlertLevel;
exports.clearCostLog = clearCostLog;
const vscode = __importStar(require("vscode"));
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const agent_config_1 = require("./agent-config");
/**
 * Model pricing in USD per million tokens
 */
const MODEL_PRICING = {
    sonnet: { input: 3, output: 15 },
    opus: { input: 15, output: 75 },
    haiku: { input: 0.25, output: 1.25 },
};
/**
 * Fallback cost per request when calculation fails
 */
const FALLBACK_COST_PER_REQUEST = 0.50;
/**
 * Cost log file path
 */
let costLogPath = null;
/**
 * Last alert level shown to avoid duplicate notifications
 */
let lastAlertLevel = 'ok';
/**
 * Initialize the cost tracker with workspace root path
 * @param workspaceRoot - Path to workspace root directory
 */
function initializeCostTracker(workspaceRoot) {
    const sessionsDir = path.join(workspaceRoot, '.claude-sessions');
    // Ensure .claude-sessions directory exists
    if (!fs.existsSync(sessionsDir)) {
        fs.mkdirSync(sessionsDir, { recursive: true });
    }
    costLogPath = path.join(sessionsDir, 'cost-log.json');
    // Initialize empty log file if it doesn't exist
    if (!fs.existsSync(costLogPath)) {
        const emptyLog = { entries: [] };
        writeLogFile(emptyLog);
    }
}
/**
 * Calculate cost for a given token usage
 * @param usage - Token usage data
 * @returns Cost in USD
 */
function calculateCost(usage) {
    const pricing = MODEL_PRICING[usage.model];
    const inputCost = (usage.inputTokens / 1_000_000) * pricing.input;
    const outputCost = (usage.outputTokens / 1_000_000) * pricing.output;
    return inputCost + outputCost;
}
/**
 * Read the cost log file
 * @returns Cost log data
 */
function readLogFile() {
    if (!costLogPath) {
        throw new Error('Cost tracker not initialized. Call initializeCostTracker() first.');
    }
    try {
        const content = fs.readFileSync(costLogPath, 'utf-8');
        return JSON.parse(content);
    }
    catch (error) {
        console.error('[CostTracker] Error reading cost log:', error);
        return { entries: [] };
    }
}
/**
 * Write the cost log file atomically
 * @param log - Cost log data to write
 */
function writeLogFile(log) {
    if (!costLogPath) {
        throw new Error('Cost tracker not initialized. Call initializeCostTracker() first.');
    }
    try {
        const tempPath = `${costLogPath}.tmp`;
        fs.writeFileSync(tempPath, JSON.stringify(log, null, 2), 'utf-8');
        fs.renameSync(tempPath, costLogPath);
    }
    catch (error) {
        console.error('[CostTracker] Error writing cost log:', error);
        throw error;
    }
}
/**
 * Log API usage and calculate cost
 * @param agentId - ID of the agent making the request
 * @param usage - Token usage data
 * @param projectNumber - Project number
 */
async function logApiUsage(agentId, usage, projectNumber) {
    try {
        const cost = calculateCost(usage);
        const entry = {
            timestamp: new Date().toISOString(),
            agentId,
            projectNumber,
            inputTokens: usage.inputTokens,
            outputTokens: usage.outputTokens,
            model: usage.model,
            costUSD: cost,
        };
        const log = readLogFile();
        log.entries.push(entry);
        writeLogFile(log);
        console.log(`[CostTracker] Logged usage: Agent=${agentId}, Project=${projectNumber}, Cost=$${cost.toFixed(4)}`);
        // Check budget after logging
        await checkAndNotifyBudget();
    }
    catch (error) {
        console.error('[CostTracker] Error logging API usage:', error);
        // Log fallback cost on failure
        try {
            const fallbackEntry = {
                timestamp: new Date().toISOString(),
                agentId,
                projectNumber,
                inputTokens: 0,
                outputTokens: 0,
                model: usage.model,
                costUSD: FALLBACK_COST_PER_REQUEST,
            };
            const log = readLogFile();
            log.entries.push(fallbackEntry);
            writeLogFile(log);
            vscode.window.showWarningMessage(`Cost tracking failed. Assuming worst-case cost of $${FALLBACK_COST_PER_REQUEST} per request.`);
        }
        catch (fallbackError) {
            console.error('[CostTracker] Failed to log fallback cost:', fallbackError);
        }
    }
}
/**
 * Get total spend for today
 * @returns Daily spend in USD
 */
async function getDailySpend() {
    const log = readLogFile();
    const today = new Date().toISOString().split('T')[0];
    return log.entries
        .filter(entry => entry.timestamp.startsWith(today))
        .reduce((sum, entry) => sum + entry.costUSD, 0);
}
/**
 * Get total spend for this month
 * @returns Monthly spend in USD
 */
async function getMonthlySpend() {
    const log = readLogFile();
    const thisMonth = new Date().toISOString().substring(0, 7); // YYYY-MM
    return log.entries
        .filter(entry => entry.timestamp.startsWith(thisMonth))
        .reduce((sum, entry) => sum + entry.costUSD, 0);
}
/**
 * Get total spend for a specific project
 * @param projectNumber - Project number
 * @returns Project spend in USD
 */
async function getProjectSpend(projectNumber) {
    const log = readLogFile();
    return log.entries
        .filter(entry => entry.projectNumber === projectNumber)
        .reduce((sum, entry) => sum + entry.costUSD, 0);
}
/**
 * Get total spend for a specific agent
 * @param agentId - Agent ID
 * @returns Agent spend in USD
 */
async function getAgentSpend(agentId) {
    const log = readLogFile();
    return log.entries
        .filter(entry => entry.agentId === agentId)
        .reduce((sum, entry) => sum + entry.costUSD, 0);
}
/**
 * Check current budget status
 * @returns Budget status information
 */
async function checkBudget() {
    const config = (0, agent_config_1.getAgentConfig)();
    const dailySpend = await getDailySpend();
    const monthlySpend = await getMonthlySpend();
    const dailyRemaining = Math.max(0, config.dailyBudgetUSD - dailySpend);
    const monthlyRemaining = Math.max(0, config.monthlyBudgetUSD - monthlySpend);
    const dailyPercentUsed = (dailySpend / config.dailyBudgetUSD) * 100;
    const monthlyPercentUsed = (monthlySpend / config.monthlyBudgetUSD) * 100;
    const withinBudget = dailySpend <= config.dailyBudgetUSD && monthlySpend <= config.monthlyBudgetUSD;
    return {
        dailySpend,
        monthlySpend,
        dailyBudget: config.dailyBudgetUSD,
        monthlyBudget: config.monthlyBudgetUSD,
        dailyRemaining,
        monthlyRemaining,
        withinBudget,
        dailyPercentUsed,
        monthlyPercentUsed,
    };
}
/**
 * Get current budget alert level
 * @returns Alert level based on daily spend percentage
 */
async function getBudgetAlertLevel() {
    const status = await checkBudget();
    const percentUsed = status.dailyPercentUsed;
    if (percentUsed >= 100) {
        return 'exceeded';
    }
    else if (percentUsed >= 90) {
        return 'warning90';
    }
    else if (percentUsed >= 75) {
        return 'warning75';
    }
    else if (percentUsed >= 50) {
        return 'warning50';
    }
    else {
        return 'ok';
    }
}
/**
 * Check budget and send notifications if thresholds are crossed
 */
async function checkAndNotifyBudget() {
    const status = await checkBudget();
    const alertLevel = await getBudgetAlertLevel();
    // Only notify if alert level has changed
    if (alertLevel === lastAlertLevel) {
        return;
    }
    lastAlertLevel = alertLevel;
    switch (alertLevel) {
        case 'warning50':
            vscode.window.showInformationMessage(`Budget Alert: 50% of daily budget used ($${status.dailySpend.toFixed(2)} / $${status.dailyBudget.toFixed(2)})`);
            break;
        case 'warning75':
            vscode.window.showWarningMessage(`Budget Alert: 75% of daily budget used ($${status.dailySpend.toFixed(2)} / $${status.dailyBudget.toFixed(2)})`);
            break;
        case 'warning90':
            vscode.window.showErrorMessage(`Budget Alert: 90% of daily budget used! New project claims paused. ($${status.dailySpend.toFixed(2)} / $${status.dailyBudget.toFixed(2)})`);
            break;
        case 'exceeded':
            vscode.window.showErrorMessage(`Budget Exceeded! Daily budget limit reached. All agents will be stopped. ($${status.dailySpend.toFixed(2)} / $${status.dailyBudget.toFixed(2)})`, 'View Details').then(action => {
                if (action === 'View Details') {
                    vscode.window.showInformationMessage(`Daily: $${status.dailySpend.toFixed(2)} / $${status.dailyBudget.toFixed(2)}\n` +
                        `Monthly: $${status.monthlySpend.toFixed(2)} / $${status.monthlyBudget.toFixed(2)}`);
                }
            });
            break;
    }
}
/**
 * Reset the last alert level (useful for testing)
 */
function resetAlertLevel() {
    lastAlertLevel = 'ok';
}
/**
 * Clear all cost entries (useful for testing and monthly resets)
 */
function clearCostLog() {
    const emptyLog = { entries: [] };
    writeLogFile(emptyLog);
    console.log('[CostTracker] Cost log cleared');
}
//# sourceMappingURL=cost-tracker.js.map