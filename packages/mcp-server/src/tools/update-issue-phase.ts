import { JSONSchemaType } from 'ajv';
import { ToolDefinition, ToolResult } from './registry.js';
import { APIClient, Issue, NotFoundError } from '../api-client.js';

/**
 * Input parameters for update_issue_phase tool
 */
export interface UpdateIssuePhaseParams {
  /** GitHub Project number */
  projectNumber: number;

  /** GitHub issue number */
  issueNumber: number;

  /** Target phase name (must match existing phase) */
  phaseName: string;
}

/**
 * Phase information from API
 */
interface Phase {
  id: string;
  projectId: string;
  name: string;
  description?: string;
  order: number;
  status: 'pending' | 'in_progress' | 'completed';
  createdAt: string;
  updatedAt: string;
}

/**
 * Updated issue response from API
 */
export interface UpdatedIssue extends Issue {
  phase?: string;
  number?: number;
}

/**
 * Error response with phase suggestions
 */
interface PhaseValidationError {
  error: string;
  message: string;
  availablePhases: string[];
  suggestions?: string[];
}

const updateIssuePhaseSchema: JSONSchemaType<UpdateIssuePhaseParams> = {
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
    phaseName: {
      type: 'string',
      description: 'Target phase name (must match existing phase)',
    },
  },
  required: ['projectNumber', 'issueNumber', 'phaseName'],
  additionalProperties: false,
};

/**
 * Calculate Levenshtein distance between two strings for fuzzy matching
 *
 * @param str1 - First string
 * @param str2 - Second string
 * @returns Edit distance (number of single-character edits needed)
 */
function levenshteinDistance(str1: string, str2: string): number {
  const matrix: number[][] = [];

  // Initialize first column of matrix
  for (let i = 0; i <= str2.length; i++) {
    matrix[i] = [i];
  }

  // Initialize first row of matrix
  for (let j = 0; j <= str1.length; j++) {
    matrix[0][j] = j;
  }

  // Fill in the rest of the matrix
  for (let i = 1; i <= str2.length; i++) {
    for (let j = 1; j <= str1.length; j++) {
      if (str2.charAt(i - 1) === str1.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1, // substitution
          matrix[i][j - 1] + 1, // insertion
          matrix[i - 1][j] + 1 // deletion
        );
      }
    }
  }

  return matrix[str2.length][str1.length];
}

/**
 * Find fuzzy matches for a phase name
 *
 * Suggests phase names that are similar to the input, using:
 * - Case-insensitive exact matches
 * - Levenshtein distance (edit distance) for typos
 * - Partial substring matches
 *
 * @param input - Input phase name (potentially misspelled)
 * @param availablePhases - List of valid phase names
 * @param maxDistance - Maximum edit distance for suggestions (default: 3)
 * @returns Array of suggested phase names, ordered by relevance
 */
function findFuzzyMatches(
  input: string,
  availablePhases: string[],
  maxDistance: number = 3
): string[] {
  const inputLower = input.toLowerCase();
  const suggestions: Array<{ name: string; distance: number }> = [];

  for (const phaseName of availablePhases) {
    const phaseNameLower = phaseName.toLowerCase();

    // Case-insensitive exact match (distance = 0)
    if (phaseNameLower === inputLower) {
      continue; // Skip, this should be handled as valid
    }

    // Calculate edit distance
    const distance = levenshteinDistance(inputLower, phaseNameLower);

    // Include if within threshold
    if (distance <= maxDistance) {
      suggestions.push({ name: phaseName, distance });
    } else if (
      phaseNameLower.includes(inputLower) ||
      inputLower.includes(phaseNameLower)
    ) {
      // Also include partial matches with higher distance
      suggestions.push({ name: phaseName, distance: distance + 10 });
    }
  }

  // Sort by distance (closest first) and return phase names
  return suggestions
    .sort((a, b) => a.distance - b.distance)
    .slice(0, 3) // Limit to top 3 suggestions
    .map((s) => s.name);
}

