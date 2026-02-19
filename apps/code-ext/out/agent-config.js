"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function (o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
        desc = { enumerable: true, get: function () { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function (o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function (o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function (o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function (o) {
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
exports.VALID_AGENT_CATEGORIES = void 0;
exports.getAgentConfig = getAgentConfig;
exports.isCategoryEnabled = isCategoryEnabled;
exports.getDisabledCategories = getDisabledCategories;
const vscode = __importStar(require("vscode"));
/**
 * Valid agent categories for task assignment in the multi-agent orchestration system
 */
exports.VALID_AGENT_CATEGORIES = [
    'Optimization',
    'Innovation',
    'Architecture',
    'Front End Improvements',
    'Back End Improvements',
    'Security',
    'Testing',
    'Documentation',
    'Technical Debt',
    'Developer Experience (DX)',
    'Monitoring & Observability',
    'DevOps/Infrastructure',
    'Accessibility (a11y)',
    'Dependency Management',
    'Data Management',
    'Internationalization (i18n)',
    'Error Handling & Resilience',
    'Code Quality',
    'Compliance & Governance',
    'Scalability',
    'API Evolution',
];
/**
 * Configuration validation constants
 */
const VALIDATION_RULES = {
    MAX_CONCURRENT_MIN: 1,
    MAX_CONCURRENT_MAX: 10,
    MAX_CONCURRENT_DEFAULT: 1,
    BUDGET_MIN: 0,
    DAILY_BUDGET_DEFAULT: 50,
    MONTHLY_BUDGET_DEFAULT: 500,
};
/**
 * Validates and returns the maximum concurrent agents setting
 * @param configValue - Raw configuration value from VSCode settings
 * @returns Validated maxConcurrent value (1-10)
 */
function validateMaxConcurrent(configValue) {
    const value = Number(configValue);
    if (isNaN(value) || value < VALIDATION_RULES.MAX_CONCURRENT_MIN) {
        vscode.window.showWarningMessage(`Stoked Projects: Invalid maxConcurrent value (${configValue}). Using default: ${VALIDATION_RULES.MAX_CONCURRENT_DEFAULT}`);
        return VALIDATION_RULES.MAX_CONCURRENT_DEFAULT;
    }
    if (value > VALIDATION_RULES.MAX_CONCURRENT_MAX) {
        vscode.window.showWarningMessage(`Stoked Projects: maxConcurrent value (${value}) exceeds maximum of ${VALIDATION_RULES.MAX_CONCURRENT_MAX}. Capping at ${VALIDATION_RULES.MAX_CONCURRENT_MAX}`);
        return VALIDATION_RULES.MAX_CONCURRENT_MAX;
    }
    return Math.floor(value);
}
/**
 * Validates and returns a budget setting
 * @param configValue - Raw configuration value from VSCode settings
 * @param fieldName - Name of the budget field for error messages
 * @param defaultValue - Default value to use if validation fails
 * @returns Validated budget value (>= 0)
 */
function validateBudget(configValue, fieldName, defaultValue) {
    const value = Number(configValue);
    if (isNaN(value) || value < VALIDATION_RULES.BUDGET_MIN) {
        vscode.window.showErrorMessage(`Stoked Projects: Invalid ${fieldName} value (${configValue}). Budget must be >= 0. Using default: $${defaultValue}`);
        return defaultValue;
    }
    return value;
}
/**
 * Validates and filters enabled categories
 * @param configValue - Raw configuration value from VSCode settings
 * @returns Validated array of agent categories
 */
function validateCategories(configValue) {
    if (!Array.isArray(configValue)) {
        console.warn('[AgentConfig] enabledCategories is not an array, using all categories');
        return [...exports.VALID_AGENT_CATEGORIES];
    }
    const validCategories = [];
    const invalidCategories = [];
    for (const category of configValue) {
        if (typeof category === 'string' && exports.VALID_AGENT_CATEGORIES.includes(category)) {
            validCategories.push(category);
        }
        else {
            invalidCategories.push(String(category));
        }
    }
    if (invalidCategories.length > 0) {
        console.warn(`[AgentConfig] Invalid categories filtered out: ${invalidCategories.join(', ')}`);
    }
    // If all categories were invalid, return all valid categories
    if (validCategories.length === 0) {
        console.warn('[AgentConfig] No valid categories found, enabling all categories');
        return [...exports.VALID_AGENT_CATEGORIES];
    }
    return validCategories;
}
/**
 * Loads and validates agent configuration from workspace settings
 * @returns Validated AgentConfig object
 */
function getAgentConfig() {
    const config = vscode.workspace.getConfiguration('claudeProjects.agents');
    const maxConcurrent = validateMaxConcurrent(config.get('maxConcurrent'));
    const dailyBudgetUSD = validateBudget(config.get('dailyBudgetUSD'), 'dailyBudgetUSD', VALIDATION_RULES.DAILY_BUDGET_DEFAULT);
    const monthlyBudgetUSD = validateBudget(config.get('monthlyBudgetUSD'), 'monthlyBudgetUSD', VALIDATION_RULES.MONTHLY_BUDGET_DEFAULT);
    const enabledCategories = validateCategories(config.get('enabledCategories'));
    console.log('[AgentConfig] Loaded configuration:', {
        maxConcurrent,
        dailyBudgetUSD,
        monthlyBudgetUSD,
        enabledCategories: enabledCategories.length,
    });
    return {
        maxConcurrent,
        dailyBudgetUSD,
        monthlyBudgetUSD,
        enabledCategories,
    };
}
/**
 * Checks if a specific category is enabled in the current configuration
 * @param category - Category to check
 * @returns true if the category is enabled
 */
function isCategoryEnabled(category) {
    const config = getAgentConfig();
    return config.enabledCategories.includes(category);
}
/**
 * Returns the list of disabled categories
 * @returns Array of disabled agent categories
 */
function getDisabledCategories() {
    const config = getAgentConfig();
    return exports.VALID_AGENT_CATEGORIES.filter(cat => !config.enabledCategories.includes(cat));
}
//# sourceMappingURL=agent-config.js.map