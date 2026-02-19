/**
 * Schema Validation Module
 *
 * Provides schema validation using ajv for JSON Schema Draft 2020-12 validation.
 * This module validates tool inputs and outputs against their defined schemas.
 */

import Ajv, { ValidateFunction, JSONSchemaType } from 'ajv';
import { toolSchemas, ToolName } from './index.js';

/**
 * Schema validation result
 */
export interface ValidationResult {
  valid: boolean;
  errors?: Array<{
    path: string;
    message: string;
    keyword: string;
  }>;
}

/**
 * Schema validator class
 *
 * Manages validation of tool inputs and outputs against JSON schemas.
 */
export class SchemaValidator {
  private ajv: Ajv;
  private validators: Map<string, ValidateFunction> = new Map();

  constructor() {
    this.ajv = new Ajv({
      allErrors: true,
      strict: false,
      keywords: ['constraints', 'errorSchema'],
    });

    // Pre-compile all tool schemas
    this.initializeValidators();
  }

  /**
   * Initialize validators for all tool schemas
   */
  private initializeValidators(): void {
    for (const [toolName, schema] of Object.entries(toolSchemas)) {
      try {
        // Extract the input schema
        const inputSchema = (schema as any).input;
        if (inputSchema) {
          const validator = this.ajv.compile(inputSchema);
          this.validators.set(`${toolName}_input`, validator);
        }

        // Extract the output schema
        const outputSchema = (schema as any).output;
        if (outputSchema) {
          const validator = this.ajv.compile(outputSchema);
          this.validators.set(`${toolName}_output`, validator);
        }
      } catch (error) {
        console.error(`Failed to compile schema for tool: ${toolName}`, error);
      }
    }
  }

  /**
   * Validate tool input parameters
   *
   * @param toolName - Name of the tool
   * @param input - Input parameters to validate
   * @returns Validation result with error details if validation fails
   */
  validateInput(toolName: string, input: unknown): ValidationResult {
    const validator = this.validators.get(`${toolName}_input`);
    if (!validator) {
      return {
        valid: false,
        errors: [
          {
            path: 'root',
            message: `No input schema found for tool: ${toolName}`,
            keyword: 'schema',
          },
        ],
      };
    }

    const valid = validator(input);
    if (valid) {
      return { valid: true };
    }

    // Convert ajv errors to readable format
    const errors = (validator.errors || []).map((error) => ({
      path: error.instancePath || 'root',
      message: this.formatErrorMessage(error),
      keyword: error.keyword,
    }));

    return { valid: false, errors };
  }

  /**
   * Validate tool output
   *
   * @param toolName - Name of the tool
   * @param output - Output to validate
   * @returns Validation result with error details if validation fails
   */
  validateOutput(toolName: string, output: unknown): ValidationResult {
    const validator = this.validators.get(`${toolName}_output`);
    if (!validator) {
      return {
        valid: false,
        errors: [
          {
            path: 'root',
            message: `No output schema found for tool: ${toolName}`,
            keyword: 'schema',
          },
        ],
      };
    }

    const valid = validator(output);
    if (valid) {
      return { valid: true };
    }

    // Convert ajv errors to readable format
    const errors = (validator.errors || []).map((error) => ({
      path: error.instancePath || 'root',
      message: this.formatErrorMessage(error),
      keyword: error.keyword,
    }));

    return { valid: false, errors };
  }

  /**
   * Get the schema for a tool
   *
   * @param toolName - Name of the tool
   * @returns Full schema definition or undefined
   */
  getSchema(toolName: string): any {
    return toolSchemas[toolName as ToolName];
  }

  /**
   * Get input schema for a tool
   *
   * @param toolName - Name of the tool
   * @returns Input schema definition or undefined
   */
  getInputSchema(toolName: string): any {
    const schema = this.getSchema(toolName);
    return schema?.input;
  }

  /**
   * Get output schema for a tool
   *
   * @param toolName - Name of the tool
   * @returns Output schema definition or undefined
   */
  getOutputSchema(toolName: string): any {
    const schema = this.getSchema(toolName);
    return schema?.output;
  }

  /**
   * Get error schema for a tool
   *
   * @param toolName - Name of the tool
   * @returns Error schema definition or undefined
   */
  getErrorSchema(toolName: string): any {
    const schema = this.getSchema(toolName);
    return schema?.errorSchema;
  }

  /**
   * Get examples for a tool
   *
   * @param toolName - Name of the tool
   * @returns Examples object or undefined
   */
  getExamples(toolName: string): any {
    const schema = this.getSchema(toolName);
    return schema?.examples;
  }

  /**
   * Format ajv error into human-readable message
   *
   * @param error - AJV validation error
   * @returns Formatted error message
   */
  private formatErrorMessage(error: any): string {
    const path = error.instancePath || 'root';

    switch (error.keyword) {
      case 'required':
        return `Missing required field: ${error.params.missingProperty}`;
      case 'enum':
        return `Field "${path}" must be one of: ${error.params.allowedValues.join(', ')}`;
      case 'type':
        return `Field "${path}" must be of type "${error.params.type}"`;
      case 'minimum':
        return `Field "${path}" must be >= ${error.params.limit}`;
      case 'maximum':
        return `Field "${path}" must be <= ${error.params.limit}`;
      case 'minLength':
        return `Field "${path}" must have minimum length of ${error.params.limit}`;
      case 'maxLength':
        return `Field "${path}" must have maximum length of ${error.params.limit}`;
      case 'format':
        return `Field "${path}" must be a valid ${error.params.format}`;
      case 'additionalProperties':
        return `Field "${path}" has unexpected properties`;
      default:
        return error.message || 'Validation error';
    }
  }
}

/**
 * Global schema validator instance
 */
export const schemaValidator = new SchemaValidator();

/**
 * Validate tool input (convenience function)
 *
 * @param toolName - Name of the tool
 * @param input - Input parameters to validate
 * @returns True if valid, false otherwise
 */
export function validateToolInput(toolName: string, input: unknown): boolean {
  const result = schemaValidator.validateInput(toolName, input);
  return result.valid;
}

/**
 * Validate tool output (convenience function)
 *
 * @param toolName - Name of the tool
 * @param output - Output to validate
 * @returns True if valid, false otherwise
 */
export function validateToolOutput(toolName: string, output: unknown): boolean {
  const result = schemaValidator.validateOutput(toolName, output);
  return result.valid;
}
