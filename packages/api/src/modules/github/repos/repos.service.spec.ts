import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException, ForbiddenException } from '@nestjs/common';
import { ReposService } from './repos.service';
import { GitHubClientService } from '../client/github-client.service';
import { ReposCacheService } from './repos-cache.service';
import { AppLoggerService } from '../../../common/logging/app-logger.service';
import { GitHubErrorCode, GitHubOperationType } from '../client/github-client.types';

// Mock @octokit/graphql
jest.mock('@octokit/graphql', () => ({
  graphql: {
    defaults: jest.fn(() => jest.fn()),
  },
}));

// Mock @octokit/rest
jest.mock('@octokit/rest', () => ({
  Octokit: jest.fn().mockImplementation(() => ({
    request: jest.fn(),
    rateLimit: {
      get: jest.fn(),
    },
  })),
}));

describe('ReposService', () => {
  let service: ReposService;
  let githubClient: jest.Mocked<GitHubClientService>;
  let cacheService: jest.Mocked<ReposCacheService>;
  let logger: jest.Mocked<AppLoggerService>;

  beforeEach(async () => {
    const mockGitHubClient = {
      executeGraphQL: jest.fn(),
    };

    const mockCacheService = {
      getRepository: jest.fn(),
      setRepository: jest.fn(),
      getOrganization: jest.fn(),
      setOrganization: jest.fn(),
      getLinkedProjects: jest.fn(),
      setLinkedProjects: jest.fn(),
    };

    const mockLogger = {
      setContext: jest.fn(),
      log: jest.fn(),
      error: jest.fn(),
      warn: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ReposService,
        { provide: GitHubClientService, useValue: mockGitHubClient },
        { provide: ReposCacheService, useValue: mockCacheService },
        { provide: AppLoggerService, useValue: mockLogger },
      ],
    }).compile();

    service = module.get<ReposService>(ReposService);
    githubClient = module.get(GitHubClientService);
    cacheService = module.get(ReposCacheService);
    logger = module.get(AppLoggerService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('getRepositoryMetadata', () => {
    const owner = 'octocat';
    const repo = 'hello-world';

    it('should return cached repository metadata if available', async () => {
      const cachedData = {
        id: 'R_123',
        name: repo,
        owner,
        url: `https://github.com/${owner}/${repo}`,
        defaultBranch: 'main',
        isPrivate: false,
      };

      cacheService.getRepository.mockReturnValue(cachedData);

      const result = await service.getRepositoryMetadata(owner, repo, false);

      expect(result).toEqual(cachedData);
      expect(cacheService.getRepository).toHaveBeenCalledWith(owner, repo, false);
      expect(githubClient.executeGraphQL).not.toHaveBeenCalled();
    });

    it('should fetch repository metadata from GitHub if not cached', async () => {
      cacheService.getRepository.mockReturnValue(null);

      const githubResponse = {
        repository: {
          id: 'R_123',
          name: repo,
          owner: { login: owner },
          description: 'A test repo',
          url: `https://github.com/${owner}/${repo}`,
          defaultBranchRef: { name: 'main' },
          isPrivate: false,
        },
      };

      githubClient.executeGraphQL.mockResolvedValue({
        success: true,
        data: githubResponse,
        metadata: { operation: GitHubOperationType.GRAPHQL, duration: 100 },
      });

      const result = await service.getRepositoryMetadata(owner, repo, false);

      expect(result).toMatchObject({
        id: 'R_123',
        name: repo,
        owner,
        description: 'A test repo',
        url: `https://github.com/${owner}/${repo}`,
        defaultBranch: 'main',
        isPrivate: false,
      });
      expect(cacheService.setRepository).toHaveBeenCalled();
    });

    it('should include projects when includeProjects is true', async () => {
      cacheService.getRepository.mockReturnValue(null);

      const githubResponse = {
        repository: {
          id: 'R_123',
          name: repo,
          owner: { login: owner },
          url: `https://github.com/${owner}/${repo}`,
          defaultBranchRef: { name: 'main' },
          isPrivate: false,
          projectsV2: {
            nodes: [
              { id: 'P_1', title: 'Project 1', url: 'https://github.com/...', number: 1 },
            ],
          },
        },
      };

      githubClient.executeGraphQL.mockResolvedValue({
        success: true,
        data: githubResponse,
        metadata: { operation: GitHubOperationType.GRAPHQL, duration: 100 },
      });

      const result = await service.getRepositoryMetadata(owner, repo, true);

      expect(result.projects).toBeDefined();
      expect(result.projects).toHaveLength(1);
      expect(result.projects![0]).toMatchObject({
        id: 'P_1',
        title: 'Project 1',
        number: 1,
      });
    });

    it('should throw NotFoundException if repository not found', async () => {
      cacheService.getRepository.mockReturnValue(null);

      githubClient.executeGraphQL.mockResolvedValue({
        success: true,
        data: { repository: null },
        metadata: { operation: GitHubOperationType.GRAPHQL, duration: 100 },
      });

      await expect(service.getRepositoryMetadata(owner, repo, false)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should throw NotFoundException for invalid owner name', async () => {
      await expect(
        service.getRepositoryMetadata('-invalid', repo, false),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw NotFoundException for invalid repo name', async () => {
      await expect(
        service.getRepositoryMetadata(owner, '-invalid', false),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw ForbiddenException for OAuth restrictions', async () => {
      cacheService.getRepository.mockReturnValue(null);

      githubClient.executeGraphQL.mockResolvedValue({
        success: false,
        error: {
          code: GitHubErrorCode.UNKNOWN_ERROR,
          message: 'GraphQL error',
          retryable: false,
          originalError: {
            errors: [{ message: 'SAML enforcement enabled' }],
          },
        },
        metadata: { operation: GitHubOperationType.GRAPHQL, duration: 100 },
      });

      await expect(service.getRepositoryMetadata(owner, repo, false)).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('should return 404 for private repo without access', async () => {
      cacheService.getRepository.mockReturnValue(null);

      githubClient.executeGraphQL.mockResolvedValue({
        success: false,
        error: {
          code: GitHubErrorCode.UNKNOWN_ERROR,
          message: 'Not found',
          retryable: false,
          originalError: {
            errors: [{ type: 'NOT_FOUND' }],
          },
        },
        metadata: { operation: GitHubOperationType.GRAPHQL, duration: 100 },
      });

      await expect(service.getRepositoryMetadata(owner, repo, false)).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('getOrganizationMetadata', () => {
    const owner = 'github';

    it('should return cached organization metadata if available', async () => {
      const cachedData = {
        id: 'O_123',
        login: owner,
        url: `https://github.com/${owner}`,
        projectsV2Count: 42,
      };

      cacheService.getOrganization.mockReturnValue(cachedData);

      const result = await service.getOrganizationMetadata(owner);

      expect(result).toEqual(cachedData);
      expect(cacheService.getOrganization).toHaveBeenCalledWith(owner);
      expect(githubClient.executeGraphQL).not.toHaveBeenCalled();
    });

    it('should fetch organization metadata from GitHub if not cached', async () => {
      cacheService.getOrganization.mockReturnValue(null);

      const githubResponse = {
        organization: {
          id: 'O_123',
          login: owner,
          name: 'GitHub Inc.',
          description: 'Where software is built',
          url: `https://github.com/${owner}`,
          projectsV2: { totalCount: 42 },
        },
      };

      githubClient.executeGraphQL.mockResolvedValue({
        success: true,
        data: githubResponse,
        metadata: { operation: GitHubOperationType.GRAPHQL, duration: 100 },
      });

      const result = await service.getOrganizationMetadata(owner);

      expect(result).toMatchObject({
        id: 'O_123',
        login: owner,
        name: 'GitHub Inc.',
        description: 'Where software is built',
        url: `https://github.com/${owner}`,
        projectsV2Count: 42,
      });
      expect(cacheService.setOrganization).toHaveBeenCalled();
    });

    it('should throw NotFoundException if organization not found', async () => {
      cacheService.getOrganization.mockReturnValue(null);

      githubClient.executeGraphQL.mockResolvedValue({
        success: true,
        data: { organization: null },
        metadata: { operation: GitHubOperationType.GRAPHQL, duration: 100 },
      });

      await expect(service.getOrganizationMetadata(owner)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should throw NotFoundException for invalid owner name', async () => {
      await expect(service.getOrganizationMetadata('-invalid')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('getLinkedProjects', () => {
    const owner = 'octocat';
    const repo = 'hello-world';

    it('should return cached linked projects if available', async () => {
      const cachedData = {
        repositoryId: 'R_123',
        projects: [
          { id: 'P_1', title: 'Project 1', url: 'https://github.com/...', number: 1 },
        ],
      };

      cacheService.getLinkedProjects.mockReturnValue(cachedData);

      const result = await service.getLinkedProjects(owner, repo);

      expect(result).toEqual(cachedData);
      expect(cacheService.getLinkedProjects).toHaveBeenCalledWith(owner, repo);
      expect(githubClient.executeGraphQL).not.toHaveBeenCalled();
    });

    it('should fetch linked projects from GitHub if not cached', async () => {
      cacheService.getLinkedProjects.mockReturnValue(null);

      const githubResponse = {
        repository: {
          id: 'R_123',
          projectsV2: {
            nodes: [
              { id: 'P_1', title: 'Project 1', url: 'https://github.com/...', number: 1 },
              { id: 'P_2', title: 'Project 2', url: 'https://github.com/...', number: 2 },
            ],
          },
        },
      };

      githubClient.executeGraphQL.mockResolvedValue({
        success: true,
        data: githubResponse,
        metadata: { operation: GitHubOperationType.GRAPHQL, duration: 100 },
      });

      const result = await service.getLinkedProjects(owner, repo);

      expect(result).toMatchObject({
        repositoryId: 'R_123',
        projects: expect.arrayContaining([
          expect.objectContaining({ id: 'P_1', title: 'Project 1', number: 1 }),
          expect.objectContaining({ id: 'P_2', title: 'Project 2', number: 2 }),
        ]),
      });
      expect(cacheService.setLinkedProjects).toHaveBeenCalled();
    });

    it('should throw NotFoundException if repository not found', async () => {
      cacheService.getLinkedProjects.mockReturnValue(null);

      githubClient.executeGraphQL.mockResolvedValue({
        success: true,
        data: { repository: null },
        metadata: { operation: GitHubOperationType.GRAPHQL, duration: 100 },
      });

      await expect(service.getLinkedProjects(owner, repo)).rejects.toThrow(
        NotFoundException,
      );
    });
  });
});
