# MCP Tool Schemas

This directory contains comprehensive JSON Schema definitions for all MCP (Model Context Protocol) tools, enabling robust validation and documentation of tool inputs and outputs.

## Overview

All schemas follow **JSON Schema Draft 2020-12** specification and include:
- Input parameter definitions with constraints
- Output structure specifications
- Error response schemas
- Example payloads (success and failure cases)
- Tool-specific constraints and behaviors

## Tools

### Read-Only Tools

#### `health_check`
Check connectivity and authentication with the api.
- **File:** `health-check.json`
- **Input:** No parameters required
- **Output:** API availability, authentication status, response time

#### `read_project`
Fetch complete project details including metadata, fields, phases, and statistics.
- **File:** `read-project.json`
- **Input:** `projectNumber` (number)
- **Output:** Project object with nested phases and fields

#### `list_issues`
List all issues in a project with optional filtering by status, phase, and assignee.
- **File:** `list-issues.json`
- **Input:** `projectNumber` (required), `status`, `phase`, `assignee` (optional filters)
- **Output:** Array of issue summary objects

#### `get_project_phases`
Get the list of phases defined for a project with work item counts.
- **File:** `get-project-phases.json`
- **Input:** `projectNumber` (number)
- **Output:** Ordered array of phase objects with statistics

#### `get_issue_details`
Get complete details for a specific issue including work items and activity.
- **File:** `get-issue-details.json`
- **Input:** `projectNumber` (number), `issueNumber` (number)
- **Output:** Full issue object with work items and activity log

### Write Tools

#### `create_issue`
Create a new GitHub issue and add it to the project board.
- **File:** `create-issue.json`
- **Input:** `projectNumber`, `title` (required), plus optional `body`, `status`, `phase`, `assignee`, `labels`
- **Output:** Created issue object with GitHub issue number

#### `update_issue`
Update issue details (title, description, assignee, labels).
- **File:** `update-issue.json`
- **Input:** `projectNumber`, `issueNumber` (required), plus optional field updates
- **Output:** Updated issue object

#### `update_issue_status`
Change the status of an issue (backlog, todo, in_progress, done).
- **File:** `update-issue-status.json`
- **Input:** `projectNumber`, `issueNumber`, `status` (required)
- **Output:** Issue object with previous and new status

#### `update_issue_phase`
Move an issue to a different phase with fuzzy matching support.
- **File:** `update-issue-phase.json`
- **Input:** `projectNumber`, `issueNumber`, `phase` (required)
- **Output:** Issue object showing previous and new phase

## Validation

### Using the Validator

```typescript
import { SchemaValidator } from './validator.js';

const validator = new SchemaValidator();

// Validate input
const inputResult = validator.validateInput('create_issue', {
  projectNumber: 70,
  title: 'New Feature'
});

if (inputResult.valid) {
  console.log('Input is valid');
} else {
  console.log('Errors:', inputResult.errors);
}

// Validate output
const outputResult = validator.validateOutput('create_issue', {
  number: 1,
  title: 'New Feature',
  status: 'backlog',
  url: 'https://...',
  createdAt: '2026-01-24T00:00:00Z'
});
```

### Convenience Functions

```typescript
import { validateToolInput, validateToolOutput } from './validator.js';

// Simple validation
const inputValid = validateToolInput('read_project', { projectNumber: 70 });
const outputValid = validateToolOutput('read_project', projectData);
```

### Retrieving Schemas

```typescript
import { SchemaValidator } from './validator.js';

const validator = new SchemaValidator();

// Get specific schemas
const inputSchema = validator.getInputSchema('read_project');
const outputSchema = validator.getOutputSchema('read_project');
const errorSchema = validator.getErrorSchema('read_project');

// Get examples
const examples = validator.getExamples('read_project');
```

## Schema Structure

