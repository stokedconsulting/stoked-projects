import * as assert from 'assert';
import * as vscode from 'vscode';
import { getAgentConfig, isCategoryEnabled, getDisabledCategories, VALID_AGENT_CATEGORIES, AgentCategory } from '../agent-config';

suite('Agent Configuration Test Suite', () => {
    let originalConfig: any;

    suiteSetup(() => {
        // Store original configuration
        const config = vscode.workspace.getConfiguration('claudeProjects.agents');
        originalConfig = {
            maxConcurrent: config.get('maxConcurrent'),
            dailyBudgetUSD: config.get('dailyBudgetUSD'),
            monthlyBudgetUSD: config.get('monthlyBudgetUSD'),
            enabledCategories: config.get('enabledCategories'),
        };
    });

    suiteTeardown(async () => {
        // Restore original configuration
        const config = vscode.workspace.getConfiguration('claudeProjects.agents');
        await config.update('maxConcurrent', originalConfig.maxConcurrent, vscode.ConfigurationTarget.Global);
        await config.update('dailyBudgetUSD', originalConfig.dailyBudgetUSD, vscode.ConfigurationTarget.Global);
        await config.update('monthlyBudgetUSD', originalConfig.monthlyBudgetUSD, vscode.ConfigurationTarget.Global);
        await config.update('enabledCategories', originalConfig.enabledCategories, vscode.ConfigurationTarget.Global);
    });

    test('AC-1.1.a: Valid configuration loads successfully within 2 seconds', async () => {
        const config = vscode.workspace.getConfiguration('claudeProjects.agents');
        await config.update('maxConcurrent', 3, vscode.ConfigurationTarget.Global);
        await config.update('dailyBudgetUSD', 100, vscode.ConfigurationTarget.Global);
        await config.update('monthlyBudgetUSD', 1000, vscode.ConfigurationTarget.Global);
        await config.update('enabledCategories', ['Security', 'Testing', 'Documentation'], vscode.ConfigurationTarget.Global);

        const startTime = Date.now();
        const agentConfig = getAgentConfig();
        const loadTime = Date.now() - startTime;

        assert.strictEqual(agentConfig.maxConcurrent, 3, 'maxConcurrent should be 3');
        assert.strictEqual(agentConfig.dailyBudgetUSD, 100, 'dailyBudgetUSD should be 100');
        assert.strictEqual(agentConfig.monthlyBudgetUSD, 1000, 'monthlyBudgetUSD should be 1000');
        assert.strictEqual(agentConfig.enabledCategories.length, 3, 'Should have 3 enabled categories');
        assert.ok(loadTime < 2000, `Configuration should load in under 2 seconds (took ${loadTime}ms)`);
    });

    test('AC-1.1.b: maxConcurrent > 10 is capped at 10 with warning', async () => {
        const config = vscode.workspace.getConfiguration('claudeProjects.agents');
        await config.update('maxConcurrent', 15, vscode.ConfigurationTarget.Global);

        const agentConfig = getAgentConfig();

        assert.strictEqual(agentConfig.maxConcurrent, 10, 'maxConcurrent should be capped at 10');
    });

    test('AC-1.1.b: maxConcurrent < 1 uses default value with warning', async () => {
        const config = vscode.workspace.getConfiguration('claudeProjects.agents');
        await config.update('maxConcurrent', 0, vscode.ConfigurationTarget.Global);

        const agentConfig = getAgentConfig();

        assert.strictEqual(agentConfig.maxConcurrent, 1, 'maxConcurrent should default to 1');
    });

    test('AC-1.1.b: maxConcurrent with invalid value uses default', async () => {
        const config = vscode.workspace.getConfiguration('claudeProjects.agents');
        await config.update('maxConcurrent', 'invalid', vscode.ConfigurationTarget.Global);

        const agentConfig = getAgentConfig();

        assert.strictEqual(agentConfig.maxConcurrent, 1, 'maxConcurrent should default to 1 for invalid input');
    });

    test('AC-1.1.c: Negative dailyBudgetUSD uses default value with error', async () => {
        const config = vscode.workspace.getConfiguration('claudeProjects.agents');
        await config.update('dailyBudgetUSD', -10, vscode.ConfigurationTarget.Global);

        const agentConfig = getAgentConfig();

        assert.strictEqual(agentConfig.dailyBudgetUSD, 50, 'dailyBudgetUSD should default to 50 for negative values');
    });

    test('AC-1.1.c: Negative monthlyBudgetUSD uses default value with error', async () => {
        const config = vscode.workspace.getConfiguration('claudeProjects.agents');
        await config.update('monthlyBudgetUSD', -100, vscode.ConfigurationTarget.Global);

        const agentConfig = getAgentConfig();

        assert.strictEqual(agentConfig.monthlyBudgetUSD, 500, 'monthlyBudgetUSD should default to 500 for negative values');
    });

    test('AC-1.1.c: Zero budgets are allowed', async () => {
        const config = vscode.workspace.getConfiguration('claudeProjects.agents');
        await config.update('dailyBudgetUSD', 0, vscode.ConfigurationTarget.Global);
        await config.update('monthlyBudgetUSD', 0, vscode.ConfigurationTarget.Global);

        const agentConfig = getAgentConfig();

        assert.strictEqual(agentConfig.dailyBudgetUSD, 0, 'dailyBudgetUSD can be 0');
        assert.strictEqual(agentConfig.monthlyBudgetUSD, 0, 'monthlyBudgetUSD can be 0');
    });

    test('AC-1.1.d: Invalid category names are filtered out with warning', async () => {
        const config = vscode.workspace.getConfiguration('claudeProjects.agents');
        const invalidCategories = ['Security', 'InvalidCategory1', 'Testing', 'BadCategory', 'Documentation'];
        await config.update('enabledCategories', invalidCategories, vscode.ConfigurationTarget.Global);

        const agentConfig = getAgentConfig();

        assert.strictEqual(agentConfig.enabledCategories.length, 3, 'Should have 3 valid categories');
        assert.ok(agentConfig.enabledCategories.includes('Security'), 'Should include Security');
        assert.ok(agentConfig.enabledCategories.includes('Testing'), 'Should include Testing');
        assert.ok(agentConfig.enabledCategories.includes('Documentation'), 'Should include Documentation');
        assert.ok(!agentConfig.enabledCategories.includes('InvalidCategory1' as AgentCategory), 'Should not include InvalidCategory1');
    });

    test('AC-1.1.d: All invalid categories defaults to all valid categories', async () => {
        const config = vscode.workspace.getConfiguration('claudeProjects.agents');
        await config.update('enabledCategories', ['Invalid1', 'Invalid2'], vscode.ConfigurationTarget.Global);

        const agentConfig = getAgentConfig();

        assert.strictEqual(agentConfig.enabledCategories.length, VALID_AGENT_CATEGORIES.length, 'Should enable all valid categories when all are invalid');
    });

    test('Valid categories constant has 21 categories', () => {
        assert.strictEqual(VALID_AGENT_CATEGORIES.length, 21, 'Should have exactly 21 valid categories');
    });

    test('isCategoryEnabled returns true for enabled category', async () => {
        const config = vscode.workspace.getConfiguration('claudeProjects.agents');
        await config.update('enabledCategories', ['Security', 'Testing'], vscode.ConfigurationTarget.Global);

        assert.ok(isCategoryEnabled('Security'), 'Security should be enabled');
        assert.ok(isCategoryEnabled('Testing'), 'Testing should be enabled');
        assert.ok(!isCategoryEnabled('Documentation'), 'Documentation should not be enabled');
    });

    test('getDisabledCategories returns correct disabled categories', async () => {
        const config = vscode.workspace.getConfiguration('claudeProjects.agents');
        await config.update('enabledCategories', ['Security', 'Testing'], vscode.ConfigurationTarget.Global);

        const disabled = getDisabledCategories();

        assert.strictEqual(disabled.length, VALID_AGENT_CATEGORIES.length - 2, 'Should have 19 disabled categories');
        assert.ok(!disabled.includes('Security'), 'Security should not be in disabled list');
        assert.ok(!disabled.includes('Testing'), 'Testing should not be in disabled list');
        assert.ok(disabled.includes('Documentation'), 'Documentation should be in disabled list');
    });

    test('Default configuration values are correct', async () => {
        const config = vscode.workspace.getConfiguration('claudeProjects.agents');
        await config.update('maxConcurrent', undefined, vscode.ConfigurationTarget.Global);
        await config.update('dailyBudgetUSD', undefined, vscode.ConfigurationTarget.Global);
        await config.update('monthlyBudgetUSD', undefined, vscode.ConfigurationTarget.Global);
        await config.update('enabledCategories', undefined, vscode.ConfigurationTarget.Global);

        const agentConfig = getAgentConfig();

        assert.strictEqual(agentConfig.maxConcurrent, 1, 'Default maxConcurrent should be 1');
        assert.strictEqual(agentConfig.dailyBudgetUSD, 50, 'Default dailyBudgetUSD should be 50');
        assert.strictEqual(agentConfig.monthlyBudgetUSD, 500, 'Default monthlyBudgetUSD should be 500');
        assert.strictEqual(agentConfig.enabledCategories.length, 21, 'Default should enable all 21 categories');
    });

    test('Fractional maxConcurrent is floored to integer', async () => {
        const config = vscode.workspace.getConfiguration('claudeProjects.agents');
        await config.update('maxConcurrent', 5.7, vscode.ConfigurationTarget.Global);

        const agentConfig = getAgentConfig();

        assert.strictEqual(agentConfig.maxConcurrent, 5, 'maxConcurrent should be floored to 5');
    });

    test('Configuration can be read multiple times without errors', async () => {
        const config = vscode.workspace.getConfiguration('claudeProjects.agents');
        await config.update('maxConcurrent', 3, vscode.ConfigurationTarget.Global);

        const config1 = getAgentConfig();
        const config2 = getAgentConfig();
        const config3 = getAgentConfig();

        assert.strictEqual(config1.maxConcurrent, 3, 'First read should be 3');
        assert.strictEqual(config2.maxConcurrent, 3, 'Second read should be 3');
        assert.strictEqual(config3.maxConcurrent, 3, 'Third read should be 3');
    });
});
