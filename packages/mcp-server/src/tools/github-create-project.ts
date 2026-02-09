import { JSONSchemaType } from 'ajv';
import { ToolDefinition, ToolResult } from './registry.js';
import { GitHubClient } from '../github-client.js';
import { APIClient } from '../api-client.js';

/**
 * Parameters for github_create_project tool
 */
export interface CreateProjectParams {
  owner: string;
  repo?: string;
  name: string;
  body?: string;
}

/**
 * JSON Schema for github_create_project parameters
 */
const createProjectSchema: JSONSchemaType<CreateProjectParams> = {
  type: 'object',
  properties: {
    owner: {
      type: 'string',
      description: 'Repository owner (organization or user)',
    },
    repo: {
      type: 'string',
      nullable: true,
      description:
        'Repository name (if creating repo project, omit for org project)',
    },
    name: {
      type: 'string',
      description: 'Project name',
    },
    body: {
      type: 'string',
      nullable: true,
      description: 'Project description',
    },
  },
  required: ['owner', 'name'],
  additionalProperties: false,
};

/**
 * Create github_create_project tool
 *
 * Creates a new GitHub project in a repository or organization
 */
export function createGitHubCreateProjectTool(
  client: GitHubClient,
  apiClient?: APIClient,
): ToolDefinition<CreateProjectParams> {
  return {
    name: 'github_create_project',
    description:
      'Create a new GitHub project in a repository or organization. If repo is provided, creates a repository project; otherwise creates an organization project.',
    inputSchema: createProjectSchema,
    handler: async (params: CreateProjectParams): Promise<ToolResult> => {
      try {
        const result = await client.createProject(params);

        // Post event to API for real-time broadcasting
        if (apiClient) {
          apiClient.postProjectEvent({
            type: 'project.created',
            data: {
              projectNumber: result.number,
              title: result.title,
              owner: params.owner,
              repo: params.repo,
              url: result.url,
              id: result.id,
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
                  error: 'Failed to create project',
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
