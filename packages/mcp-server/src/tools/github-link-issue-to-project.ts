import { JSONSchemaType } from 'ajv';
import { ToolDefinition, ToolResult } from './registry.js';
import { GitHubClient } from '../github-client.js';
import { APIClient } from '../api-client.js';

export interface LinkIssueToProjectParams {
  projectId: string;
  issueId: string;
  projectNumber?: number;
  issueNumber?: number;
}

const linkIssueToProjectSchema: JSONSchemaType<LinkIssueToProjectParams> = {
  type: 'object',
  properties: {
    projectId: {
      type: 'string',
      description: 'Project node ID (ProjectsV2)',
    },
    issueId: {
      type: 'string',
      description: 'Issue node ID',
    },
    projectNumber: {
      type: 'number',
      nullable: true,
      description: 'GitHub Project number (for real-time extension notifications)',
    },
    issueNumber: {
      type: 'number',
      nullable: true,
      description: 'GitHub issue number (for real-time extension notifications)',
    },
  },
  required: ['projectId', 'issueId'],
  additionalProperties: false,
};

export function createGitHubLinkIssueToProjectTool(
  client: GitHubClient,
  apiClient?: APIClient,
): ToolDefinition<LinkIssueToProjectParams> {
  return {
    name: 'github_link_issue_to_project',
    description: 'Add an issue to a GitHub project (ProjectsV2)',
    inputSchema: linkIssueToProjectSchema,
    handler: async (params: LinkIssueToProjectParams): Promise<ToolResult> => {
      try {
        const result = await client.linkIssueToProject(params);

        // Post event to API for real-time broadcasting
        if (params.projectNumber && apiClient) {
          apiClient.postProjectEvent({
            type: 'issue.created',
            data: {
              projectNumber: params.projectNumber,
              issueNumber: params.issueNumber || 0,
              title: '',
              owner: '',
              repo: '',
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
                  itemId: result.itemId,
                  message: 'Issue added to project successfully',
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
                  error: 'Failed to link issue to project',
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
