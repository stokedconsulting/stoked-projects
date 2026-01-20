import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { ToolRegistry } from './tools/registry.js';
import { ServerConfig, Logger } from './config.js';
import { createAPIClient } from './api-client.js';
import { createHealthCheckTool } from './tools/health-check.js';
import { createGetIssueDetailsTool } from './tools/get-issue-details.js';
import { createReadProjectTool } from './tools/read-project.js';
import { createGetProjectPhasesTool } from './tools/get-project-phases.js';
import { createListIssuesTool } from './tools/list-issues.js';

/**
 * MCP Server for Claude Projects API and Extension Communication
 *
 * This server provides the Model Context Protocol interface for:
 * - State tracking API communication
 * - Browser extension integration
 * - Project orchestration workflows
 */
export class MCPServer {
  private server: Server;
  private registry: ToolRegistry;
  private config: ServerConfig;
  private logger: Logger;

  constructor(config: ServerConfig, logger: Logger) {
    this.config = config;
    this.logger = logger;

    this.server = new Server(
      {
        name: 'claude-projects-mcp-server',
        version: '0.1.0',
      },
      {
        capabilities: {
          tools: {},
        },
      }
    );

    this.registry = new ToolRegistry();
    this.setupHandlers();
    this.registerTools();
  }

  /**
   * Register all available tools with the registry
   */
  private registerTools(): void {
    // Create API client for tools
    const apiClient = createAPIClient({
      baseUrl: this.config.apiBaseUrl,
      apiKey: this.config.apiKey,
      timeout: this.config.requestTimeout,
      maxRetries: this.config.retryAttempts,
    });

    // Register health check tool
    const healthCheckTool = createHealthCheckTool(apiClient);
    this.registry.registerTool(healthCheckTool);

    // Register read project tool
    const readProjectTool = createReadProjectTool(apiClient);
    this.registry.registerTool(readProjectTool);

    // Register get issue details tool
    const getIssueDetailsTool = createGetIssueDetailsTool(apiClient);
    this.registry.registerTool(getIssueDetailsTool);

    // Register get project phases tool
    const getProjectPhasesTool = createGetProjectPhasesTool(apiClient);
    this.registry.registerTool(getProjectPhasesTool);

    // Register list issues tool
    const listIssuesTool = createListIssuesTool(apiClient);
    this.registry.registerTool(listIssuesTool);

    this.logger.info(`Registered ${this.registry.getToolCount()} tool(s)`);
  }

  /**
   * Get the tool registry (for testing and tool registration)
   */
  getRegistry(): ToolRegistry {
    return this.registry;
  }

  /**
   * Setup MCP protocol handlers
   */
  private setupHandlers(): void {
    // List available tools
    this.server.setRequestHandler(ListToolsRequestSchema, async () => {
      return {
        tools: this.registry.listTools(),
      };
    });

    // Handle tool calls
    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;

      // Execute tool through registry with validation and error handling
      const result = await this.registry.executeTool(name, args || {});

      return result;
    });
  }

  /**
   * Start the MCP server with stdio transport
   */
  async start(): Promise<void> {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);

    this.logger.info('MCP Server started successfully');
    this.logger.info('Server name: claude-projects-mcp-server');
    this.logger.info('Server version: 0.1.0');
    this.logger.info('Protocol: MCP via stdio transport');
    this.logger.info('Capabilities: tools');
  }

  /**
   * Get the server instance (for testing)
   */
  getServer(): Server {
    return this.server;
  }
}