/**
 * Create update_issue_phase tool definition
 *
 * This tool moves a GitHub issue to a different phase in the project.
 * Phases represent sequential stages like 'Foundation', 'Core Features', etc.
 * Use get_project_phases to see available phases first.
 *
 * @param apiClient - Configured API client instance
 * @returns Tool definition for update_issue_phase
 */
export function createUpdateIssuePhaseTool(
  apiClient: APIClient
): ToolDefinition<UpdateIssuePhaseParams> {
  return {
    name: 'update_issue_phase',
    description:
      'Move a GitHub issue to a different phase in the project. Phases represent sequential stages like \'Foundation\', \'Core Features\', etc. Use get_project_phases to see available phases first.',
    inputSchema: updateIssuePhaseSchema,
    handler: async (params: UpdateIssuePhaseParams): Promise<ToolResult> => {
      try {
        const { projectNumber, issueNumber, phaseName } = params;

        // Step 1: Validate phase exists via GET phases endpoint
        const phases = await apiClient.get<Phase[]>(
          `/api/projects/${projectNumber}/phases`
        );

        // Extract phase names for validation
        const availablePhaseNames = phases.map((p) => p.name);

        // Check for exact match (case-sensitive)
        const exactMatch = availablePhaseNames.find((name) => name === phaseName);

        if (!exactMatch) {
          // Check for case-insensitive match
          const caseInsensitiveMatch = availablePhaseNames.find(
            (name) => name.toLowerCase() === phaseName.toLowerCase()
          );

          if (caseInsensitiveMatch) {
            // Found case-insensitive match - provide helpful error
            const error: PhaseValidationError = {
              error: `Phase name is case-sensitive`,
              message: `Phase "${phaseName}" does not exist. Did you mean "${caseInsensitiveMatch}"?`,
              availablePhases: availablePhaseNames,
              suggestions: [caseInsensitiveMatch],
            };

            return {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify(error, null, 2),
                },
              ],
              isError: true,
            };
          }

          // No case-insensitive match - find fuzzy matches
          const suggestions = findFuzzyMatches(phaseName, availablePhaseNames);

          const error: PhaseValidationError = {
            error: `Phase "${phaseName}" does not exist`,
            message:
              suggestions.length > 0
                ? `Phase "${phaseName}" not found. Did you mean: ${suggestions.map((s) => `"${s}"`).join(', ')}?`
                : `Phase "${phaseName}" not found. Available phases: ${availablePhaseNames.map((s) => `"${s}"`).join(', ')}`,
            availablePhases: availablePhaseNames,
            suggestions: suggestions.length > 0 ? suggestions : undefined,
          };

          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify(error, null, 2),
              },
            ],
            isError: true,
          };
        }

        // Step 2: Phase is valid - make PUT request to update issue
        const updatedIssue = await apiClient.put<UpdatedIssue>(
          `/api/projects/${projectNumber}/issues/${issueNumber}/phase`,
          { phaseName }
        );

        // Step 3: Return updated Issue object
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(updatedIssue, null, 2),
            },
          ],
        };

        // Note: Notification event (AC-3.2.a) is stubbed for Phase 4
      } catch (error) {
        // Handle NotFoundError for non-existent issues or projects
        if (error instanceof NotFoundError) {
          const errorMessage = error.message;

          // Determine if it's a project or issue not found
          const isProjectNotFound = errorMessage.toLowerCase().includes('project');
          const isIssueNotFound = errorMessage.toLowerCase().includes('issue');

          const notFoundResponse = {
            error: isProjectNotFound
              ? `Project #${params.projectNumber} not found`
              : isIssueNotFound
                ? `Issue #${params.issueNumber} not found`
                : `Resource not found`,
            message: errorMessage,
            projectNumber: params.projectNumber,
            issueNumber: params.issueNumber,
          };

          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify(notFoundResponse, null, 2),
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
