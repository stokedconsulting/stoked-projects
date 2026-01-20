import { JSONSchemaType } from 'ajv';
import { ToolDefinition, ToolResult } from './registry.js';
import { APIClient, Issue, WorkItem, NotFoundError } from '../api-client.js';

/**
 * Extended Issue interface with work items
 *
 * Provides complete issue details including description, status, phase,
 * work items, labels, and activity information.
 */
export interface IssueDetails extends Issue {
  /** Array of work items associated with this issue */
  workItems?: WorkItem[];

  /** Phase information if issue is part of a phase */
  phase?: string;

  /** Issue number from GitHub */
  number?: number;
}

/**
 * Input parameters for get_issue_details tool
 */
export interface GetIssueDetailsParams {
  /** GitHub Project number */
  projectNumber: number;

  /** GitHub issue number */
  issueNumber: number;
}

/**
 * JSON Schema for get_issue_details parameters
 */
const getIssueDetailsSchema: JSONSchemaType<GetIssueDetailsParams> = {
  type: 'object',
  properties: {
    projectNumber: {
      type: 'number',
      description: 'GitHub Project number',
    },
    issueNumber: {
      type: 'number',
      description: 'GitHub issue number',
    },
  },
  required: ['projectNumber', 'issueNumber'],
  additionalProperties: false,
};

/**
 * Create get_issue_details tool definition
 *
 * This tool fetches complete details for a specific GitHub issue including
 * description, status, phase, work items, labels, and recent activity.
 * Use this after list_issues to get full information for a specific issue.
 *
 * @param apiClient - Configured API client instance
 * @returns Tool definition for get_issue_details
 */
export function createGetIssueDetailsTool(apiClient: APIClient): ToolDefinition<GetIssueDetailsParams> {
  return {
    name: 'get_issue_details',
    description:
      'Get complete details for a specific GitHub issue including description, status, phase, work items, labels, and recent activity. Use this after list_issues to get full information for a specific issue.',
    inputSchema: getIssueDetailsSchema,
    handler: async (params: GetIssueDetailsParams): Promise<ToolResult> => {
      const { projectNumber, issueNumber } = params;

      try {
        // Make GET request to fetch issue details
        const issueDetails = await apiClient.get<IssueDetails>(
          `/api/projects/${projectNumber}/issues/${issueNumber}`
        );

        // Return successful result with issue details
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(issueDetails, null, 2),
            },
          ],
        };
      } catch (error) {
        // Handle NotFoundError with specific messages
        if (error instanceof NotFoundError) {
          // Determine if issue doesn't exist or if it exists but not in this project
          const errorMessage = error.message;

          // Check if error message indicates issue-project mismatch
          const isProjectMismatch = errorMessage.includes('not found in project') ||
                                     errorMessage.includes('not part of project');

          const notFoundMessage = isProjectMismatch
            ? `Issue #${issueNumber} exists but is not part of Project #${projectNumber}`
            : `Issue #${issueNumber} not found in Project #${projectNumber}`;

          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify(
                  {
                    error: notFoundMessage,
                    projectNumber,
                    issueNumber,
                  },
                  null,
                  2
                ),
              },
            ],
            isError: true,
          };
        }

        // Re-throw other errors to be handled by registry
        throw error;
      }
    },
  };
}
