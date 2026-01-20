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
    // Multiple tools are automatically registered (health_check, read_project, get_issue_details, get_project_phases, list_issues)
    expect(registry.getToolCount()).toBe(5);
    expect(registry.hasTool('health_check')).toBe(true);
    expect(registry.hasTool('read_project')).toBe(true);
    expect(registry.hasTool('get_issue_details')).toBe(true);
    expect(registry.hasTool('get_project_phases')).toBe(true);
    expect(registry.hasTool('list_issues')).toBe(true);
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
    registry.registerTool({
      name: 'echo',
      description: 'Echo test',
      inputSchema: schema,
      handler: async (params) => ({
        content: [{ type: 'text', text: params.message }],
      }),
    });

    // 5 tools are registered automatically, plus echo = 6 tools
    expect(registry.getToolCount()).toBe(6);
    expect(registry.hasTool('echo')).toBe(true);
    expect(registry.hasTool('health_check')).toBe(true);

    const tools = registry.listTools();
    expect(tools).toHaveLength(6);
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
