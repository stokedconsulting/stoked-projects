import { JSONSchemaType } from 'ajv';
import { ToolDefinition, ToolResult } from './registry.js';
import { GitHubClient } from '../github-client.js';
import { APIClient } from '../api-client.js';

export interface UpdateIssueParams {
  owner: string;
  repo: string;
  issueNumber: number;
  title?: string;
  body?: string;
  state?: 'open' | 'closed';
  assignees?: string[];
  labels?: string[];
  projectNumber?: number;
}

const updateIssueSchema: JSONSchemaType<UpdateIssueParams> = {
  type: 'object',
  properties: {
    owner: {
      type: 'string',
      description: 'Repository owner',
    },
    repo: {
      type: 'string',
      description: 'Repository name',
    },
    issueNumber: {
      type: 'number',
      description: 'Issue number',
    },
    title: {
      type: 'string',
      nullable: true,
      description: 'New issue title',
    },
    body: {
      type: 'string',
      nullable: true,
      description: 'New issue description',
    },
    state: {
      type: 'string',
      enum: ['open', 'closed'],
      nullable: true,
      description: 'Issue state',
    },
    assignees: {
      type: 'array',
      items: { type: 'string' },
      nullable: true,
      description: 'Array of assignees',
    },
    labels: {
      type: 'array',
      items: { type: 'string' },
      nullable: true,
      description: 'Array of labels',
    },
    projectNumber: {
      type: 'number',
      nullable: true,
      description: 'GitHub Project number (for real-time extension notifications)',
    },
  },
  required: ['owner', 'repo', 'issueNumber'],
  additionalProperties: false,
};

export function createGitHubUpdateIssueTool(
  client: GitHubClient,
  apiClient?: APIClient,
): ToolDefinition<UpdateIssueParams> {
  return {
    name: 'github_update_issue',
    description: 'Update a GitHub issue (title, body, state, assignees, labels)',
    inputSchema: updateIssueSchema,
    handler: async (params: UpdateIssueParams): Promise<ToolResult> => {
      try {
        const result = await client.updateIssue(params);

        // Post event to API for real-time broadcasting
        if (params.projectNumber && apiClient) {
          const updatedFields: string[] = [];
          if (params.title) updatedFields.push('title');
          if (params.body) updatedFields.push('body');
          if (params.state) updatedFields.push('state');
          if (params.assignees) updatedFields.push('assignees');
          if (params.labels) updatedFields.push('labels');

          apiClient.postProjectEvent({
            type: params.state === 'closed' ? 'issue.closed' : 'issue.updated',
            data: {
              projectNumber: params.projectNumber,
              issueNumber: params.issueNumber,
              title: params.title || result.title,
              state: params.state,
              updatedFields,
              owner: params.owner,
              repo: params.repo,
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
                  issue: result,
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
                  error: 'Failed to update issue',
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
