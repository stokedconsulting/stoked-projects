import Ajv, { JSONSchemaType, ValidateFunction } from 'ajv';
import { Tool, CallToolResult } from '@modelcontextprotocol/sdk/types.js';

/**
 * Content item in a tool result
 */
export interface ToolContentItem {
  type: 'text' | 'image' | 'resource';
  text?: string;
  data?: string;
  mimeType?: string;
}

/**
 * Result returned by a tool handler (MCP CallToolResult format)
 * Re-export the SDK type for convenience
 */
export type ToolResult = CallToolResult;

/**
 * Tool handler function signature
 */
export type ToolHandler<T = any> = (params: T) => Promise<ToolResult>;

/**
 * Tool definition with handler and schema
 */
export interface ToolDefinition<T = any> {
  name: string;
  description: string;
  inputSchema: JSONSchemaType<T>;
  handler: ToolHandler<T>;
}

/**
 * Validation error with field-specific messages
 */
export interface ValidationError {
  field: string;
  message: string;
}

/**
 * Error result from tool execution
 */
export interface ToolError {
  error: string;
  validationErrors?: ValidationError[];
}

/**
 * Tool Registry for managing MCP tools
 *
 * Provides:
 * - Tool registration with JSON Schema validation
 * - Parameter validation using ajv
 * - Error handling wrapper for tool execution
 * - Tool listing for MCP protocol
 */
export class ToolRegistry {
  private tools: Map<string, ToolDefinition> = new Map();
  private validators: Map<string, ValidateFunction> = new Map();
  private ajv: Ajv;

  constructor() {
    this.ajv = new Ajv({
      allErrors: true,
      verbose: true,
      strict: false, // Allow additional properties for flexibility
    });
  }

  /**
   * Register a new tool with the registry
   *
   * @param tool - Tool definition with name, description, schema, and handler
   * @throws Error if tool with same name already exists
   */
  registerTool<T = any>(tool: ToolDefinition<T>): void {
    if (this.tools.has(tool.name)) {
      throw new Error(`Tool already registered: ${tool.name}`);
    }

    // Compile JSON schema validator
    const validator = this.ajv.compile(tool.inputSchema);
    this.validators.set(tool.name, validator);

    // Store tool definition
    this.tools.set(tool.name, tool as ToolDefinition);

    console.error(`Tool registered: ${tool.name}`);
  }

  /**
   * Get list of all registered tools (for tools/list response)
   *
   * @returns Array of MCP Tool definitions
   */
  listTools(): Tool[] {
    return Array.from(this.tools.values()).map((tool) => ({
      name: tool.name,
      description: tool.description,
      inputSchema: tool.inputSchema as any,
    }));
  }

  /**
   * Validate tool parameters against JSON schema
   *
   * @param toolName - Name of the tool
   * @param params - Parameters to validate
   * @returns Validation errors if invalid, empty array if valid
   */
  private validateParams(toolName: string, params: unknown): ValidationError[] {
    const validator = this.validators.get(toolName);
    if (!validator) {
      return [{ field: 'tool', message: `Unknown tool: ${toolName}` }];
    }

    const valid = validator(params);
    if (valid) {
      return [];
    }

    // Convert ajv errors to field-specific validation errors
    const errors: ValidationError[] = [];
    if (validator.errors) {
      for (const error of validator.errors) {
        const field = error.instancePath || error.params['missingProperty'] || 'root';
        const message = error.message || 'Validation failed';
        errors.push({
          field: field.replace(/^\//, ''), // Remove leading slash
          message: `${field}: ${message}`,
        });
      }
    }

    return errors;
  }

  /**
   * Execute a tool with parameter validation and error handling
   *
   * @param toolName - Name of the tool to execute
   * @param params - Parameters to pass to the tool
   * @returns Tool result or error response
   */
  async executeTool(toolName: string, params: unknown): Promise<ToolResult> {
    try {
      // Get tool definition
      const tool = this.tools.get(toolName);
      if (!tool) {
        return {
          content: [
            {
              type: 'text',
              text: `Unknown tool: ${toolName}`,
            },
          ],
          isError: true,
        };
      }

      // Validate parameters
      const validationErrors = this.validateParams(toolName, params);
      if (validationErrors.length > 0) {
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                {
                  error: 'Parameter validation failed',
                  validationErrors,
                },
                null,
                2
              ),
            },
          ],
          isError: true,
        };
      }

      // Log tool invocation (sanitize sensitive data)
      const sanitizedParams = this.sanitizeParams(params);
      console.error(`Executing tool: ${toolName}`, JSON.stringify(sanitizedParams, null, 2));

      // Execute tool handler
      const result = await tool.handler(params);

      console.error(`Tool execution complete: ${toolName}`);
      return result;
    } catch (error) {
      // Catch and wrap any handler exceptions
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error occurred';
      console.error(`Tool execution error: ${toolName}`, error);

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                error: `Tool execution failed: ${errorMessage}`,
                toolName,
              },
              null,
              2
            ),
          },
        ],
        isError: true,
      };
    }
  }

  /**
   * Sanitize parameters for logging (remove API keys and sensitive data)
   *
   * @param params - Parameters to sanitize
   * @returns Sanitized copy of parameters
   */
  private sanitizeParams(params: unknown): unknown {
    if (typeof params !== 'object' || params === null) {
      return params;
    }

    const sanitized: any = Array.isArray(params) ? [...params] : { ...params };

    // List of sensitive field names (lowercase for case-insensitive matching)
    const sensitiveFields = [
      'apikey',
      'api_key',
      'token',
      'password',
      'secret',
      'authorization',
      'auth',
    ];

    for (const key in sanitized) {
      if (sensitiveFields.some((field) => key.toLowerCase().includes(field))) {
        sanitized[key] = '***REDACTED***';
      } else if (typeof sanitized[key] === 'object') {
        sanitized[key] = this.sanitizeParams(sanitized[key]);
      }
    }

    return sanitized;
  }

  /**
   * Check if a tool is registered
   *
   * @param toolName - Name of the tool
   * @returns True if tool exists
   */
  hasTool(toolName: string): boolean {
    return this.tools.has(toolName);
  }

  /**
   * Get count of registered tools
   *
   * @returns Number of registered tools
   */
  getToolCount(): number {
    return this.tools.size;
  }

  /**
   * Clear all registered tools (useful for testing)
   */
  clear(): void {
    this.tools.clear();
    this.validators.clear();
  }
}
