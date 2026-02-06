import { JSONSchemaType } from 'ajv';
import { ToolDefinition, ToolResult } from './registry.js';
import { APIClient, Issue, NotFoundError } from '../api-client.js';

/**
 * Issue creation response from API
 *
 * Includes the created issue with GitHub issue number and URL
 */
export interface CreatedIssue extends Issue {
  /** GitHub issue number */
  number: number;

  /** GitHub issue URL */
  url?: string;

  /** Phase name if issue is assigned to a phase */
  phase?: string;

  /** Assignee username */
  assignee?: string;
}

/**
 * Input parameters for create_issue tool
 */
export interface CreateIssueParams {
  /** GitHub Project number to add issue to */
  projectNumber: number;

  /** Issue title (required) */
  title: string;

  /** Issue description in markdown (optional) */
  body?: string;

  /** Initial status (default: backlog) */
  status?: 'backlog' | 'todo' | 'in_progress' | 'done';

  /** Initial phase name (optional) */
  phase?: string;

  /** GitHub username to assign (optional) */
  assignee?: string;

  /** Array of label names (optional) */
  labels?: string[];
}

/**
 * JSON Schema for create_issue parameters
 */
const createIssueSchema: JSONSchemaType<CreateIssueParams> = {
  type: 'object',
  properties: {
    projectNumber: {
      type: 'number',
      description: 'GitHub Project number to add issue to',
    },
    title: {
      type: 'string',
      description: 'Issue title (required)',
      minLength: 1,
    },
    body: {
      type: 'string',
      description: 'Issue description in markdown (optional)',
      nullable: true,
    },
    status: {
      type: 'string',
      enum: ['backlog', 'todo', 'in_progress', 'done'],
      description: 'Initial status (default: backlog)',
      nullable: true,
    },
    phase: {
      type: 'string',
      description: 'Initial phase name (optional)',
      nullable: true,
    },
    assignee: {
      type: 'string',
      description: 'GitHub username to assign (optional)',
      nullable: true,
    },
    labels: {
      type: 'array',
      items: {
        type: 'string',
      },
      description: 'Array of label names (optional)',
      nullable: true,
    },
  },
  required: ['projectNumber', 'title'],
  additionalProperties: false,
};

/**
 * Create create_issue tool definition
 *
 * This tool creates a new GitHub issue and adds it to the project board.
 * Optionally sets initial status, phase, assignee, and labels.
 * Returns the created issue with its GitHub issue number.
 *
 * @param apiClient - Configured API client instance
 * @returns Tool definition for create_issue
 */
export function createCreateIssueTool(apiClient: APIClient): ToolDefinition<CreateIssueParams> {
  return {
    name: 'create_issue',
    description:
      'Create a new GitHub issue and add it to the project board. Optionally set initial status, phase, assignee, and labels. Returns the created issue with its GitHub issue number.',
    inputSchema: createIssueSchema,
    handler: async (params: CreateIssueParams): Promise<ToolResult> => {
      const { projectNumber, title, body, status, phase, assignee, labels } = params;

      // Validate title is not empty
      if (!title || title.trim().length === 0) {
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                {
                  error: 'Title is required and cannot be empty',
                  projectNumber,
                },
                null,
                2
              ),
            },
          ],
          isError: true,
        };
      }

      try {
        // Build request payload
        const payload: any = {
          title: title.trim(),
          status: status || 'backlog',
        };

        if (body) {
          payload.body = body;
        }

        if (phase) {
          payload.phase = phase;
        }

        if (assignee) {
          payload.assignee = assignee;
        }

        if (labels && labels.length > 0) {
          payload.labels = labels;
        }

        // Make POST request to create issue
        const createdIssue = await apiClient.post<CreatedIssue>(
          `/api/projects/${projectNumber}/issues`,
          payload
        );

        // Post event to API for real-time broadcasting
        apiClient.postProjectEvent({
          type: 'issue.created',
          data: {
            projectNumber,
            issueNumber: createdIssue.number,
            title: createdIssue.title,
            url: createdIssue.url,
            state: 'open',
          },
        });

        // Return successful result with created issue
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(createdIssue, null, 2),
            },
          ],
        };
      } catch (error) {
        // Handle NotFoundError (project or phase not found)
        if (error instanceof NotFoundError) {
          const errorMessage = error.message;

          // Check if error is about project not existing
          const isProjectNotFound =
            errorMessage.includes('project not found') ||
            errorMessage.includes('Project not found') ||
            errorMessage.includes(`Project #${projectNumber} not found`);

          // Check if error is about phase not existing
          const isPhaseNotFound =
            errorMessage.includes('phase not found') ||
            errorMessage.includes('Phase not found') ||
            (phase && errorMessage.includes(phase));

          let notFoundMessage: string;
          if (isProjectNotFound) {
            notFoundMessage = `Project #${projectNumber} not found`;
          } else if (isPhaseNotFound) {
            notFoundMessage = `Phase "${phase}" not found in Project #${projectNumber}`;
          } else {
            notFoundMessage = errorMessage;
          }

          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify(
                  {
                    error: notFoundMessage,
                    projectNumber,
                    ...(phase && { phase }),
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