Each tool schema follows this structure:

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "title": "Tool Name",
  "description": "Tool description",
  "input": {
    "type": "object",
    "properties": { /* ... */ },
    "required": [ /* ... */ ]
  },
  "output": {
    "type": "object",
    "properties": { /* ... */ },
    "required": [ /* ... */ ]
  },
  "errorSchema": {
    "type": "object",
    "properties": { /* ... */ }
  },
  "examples": {
    "success": { /* ... */ },
    "failure": { /* ... */ }
  },
  "constraints": {
    "field": "constraint description"
  }
}
```

## Validation Rules

### Common Constraints

- **Required fields:** Must be provided; validation fails if missing
- **Type validation:** Fields must match declared type (number, string, boolean, array, object)
- **Enum validation:** String fields with `enum` constraint must match one of allowed values
- **Range validation:** Number fields with `minimum`/`maximum` must be within range
- **Length validation:** String fields with `minLength`/`maxLength` must be within range
- **Format validation:** String fields with `format` must match format (e.g., "uri", "date-time")
- **Nullable fields:** Marked with `nullable: true` can accept `null` value

### Common Valid Statuses

```
"backlog"      - Issue is in backlog
"todo"         - Issue is ready for work
"in_progress"  - Issue is being worked on
"done"         - Issue is complete
```

## Examples

### Creating an Issue

```typescript
// Input
{
  "projectNumber": 70,
  "title": "Implement authentication",
  "body": "# Description\n\nAdd JWT-based auth",
  "status": "todo",
  "phase": "Core Features",
  "assignee": "stoked",
  "labels": ["api", "security"]
}

// Output (success)
{
  "number": 42,
  "title": "Implement authentication",
  "status": "todo",
  "phase": "Core Features",
  "assignee": "stoked",
  "labels": ["api", "security"],
  "url": "https://github.com/example/repo/issues/42",
  "createdAt": "2026-01-24T14:30:00Z"
}
```

### Error Response

```json
{
  "error": "Phase \"NonexistentPhase\" not found in Project #70",
  "availablePhases": ["Foundation", "Core Features", "Testing"],
  "suggestion": "Did you mean 'Foundation'?"
}
```

## Testing

Comprehensive tests are provided in `validator.test.ts`:

```bash
npm test -- src/tools/schemas/validator.test.ts
```

Tests cover:
- Schema initialization and compilation
- Input validation for all tools
- Output validation for all tools
- Error handling and error message formatting
- Edge cases and boundary conditions
- Convenience function usage

## Adding New Tools

To add a new tool schema:

1. Create a JSON schema file: `tools/schemas/new-tool.json`
2. Define `input`, `output`, and `errorSchema` sections
3. Add examples for success and failure cases
4. Add test cases to `validator.test.ts`
5. Update `schemas/index.ts` to export the new schema
6. The validator will automatically compile and validate against the new schema

## Performance Considerations

- **Schema compilation:** All schemas are pre-compiled during `SchemaValidator` initialization for fast validation
- **Validation caching:** Compiled validators are cached in a Map for O(1) lookup
- **Error details:** Full error details are collected using `allErrors: true` configuration

## API Reference

### SchemaValidator Class

```typescript
class SchemaValidator {
  // Validate input parameters
  validateInput(toolName: string, input: unknown): ValidationResult

  // Validate output
  validateOutput(toolName: string, output: unknown): ValidationResult

  // Get schema definitions
  getSchema(toolName: string): any
  getInputSchema(toolName: string): any
  getOutputSchema(toolName: string): any
  getErrorSchema(toolName: string): any
  getExamples(toolName: string): any
}
```

### ValidationResult

```typescript
interface ValidationResult {
  valid: boolean;
  errors?: Array<{
    path: string;          // JSON path to field
    message: string;       // Human-readable error message
    keyword: string;       // JSON Schema keyword (enum, type, etc.)
  }>;
}
```

## References

- [JSON Schema Draft 2020-12 Specification](https://json-schema.org/draft/2020-12/json-schema-core.html)
- [AJV JSON Schema Validator](https://ajv.js.org/)
- [MCP Protocol Specification](https://modelcontextprotocol.io/specification)

## Related Files

- `index.ts` - Schema registry and exports
- `validator.ts` - Validation implementation
- `validator.test.ts` - Comprehensive test suite
- `*.json` - Individual tool schema definitions
