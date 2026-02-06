import { Test, TestingModule } from '@nestjs/testing';
import { ReposController } from './repos.controller';
import { ReposService } from './repos.service';
import { NotFoundException } from '@nestjs/common';

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

describe('ReposController', () => {
  let controller: ReposController;
  let service: jest.Mocked<ReposService>;

  beforeEach(async () => {
    const mockReposService = {
      getRepositoryMetadata: jest.fn(),
      getOrganizationMetadata: jest.fn(),
      getLinkedProjects: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [ReposController],
      providers: [{ provide: ReposService, useValue: mockReposService }],
    })
      .overrideGuard(require('../../auth/guards/api-key.guard').ApiKeyGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get<ReposController>(ReposController);
    service = module.get(ReposService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('getRepository', () => {
    it('should call service with correct parameters when include_projects is false', async () => {
      const owner = 'octocat';
      const repo = 'hello-world';
      const expectedResult = {
        id: 'R_123',
        name: repo,
        owner,
        url: `https://github.com/${owner}/${repo}`,
        defaultBranch: 'main',
        isPrivate: false,
      };

      service.getRepositoryMetadata.mockResolvedValue(expectedResult);

      const result = await controller.getRepository(owner, repo, {});

      expect(service.getRepositoryMetadata).toHaveBeenCalledWith(owner, repo, false);
      expect(result).toEqual(expectedResult);
    });

    it('should call service with correct parameters when include_projects is true', async () => {
      const owner = 'octocat';
      const repo = 'hello-world';
      const expectedResult = {
        id: 'R_123',
        name: repo,
        owner,
        url: `https://github.com/${owner}/${repo}`,
        defaultBranch: 'main',
        isPrivate: false,
        projects: [
          { id: 'P_1', title: 'Project 1', url: 'https://github.com/...', number: 1 },
        ],
      };

      service.getRepositoryMetadata.mockResolvedValue(expectedResult);

      const result = await controller.getRepository(owner, repo, { include_projects: 'true' });

      expect(service.getRepositoryMetadata).toHaveBeenCalledWith(owner, repo, true);
      expect(result).toEqual(expectedResult);
    });

    it('should handle include_projects parameter with various values', async () => {
      const owner = 'octocat';
      const repo = 'hello-world';

      // Test with 'false'
      await controller.getRepository(owner, repo, { include_projects: 'false' });
      expect(service.getRepositoryMetadata).toHaveBeenCalledWith(owner, repo, false);

      // Test with undefined
      await controller.getRepository(owner, repo, {});
      expect(service.getRepositoryMetadata).toHaveBeenCalledWith(owner, repo, false);

      // Test with 'true'
      await controller.getRepository(owner, repo, { include_projects: 'true' });
      expect(service.getRepositoryMetadata).toHaveBeenCalledWith(owner, repo, true);
    });

    it('should propagate exceptions from service', async () => {
      const owner = 'octocat';
      const repo = 'nonexistent';

      service.getRepositoryMetadata.mockRejectedValue(
        new NotFoundException({
          code: 'REPOSITORY_NOT_FOUND',
          message: `Repository ${owner}/${repo} not found`,
        }),
      );

      await expect(controller.getRepository(owner, repo, {})).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('getOrganization', () => {
    it('should call service with correct parameters', async () => {
      const owner = 'github';
      const expectedResult = {
        id: 'O_123',
        login: owner,
        url: `https://github.com/${owner}`,
        projectsV2Count: 42,
      };

      service.getOrganizationMetadata.mockResolvedValue(expectedResult);

      const result = await controller.getOrganization(owner);

      expect(service.getOrganizationMetadata).toHaveBeenCalledWith(owner);
      expect(result).toEqual(expectedResult);
    });

    it('should propagate exceptions from service', async () => {
      const owner = 'nonexistent';

      service.getOrganizationMetadata.mockRejectedValue(
        new NotFoundException({
          code: 'ORGANIZATION_NOT_FOUND',
          message: `Organization ${owner} not found`,
        }),
      );

      await expect(controller.getOrganization(owner)).rejects.toThrow(NotFoundException);
    });
  });

  describe('getLinkedProjects', () => {
    it('should call service with correct parameters', async () => {
      const owner = 'octocat';
      const repo = 'hello-world';
      const expectedResult = {
        repositoryId: 'R_123',
        projects: [
          { id: 'P_1', title: 'Project 1', url: 'https://github.com/...', number: 1 },
        ],
      };

      service.getLinkedProjects.mockResolvedValue(expectedResult);

      const result = await controller.getLinkedProjects(owner, repo);

      expect(service.getLinkedProjects).toHaveBeenCalledWith(owner, repo);
      expect(result).toEqual(expectedResult);
    });

    it('should propagate exceptions from service', async () => {
      const owner = 'octocat';
      const repo = 'nonexistent';

      service.getLinkedProjects.mockRejectedValue(
        new NotFoundException({
          code: 'REPOSITORY_NOT_FOUND',
          message: `Repository ${owner}/${repo} not found`,
        }),
      );

      await expect(controller.getLinkedProjects(owner, repo)).rejects.toThrow(
        NotFoundException,
      );
    });
  });
});
