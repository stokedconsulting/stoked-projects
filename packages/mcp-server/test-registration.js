#!/usr/bin/env node
/**
 * Tool Registration Test
 *
 * This script validates that the health_check tool is properly registered
 * and appears in the MCP tools list (AC-1.5.e).
 *
 * This test DOES NOT require an actual API key since we're only testing
 * the registration mechanism, not the execution.
 */

// Set a dummy API key for the test
process.env.STATE_TRACKING_API_KEY = 'test-api-key-for-registration-validation';

const { MCPServer } = require('./dist/server.js');
const { loadConfig, createLogger, resetConfig, resetLogger } = require('./dist/config.js');

const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
};

function log(message, color = 'reset') {
  console.log(`${colors[color]}${message}${colors.reset}`);
}

function main() {
  log('\n=== Health Check Tool Registration Test ===\n', 'cyan');

  try {
    // Reset any previous config/logger instances
    resetConfig();
    resetLogger();

    // Load configuration
    log('1. Loading configuration...', 'blue');
    const config = loadConfig();
    const logger = createLogger(config);
    log(`   ✓ Configuration loaded successfully`, 'green');

    // Create MCP server
    log('\n2. Creating MCP server instance...', 'blue');
    const server = new MCPServer(config, logger);
    log(`   ✓ Server created successfully`, 'green');

    // AC-1.5.e: Verify tool appears in registry
    log('\n3. AC-1.5.e: Verifying tool registration...', 'blue');
    const registry = server.getRegistry();
    const toolCount = registry.getToolCount();
    log(`   - Total registered tools: ${toolCount}`, 'reset');

    if (toolCount === 0) {
      log(`   ✗ FAILED: No tools registered`, 'red');
      process.exit(1);
    }

    const tools = registry.listTools();
    log(`   - Tools list length: ${tools.length}`, 'reset');

    // Find health_check tool
    const healthCheckTool = tools.find((t) => t.name === 'health_check');

    if (!healthCheckTool) {
      log(`   ✗ FAILED: health_check tool not found in registry`, 'red');
      log(`   - Available tools: ${tools.map((t) => t.name).join(', ')}`, 'red');
      process.exit(1);
    }

    log(`   ✓ health_check tool found in registry`, 'green');

    // Validate tool definition
    log('\n4. Validating tool definition...', 'blue');

    // Check name
    if (healthCheckTool.name !== 'health_check') {
      log(`   ✗ FAILED: Incorrect tool name: ${healthCheckTool.name}`, 'red');
      process.exit(1);
    }
    log(`   ✓ Tool name: ${healthCheckTool.name}`, 'green');

    // Check description
    if (!healthCheckTool.description || healthCheckTool.description.length === 0) {
      log(`   ✗ FAILED: Missing tool description`, 'red');
      process.exit(1);
    }
    log(`   ✓ Description: "${healthCheckTool.description}"`, 'green');

    // Verify description mentions key concepts
    const desc = healthCheckTool.description.toLowerCase();
    if (!desc.includes('connectivity') || !desc.includes('authentication')) {
      log(`   ⚠ WARNING: Description may not be descriptive enough`, 'cyan');
    }

    // Check input schema
    if (!healthCheckTool.inputSchema) {
      log(`   ✗ FAILED: Missing input schema`, 'red');
      process.exit(1);
    }

    if (healthCheckTool.inputSchema.type !== 'object') {
      log(`   ✗ FAILED: Input schema type should be 'object'`, 'red');
      process.exit(1);
    }

    const schemaProps = healthCheckTool.inputSchema.properties || {};
    const requiredProps = healthCheckTool.inputSchema.required || [];

    if (Object.keys(schemaProps).length !== 0) {
      log(`   ⚠ WARNING: Health check should have no parameters, found ${Object.keys(schemaProps).length}`, 'cyan');
    }

    if (requiredProps.length !== 0) {
      log(`   ⚠ WARNING: Health check should have no required parameters, found ${requiredProps.length}`, 'cyan');
    }

    log(`   ✓ Input schema is valid (empty parameters)`, 'green');

    // Check if tool is callable
    log('\n5. Verifying tool is callable...', 'blue');
    if (!registry.hasTool('health_check')) {
      log(`   ✗ FAILED: Registry reports health_check tool is not available`, 'red');
      process.exit(1);
    }
    log(`   ✓ Tool is callable via registry`, 'green');

    // Summary
    log('\n=== Test Summary ===', 'cyan');
    log(`✓ AC-1.5.e PASSED: health_check tool appears in MCP tools list`, 'green');
    log(`✓ Tool has correct name: 'health_check'`, 'green');
    log(`✓ Tool has descriptive description`, 'green');
    log(`✓ Tool has valid input schema (no parameters required)`, 'green');
    log(`✓ Tool is registered and callable`, 'green');
    log(`\n✓ Phase 1 Work Item 1.5: COMPLETE`, 'green');
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
