import * as vscode from 'vscode';

/**
 * Valid agent categories for task assignment in the multi-agent orchestration system
 */
export const VALID_AGENT_CATEGORIES = [
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
] as const;

export type AgentCategory = typeof VALID_AGENT_CATEGORIES[number];

/**
 * Agent configuration interface with validated settings
 */
export interface AgentConfig {
    maxConcurrent: number;
    dailyBudgetUSD: number;
    monthlyBudgetUSD: number;
    enabledCategories: AgentCategory[];
}

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
} as const;

/**
 * Validates and returns the maximum concurrent agents setting
 * @param configValue - Raw configuration value from VSCode settings
 * @returns Validated maxConcurrent value (1-10)
 */
function validateMaxConcurrent(configValue: any): number {
    // If not configured at all, silently use default
    if (configValue === undefined || configValue === null) {
        return VALIDATION_RULES.MAX_CONCURRENT_DEFAULT;
    }

    const value = Number(configValue);

    if (isNaN(value) || value < VALIDATION_RULES.MAX_CONCURRENT_MIN) {
        console.warn(`[AgentConfig] Invalid maxConcurrent value (${configValue}). Using default: ${VALIDATION_RULES.MAX_CONCURRENT_DEFAULT}`);
        return VALIDATION_RULES.MAX_CONCURRENT_DEFAULT;
    }

    if (value > VALIDATION_RULES.MAX_CONCURRENT_MAX) {
        console.warn(`[AgentConfig] maxConcurrent value (${value}) exceeds max ${VALIDATION_RULES.MAX_CONCURRENT_MAX}. Capping.`);
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
function validateBudget(configValue: any, fieldName: string, defaultValue: number): number {
    // If not configured at all, silently use default
    if (configValue === undefined || configValue === null) {
        return defaultValue;
    }

    const value = Number(configValue);

    if (isNaN(value) || value < VALIDATION_RULES.BUDGET_MIN) {
        console.warn(`[AgentConfig] Invalid ${fieldName} value (${configValue}). Using default: $${defaultValue}`);
        return defaultValue;
    }

    return value;
}

/**
 * Validates and filters enabled categories
 * @param configValue - Raw configuration value from VSCode settings
 * @returns Validated array of agent categories
 */
function validateCategories(configValue: any): AgentCategory[] {
    if (!Array.isArray(configValue)) {
        console.warn('[AgentConfig] enabledCategories is not an array, using all categories');
        return [...VALID_AGENT_CATEGORIES];
    }

    const validCategories: AgentCategory[] = [];
    const invalidCategories: string[] = [];

    for (const category of configValue) {
        if (typeof category === 'string' && VALID_AGENT_CATEGORIES.includes(category as AgentCategory)) {
            validCategories.push(category as AgentCategory);
        } else {
            invalidCategories.push(String(category));
        }
    }

    if (invalidCategories.length > 0) {
        console.warn(
            `[AgentConfig] Invalid categories filtered out: ${invalidCategories.join(', ')}`
        );
    }

    // If all categories were invalid, return all valid categories
    if (validCategories.length === 0) {
        console.warn('[AgentConfig] No valid categories found, enabling all categories');
        return [...VALID_AGENT_CATEGORIES];
    }

    return validCategories;
}

/**
 * Loads and validates agent configuration from workspace settings
 * @returns Validated AgentConfig object
 */
export function getAgentConfig(): AgentConfig {
    const config = vscode.workspace.getConfiguration('claudeProjects.agents');

    const maxConcurrent = validateMaxConcurrent(config.get('maxConcurrent'));
    const dailyBudgetUSD = validateBudget(
        config.get('dailyBudgetUSD'),
        'dailyBudgetUSD',
        VALIDATION_RULES.DAILY_BUDGET_DEFAULT
    );
    const monthlyBudgetUSD = validateBudget(
        config.get('monthlyBudgetUSD'),
        'monthlyBudgetUSD',
        VALIDATION_RULES.MONTHLY_BUDGET_DEFAULT
    );
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
export function isCategoryEnabled(category: AgentCategory): boolean {
    const config = getAgentConfig();
    return config.enabledCategories.includes(category);
}

/**
 * Returns the list of disabled categories
 * @returns Array of disabled agent categories
 */
export function getDisabledCategories(): AgentCategory[] {
    const config = getAgentConfig();
    return VALID_AGENT_CATEGORIES.filter(cat => !config.enabledCategories.includes(cat));
}
