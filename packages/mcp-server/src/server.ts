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
import { createUpdateIssueTool } from './tools/update-issue.js';
import { createUpdateIssuePhaseTool } from './tools/update-issue-phase.js';
import { createUpdateIssueStatusTool } from './tools/update-issue-status.js';
import { createCreateIssueTool } from './tools/create-issue.js';
import { WebSocketNotificationServer } from './events/websocket-server.js';
import { eventBus } from './events/event-bus.js';
import { createGitHubClient } from './github-client.js';
import { createGitHubCreateProjectTool } from './tools/github-create-project.js';
import { createGitHubUpdateProjectTool } from './tools/github-update-project.js';
import { createGitHubListProjectsTool } from './tools/github-list-projects.js';
import { createGitHubLinkProjectTool } from './tools/github-link-project.js';
import { createGitHubCreateIssueTool } from './tools/github-create-issue.js';
import { createGitHubUpdateIssueTool } from './tools/github-update-issue.js';
import { createGitHubCloseIssueTool } from './tools/github-close-issue.js';
import { createGitHubLinkIssueToProjectTool } from './tools/github-link-issue-to-project.js';
import { createGitHubGetRepoTool } from './tools/github-get-repo.js';
import { createGitHubGetOrgTool } from './tools/github-get-org.js';
import { createNotifyProjectCreatedTool } from './tools/notify-project-created.js';

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
  private wsServer?: WebSocketNotificationServer;

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

    // Register update issue tool
    const updateIssueTool = createUpdateIssueTool(apiClient);
    this.registry.registerTool(updateIssueTool);

    // Register update issue phase tool
    const updateIssuePhaseTool = createUpdateIssuePhaseTool(apiClient);
    this.registry.registerTool(updateIssuePhaseTool);

    // Register update issue status tool
    const updateIssueStatusTool = createUpdateIssueStatusTool(apiClient);
    this.registry.registerTool(updateIssueStatusTool);

    // Register create issue tool
    const createIssueTool = createCreateIssueTool(apiClient);
    this.registry.registerTool(createIssueTool);

    // Register notify project created tool
    const notifyProjectCreatedTool = createNotifyProjectCreatedTool(apiClient);
    this.registry.registerTool(notifyProjectCreatedTool);

    // Register GitHub tools (direct GitHub API access)
    const githubToken = process.env.GITHUB_TOKEN;
    if (githubToken) {
      const githubClient = createGitHubClient(githubToken);

      // GitHub project tools
      this.registry.registerTool(createGitHubCreateProjectTool(githubClient, apiClient));
      this.registry.registerTool(createGitHubUpdateProjectTool(githubClient, apiClient));
      this.registry.registerTool(createGitHubListProjectsTool(githubClient));
      this.registry.registerTool(createGitHubLinkProjectTool(githubClient));

      // GitHub issue tools
      this.registry.registerTool(createGitHubCreateIssueTool(githubClient, apiClient));
      this.registry.registerTool(createGitHubUpdateIssueTool(githubClient, apiClient));
      this.registry.registerTool(createGitHubCloseIssueTool(githubClient, apiClient));
      this.registry.registerTool(
        createGitHubLinkIssueToProjectTool(githubClient, apiClient)
      );

      // GitHub metadata tools
      this.registry.registerTool(createGitHubGetRepoTool(githubClient));
      this.registry.registerTool(createGitHubGetOrgTool(githubClient));

      this.logger.info('Registered 10 GitHub API tools');
    } else {
      this.logger.warn(
        'GITHUB_TOKEN not set, GitHub API tools will not be available'
      );
    }

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

    // Start WebSocket server for real-time notifications
    this.wsServer = new WebSocketNotificationServer({
      port: this.config.wsPort,
      apiKey: this.config.wsApiKey,
      eventBus,
      logger: this.logger,
    });
    await this.wsServer.start();
  }

  /**
   * Stop the MCP server and WebSocket server
   */
  async stop(): Promise<void> {
    if (this.wsServer) {
      await this.wsServer.stop();
    }
  }

  /**
   * Get the server instance (for testing)
   */
  getServer(): Server {
    return this.server;
  }
}
