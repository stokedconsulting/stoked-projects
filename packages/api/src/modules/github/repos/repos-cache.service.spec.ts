import { Test, TestingModule } from '@nestjs/testing';
import { ReposCacheService } from './repos-cache.service';

describe('ReposCacheService', () => {
  let service: ReposCacheService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [ReposCacheService],
    }).compile();

    service = module.get<ReposCacheService>(ReposCacheService);
  });

  afterEach(() => {
    service.clearAll();
  });

  describe('Repository Caching', () => {
    it('should cache and retrieve repository metadata', () => {
      const owner = 'octocat';
      const repo = 'hello-world';
      const data = {
        id: 'R_123',
        name: repo,
        owner,
        url: `https://github.com/${owner}/${repo}`,
        defaultBranch: 'main',
        isPrivate: false,
      };

      service.setRepository(owner, repo, false, data);
      const retrieved = service.getRepository(owner, repo, false);

      expect(retrieved).toEqual(data);
    });

    it('should differentiate between cached entries with and without projects', () => {
      const owner = 'octocat';
      const repo = 'hello-world';
      const dataWithoutProjects = { id: 'R_123', name: repo };
      const dataWithProjects = { id: 'R_123', name: repo, projects: [] };

      service.setRepository(owner, repo, false, dataWithoutProjects);
      service.setRepository(owner, repo, true, dataWithProjects);

      expect(service.getRepository(owner, repo, false)).toEqual(dataWithoutProjects);
      expect(service.getRepository(owner, repo, true)).toEqual(dataWithProjects);
    });

    it('should return null for non-existent repository', () => {
      const retrieved = service.getRepository('nonexistent', 'repo', false);
      expect(retrieved).toBeNull();
    });

    it('should expire repository cache after TTL', async () => {
      const owner = 'octocat';
      const repo = 'hello-world';
      const data = { id: 'R_123', name: repo };

      // Override TTL to 100ms for testing
      (service as any).REPO_CACHE_TTL = 100;

      service.setRepository(owner, repo, false, data);

      // Should be cached
      expect(service.getRepository(owner, repo, false)).toEqual(data);

      // Wait for expiration
      await new Promise((resolve) => setTimeout(resolve, 150));

      // Should be expired
      expect(service.getRepository(owner, repo, false)).toBeNull();
    });

    it('should invalidate all repository cache entries', () => {
      const owner = 'octocat';
      const repo = 'hello-world';

      service.setRepository(owner, repo, false, { id: 'R_123' });
      service.setRepository(owner, repo, true, { id: 'R_123', projects: [] });
      service.setLinkedProjects(owner, repo, { repositoryId: 'R_123', projects: [] });

      service.invalidateRepository(owner, repo);

      expect(service.getRepository(owner, repo, false)).toBeNull();
      expect(service.getRepository(owner, repo, true)).toBeNull();
      expect(service.getLinkedProjects(owner, repo)).toBeNull();
    });
  });

  describe('Organization Caching', () => {
    it('should cache and retrieve organization metadata', () => {
      const owner = 'github';
      const data = {
        id: 'O_123',
        login: owner,
        url: `https://github.com/${owner}`,
        projectsV2Count: 42,
      };

      service.setOrganization(owner, data);
      const retrieved = service.getOrganization(owner);

      expect(retrieved).toEqual(data);
    });

    it('should return null for non-existent organization', () => {
      const retrieved = service.getOrganization('nonexistent');
      expect(retrieved).toBeNull();
    });

    it('should expire organization cache after TTL', async () => {
      const owner = 'github';
      const data = { id: 'O_123', login: owner };

      // Override TTL to 100ms for testing
      (service as any).ORG_CACHE_TTL = 100;

      service.setOrganization(owner, data);

      // Should be cached
      expect(service.getOrganization(owner)).toEqual(data);

      // Wait for expiration
      await new Promise((resolve) => setTimeout(resolve, 150));

      // Should be expired
      expect(service.getOrganization(owner)).toBeNull();
    });

    it('should invalidate organization cache', () => {
      const owner = 'github';
      service.setOrganization(owner, { id: 'O_123' });

      service.invalidateOrganization(owner);

      expect(service.getOrganization(owner)).toBeNull();
    });
  });

  describe('Linked Projects Caching', () => {
    it('should cache and retrieve linked projects', () => {
      const owner = 'octocat';
      const repo = 'hello-world';
      const data = {
        repositoryId: 'R_123',
        projects: [
          { id: 'P_1', title: 'Project 1', url: 'https://github.com/...', number: 1 },
        ],
      };

      service.setLinkedProjects(owner, repo, data);
      const retrieved = service.getLinkedProjects(owner, repo);

      expect(retrieved).toEqual(data);
    });

    it('should return null for non-existent linked projects', () => {
      const retrieved = service.getLinkedProjects('nonexistent', 'repo');
      expect(retrieved).toBeNull();
    });
  });

  describe('Cache Management', () => {
    it('should clear all cache entries', () => {
      service.setRepository('owner1', 'repo1', false, { id: 'R_1' });
      service.setOrganization('org1', { id: 'O_1' });
      service.setLinkedProjects('owner2', 'repo2', { repositoryId: 'R_2', projects: [] });

      const statsBefore = service.getStats();
      expect(statsBefore.size).toBeGreaterThan(0);

      service.clearAll();

      const statsAfter = service.getStats();
      expect(statsAfter.size).toBe(0);
      expect(statsAfter.keys).toEqual([]);
    });

    it('should return cache statistics', () => {
      service.setRepository('owner1', 'repo1', false, { id: 'R_1' });
      service.setOrganization('org1', { id: 'O_1' });

      const stats = service.getStats();

      expect(stats.size).toBe(2);
      expect(stats.keys).toContain('repo:owner1:repo1:projects=false');
      expect(stats.keys).toContain('org:org1');
    });
  });
});
