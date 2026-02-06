import { JSONSchemaType } from 'ajv';
import { ToolDefinition, ToolResult } from './registry.js';
import { GitHubClient } from '../github-client.js';
import { APIClient } from '../api-client.js';

export interface UpdateProjectParams {
  projectId: string;
  name?: string;
  body?: string;
  state?: 'open' | 'closed';
  projectNumber?: number;
}

const updateProjectSchema: JSONSchemaType<UpdateProjectParams> = {
  type: 'object',
  properties: {
    projectId: {
      type: 'string',
      description: 'Project node ID (ProjectsV2)',
    },
    name: {
      type: 'string',
      nullable: true,
      description: 'New project name',
    },
    body: {
      type: 'string',
      nullable: true,
      description: 'New project description',
    },
    state: {
      type: 'string',
      enum: ['open', 'closed'],
      nullable: true,
      description: 'Project state',
    },
    projectNumber: {
      type: 'number',
      nullable: true,
      description: 'GitHub Project number (for real-time extension notifications)',
    },
  },
  required: ['projectId'],
  additionalProperties: false,
};

export function createGitHubUpdateProjectTool(
  client: GitHubClient,
  apiClient?: APIClient,
): ToolDefinition<UpdateProjectParams> {
  return {
    name: 'github_update_project',
    description: 'Update a GitHub project (name, description, or state)',
    inputSchema: updateProjectSchema,
    handler: async (params: UpdateProjectParams): Promise<ToolResult> => {
      try {
        const result = await client.updateProject(params);

        // Post event to API for real-time broadcasting
        if (params.projectNumber && apiClient) {
          apiClient.postProjectEvent({
            type: 'project.updated',
            data: {
              projectNumber: params.projectNumber,
              projectId: params.projectId,
              title: params.name,
              state: params.state,
              body: params.body,
            },
          });
        }

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                {
                  success: true,
                  project: result,
                },
                null,
                2
              ),
            },
          ],
        };
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : 'Unknown error';
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                {
                  error: 'Failed to update project',
                  message: errorMessage,
                  retryable: errorMessage.includes('rate limit'),
                },
                null,
                2
              ),
            },
          ],
          isError: true,
        };
      }
    },
  };
}
