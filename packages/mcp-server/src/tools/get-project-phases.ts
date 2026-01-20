import { JSONSchemaType } from 'ajv';
import { ToolDefinition, ToolResult } from './registry.js';
import { APIClient, Phase, NotFoundError } from '../api-client.js';

/**
 * Phase with work item count information
 *
 * Extended phase object that includes aggregated work item statistics.
 */
export interface PhaseWithStats extends Phase {
  /** Total count of work items in this phase */
  workItemCount: number;

  /** Count of completed work items */
  completedCount: number;

  /** Count of in-progress work items */
  inProgressCount: number;

  /** Count of pending work items */
  pendingCount: number;

  /** Count of blocked work items */
  blockedCount: number;
}

/**
 * Input parameters for get_project_phases tool
 */
interface GetProjectPhasesParams {
  /** GitHub Project number */
  projectNumber: number;
}

const getProjectPhasesSchema: JSONSchemaType<GetProjectPhasesParams> = {
  type: 'object',
  properties: {
    projectNumber: {
      type: 'number',
      description: 'GitHub Project number',
    },
  },
  required: ['projectNumber'],
  additionalProperties: false,
};

/**
 * Create get_project_phases tool definition
 *
 * This tool fetches the phase structure and configuration for a GitHub Project.
 * Returns phase names, order, and work item counts to help understand project
 * structure before moving issues between phases.
 *
 * @param apiClient - Configured API client instance
 * @returns Tool definition for get_project_phases
 */
export function createGetProjectPhasesTool(
  apiClient: APIClient
): ToolDefinition<GetProjectPhasesParams> {
  return {
    name: 'get_project_phases',
    description:
      'Get the list of phases (sequential stages) defined for a GitHub Project. Returns phase names, order, and work item counts. Use this to understand project structure before moving issues between phases.',
    inputSchema: getProjectPhasesSchema,
    handler: async (params: GetProjectPhasesParams): Promise<ToolResult> => {
      try {
        const { projectNumber } = params;

        // Make GET request to fetch phases
        const phases = await apiClient.get<PhaseWithStats[]>(
          `/api/projects/${projectNumber}/phases`
        );

        // Sort phases by order (ascending)
        const sortedPhases = phases.sort((a, b) => a.order - b.order);

        // Return phases array as JSON
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(sortedPhases, null, 2),
            },
          ],
        };
      } catch (error) {
        // Handle 404 errors for non-existent projects
        if (error instanceof NotFoundError) {
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify(
                  {
                    error: `Project ${params.projectNumber} not found`,
                    message:
                      'The requested project does not exist or you do not have access to it.',
                  },
                  null,
                  2
                ),
              },
            ],
            isError: true,
          };
        }

        // Rethrow other errors to be handled by registry
        throw error;
      }
    },
  };
}
