import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { GitHubIssuesService } from './github-issues.service';
import { GitHubIssuesCacheService } from './github-issues-cache.service';
import { CreateIssueDto, UpdateIssueDto, LinkIssueDto, ListIssuesDto } from './dto';
import { IssueState } from './types/github-issue.types';

// Mock the entire GitHubClientService module to avoid ESM import issues
jest.mock('../github/client/github-client.service');
import { GitHubClientService } from '../github/client/github-client.service';

describe('GitHubIssuesService', () => {
  let service: GitHubIssuesService;
  let githubClient: jest.Mocked<GitHubClientService>;
  let cache: jest.Mocked<GitHubIssuesCacheService>;

  const mockIssue = {
    id: 'I_kwDOABCDEF01234567',
    number: 42,
    title: 'Test Issue',
    body: 'Test body',
    state: IssueState.OPEN,
    url: 'https://github.com/octocat/hello-world/issues/42',
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-01-01T00:00:00Z',
    author: { login: 'octocat' },
    labels: [],
    assignees: [],
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        GitHubIssuesService,
        {
          provide: GitHubClientService,
          useValue: {
            executeGraphQL: jest.fn(),
          },
        },
        {
          provide: GitHubIssuesCacheService,
          useValue: {
            getList: jest.fn(),
            setList: jest.fn(),
            invalidateRepository: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get<GitHubIssuesService>(GitHubIssuesService);
    githubClient = module.get(GitHubClientService);
    cache = module.get(GitHubIssuesCacheService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('AC-2.2.a: POST create returns issue with number', () => {
    it('should create issue and return issue with number', async () => {
      const dto: CreateIssueDto = {
        owner: 'octocat',
        repo: 'hello-world',
        title: 'New Issue',
        body: 'Issue body',
      };

      // Mock repository ID fetch
      githubClient.executeGraphQL.mockResolvedValueOnce({
        success: true,
        data: { repository: { id: 'R_123' } },
      });

      // Mock issue creation
      githubClient.executeGraphQL.mockResolvedValueOnce({
        success: true,
        data: {
          createIssue: {
            issue: mockIssue,
          },
        },
      });

      const result = await service.createIssue(dto);

      expect(result.data).toBeDefined();
      expect(result.data.number).toBe(42);
      expect(result.data.title).toBe('Test Issue');
      expect(cache.invalidateRepository).toHaveBeenCalledWith('octocat', 'hello-world');
    });

    it('should handle labels and assignees', async () => {
      const dto: CreateIssueDto = {
        owner: 'octocat',
        repo: 'hello-world',
        title: 'New Issue',
        labels: ['bug', 'priority-high'],
        assignees: ['octocat'],
      };

      // Mock repository ID
      githubClient.executeGraphQL.mockResolvedValueOnce({
        success: true,
        data: { repository: { id: 'R_123' } },
      });

      // Mock label IDs fetch
      githubClient.executeGraphQL.mockResolvedValueOnce({
        success: true,
        data: {
          repository: {
            labels: {
              nodes: [
                { id: 'L_1', name: 'bug' },
                { id: 'L_2', name: 'priority-high' },
              ],
            },
          },
        },
      });

      // Mock user ID fetch (called for each assignee)
      githubClient.executeGraphQL.mockResolvedValueOnce({
        success: true,
        data: { user: { id: 'U_1' } },
      });

      // Mock issue creation
      githubClient.executeGraphQL.mockResolvedValueOnce({
        success: true,
        data: {
          createIssue: {
            issue: {
              ...mockIssue,
              labels: { nodes: [{ name: 'bug' }, { name: 'priority-high' }] },
              assignees: { nodes: [{ login: 'octocat' }] },
            },
          },
        },
      });

      const result = await service.createIssue(dto);

      expect(result.data.labels).toHaveLength(2);
      expect(result.data.assignees).toHaveLength(1);
    });
  });

  describe('AC-2.2.b: POST close updates state to closed', () => {
    it('should close issue and return closed state', async () => {
      // Mock get issue
      githubClient.executeGraphQL.mockResolvedValueOnce({
        success: true,
        data: {
          repository: {
            issue: mockIssue,
          },
        },
      });

      // Mock close issue
      const closedIssue = {
        ...mockIssue,
        state: IssueState.CLOSED,
        closedAt: '2024-01-02T00:00:00Z',
      };

      githubClient.executeGraphQL.mockResolvedValueOnce({
        success: true,
        data: {
          closeIssue: {
            issue: closedIssue,
          },
        },
      });

      const result = await service.closeIssue('octocat', 'hello-world', 42);

      expect(result.state).toBe(IssueState.CLOSED);
      expect(result.closedAt).toBeDefined();
      expect(cache.invalidateRepository).toHaveBeenCalledWith('octocat', 'hello-world');
    });
  });

  describe('AC-2.2.c: POST link adds issue to project and updates status', () => {
    it('should link issue to project and update status', async () => {
      const dto: LinkIssueDto = {
        projectId: 'PVT_123',
        status: 'In Progress',
      };

      // Mock get issue
      githubClient.executeGraphQL.mockResolvedValueOnce({
        success: true,
        data: {
          repository: {
            issue: mockIssue,
          },
        },
      });

      // Mock add to project
      githubClient.executeGraphQL.mockResolvedValueOnce({
        success: true,
        data: {
          addProjectV2ItemById: {
            item: { id: 'PVTI_456' },
          },
        },
      });

      // Mock get project status field
      githubClient.executeGraphQL.mockResolvedValueOnce({
        success: true,
        data: {
          node: {
            fields: {
              nodes: [
                {
                  id: 'FIELD_1',
                  name: 'Status',
                  options: [
                    { id: 'OPT_1', name: 'Todo' },
                    { id: 'OPT_2', name: 'In Progress' },
                  ],
                },
              ],
            },
          },
        },
      });

      // Mock update status
      githubClient.executeGraphQL.mockResolvedValueOnce({
        success: true,
        data: {
          updateProjectV2ItemFieldValue: {
            projectV2Item: { id: 'PVTI_456' },
          },
        },
      });

      const result = await service.linkIssueToProject('octocat', 'hello-world', 42, dto);

      expect(result.data.itemId).toBe('PVTI_456');
      expect(result.data.issue).toBeDefined();
      expect(result.warnings).toBeUndefined();
    });

    it('should handle priority field update', async () => {
      const dto: LinkIssueDto = {
        projectId: 'PVT_123',
        priority: 'High',
      };

      // Mock get issue
      githubClient.executeGraphQL.mockResolvedValueOnce({
        success: true,
        data: { repository: { issue: mockIssue } },
      });

      // Mock add to project
      githubClient.executeGraphQL.mockResolvedValueOnce({
        success: true,
        data: { addProjectV2ItemById: { item: { id: 'PVTI_456' } } },
      });

      // Mock get priority field
      githubClient.executeGraphQL.mockResolvedValueOnce({
        success: true,
        data: {
          node: {
            fields: {
              nodes: [
                {
                  id: 'FIELD_2',
                  name: 'Priority',
                  options: [
                    { id: 'OPT_3', name: 'High' },
                    { id: 'OPT_4', name: 'Low' },
                  ],
                },
              ],
            },
          },
        },
      });

      // Mock update priority
      githubClient.executeGraphQL.mockResolvedValueOnce({
        success: true,
        data: { updateProjectV2ItemFieldValue: { projectV2Item: { id: 'PVTI_456' } } },
      });

      const result = await service.linkIssueToProject('octocat', 'hello-world', 42, dto);

      expect(result.data.itemId).toBe('PVTI_456');
      expect(result.warnings).toBeUndefined();
    });
  });

  describe('AC-2.2.d: GET specific issue returns fresh data (no cache)', () => {
    it('should always fetch issue from GitHub (no cache)', async () => {
      githubClient.executeGraphQL.mockResolvedValueOnce({
        success: true,
        data: {
          repository: {
            issue: mockIssue,
          },
        },
      });

      const result = await service.getIssue('octocat', 'hello-world', 42);

      expect(result).toBeDefined();
      expect(result.number).toBe(42);
      expect(cache.getList).not.toHaveBeenCalled();
      expect(githubClient.executeGraphQL).toHaveBeenCalledTimes(1);
    });

    it('should throw NotFoundException when issue not found', async () => {
      githubClient.executeGraphQL.mockResolvedValueOnce({
        success: true,
        data: {
          repository: {
            issue: null,
          },
        },
      });

      await expect(service.getIssue('octocat', 'hello-world', 999)).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('AC-2.2.e: Project link failure still creates issue with warning', () => {
    it('should return warning when status update fails', async () => {
      const dto: LinkIssueDto = {
        projectId: 'PVT_123',
        status: 'Invalid Status',
      };

      // Mock get issue
      githubClient.executeGraphQL.mockResolvedValueOnce({
        success: true,
        data: { repository: { issue: mockIssue } },
      });

      // Mock add to project (succeeds)
      githubClient.executeGraphQL.mockResolvedValueOnce({
        success: true,
        data: { addProjectV2ItemById: { item: { id: 'PVTI_456' } } },
      });

      // Mock get status field (returns null - status not found)
      githubClient.executeGraphQL.mockResolvedValueOnce({
        success: true,
        data: {
          node: {
            fields: {
              nodes: [
                {
                  id: 'FIELD_1',
                  name: 'Status',
                  options: [{ id: 'OPT_1', name: 'Todo' }],
                },
              ],
            },
          },
        },
      });

      const result = await service.linkIssueToProject('octocat', 'hello-world', 42, dto);

      expect(result.data.itemId).toBe('PVTI_456');
      expect(result.warnings).toBeDefined();
      expect(result.warnings).toHaveLength(1);
      expect(result.warnings![0]).toContain('status update failed');
    });

    it('should return warnings when both status and priority fail', async () => {
      const dto: LinkIssueDto = {
        projectId: 'PVT_123',
        status: 'Invalid',
        priority: 'Invalid',
      };

      // Mock get issue
      githubClient.executeGraphQL.mockResolvedValueOnce({
        success: true,
        data: { repository: { issue: mockIssue } },
      });

      // Mock add to project
      githubClient.executeGraphQL.mockResolvedValueOnce({
        success: true,
        data: { addProjectV2ItemById: { item: { id: 'PVTI_456' } } },
      });

      // Mock status field fetch (not found)
      githubClient.executeGraphQL.mockResolvedValueOnce({
        success: true,
        data: { node: { fields: { nodes: [] } } },
      });

      // Mock priority field fetch (not found)
      githubClient.executeGraphQL.mockResolvedValueOnce({
        success: true,
        data: { node: { fields: { nodes: [] } } },
      });

      const result = await service.linkIssueToProject('octocat', 'hello-world', 42, dto);

      expect(result.data.itemId).toBe('PVTI_456');
      expect(result.warnings).toHaveLength(2);
      expect(result.warnings![0]).toContain('status update failed');
      expect(result.warnings![1]).toContain('priority update failed');
    });
  });

  describe('AC-2.2.f: GET list cached for 2 minutes', () => {
    it('should return cached list when available', async () => {
      const cachedIssues = [mockIssue];
      cache.getList.mockReturnValueOnce(cachedIssues);

      const result = await service.listIssues('octocat', 'hello-world');

      expect(result).toBe(cachedIssues);
      expect(cache.getList).toHaveBeenCalled();
      expect(githubClient.executeGraphQL).not.toHaveBeenCalled();
    });

    it('should fetch from GitHub when cache miss', async () => {
      cache.getList.mockReturnValueOnce(null);

      githubClient.executeGraphQL.mockResolvedValueOnce({
        success: true,
        data: {
          repository: {
            issues: {
              nodes: [mockIssue],
            },
          },
        },
      });

      const result = await service.listIssues('octocat', 'hello-world');

      expect(result).toHaveLength(1);
      expect(cache.getList).toHaveBeenCalled();
      expect(cache.setList).toHaveBeenCalled();
      expect(githubClient.executeGraphQL).toHaveBeenCalledTimes(1);
    });

    it('should use filters in cache key', async () => {
      cache.getList.mockReturnValueOnce(null);

      githubClient.executeGraphQL.mockResolvedValueOnce({
        success: true,
        data: {
          repository: {
            issues: {
              nodes: [mockIssue],
            },
          },
        },
      });

      const filters: ListIssuesDto = {
        state: 'open' as any,
        labels: 'bug,priority-high',
      };

      await service.listIssues('octocat', 'hello-world', filters);

      const cacheKeyCall = cache.getList.mock.calls[0][0];
      expect(cacheKeyCall).toContain('octocat/hello-world');
      expect(cacheKeyCall).toContain('state:open');
      expect(cacheKeyCall).toContain('labels:bug,priority-high');
    });
  });

  describe('Additional Operations', () => {
    it('should update issue title and body', async () => {
      const dto: UpdateIssueDto = {
        title: 'Updated Title',
        body: 'Updated body',
      };

      // Mock get issue
      githubClient.executeGraphQL.mockResolvedValueOnce({
        success: true,
        data: { repository: { issue: mockIssue } },
      });

      // Mock update
      githubClient.executeGraphQL.mockResolvedValueOnce({
        success: true,
        data: {
          updateIssue: {
            issue: {
              ...mockIssue,
              title: 'Updated Title',
              body: 'Updated body',
            },
          },
        },
      });

      const result = await service.updateIssue('octocat', 'hello-world', 42, dto);

      expect(result.title).toBe('Updated Title');
      expect(result.body).toBe('Updated body');
    });

    it('should handle GraphQL errors gracefully', async () => {
      githubClient.executeGraphQL.mockResolvedValueOnce({
        success: false,
        error: {
          code: 'UNKNOWN_ERROR' as any,
          message: 'API Error',
          retryable: false,
        },
      });

      await expect(service.getIssue('octocat', 'hello-world', 42)).rejects.toThrow('API Error');
    });
  });
});
