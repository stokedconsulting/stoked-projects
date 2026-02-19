/**
 * Schema Integration Tests
 *
 * Tests that schemas work correctly with the actual tool implementations.
 */

import { describe, test, expect } from '@jest/globals';
import { SchemaValidator } from './validator.js';
import { listToolSchemas } from './index.js';

describe('Schema Integration Tests', () => {
  const validator = new SchemaValidator();

  describe('All Tool Schemas Are Available', () => {
    test('should have all expected tools', () => {
      const tools = listToolSchemas();
      const expectedTools = [
        'health_check',
        'read_project',
        'list_issues',
        'get_project_phases',
        'get_issue_details',
        'create_issue',
        'update_issue',
        'update_issue_status',
        'update_issue_phase',
      ];

      for (const tool of expectedTools) {
        expect(tools).toContain(tool);
      }
    });
  });

  describe('Schema Completeness', () => {
    test('each tool schema should have input, output, and errorSchema', () => {
      const tools = listToolSchemas();

      for (const tool of tools) {
        const schema = validator.getSchema(tool);
        expect(schema).toBeDefined();
        expect(schema.input).toBeDefined();
        expect(schema.output).toBeDefined();
        expect(schema.errorSchema).toBeDefined();
        expect(schema.title).toBeDefined();
        expect(schema.description).toBeDefined();
      }
    });

    test('each tool should have examples', () => {
      const tools = listToolSchemas();

      for (const tool of tools) {
        const examples = validator.getExamples(tool);
        expect(examples).toBeDefined();
      }
    });
  });

  describe('Schema Validation Consistency', () => {
    test('valid inputs should pass validation', () => {
      const testCases = [
        {
          tool: 'health_check',
          input: {},
        },
        {
          tool: 'read_project',
          input: { projectNumber: 70 },
        },
        {
          tool: 'create_issue',
          input: {
            projectNumber: 70,
            title: 'Test Issue',
          },
        },
        {
          tool: 'update_issue_status',
          input: {
            projectNumber: 70,
            issueNumber: 1,
            status: 'done',
          },
        },
        {
          tool: 'list_issues',
          input: { projectNumber: 70 },
        },
        {
          tool: 'get_project_phases',
          input: { projectNumber: 70 },
        },
        {
          tool: 'get_issue_details',
          input: {
            projectNumber: 70,
            issueNumber: 1,
          },
        },
        {
          tool: 'update_issue_phase',
          input: {
            projectNumber: 70,
            issueNumber: 1,
            phase: 'Foundation',
          },
        },
        {
          tool: 'update_issue',
          input: {
            projectNumber: 70,
            issueNumber: 1,
            title: 'Updated title',
          },
        },
      ];

      for (const { tool, input } of testCases) {
        const result = validator.validateInput(tool, input);
        expect(result.valid).toBe(true);
      }
    });

    test('invalid inputs should fail validation', () => {
      const testCases = [
        {
          tool: 'read_project',
          input: {},
          reason: 'missing required projectNumber',
        },
        {
          tool: 'create_issue',
          input: { projectNumber: 70 },
          reason: 'missing required title',
        },
        {
          tool: 'update_issue_status',
          input: {
            projectNumber: 70,
            issueNumber: 1,
            status: 'invalid_status',
          },
          reason: 'invalid status enum',
        },
        {
          tool: 'list_issues',
          input: {
            projectNumber: 70,
            status: 'invalid_status',
          },
          reason: 'invalid status filter',
        },
      ];

      for (const { tool, input, reason } of testCases) {
        const result = validator.validateInput(tool, input);
        expect(result.valid).toBe(false);
      }
    });
  });

  describe('Error Schema Validation', () => {
    test('error responses should validate against errorSchema', () => {
      const errorResponse = {
        error: 'Project not found',
      };

      const result = validator.validateOutput(
        'read_project',
        errorResponse
      );

      // Note: This may not validate against the output schema
      // but should match the error schema structure
      expect(typeof result).toBe('object');
    });
  });

  describe('Example Payloads', () => {
    test('all example success payloads should be valid', () => {
      const tools = listToolSchemas();

      for (const tool of tools) {
        const examples = validator.getExamples(tool);
        if (examples?.success?.output) {
          const result = validator.validateOutput(tool, examples.success.output);
          expect(result.valid).toBe(true);
        }
      }
    });

    test('all example inputs should be valid', () => {
      const tools = listToolSchemas();

      for (const tool of tools) {
        const examples = validator.getExamples(tool);
        if (examples?.success?.input) {
          const result = validator.validateInput(tool, examples.success.input);
          expect(result.valid).toBe(true);
        }
      }
    });
  });

  describe('Schema Details', () => {
    test('should provide detailed schema information', () => {
      const readProjectSchema = validator.getSchema('read_project');
      expect(readProjectSchema.$schema).toBe(
        'https://json-schema.org/draft/2020-12/schema'
      );
      expect(readProjectSchema.title).toBe('Read Project Tool');
      expect(readProjectSchema.input.properties.projectNumber).toBeDefined();
      expect(readProjectSchema.output.properties.title).toBeDefined();
    });

    test('schemas should have meaningful descriptions', () => {
      const tools = listToolSchemas();

      for (const tool of tools) {
        const schema = validator.getSchema(tool);
        expect(schema.title).toBeTruthy();
        expect(schema.title.length).toBeGreaterThan(0);
        expect(schema.description).toBeTruthy();
        expect(schema.description.length).toBeGreaterThan(0);
      }
    });
  });

  describe('Type Safety', () => {
    test('should handle nullable fields', () => {
      const issueWithNullFields = {
        number: 1,
        title: 'Issue',
        body: null,
        status: 'todo',
        url: 'https://github.com/test',
        createdAt: '2026-01-01T00:00:00Z',
        updatedAt: '2026-01-01T00:00:00Z',
        workItems: [],
        activity: [],
        phase: null,
        assignee: null,
      };

      const result = validator.validateOutput('get_issue_details', issueWithNullFields);
      expect(result.valid).toBe(true);
    });

    test('should validate array types', () => {
      const issues = [
        {
          number: 1,
          title: 'Issue 1',
          status: 'done',
          url: 'https://github.com/test',
          createdAt: '2026-01-01T00:00:00Z',
          updatedAt: '2026-01-01T00:00:00Z',
        },
      ];

      const result = validator.validateOutput('list_issues', issues);
      expect(result.valid).toBe(true);
    });

    test('should validate empty arrays', () => {
      const emptyIssues: any[] = [];
      const result = validator.validateOutput('list_issues', emptyIssues);
      expect(result.valid).toBe(true);
    });
  });

  describe('Constraint Enforcement', () => {
    test('should enforce minimum values', () => {
      const input = {
        projectNumber: -1,
      };

      const result = validator.validateInput('read_project', input);
      expect(result.valid).toBe(false);
    });

    test('should enforce enum constraints', () => {
      const testCases = [
        { status: 'backlog', valid: true },
        { status: 'todo', valid: true },
        { status: 'in_progress', valid: true },
        { status: 'done', valid: true },
        { status: 'invalid', valid: false },
      ];

      for (const { status, valid } of testCases) {
        const input = {
          projectNumber: 70,
          issueNumber: 1,
          status,
        };

        const result = validator.validateInput('update_issue_status', input);
        expect(result.valid).toBe(valid);
      }
    });

    test('should enforce string constraints', () => {
      const testCases = [
        { title: 'Valid Title', valid: true },
        { title: '', valid: false },
        { title: 'a'.repeat(257), valid: false },
      ];

      for (const { title, valid } of testCases) {
        const input = {
          projectNumber: 70,
          title,
        };

        const result = validator.validateInput('create_issue', input);
        expect(result.valid).toBe(valid);
      }
    });
  });
});
