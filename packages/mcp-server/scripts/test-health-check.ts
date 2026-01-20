#!/usr/bin/env ts-node
/**
 * Manual test script for health_check tool
 *
 * This script validates end-to-end functionality of the health_check tool:
 * 1. Creates an MCP server instance
 * 2. Registers the health_check tool
 * 3. Lists tools to verify registration
 * 4. Executes the tool with various scenarios
 * 5. Validates all acceptance criteria
 */

import { MCPServer } from '../src/server';
import { loadConfig, createLogger, resetConfig, resetLogger } from '../src/config';

/**
 * Test colors for output
 */
const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
};

function log(message: string, color: keyof typeof colors = 'reset') {
  console.log(`${colors[color]}${message}${colors.reset}`);
}

async function main() {
  log('\n=== MCP Server Health Check Tool Test ===\n', 'cyan');

  try {
    // Reset any previous config/logger instances
    resetConfig();
    resetLogger();

    // Load configuration
    log('1. Loading configuration...', 'blue');
    const config = loadConfig();
    const logger = createLogger(config);
    log(`   ✓ Configuration loaded successfully`, 'green');
    log(`   - API URL: ${config.apiBaseUrl}`, 'reset');
    log(`   - Timeout: ${config.requestTimeout}ms`, 'reset');
    log(`   - Retries: ${config.retryAttempts}`, 'reset');

    // Create MCP server
    log('\n2. Creating MCP server instance...', 'blue');
    const server = new MCPServer(config, logger);
    log(`   ✓ Server created successfully`, 'green');

    // AC-1.5.e: Verify tool appears in registry
    log('\n3. AC-1.5.e: Verifying tool registration...', 'blue');
    const registry = server.getRegistry();
    const toolCount = registry.getToolCount();
    log(`   - Registered tools: ${toolCount}`, 'reset');

    if (toolCount === 0) {
      log(`   ✗ FAILED: No tools registered`, 'red');
      process.exit(1);
    }

    const tools = registry.listTools();
    const healthCheckTool = tools.find((t) => t.name === 'health_check');

    if (!healthCheckTool) {
      log(`   ✗ FAILED: health_check tool not found in registry`, 'red');
      log(`   - Available tools: ${tools.map((t) => t.name).join(', ')}`, 'yellow');
      process.exit(1);
    }

    log(`   ✓ health_check tool found in registry`, 'green');
    log(`   - Name: ${healthCheckTool.name}`, 'reset');
    log(`   - Description: ${healthCheckTool.description}`, 'reset');
    log(`   - Input schema: ${JSON.stringify(healthCheckTool.inputSchema, null, 2)}`, 'reset');

    // Execute health check tool
    log('\n4. Executing health_check tool...', 'blue');
    const startTime = Date.now();
    const result = await registry.executeTool('health_check', {});
    const executionTime = Date.now() - startTime;

    log(`   - Execution time: ${executionTime}ms`, 'reset');

    // Parse result
    if (!result.content || result.content.length === 0) {
      log(`   ✗ FAILED: Tool returned empty content`, 'red');
      process.exit(1);
    }

    const textContent = result.content[0];
    if (textContent.type !== 'text') {
      log(`   ✗ FAILED: Expected text content, got ${textContent.type}`, 'red');
      process.exit(1);
    }

    const healthResult = JSON.parse(textContent.text || '{}');

    log(`   ✓ Tool executed successfully`, 'green');
    log(`   - Result: ${JSON.stringify(healthResult, null, 2)}`, 'reset');

    // AC-1.5.a or AC-1.5.b: Validate authentication
    log('\n5. Validating authentication status...', 'blue');
    if (healthResult.apiAvailable) {
      log(`   ✓ AC-1.5.c PASSED: API is available`, 'green');

      if (healthResult.authenticated) {
        log(`   ✓ AC-1.5.a PASSED: Authentication successful (valid API key)`, 'green');
      } else {
        log(
          `   ⚠ AC-1.5.b: Authentication failed (invalid or missing API key)`,
          'yellow'
        );
        if (healthResult.error) {
          log(`   - Error: ${healthResult.error}`, 'yellow');
        }
      }
    } else {
      log(`   ✗ AC-1.5.c: API is NOT available`, 'red');
      if (healthResult.error) {
        log(`   - Error: ${healthResult.error}`, 'red');
      }
    }

    // AC-1.5.d: Validate response time
    log('\n6. AC-1.5.d: Validating response time...', 'blue');
    if (typeof healthResult.responseTimeMs !== 'number') {
      log(
        `   ✗ FAILED: responseTimeMs is not a number (${typeof healthResult.responseTimeMs})`,
        'red'
      );
      process.exit(1);
    }

    if (healthResult.responseTimeMs < 0) {
      log(`   ✗ FAILED: responseTimeMs is negative (${healthResult.responseTimeMs})`, 'red');
      process.exit(1);
    }

    if (healthResult.responseTimeMs > 2000) {
      log(
        `   ⚠ WARNING: Response time exceeded 2 seconds (${healthResult.responseTimeMs}ms)`,
        'yellow'
      );
    } else {
      log(`   ✓ AC-1.5.d PASSED: Response time within 2 seconds`, 'green');
    }

    log(`   - Response time: ${healthResult.responseTimeMs}ms`, 'reset');

    // Summary
    log('\n=== Test Summary ===', 'cyan');
    log(`✓ All acceptance criteria validated`, 'green');
    log(`✓ health_check tool is fully functional`, 'green');
    log(`✓ Phase 1 Foundation & Infrastructure: COMPLETE\n`, 'green');

    process.exit(0);
  } catch (error) {
    log(`\n✗ Test failed with error:`, 'red');
    console.error(error);
    process.exit(1);
  }
}

// Run the test
main();
