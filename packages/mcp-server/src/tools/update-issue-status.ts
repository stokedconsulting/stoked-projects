import { JSONSchemaType } from 'ajv';
import { ToolDefinition, ToolResult } from './registry.js';
import { APIClient, NotFoundError } from '../api-client.js';

/**
 * Valid status values for GitHub Project issues
 */
export type IssueStatus = 'backlog' | 'todo' | 'in_progress' | 'done';

/**
 * Extended Issue interface for update response
 */
export interface UpdatedIssue {
  id: string;
  projectId: string;
  title: string;
  description?: string;
  status: IssueStatus;
  labels: string[];
  createdAt: string;
  updatedAt: string;
  number?: number;
}

/**
 * Input parameters for update_issue_status tool
 */
export interface UpdateIssueStatusParams {
  /** GitHub Project number */
  projectNumber: number;

  /** GitHub issue number */
  issueNumber: number;

  /** New status for the issue */
  status: IssueStatus;
}

/**
 * Conflict error response when concurrent update occurs
 */
export interface ConflictError {
  error: string;
  conflictType: 'concurrent_update';
  suggestion: string;
  projectNumber: number;
  issueNumber: number;
  attemptedStatus: IssueStatus;
}

/**
 * JSON Schema for update_issue_status parameters
 */
const updateIssueStatusSchema: JSONSchemaType<UpdateIssueStatusParams> = {
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
    status: {
      type: 'string',
      enum: ['backlog', 'todo', 'in_progress', 'done'],
      description: 'New status for the issue',
    },
  },
  required: ['projectNumber', 'issueNumber', 'status'],
  additionalProperties: false,
};

/**
 * Create update_issue_status tool definition
 *
 * This tool updates the status of a GitHub issue in the project board.
 * Valid statuses are: backlog, todo, in_progress, done.
 * This operation syncs to GitHub Projects and triggers extension notifications.
 *
 * @param apiClient - Configured API client instance
 * @returns Tool definition for update_issue_status
 */
export function createUpdateIssueStatusTool(apiClient: APIClient): ToolDefinition<UpdateIssueStatusParams> {
  return {
    name: 'update_issue_status',
    description:
      'Update the status of a GitHub issue in the project board. Valid statuses: backlog, todo, in_progress, done. This operation syncs to GitHub Projects and triggers extension notifications.',
    inputSchema: updateIssueStatusSchema,
    handler: async (params: UpdateIssueStatusParams): Promise<ToolResult> => {
      const { projectNumber, issueNumber, status } = params;

      try {
        // First, validate issue exists via GET request
        try {
          await apiClient.get<UpdatedIssue>(
            `/api/projects/${projectNumber}/issues/${issueNumber}`
          );
        } catch (error) {
          // If issue doesn't exist, return 404 error
          if (error instanceof NotFoundError) {
            return {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify(
                    {
                      error: `Issue #${issueNumber} not found in Project #${projectNumber}`,
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
          // Re-throw other errors
          throw error;
        }

        // Make PUT request to update issue status
        const updatedIssue = await apiClient.put<UpdatedIssue>(
          `/api/projects/${projectNumber}/issues/${issueNumber}/status`,
          { status }
        );

        // Post event to API for real-time broadcasting
        apiClient.postProjectEvent({
          type: 'issue.updated',
          data: {
            projectNumber,
            issueNumber,
            status,
            title: updatedIssue.title,
            updatedFields: ['status'],
          },
        });

        // Return successful result with updated issue details
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(updatedIssue, null, 2),
            },
          ],
        };
      } catch (error) {
        // Handle conflict error (409) for concurrent updates
        if (error instanceof Error && error.message.includes('409')) {
          const conflictResponse: ConflictError = {
            error: 'Concurrent update conflict detected',
            conflictType: 'concurrent_update',
            suggestion: 'Retry the update operation after fetching the latest issue state',
            projectNumber,
            issueNumber,
            attemptedStatus: status,
          };

          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify(conflictResponse, null, 2),
              },
            ],
            isError: true,
          };
        }

        // Handle NotFoundError (should be caught above, but defensive)
        if (error instanceof NotFoundError) {
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify(
                  {
                    error: `Issue #${issueNumber} not found in Project #${projectNumber}`,
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
