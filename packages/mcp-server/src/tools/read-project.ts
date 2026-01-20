import { JSONSchemaType } from 'ajv';
import { ToolDefinition, ToolResult } from './registry.js';
import { APIClient, NotFoundError, AuthenticationError } from '../api-client.js';

/**
 * Project field definition interface
 */
export interface ProjectField {
  id: string;
  name: string;
  dataType: string;
  options?: string[];
}

/**
 * Phase interface
 */
export interface ProjectPhase {
  id: string;
  name: string;
  description?: string;
  order: number;
  status: 'pending' | 'in_progress' | 'completed';
}

/**
 * Complete project details interface
 */
export interface ProjectDetails {
  /** GitHub Project number (e.g., 70 for Project #70) */
  projectNumber: number;

  /** Project ID from GitHub */
  id: string;

  /** Project title */
  title: string;

  /** Project description */
  description?: string;

  /** Project URL */
  url: string;

  /** Project status */
  status: 'open' | 'closed';

  /** Whether project is public */
  public: boolean;

  /** Owner login (user or organization) */
  owner: string;

  /** Field definitions for this project */
  fields: ProjectField[];

  /** Phases in this project */
  phases: ProjectPhase[];

  /** Summary statistics */
  stats: {
    /** Total number of items in project */
    totalItems: number;

    /** Number of open items */
    openItems: number;

    /** Number of closed items */
    closedItems: number;

    /** Number of phases */
    totalPhases: number;
  };

  /** Timestamps */
  createdAt: string;
  updatedAt: string;
}

/**
 * Input parameters for read_project tool
 */
export interface ReadProjectParams {
  /** GitHub Project number (e.g., 70 for Project #70) */
  projectNumber: number;
}

/**
 * JSON Schema for read_project parameters
 */
const readProjectSchema: JSONSchemaType<ReadProjectParams> = {
  type: 'object',
  properties: {
    projectNumber: {
      type: 'number',
      description: 'GitHub Project number (e.g., 70 for Project #70)',
    },
  },
  required: ['projectNumber'],
  additionalProperties: false,
};

/**
 * Create read_project tool definition
 *
 * This tool fetches complete project details from the state-tracking-api,
 * including project metadata, field definitions, phases, and summary statistics.
 *
 * @param apiClient - Configured API client instance
 * @returns Tool definition for read_project
 */
export function createReadProjectTool(
  apiClient: APIClient
): ToolDefinition<ReadProjectParams> {
  return {
    name: 'read_project',
    description:
      'Fetch complete project details from GitHub Projects by project number. Returns project metadata, fields, phases, and high-level statistics. Use this to understand project structure before reading issues.',
    inputSchema: readProjectSchema,
    handler: async (params: ReadProjectParams): Promise<ToolResult> => {
      try {
        // Make GET request to /api/projects/{projectNumber}
        const project = await apiClient.get<ProjectDetails>(
          `/api/projects/${params.projectNumber}`
        );

        // Return successful result with project details
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(project, null, 2),
            },
          ],
        };
      } catch (error) {
        // Handle NotFoundError (404)
        if (error instanceof NotFoundError) {
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify(
                  {
                    error: `Project #${params.projectNumber} not found`,
                  },
                  null,
                  2
                ),
              },
            ],
            isError: true,
          };
        }

        // Handle AuthenticationError (401/403)
        if (error instanceof AuthenticationError) {
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify(
                  {
                    error: 'Authentication failed. Check STATE_TRACKING_API_KEY',
                  },
                  null,
                  2
                ),
              },
            ],
            isError: true,
          };
        }

        // Handle network errors
        if (error instanceof Error) {
          if (
            error.message.includes('ECONNREFUSED') ||
            error.message.includes('ENOTFOUND') ||
            error.message.includes('network') ||
            error.message.includes('timeout')
          ) {
            return {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify(
                    {
                      error: 'Failed to connect to state-tracking-api',
                      details: error.message,
                    },
                    null,
                    2
                  ),
                },
              ],
              isError: true,
            };
          }

          // Handle JSON parse errors
          if (
            error.message.includes('JSON') ||
            error.message.includes('parse') ||
            error.message.includes('Unexpected token')
          ) {
            return {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify(
                    {
                      error: 'Failed to parse API response',
                      details: error.message,
                    },
                    null,
                    2
                  ),
                },
              ],
              isError: true,
            };
          }

          // Generic error fallback
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify(
                  {
                    error: `Failed to fetch project: ${error.message}`,
                  },
                  null,
                  2
                ),
              },
            ],
            isError: true,
          };
        }

        // Unknown error type
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                {
                  error: 'Unknown error occurred while fetching project',
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
