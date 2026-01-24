import { Test, TestingModule } from '@nestjs/testing';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { HttpStatus } from '@nestjs/common';
import { ProjectsService } from './projects.service';
import { GitHubClientService } from '../client/github-client.service';
import { GitHubLoggerService } from '../../../github/logging/github-logger.service';
import {
  GitHubAuthException,
  GitHubValidationException,
} from '../../../github/errors/github.exception';
import { CreateProjectDto, UpdateProjectDto, LinkProjectDto } from './dto';

describe('ProjectsService', () => {
  let service: ProjectsService;
  let githubClient: jest.Mocked<GitHubClientService>;
  let githubLogger: jest.Mocked<GitHubLoggerService>;
  let cacheManager: any;

  const mockGitHubClient = {
    executeGraphQL: jest.fn(),
  };

  const mockGitHubLogger = {
    startOperation: jest.fn().mockReturnValue({
      endOperation: jest.fn(),
    }),
  };

  const mockCacheManager = {
    get: jest.fn(),
    set: jest.fn(),
    reset: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ProjectsService,
        {
          provide: GitHubClientService,
          useValue: mockGitHubClient,
        },
        {
          provide: GitHubLoggerService,
          useValue: mockGitHubLogger,
        },
        {
          provide: CACHE_MANAGER,
          useValue: mockCacheManager,
        },
      ],
    }).compile();

    service = module.get<ProjectsService>(ProjectsService);
    githubClient = module.get(GitHubClientService);
    githubLogger = module.get(GitHubLoggerService);
    cacheManager = module.get(CACHE_MANAGER);

    jest.clearAllMocks();
  });

  describe('listRepoProjects', () => {
    const owner = 'anthropics';
    const repo = 'claude-projects';
    const token = 'ghp_test_token';
    const mockProjects = [
      {
        id: 'PVT_1',
        number: 1,
        title: 'Project 1',
        url: 'https://github.com/orgs/anthropics/projects/1',
        closed: false,
        public: true,
        createdAt: '2026-01-01T00:00:00Z',
        updatedAt: '2026-01-24T00:00:00Z',
      },
    ];

    it('AC-2.1.a: should return repo-linked projects with correct schema', async () => {
      mockCacheManager.get.mockResolvedValue(null);
      mockGitHubClient.executeGraphQL.mockResolvedValue({
        success: true,
        data: {
          repository: {
            id: 'REPO_1',
            projectsV2: {
              totalCount: 1,
              nodes: mockProjects,
              pageInfo: {
                hasNextPage: false,
                endCursor: null,
              },
            },
          },
        },
      });

      const result = await service.listRepoProjects(owner, repo, token);

      expect(result).toEqual({
        projects: mockProjects,
        repositoryId: 'REPO_1',
        totalCount: 1,
        hasNextPage: false,
        endCursor: null,
      });
      expect(githubClient.executeGraphQL).toHaveBeenCalledWith({
        query: expect.stringContaining('repository(owner: $owner, name: $repo)'),
        variables: { owner, repo },
      });
    });

    it('AC-2.1.f: should cache results for 5 minutes', async () => {
      mockCacheManager.get.mockResolvedValue(null);
      mockGitHubClient.executeGraphQL.mockResolvedValue({
        success: true,
        data: {
          repository: {
            id: 'REPO_1',
            projectsV2: {
              totalCount: 1,
              nodes: mockProjects,
              pageInfo: { hasNextPage: false, endCursor: null },
            },
          },
        },
      });

      await service.listRepoProjects(owner, repo, token);

      expect(cacheManager.set).toHaveBeenCalledWith(
        expect.stringContaining(`projects:repo:${owner}:${repo}`),
        expect.any(Object),
        300000, // 5 minutes in milliseconds
      );
    });

    it('should return cached data when available', async () => {
      const cachedData = {
        projects: mockProjects,
        repositoryId: 'REPO_1',
        totalCount: 1,
      };
      mockCacheManager.get.mockResolvedValue(cachedData);

      const result = await service.listRepoProjects(owner, repo, token);

      expect(result).toEqual(cachedData);
      expect(githubClient.executeGraphQL).not.toHaveBeenCalled();
    });

    it('AC-2.1.d: should throw 401 when token is missing', async () => {
      await expect(service.listRepoProjects(owner, repo, '')).rejects.toThrow(
        GitHubAuthException,
      );
    });

    it('AC-2.1.e: should throw 403 for OAuth restrictions', async () => {
      mockCacheManager.get.mockResolvedValue(null);
      mockGitHubClient.executeGraphQL.mockResolvedValue({
        success: true,
        data: {
          errors: [
            {
              type: 'FORBIDDEN',
              message: 'OAuth App access restrictions',
            },
          ],
        },
      });

      await expect(service.listRepoProjects(owner, repo, token)).rejects.toThrow(
        GitHubAuthException,
      );
    });

    it('should throw 404 when repository not found', async () => {
      mockCacheManager.get.mockResolvedValue(null);
      mockGitHubClient.executeGraphQL.mockResolvedValue({
        success: true,
        data: {
          repository: null,
        },
      });

      await expect(service.listRepoProjects(owner, repo, token)).rejects.toThrow(
        GitHubValidationException,
      );
    });
  });

  describe('createProject', () => {
    const dto: CreateProjectDto = {
      owner: 'anthropics',
      title: 'New Project',
      body: 'Project description',
    };
    const token = 'ghp_test_token';

    it('AC-2.1.b: should create project and return within 3 seconds', async () => {
      const startTime = Date.now();

      mockGitHubClient.executeGraphQL
        .mockResolvedValueOnce({
          success: true,
          data: {
            repositoryOwner: {
              id: 'OWNER_1',
            },
          },
        })
        .mockResolvedValueOnce({
          success: true,
          data: {
            createProjectV2: {
              projectV2: {
                id: 'PVT_1',
                number: 1,
                title: dto.title,
                url: 'https://github.com/orgs/anthropics/projects/1',
                closed: false,
                public: false,
                createdAt: '2026-01-24T00:00:00Z',
                updatedAt: '2026-01-24T00:00:00Z',
              },
            },
          },
        });

      const result = await service.createProject(dto, token);
      const duration = Date.now() - startTime;

      expect(duration).toBeLessThan(3000);
      expect(result.project).toMatchObject({
        id: 'PVT_1',
        number: 1,
        title: dto.title,
      });
      expect(cacheManager.reset).toHaveBeenCalled();
    });

    it('should throw 404 when owner not found', async () => {
      mockGitHubClient.executeGraphQL.mockResolvedValue({
        success: true,
        data: {
          repositoryOwner: null,
        },
      });

      await expect(service.createProject(dto, token)).rejects.toThrow(
        GitHubValidationException,
      );
    });
  });

  describe('linkProject', () => {
    const projectId = 'PVT_1';
    const dto: LinkProjectDto = {
      repositoryId: 'REPO_1',
    };
    const token = 'ghp_test_token';

    it('AC-2.1.c: should link project to repo via GraphQL', async () => {
      mockGitHubClient.executeGraphQL.mockResolvedValue({
        success: true,
        data: {
          linkProjectV2ToRepository: {
            repository: {
              id: 'REPO_1',
              name: 'claude-projects',
              owner: {
                login: 'anthropics',
              },
            },
            projectV2: {
              id: 'PVT_1',
              number: 1,
            },
          },
        },
      });

      const result = await service.linkProject(projectId, dto, token);

      expect(result).toEqual({
        success: true,
        project: {
          id: 'PVT_1',
          number: 1,
        },
        repository: {
          id: 'REPO_1',
          name: 'claude-projects',
          owner: 'anthropics',
        },
      });
      expect(githubClient.executeGraphQL).toHaveBeenCalledWith({
        query: expect.stringContaining('linkProjectV2ToRepository'),
        variables: {
          projectId,
          repositoryId: dto.repositoryId,
        },
      });
      expect(cacheManager.reset).toHaveBeenCalled();
    });

    it('should throw validation error when link fails', async () => {
      mockGitHubClient.executeGraphQL.mockResolvedValue({
        success: true,
        data: {
          linkProjectV2ToRepository: null,
        },
      });

      await expect(service.linkProject(projectId, dto, token)).rejects.toThrow(
        GitHubValidationException,
      );
    });
  });

  describe('updateProject', () => {
    const projectId = 'PVT_1';
    const dto: UpdateProjectDto = {
      title: 'Updated Title',
      closed: true,
    };
    const token = 'ghp_test_token';

    it('should update project successfully', async () => {
      mockGitHubClient.executeGraphQL.mockResolvedValue({
        success: true,
        data: {
          updateProjectV2: {
            projectV2: {
              id: 'PVT_1',
              number: 1,
              title: dto.title,
              url: 'https://github.com/orgs/anthropics/projects/1',
              closed: true,
              public: false,
              createdAt: '2026-01-01T00:00:00Z',
              updatedAt: '2026-01-24T00:00:00Z',
            },
          },
        },
      });

      const result = await service.updateProject(projectId, dto, token);

      expect(result.project).toMatchObject({
        id: 'PVT_1',
        title: dto.title,
        closed: true,
      });
      expect(cacheManager.reset).toHaveBeenCalled();
    });
  });
});
