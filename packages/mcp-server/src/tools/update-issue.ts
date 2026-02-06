import { JSONSchemaType } from 'ajv';
import { ToolDefinition, ToolResult } from './registry.js';
import { APIClient, Issue, NotFoundError } from '../api-client.js';

/**
 * Input parameters for update_issue tool
 */
export interface UpdateIssueParams {
  /** GitHub Project number */
  projectNumber: number;

  /** GitHub issue number */
  issueNumber: number;

  /** New title (optional) */
  title?: string;

  /** New description in markdown (optional) */
  body?: string;

  /** GitHub username to assign (optional, use null to unassign) */
  assignee?: string | null;

  /** Complete array of label names (replaces existing labels) */
  labels?: string[];
}

/**
 * Request body for PATCH /api/projects/{projectNumber}/issues/{issueNumber}
 */
interface UpdateIssueRequestBody {
  title?: string;
  body?: string;
  assignee?: string | null;
  labels?: string[];
}

/**
 * JSON Schema for update_issue parameters
 */
const updateIssueSchema: JSONSchemaType<UpdateIssueParams> = {
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
    title: {
      type: 'string',
      description: 'New title (optional)',
      nullable: true,
    },
    body: {
      type: 'string',
      description: 'New description in markdown (optional)',
      nullable: true,
    },
    assignee: {
      type: 'string',
      description: 'GitHub username to assign (optional, use null to unassign)',
      nullable: true,
    },
    labels: {
      type: 'array',
      items: { type: 'string' },
      description: 'Complete array of label names (replaces existing labels)',
      nullable: true,
    },
  },
  required: ['projectNumber', 'issueNumber'],
  additionalProperties: false,
};

/**
 * Create update_issue tool definition
 *
 * This tool updates issue details including title, description, assignee, or labels.
 * Only provided fields will be updated (partial update supported).
 * Use this for general issue modifications beyond status/phase changes.
 *
 * @param apiClient - Configured API client instance
 * @returns Tool definition for update_issue
 */
export function createUpdateIssueTool(apiClient: APIClient): ToolDefinition<UpdateIssueParams> {
  return {
    name: 'update_issue',
    description:
      'Update issue details including title, description, assignee, or labels. Only provided fields will be updated (partial update supported). Use this for general issue modifications beyond status/phase changes.',
    inputSchema: updateIssueSchema,
    handler: async (params: UpdateIssueParams): Promise<ToolResult> => {
      const { projectNumber, issueNumber, title, body, assignee, labels } = params;

      // Validate at least one update field is provided
      const hasUpdates = title !== undefined || body !== undefined || assignee !== undefined || labels !== undefined;

      if (!hasUpdates) {
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                {
                  error: 'At least one field required',
                  message: 'At least one of title, body, assignee, or labels must be provided for update',
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

      // Build request body with only provided fields
      const requestBody: UpdateIssueRequestBody = {};
      if (title !== undefined) requestBody.title = title;
      if (body !== undefined) requestBody.body = body;
      if (assignee !== undefined) requestBody.assignee = assignee;
      if (labels !== undefined) requestBody.labels = labels;

      try {
        // Make PATCH request to update issue
        const updatedIssue = await apiClient.patch<Issue>(
          `/api/projects/${projectNumber}/issues/${issueNumber}`,
          requestBody
        );

        // Post event to API for real-time broadcasting
        apiClient.postProjectEvent({
          type: 'issue.updated',
          data: {
            projectNumber,
            issueNumber,
            title: updatedIssue.title,
            updatedFields: Object.keys(requestBody),
          },
        });

        // Return successful result with updated issue
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(updatedIssue, null, 2),
            },
          ],
        };
      } catch (error) {
        // Handle NotFoundError with specific messages
        if (error instanceof NotFoundError) {
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
