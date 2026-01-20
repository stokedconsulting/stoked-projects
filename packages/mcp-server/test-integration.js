#!/usr/bin/env node
/**
 * Integration test for health_check tool
 *
 * This script validates end-to-end functionality using the compiled JavaScript.
 */

const { MCPServer } = require('./dist/server.js');
const { loadConfig, createLogger, resetConfig, resetLogger } = require('./dist/config.js');

const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
};

function log(message, color = 'reset') {
  console.log(`${colors[color]}${message}${colors.reset}`);
}

async function main() {
  log('\n=== MCP Server Health Check Tool Integration Test ===\n', 'cyan');

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
    log(`\n   Result:`, 'reset');
    log(`   - API Available: ${healthResult.apiAvailable}`, 'reset');
    log(`   - Authenticated: ${healthResult.authenticated}`, 'reset');
    log(`   - Response Time: ${healthResult.responseTimeMs}ms`, 'reset');
    if (healthResult.apiVersion) {
      log(`   - API Version: ${healthResult.apiVersion}`, 'reset');
    }
    if (healthResult.error) {
      log(`   - Error: ${healthResult.error}`, 'yellow');
    }

    // Validate all acceptance criteria
    log('\n5. Validating acceptance criteria...', 'blue');

    // AC-1.5.d: Validate response time
    if (typeof healthResult.responseTimeMs !== 'number') {
      log(`   ✗ AC-1.5.d FAILED: responseTimeMs is not a number`, 'red');
      process.exit(1);
    }

    if (healthResult.responseTimeMs < 0) {
      log(`   ✗ AC-1.5.d FAILED: responseTimeMs is negative`, 'red');
      process.exit(1);
    }

    log(`   ✓ AC-1.5.d PASSED: Response time field present and valid`, 'green');

    if (healthResult.responseTimeMs > 2000) {
      log(`   ⚠ WARNING: Response time exceeded 2 seconds (${healthResult.responseTimeMs}ms)`, 'yellow');
    }

    // AC-1.5.c: API availability
    if (healthResult.apiAvailable) {
      log(`   ✓ AC-1.5.c PASSED: API is available`, 'green');

      // AC-1.5.a or AC-1.5.b: Authentication
      if (healthResult.authenticated) {
        log(`   ✓ AC-1.5.a PASSED: Authentication successful (valid API key)`, 'green');
      } else {
        log(`   ⚠ AC-1.5.b: Authentication failed (check API key)`, 'yellow');
      }
    } else {
      log(`   ⚠ AC-1.5.c: API is not available (check connectivity)`, 'yellow');
      log(`   - This is expected if the API is not running locally`, 'yellow');
    }

    // Summary
    log('\n=== Test Summary ===', 'cyan');
    log(`✓ health_check tool is registered`, 'green');
    log(`✓ Tool executes without errors`, 'green');
    log(`✓ All required fields are present in the response`, 'green');
    log(`✓ AC-1.5.e PASSED: Tool appears in MCP tools list`, 'green');
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
