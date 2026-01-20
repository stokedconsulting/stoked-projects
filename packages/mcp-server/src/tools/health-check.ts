import { JSONSchemaType } from 'ajv';
import { ToolDefinition, ToolResult } from './registry.js';
import { APIClient } from '../api-client.js';

/**
 * Health check result interface
 *
 * Provides detailed information about API connectivity and authentication status.
 */
export interface HealthCheckResult {
  /** Whether the API is reachable and responding */
  apiAvailable: boolean;

  /** Whether authentication is valid (API key is accepted) */
  authenticated: boolean;

  /** Response time in milliseconds for the health check request */
  responseTimeMs: number;

  /** API version string if available */
  apiVersion?: string;

  /** Error message if the health check failed */
  error?: string;
}

/**
 * Empty input schema for health_check tool (no parameters required)
 */
type HealthCheckParams = Record<string, never>;

const healthCheckSchema: JSONSchemaType<HealthCheckParams> = {
  type: 'object',
  properties: {},
  required: [],
  additionalProperties: false,
};

/**
 * Create health check tool definition
 *
 * This tool validates connectivity and authentication with the state-tracking-api
 * by making test requests to the health and projects endpoints.
 *
 * @param apiClient - Configured API client instance
 * @returns Tool definition for health check
 */
export function createHealthCheckTool(apiClient: APIClient): ToolDefinition<HealthCheckParams> {
  return {
    name: 'health_check',
    description:
      'Check connectivity and authentication with the state-tracking-api. Returns API health status and authentication verification.',
    inputSchema: healthCheckSchema,
    handler: async (): Promise<ToolResult> => {
      const result: HealthCheckResult = {
        apiAvailable: false,
        authenticated: false,
        responseTimeMs: 0,
      };

      try {
        // Measure response time
        const startTime = Date.now();

        // Test 1: Check API availability with /health endpoint
        try {
          const healthResponse = await apiClient.get<{ status?: string; version?: string }>(
            '/health'
          );
          result.apiAvailable = true;

          // Extract API version if available
          if (healthResponse.version) {
            result.apiVersion = healthResponse.version;
          }
        } catch (error) {
          // API is not available - could be network error, timeout, or server error
          const errorMessage =
            error instanceof Error ? error.message : 'Unknown error';
          result.error = `API health check failed: ${errorMessage}`;
          result.responseTimeMs = Date.now() - startTime;

          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify(result, null, 2),
              },
            ],
          };
        }

        // Test 2: Verify authentication with /api/projects endpoint
        try {
          await apiClient.get('/api/projects');
          result.authenticated = true;
        } catch (error) {
          // Authentication failed - API is available but credentials are invalid
          const errorMessage =
            error instanceof Error ? error.message : 'Unknown error';

          // Check if it's an authentication error (401/403)
          if (errorMessage.includes('401') || errorMessage.includes('403')) {
            result.authenticated = false;
            result.error = 'Authentication failed: Invalid or expired API key';
          } else {
            // Other error - still mark as not authenticated but provide details
            result.authenticated = false;
            result.error = `Authentication check failed: ${errorMessage}`;
          }
        }

        // Calculate total response time
        result.responseTimeMs = Date.now() - startTime;

        // Return success result
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      } catch (error) {
        // Unexpected error in health check logic
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        result.error = `Health check failed unexpectedly: ${errorMessage}`;

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      }
    },
  };
}
