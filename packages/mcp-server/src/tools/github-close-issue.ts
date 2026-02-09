import { JSONSchemaType } from 'ajv';
import { ToolDefinition, ToolResult } from './registry.js';
import { GitHubClient } from '../github-client.js';
import { APIClient } from '../api-client.js';

export interface CloseIssueParams {
  owner: string;
  repo: string;
  issueNumber: number;
  projectNumber?: number;
}

const closeIssueSchema: JSONSchemaType<CloseIssueParams> = {
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
      description: 'Issue number to close',
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

export function createGitHubCloseIssueTool(
  client: GitHubClient,
  apiClient?: APIClient,
): ToolDefinition<CloseIssueParams> {
  return {
    name: 'github_close_issue',
    description: 'Close a GitHub issue',
    inputSchema: closeIssueSchema,
    handler: async (params: CloseIssueParams): Promise<ToolResult> => {
      try {
        const result = await client.closeIssue(params);

        // Post event to API for real-time broadcasting
        if (params.projectNumber && apiClient) {
          apiClient.postProjectEvent({
            type: 'issue.closed',
            data: {
              projectNumber: params.projectNumber,
              issueNumber: params.issueNumber,
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
                  message: 'Issue closed successfully',
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
                  error: 'Failed to close issue',
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
