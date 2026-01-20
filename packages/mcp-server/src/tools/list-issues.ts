import { JSONSchemaType } from 'ajv';
import { ToolDefinition, ToolResult } from './registry.js';
import { APIClient, Issue } from '../api-client.js';

/**
 * Parameters for list_issues tool
 */
export interface ListIssuesParams {
  /** GitHub Project number */
  projectNumber: number;

  /** Filter by issue status (optional) */
  status?: 'backlog' | 'todo' | 'in_progress' | 'done';

  /** Filter by phase name (optional) */
  phase?: string;

  /** Filter by GitHub username (optional) */
  assignee?: string;
}

/**
 * JSON Schema for list_issues parameters
 */
const listIssuesSchema: JSONSchemaType<ListIssuesParams> = {
  type: 'object',
  properties: {
    projectNumber: {
      type: 'number',
      description: 'GitHub Project number',
    },
    status: {
      type: 'string',
      enum: ['backlog', 'todo', 'in_progress', 'done'],
      description: 'Filter by issue status (optional)',
      nullable: true,
    },
    phase: {
      type: 'string',
      description: 'Filter by phase name (optional)',
      nullable: true,
    },
    assignee: {
      type: 'string',
      description: 'Filter by GitHub username (optional)',
      nullable: true,
    },
  },
  required: ['projectNumber'],
  additionalProperties: false,
};

/**
 * Build query parameters from filter options
 *
 * @param params - List issues parameters with optional filters
 * @returns Query string for API request
 */
function buildQueryString(params: ListIssuesParams): string {
  const queryParams: string[] = [];

  if (params.status) {
    queryParams.push(`status=${encodeURIComponent(params.status)}`);
  }

  if (params.phase) {
    queryParams.push(`phase=${encodeURIComponent(params.phase)}`);
  }

  if (params.assignee) {
    queryParams.push(`assignee=${encodeURIComponent(params.assignee)}`);
  }

  return queryParams.length > 0 ? `?${queryParams.join('&')}` : '';
}

/**
 * Create list issues tool definition
 *
 * This tool lists all issues in a GitHub Project with optional filtering by status,
 * phase, and assignee. Returns issue summaries including title, status, phase,
 * assignee, and labels.
 *
 * @param apiClient - Configured API client instance
 * @returns Tool definition for list issues
 */
export function createListIssuesTool(apiClient: APIClient): ToolDefinition<ListIssuesParams> {
  return {
    name: 'list_issues',
    description:
      'List all issues in a GitHub Project with optional filtering. Returns issue summaries including title, status, phase, assignee, and labels. Use filters to narrow results to specific phases or statuses.',
    inputSchema: listIssuesSchema,
    handler: async (params: ListIssuesParams): Promise<ToolResult> => {
      try {
        const startTime = Date.now();

        // Build API endpoint path with query parameters
        const queryString = buildQueryString(params);
        const apiPath = `/api/projects/${params.projectNumber}/issues${queryString}`;

        // Make API request
        const issues = await apiClient.get<Issue[]>(apiPath);

        // Calculate response time
        const responseTimeMs = Date.now() - startTime;

        // Format response with issue summaries
        const response = {
          projectNumber: params.projectNumber,
          issueCount: issues.length,
          responseTimeMs,
          filters: {
            status: params.status || null,
            phase: params.phase || null,
            assignee: params.assignee || null,
          },
          issues: issues.map((issue) => ({
            id: issue.id,
            title: issue.title,
            status: issue.status,
            labels: issue.labels,
            projectId: issue.projectId,
            createdAt: issue.createdAt,
            updatedAt: issue.updatedAt,
          })),
        };

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(response, null, 2),
            },
          ],
        };
      } catch (error) {
        // Handle errors gracefully
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                {
                  error: `Failed to list issues: ${errorMessage}`,
                  projectNumber: params.projectNumber,
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
