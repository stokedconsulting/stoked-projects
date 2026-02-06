import { JSONSchemaType } from 'ajv';
import { ToolDefinition, ToolResult } from './registry.js';
import { APIClient } from '../api-client.js';

/**
 * Input parameters for notify_project_created tool
 */
export interface NotifyProjectCreatedParams {
  /** GitHub Project number */
  projectNumber: number;

  /** Project title */
  title?: string;

  /** Repository owner (org or user) */
  owner?: string;

  /** Repository name */
  repo?: string;

  /** Project URL */
  url?: string;

  /** Additional project metadata */
  metadata?: Record<string, unknown>;
}

/**
 * JSON Schema for notify_project_created parameters
 */
const notifyProjectCreatedSchema: JSONSchemaType<NotifyProjectCreatedParams> = {
  type: 'object',
  properties: {
    projectNumber: {
      type: 'number',
      description: 'GitHub Project number',
    },
    title: {
      type: 'string',
      description: 'Project title',
      nullable: true,
    },
    owner: {
      type: 'string',
      description: 'Repository owner (org or user)',
      nullable: true,
    },
    repo: {
      type: 'string',
      description: 'Repository name',
      nullable: true,
    },
    url: {
      type: 'string',
      description: 'Project URL',
      nullable: true,
    },
    metadata: {
      type: 'object',
      description: 'Additional project metadata',
      nullable: true,
      required: [],
    },
  },
  required: ['projectNumber'],
  additionalProperties: false,
};

/**
 * Create notify_project_created tool definition
 *
 * This tool emits a project.created event to notify connected clients
 * (VSCode extension) that a new project has been created. This is typically
 * called by /project-create skill after successfully creating a GitHub project.
 *
 * @returns Tool definition for notify_project_created
 */
export function createNotifyProjectCreatedTool(apiClient?: APIClient): ToolDefinition<NotifyProjectCreatedParams> {
  return {
    name: 'notify_project_created',
    description:
      'Notify connected clients (VSCode extension) that a new GitHub project has been created. ' +
      'Emits a project.created event via WebSocket to trigger UI refresh. ' +
      'Call this after successfully creating a project with /project-create.',
    inputSchema: notifyProjectCreatedSchema,
    handler: async (params: NotifyProjectCreatedParams): Promise<ToolResult> => {
      const { projectNumber, title, owner, repo, url, metadata } = params;

      // Build event data payload
      const eventData: any = {
        projectNumber,
      };

      if (title) {
        eventData.title = title;
      }

      if (owner) {
        eventData.owner = owner;
      }

      if (repo) {
        eventData.repo = repo;
      }

      if (url) {
        eventData.url = url;
      }

      if (metadata) {
        eventData.metadata = metadata;
      }

      // Post event to API for real-time broadcasting
      if (apiClient) {
        apiClient.postProjectEvent({
          type: 'project.created',
          data: eventData,
        });
      }

      // Return success result
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                success: true,
                message: 'Project creation notification sent',
                projectNumber,
                eventType: 'project.created',
              },
              null,
              2
            ),
          },
        ],
      };
    },
  };
}
