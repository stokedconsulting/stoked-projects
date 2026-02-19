// Mock @octokit/rest (pure ESM, can't be imported by Jest/CommonJS)
jest.mock('@octokit/rest', () => ({
  Octokit: jest.fn().mockImplementation(() => ({
    rest: {
      repos: { get: jest.fn(), listForOrg: jest.fn() },
      issues: { create: jest.fn(), update: jest.fn(), get: jest.fn(), listForRepo: jest.fn() },
      projects: { listForRepo: jest.fn(), listForOrg: jest.fn() },
      orgs: { get: jest.fn() },
    },
    graphql: jest.fn(),
  })),
}));

import { createGitHubClient } from '../github-client';
import { createGitHubCreateProjectTool } from './github-create-project';
import { createGitHubListProjectsTool } from './github-list-projects';
import { createGitHubCreateIssueTool } from './github-create-issue';
import { createGitHubGetRepoTool } from './github-get-repo';
import { createGitHubGetOrgTool } from './github-get-org';

describe('GitHub MCP Tools', () => {
  // Skip live API tests — @octokit/rest is ESM-only and must be mocked in Jest,
  // so these tests can only validate schemas, not actual API calls
  const skipIfNoToken = describe.skip;

  skipIfNoToken('with valid GitHub token', () => {
    let client: ReturnType<typeof createGitHubClient>;

    beforeAll(() => {
      client = createGitHubClient(process.env.GITHUB_TOKEN!);
    });

    describe('github_get_repo', () => {
      it('should get repository metadata', async () => {
        const tool = createGitHubGetRepoTool(client);
        const result = await tool.handler({
          owner: 'octocat',
          repo: 'Hello-World',
        });

        expect(result.isError).toBeFalsy();
        const data = JSON.parse((result.content[0] as { type: 'text'; text: string }).text);
        expect(data.success).toBe(true);
        expect(data.repository.name).toBe('Hello-World');
      });
    });

    describe('github_list_projects', () => {
      it('should list projects for a repository', async () => {
        const tool = createGitHubListProjectsTool(client);
        const result = await tool.handler({
          owner: 'octocat',
          repo: 'Hello-World',
        });

        expect(result.isError).toBeFalsy();
        const data = JSON.parse((result.content[0] as { type: 'text'; text: string }).text);
        expect(data.success).toBe(true);
        expect(Array.isArray(data.projects)).toBe(true);
      });
    });
  });

  describe('tool schema validation', () => {
    let client: ReturnType<typeof createGitHubClient>;

    beforeAll(() => {
      client = createGitHubClient('fake-token');
    });

    it('should have correct schema for github_create_project', () => {
      const tool = createGitHubCreateProjectTool(client);
      expect(tool.name).toBe('github_create_project');
      expect(tool.inputSchema.required).toContain('owner');
      expect(tool.inputSchema.required).toContain('name');
    });

    it('should have correct schema for github_create_issue', () => {
      const tool = createGitHubCreateIssueTool(client);
      expect(tool.name).toBe('github_create_issue');
      expect(tool.inputSchema.required).toContain('owner');
      expect(tool.inputSchema.required).toContain('repo');
      expect(tool.inputSchema.required).toContain('title');
    });

    it('should have correct schema for github_get_repo', () => {
      const tool = createGitHubGetRepoTool(client);
      expect(tool.name).toBe('github_get_repo');
      expect(tool.inputSchema.required).toContain('owner');
      expect(tool.inputSchema.required).toContain('repo');
    });

    it('should have correct schema for github_get_org', () => {
      const tool = createGitHubGetOrgTool(client);
      expect(tool.name).toBe('github_get_org');
      expect(tool.inputSchema.required).toContain('org');
    });
  });
});
