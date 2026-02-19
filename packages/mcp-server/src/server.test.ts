// Mock @octokit/rest (pure ESM, can't be imported by Jest/CommonJS)
jest.mock('@octokit/rest', () => ({
  Octokit: jest.fn().mockImplementation(() => ({
    rest: {},
    graphql: jest.fn(),
  })),
}));

import { MCPServer } from './server';
import { JSONSchemaType } from 'ajv';
import { ServerConfig, Logger } from './config';

// Mock logger for testing
const mockLogger: Logger = {
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
};

// Mock config for testing
const mockConfig: ServerConfig = {
  apiKey: 'test-api-key',
  apiBaseUrl: 'https://test.example.com',
  logLevel: 'info',
  requestTimeout: 10000,
  retryAttempts: 3,
};

describe('MCPServer - Tool Registry Integration', () => {
  let server: MCPServer;

  beforeEach(() => {
    jest.clearAllMocks();
    server = new MCPServer(mockConfig, mockLogger);
  });

  it('should expose the tool registry for tool registration', () => {
    const registry = server.getRegistry();
    expect(registry).toBeDefined();
    // Core API tools (10) + GitHub tools (10 when GITHUB_TOKEN is set) + notify = 20
    expect(registry.getToolCount()).toBeGreaterThanOrEqual(10);
    expect(registry.hasTool('health_check')).toBe(true);
    expect(registry.hasTool('read_project')).toBe(true);
    expect(registry.hasTool('get_issue_details')).toBe(true);
    expect(registry.hasTool('get_project_phases')).toBe(true);
    expect(registry.hasTool('list_issues')).toBe(true);
    expect(registry.hasTool('update_issue')).toBe(true);
    expect(registry.hasTool('update_issue_phase')).toBe(true);
    expect(registry.hasTool('update_issue_status')).toBe(true);
    expect(registry.hasTool('create_issue')).toBe(true);
  });

  it('should allow registering tools through the registry', () => {
    interface EchoParams {
      message: string;
    }

    const schema: JSONSchemaType<EchoParams> = {
      type: 'object',
      properties: {
        message: { type: 'string' },
      },
      required: ['message'],
      additionalProperties: false,
    };

    const registry = server.getRegistry();
    const baseCount = registry.getToolCount();

    registry.registerTool({
      name: 'echo',
      description: 'Echo test',
      inputSchema: schema,
      handler: async (params) => ({
        content: [{ type: 'text', text: params.message }],
      }),
    });

    expect(registry.getToolCount()).toBe(baseCount + 1);
    expect(registry.hasTool('echo')).toBe(true);
    expect(registry.hasTool('health_check')).toBe(true);

    const tools = registry.listTools();
    expect(tools).toHaveLength(baseCount + 1);
    const echoTool = tools.find((t) => t.name === 'echo');
    expect(echoTool).toBeDefined();
    expect(echoTool?.name).toBe('echo');
  });

  it('should integrate registry with server handlers', async () => {
    interface TestParams {
      value: number;
    }

    const schema: JSONSchemaType<TestParams> = {
      type: 'object',
      properties: {
        value: { type: 'number' },
      },
      required: ['value'],
      additionalProperties: false,
    };

    const registry = server.getRegistry();
    registry.registerTool({
      name: 'double',
      description: 'Double a number',
      inputSchema: schema,
      handler: async (params) => ({
        content: [{ type: 'text', text: String(params.value * 2) }],
      }),
    });

    // Test successful execution
    const result = await registry.executeTool('double', { value: 21 });
    expect(result.isError).toBeUndefined();
    expect(result.content[0].text).toBe('42');

    // Test validation error
    const errorResult = await registry.executeTool('double', { value: 'not-a-number' });
    expect(errorResult.isError).toBe(true);
  });
});
