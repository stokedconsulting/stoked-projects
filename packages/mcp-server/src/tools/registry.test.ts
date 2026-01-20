import { ToolRegistry, ToolDefinition, ToolResult } from './registry';
import { JSONSchemaType } from 'ajv';

describe('ToolRegistry', () => {
  let registry: ToolRegistry;

  beforeEach(() => {
    registry = new ToolRegistry();
  });

  describe('AC-1.3.a: Tool registration and listing', () => {
    it('should register a tool and include it in tools/list response', () => {
      // Define a simple tool
      interface EchoParams {
        message: string;
      }

      const echoSchema: JSONSchemaType<EchoParams> = {
        type: 'object',
        properties: {
          message: { type: 'string' },
        },
        required: ['message'],
        additionalProperties: false,
      };

      const echoTool: ToolDefinition<EchoParams> = {
        name: 'echo',
        description: 'Echoes back the provided message',
        inputSchema: echoSchema,
        handler: async (params) => ({
          content: [{ type: 'text', text: params.message }],
        }),
      };

      // Register the tool
      registry.registerTool(echoTool);

      // Verify it appears in the list
      const tools = registry.listTools();
      expect(tools).toHaveLength(1);
      expect(tools[0]).toEqual({
        name: 'echo',
        description: 'Echoes back the provided message',
        inputSchema: echoSchema,
      });
    });

    it('should list multiple registered tools', () => {
      interface AddParams {
        a: number;
        b: number;
      }

      const addSchema: JSONSchemaType<AddParams> = {
        type: 'object',
        properties: {
          a: { type: 'number' },
          b: { type: 'number' },
        },
        required: ['a', 'b'],
        additionalProperties: false,
      };

      interface MultiplyParams {
        x: number;
        y: number;
      }

      const multiplySchema: JSONSchemaType<MultiplyParams> = {
        type: 'object',
        properties: {
          x: { type: 'number' },
          y: { type: 'number' },
        },
        required: ['x', 'y'],
        additionalProperties: false,
      };

      registry.registerTool({
        name: 'add',
        description: 'Adds two numbers',
        inputSchema: addSchema,
        handler: async (params) => ({
          content: [{ type: 'text', text: String(params.a + params.b) }],
        }),
      });

      registry.registerTool({
        name: 'multiply',
        description: 'Multiplies two numbers',
        inputSchema: multiplySchema,
        handler: async (params) => ({
          content: [{ type: 'text', text: String(params.x * params.y) }],
        }),
      });

      const tools = registry.listTools();
      expect(tools).toHaveLength(2);
      expect(tools.map((t) => t.name)).toEqual(['add', 'multiply']);
    });

    it('should throw error when registering duplicate tool name', () => {
      interface TestParams {
        value: string;
      }

      const schema: JSONSchemaType<TestParams> = {
        type: 'object',
        properties: {
          value: { type: 'string' },
        },
        required: ['value'],
        additionalProperties: false,
      };

      const tool: ToolDefinition<TestParams> = {
        name: 'test',
        description: 'Test tool',
        inputSchema: schema,
        handler: async () => ({ content: [{ type: 'text', text: 'ok' }] }),
      };

      registry.registerTool(tool);
      expect(() => registry.registerTool(tool)).toThrow('Tool already registered: test');
    });
  });

  describe('AC-1.3.b: Parameter validation errors', () => {
    beforeEach(() => {
      interface ValidatedParams {
        name: string;
        age: number;
        email?: string;
      }

      const schema: JSONSchemaType<ValidatedParams> = {
        type: 'object',
        properties: {
          name: { type: 'string' },
          age: { type: 'number' },
          email: { type: 'string', nullable: true },
        },
        required: ['name', 'age'],
        additionalProperties: false,
      };

      registry.registerTool({
        name: 'validate-test',
        description: 'Test parameter validation',
        inputSchema: schema,
        handler: async (params) => ({
          content: [{ type: 'text', text: `Hello ${params.name}` }],
        }),
      });
    });

    it('should return validation error when required parameter is missing', async () => {
      const result = await registry.executeTool('validate-test', { name: 'Alice' });

      expect(result.isError).toBe(true);
      expect(result.content[0].type).toBe('text');

      const textContent = result.content[0];
      if (textContent.type === 'text') {
        const error = JSON.parse(textContent.text);
        expect(error.error).toBe('Parameter validation failed');
        expect(error.validationErrors).toBeDefined();
        expect(error.validationErrors.length).toBeGreaterThan(0);
      }
    });

    it('should return field-specific validation error messages', async () => {
      const result = await registry.executeTool('validate-test', {
        name: 'Alice',
        age: 'not-a-number', // Wrong type
      });

      expect(result.isError).toBe(true);

      const textContent = result.content[0];
      if (textContent.type === 'text') {
        const error = JSON.parse(textContent.text);
        expect(error.validationErrors).toBeDefined();

        // Check that validation error has field and message
        const validationError = error.validationErrors[0];
        expect(validationError).toHaveProperty('field');
        expect(validationError).toHaveProperty('message');
      }
    });

    it('should return validation error for invalid parameter type', async () => {
      const result = await registry.executeTool('validate-test', {
        name: 123, // Should be string
        age: 25,
      });

      expect(result.isError).toBe(true);

      const textContent = result.content[0];
      if (textContent.type === 'text') {
        const error = JSON.parse(textContent.text);
        expect(error.error).toBe('Parameter validation failed');
      }
    });

    it('should pass validation with correct parameters', async () => {
      const result = await registry.executeTool('validate-test', {
        name: 'Alice',
        age: 25,
      });

      expect(result.isError).toBeUndefined();
      const textContent = result.content[0];
      if (textContent.type === 'text') {
        expect(textContent.text).toBe('Hello Alice');
      }
    });
  });

  describe('AC-1.3.c: Exception handling', () => {
    it('should catch handler exceptions and return MCP error response', async () => {
      interface ErrorParams {
        trigger: string;
      }

      const schema: JSONSchemaType<ErrorParams> = {
        type: 'object',
        properties: {
          trigger: { type: 'string' },
        },
        required: ['trigger'],
        additionalProperties: false,
      };

      registry.registerTool({
        name: 'error-test',
        description: 'Test error handling',
        inputSchema: schema,
        handler: async (params) => {
          if (params.trigger === 'error') {
            throw new Error('Simulated handler error');
          }
          return { content: [{ type: 'text', text: 'ok' }] };
        },
      });

      const result = await registry.executeTool('error-test', { trigger: 'error' });

      expect(result.isError).toBe(true);
      expect(result.content[0].type).toBe('text');

      const textContent = result.content[0];
      if (textContent.type === 'text') {
        const error = JSON.parse(textContent.text);
        expect(error.error).toContain('Tool execution failed');
        expect(error.error).toContain('Simulated handler error');
        expect(error.toolName).toBe('error-test');
      }
    });

    it('should handle unknown tool execution', async () => {
      const result = await registry.executeTool('non-existent-tool', {});

      expect(result.isError).toBe(true);
      const textContent = result.content[0];
      if (textContent.type === 'text') {
        expect(textContent.text).toContain('Unknown tool: non-existent-tool');
      }
    });

    it('should handle handler that throws non-Error objects', async () => {
      interface ThrowParams {
        value: string;
      }

      const schema: JSONSchemaType<ThrowParams> = {
        type: 'object',
        properties: {
          value: { type: 'string' },
        },
        required: ['value'],
        additionalProperties: false,
      };

      registry.registerTool({
        name: 'throw-test',
        description: 'Test throwing non-Error',
        inputSchema: schema,
        handler: async () => {
          throw 'String error'; // eslint-disable-line @typescript-eslint/no-throw-literal
        },
      });

      const result = await registry.executeTool('throw-test', { value: 'test' });

      expect(result.isError).toBe(true);
      const textContent = result.content[0];
      if (textContent.type === 'text') {
        expect(textContent.text).toContain('Tool execution failed');
      }
    });
  });

  describe('AC-1.3.d: Successful tool execution', () => {
    it('should return MCP success response with tool output', async () => {
      interface CalculateParams {
        operation: 'add' | 'subtract';
        a: number;
        b: number;
      }

      const schema: JSONSchemaType<CalculateParams> = {
        type: 'object',
        properties: {
          operation: { type: 'string', enum: ['add', 'subtract'] },
          a: { type: 'number' },
          b: { type: 'number' },
        },
        required: ['operation', 'a', 'b'],
        additionalProperties: false,
      };

      registry.registerTool({
        name: 'calculate',
        description: 'Perform calculation',
        inputSchema: schema,
        handler: async (params) => {
          const result =
            params.operation === 'add' ? params.a + params.b : params.a - params.b;
          return {
            content: [
              {
                type: 'text',
                text: `Result: ${result}`,
              },
            ],
          };
        },
      });

      const result = await registry.executeTool('calculate', {
        operation: 'add',
        a: 10,
        b: 5,
      });

      expect(result.isError).toBeUndefined();
      expect(result.content).toHaveLength(1);
      expect(result.content[0].type).toBe('text');
      const textContent = result.content[0];
      if (textContent.type === 'text') {
        expect(textContent.text).toBe('Result: 15');
      }
    });

    it('should handle tool with complex output structure', async () => {
      interface DataParams {
        format: 'json' | 'text';
      }

      const schema: JSONSchemaType<DataParams> = {
        type: 'object',
        properties: {
          format: { type: 'string', enum: ['json', 'text'] },
        },
        required: ['format'],
        additionalProperties: false,
      };

      registry.registerTool({
        name: 'data-formatter',
        description: 'Format data',
        inputSchema: schema,
        handler: async (params) => {
          if (params.format === 'json') {
            return {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify({ status: 'success', data: [1, 2, 3] }),
                },
              ],
            };
          }
          return {
            content: [
              { type: 'text', text: 'Line 1' },
              { type: 'text', text: 'Line 2' },
            ],
          };
        },
      });

      const result = await registry.executeTool('data-formatter', { format: 'json' });

      expect(result.isError).toBeUndefined();
      expect(result.content).toHaveLength(1);
      const textContent = result.content[0];
      if (textContent.type === 'text') {
        const data = JSON.parse(textContent.text);
        expect(data.status).toBe('success');
        expect(data.data).toEqual([1, 2, 3]);
      }
    });
  });

  describe('AC-1.3.e: Multiple tools with correct schemas', () => {
    it('should list all registered tools with their complete schemas', () => {
      interface Tool1Params {
        text: string;
      }

      const tool1Schema: JSONSchemaType<Tool1Params> = {
        type: 'object',
        properties: {
          text: { type: 'string' },
        },
        required: ['text'],
        additionalProperties: false,
      };

      interface Tool2Params {
        count: number;
        optional?: string;
      }

      const tool2Schema: JSONSchemaType<Tool2Params> = {
        type: 'object',
        properties: {
          count: { type: 'number' },
          optional: { type: 'string', nullable: true },
        },
        required: ['count'],
        additionalProperties: false,
      };

      interface Tool3Params {
        enabled: boolean;
        tags: string[];
      }

      const tool3Schema: JSONSchemaType<Tool3Params> = {
        type: 'object',
        properties: {
          enabled: { type: 'boolean' },
          tags: { type: 'array', items: { type: 'string' } },
        },
        required: ['enabled', 'tags'],
        additionalProperties: false,
      };

      registry.registerTool({
        name: 'tool1',
        description: 'First tool',
        inputSchema: tool1Schema,
        handler: async () => ({ content: [{ type: 'text', text: 'ok' }] }),
      });

      registry.registerTool({
        name: 'tool2',
        description: 'Second tool',
        inputSchema: tool2Schema,
        handler: async () => ({ content: [{ type: 'text', text: 'ok' }] }),
      });

      registry.registerTool({
        name: 'tool3',
        description: 'Third tool',
        inputSchema: tool3Schema,
        handler: async () => ({ content: [{ type: 'text', text: 'ok' }] }),
      });

      const tools = registry.listTools();

      expect(tools).toHaveLength(3);

      // Verify each tool has correct schema
      const tool1 = tools.find((t) => t.name === 'tool1');
      expect(tool1).toBeDefined();
      expect(tool1!.description).toBe('First tool');
      expect(tool1!.inputSchema).toEqual(tool1Schema);

      const tool2 = tools.find((t) => t.name === 'tool2');
      expect(tool2).toBeDefined();
      expect(tool2!.description).toBe('Second tool');
      expect(tool2!.inputSchema).toEqual(tool2Schema);

      const tool3 = tools.find((t) => t.name === 'tool3');
      expect(tool3).toBeDefined();
      expect(tool3!.description).toBe('Third tool');
      expect(tool3!.inputSchema).toEqual(tool3Schema);
    });

    it('should execute each tool independently with correct validation', async () => {
      interface TextParams {
        message: string;
      }

      const textSchema: JSONSchemaType<TextParams> = {
        type: 'object',
        properties: {
          message: { type: 'string' },
        },
        required: ['message'],
        additionalProperties: false,
      };

      interface NumberParams {
        value: number;
      }

      const numberSchema: JSONSchemaType<NumberParams> = {
        type: 'object',
        properties: {
          value: { type: 'number' },
        },
        required: ['value'],
        additionalProperties: false,
      };

      registry.registerTool({
        name: 'text-tool',
        description: 'Text tool',
        inputSchema: textSchema,
        handler: async (params) => ({
          content: [{ type: 'text', text: `Message: ${params.message}` }],
        }),
      });

      registry.registerTool({
        name: 'number-tool',
        description: 'Number tool',
        inputSchema: numberSchema,
        handler: async (params) => ({
          content: [{ type: 'text', text: `Value: ${params.value}` }],
        }),
      });

      // Execute text tool
      const result1 = await registry.executeTool('text-tool', { message: 'Hello' });
      expect(result1.isError).toBeUndefined();
      const textContent1 = result1.content[0];
      if (textContent1.type === 'text') {
        expect(textContent1.text).toBe('Message: Hello');
      }

      // Execute number tool
      const result2 = await registry.executeTool('number-tool', { value: 42 });
      expect(result2.isError).toBeUndefined();
      const textContent2 = result2.content[0];
      if (textContent2.type === 'text') {
        expect(textContent2.text).toBe('Value: 42');
      }

      // Verify cross-validation works (text-tool should reject number params)
      const result3 = await registry.executeTool('text-tool', { value: 42 });
      expect(result3.isError).toBe(true);
    });
  });

  describe('Additional functionality', () => {
    it('should sanitize API keys in logged parameters', async () => {
      interface ApiParams {
        apiKey: string;
        data: string;
      }

      const schema: JSONSchemaType<ApiParams> = {
        type: 'object',
        properties: {
          apiKey: { type: 'string' },
          data: { type: 'string' },
        },
        required: ['apiKey', 'data'],
        additionalProperties: false,
      };

      const consoleSpy = jest.spyOn(console, 'error').mockImplementation();

      registry.registerTool({
        name: 'api-test',
        description: 'Test API key sanitization',
        inputSchema: schema,
        handler: async (params) => ({
          content: [{ type: 'text', text: params.data }],
        }),
      });

      await registry.executeTool('api-test', {
        apiKey: 'secret-key-12345',
        data: 'test-data',
      });

      // Verify console.error was called with sanitized params
      expect(consoleSpy).toHaveBeenCalled();
      const loggedParams = consoleSpy.mock.calls.find((call) =>
        call[0].includes('Executing tool')
      );
      expect(loggedParams).toBeDefined();
      expect(loggedParams![1]).toContain('***REDACTED***');
      expect(loggedParams![1]).not.toContain('secret-key-12345');

      consoleSpy.mockRestore();
    });

    it('should provide helper methods for registry management', () => {
      interface TestParams {
        value: string;
      }

      const schema: JSONSchemaType<TestParams> = {
        type: 'object',
        properties: {
          value: { type: 'string' },
        },
        required: ['value'],
        additionalProperties: false,
      };

      expect(registry.getToolCount()).toBe(0);

      registry.registerTool({
        name: 'test',
        description: 'Test',
        inputSchema: schema,
        handler: async () => ({ content: [{ type: 'text', text: 'ok' }] }),
      });

      expect(registry.getToolCount()).toBe(1);
      expect(registry.hasTool('test')).toBe(true);
      expect(registry.hasTool('non-existent')).toBe(false);

      registry.clear();
      expect(registry.getToolCount()).toBe(0);
    });
  });
});
