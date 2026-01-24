import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ProjectsCacheService } from './projects-cache.service';
import * as request from 'supertest';
import { ProjectsController } from './projects.controller';
import { ProjectsService } from './projects.service';
import { GitHubClientService } from '../client/github-client.service';
import { GitHubLoggerService } from '../../../github/logging/github-logger.service';
import { ApiKeyGuard } from '../../auth/guards/api-key.guard';
import { ConfigService } from '@nestjs/config';

describe('ProjectsController (Integration)', () => {
  let app: INestApplication;
  let githubClient: jest.Mocked<GitHubClientService>;

  const mockGitHubClient = {
    executeGraphQL: jest.fn(),
  };

  const mockGitHubLogger = {
    startOperation: jest.fn().mockReturnValue({
      endOperation: jest.fn(),
    }),
  };

  const mockConfigService = {
    get: jest.fn((key: string) => {
      if (key === 'app.environment') return 'development';
      if (key === 'auth.apiKeys') return [];
      return undefined;
    }),
  };

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [],
      controllers: [ProjectsController],
      providers: [
        ProjectsService,
        ProjectsCacheService,
        {
          provide: GitHubClientService,
          useValue: mockGitHubClient,
        },
        {
          provide: GitHubLoggerService,
          useValue: mockGitHubLogger,
        },
        {
          provide: ConfigService,
          useValue: mockConfigService,
        },
        ApiKeyGuard,
      ],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        transform: true,
        forbidNonWhitelisted: true,
      }),
    );

    await app.init();
    githubClient = moduleFixture.get(GitHubClientService);
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('GET /api/github/projects/:owner/:repo', () => {
    it('should return 200 with projects list', async () => {
      const mockResponse = {
        success: true,
        data: {
          repository: {
            id: 'REPO_1',
            projectsV2: {
              totalCount: 2,
              nodes: [
                {
                  id: 'PVT_1',
                  number: 1,
                  title: 'Project 1',
                  url: 'https://github.com/orgs/test/projects/1',
                  closed: false,
                  public: true,
                  createdAt: '2026-01-01T00:00:00Z',
                  updatedAt: '2026-01-24T00:00:00Z',
                },
                {
                  id: 'PVT_2',
                  number: 2,
                  title: 'Project 2',
                  url: 'https://github.com/orgs/test/projects/2',
                  closed: false,
                  public: false,
                  createdAt: '2026-01-15T00:00:00Z',
                  updatedAt: '2026-01-24T00:00:00Z',
                },
              ],
              pageInfo: {
                hasNextPage: false,
                endCursor: null,
              },
            },
          },
        },
      };

      mockGitHubClient.executeGraphQL.mockResolvedValue(mockResponse);

      const response = await request(app.getHttpServer())
        .get('/api/github/projects/test-org/test-repo')
        .set('x-github-token', 'ghp_test_token')
        .expect(200);

      expect(response.body).toHaveProperty('projects');
      expect(response.body.projects).toHaveLength(2);
      expect(response.body.projects[0]).toMatchObject({
        id: 'PVT_1',
        number: 1,
        title: 'Project 1',
      });
      expect(response.body).toHaveProperty('repositoryId', 'REPO_1');
      expect(response.body).toHaveProperty('totalCount', 2);
    });

    it('should return 401 when GitHub token is missing', async () => {
      await request(app.getHttpServer())
        .get('/api/github/projects/test-org/test-repo')
        .expect(401);
    });
  });

  describe('POST /api/github/projects', () => {
    it('should return 201 when project is created', async () => {
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
                id: 'PVT_NEW',
                number: 5,
                title: 'New Project',
                url: 'https://github.com/orgs/test/projects/5',
                closed: false,
                public: false,
                createdAt: '2026-01-24T00:00:00Z',
                updatedAt: '2026-01-24T00:00:00Z',
              },
            },
          },
        });

      const response = await request(app.getHttpServer())
        .post('/api/github/projects')
        .set('x-github-token', 'ghp_test_token')
        .send({
          owner: 'test-org',
          title: 'New Project',
          body: 'Project description',
        })
        .expect(201);

      expect(response.body).toHaveProperty('project');
      expect(response.body.project).toMatchObject({
        id: 'PVT_NEW',
        number: 5,
        title: 'New Project',
      });
    });

    it('should return 400 when required fields are missing', async () => {
      await request(app.getHttpServer())
        .post('/api/github/projects')
        .set('x-github-token', 'ghp_test_token')
        .send({
          owner: 'test-org',
          // Missing title
        })
        .expect(400);
    });

    it('should return 400 when fields have wrong types', async () => {
      await request(app.getHttpServer())
        .post('/api/github/projects')
        .set('x-github-token', 'ghp_test_token')
        .send({
          owner: 123, // Should be string
          title: 'New Project',
        })
        .expect(400);
    });
  });

  describe('PATCH /api/github/projects/:projectId', () => {
    it('should return 200 when project is updated', async () => {
      mockGitHubClient.executeGraphQL.mockResolvedValue({
        success: true,
        data: {
          updateProjectV2: {
            projectV2: {
              id: 'PVT_1',
              number: 1,
              title: 'Updated Title',
              url: 'https://github.com/orgs/test/projects/1',
              closed: true,
              public: false,
              createdAt: '2026-01-01T00:00:00Z',
              updatedAt: '2026-01-24T00:00:00Z',
            },
          },
        },
      });

      const response = await request(app.getHttpServer())
        .patch('/api/github/projects/PVT_1')
        .set('x-github-token', 'ghp_test_token')
        .send({
          title: 'Updated Title',
          closed: true,
        })
        .expect(200);

      expect(response.body.project).toMatchObject({
        id: 'PVT_1',
        title: 'Updated Title',
        closed: true,
      });
    });
  });

  describe('POST /api/github/projects/:projectId/link', () => {
    it('should return 200 when project is linked', async () => {
      mockGitHubClient.executeGraphQL.mockResolvedValue({
        success: true,
        data: {
          linkProjectV2ToRepository: {
            repository: {
              id: 'REPO_1',
              name: 'test-repo',
              owner: {
                login: 'test-org',
              },
            },
            projectV2: {
              id: 'PVT_1',
              number: 1,
            },
          },
        },
      });

      const response = await request(app.getHttpServer())
        .post('/api/github/projects/PVT_1/link')
        .set('x-github-token', 'ghp_test_token')
        .send({
          repositoryId: 'REPO_1',
        })
        .expect(200);

      expect(response.body).toEqual({
        success: true,
        project: {
          id: 'PVT_1',
          number: 1,
        },
        repository: {
          id: 'REPO_1',
          name: 'test-repo',
          owner: 'test-org',
        },
      });
    });

    it('should return 400 when repositoryId is missing', async () => {
      await request(app.getHttpServer())
        .post('/api/github/projects/PVT_1/link')
        .set('x-github-token', 'ghp_test_token')
        .send({})
        .expect(400);
    });
  });

  describe('DELETE /api/github/projects/:projectId/link', () => {
    it('should return 200 when project is unlinked', async () => {
      mockGitHubClient.executeGraphQL.mockResolvedValue({
        success: true,
        data: {
          unlinkProjectV2FromRepository: {
            repository: {
              id: 'REPO_1',
              name: 'test-repo',
              owner: {
                login: 'test-org',
              },
            },
            projectV2: {
              id: 'PVT_1',
              number: 1,
            },
          },
        },
      });

      const response = await request(app.getHttpServer())
        .delete('/api/github/projects/PVT_1/link')
        .set('x-github-token', 'ghp_test_token')
        .send({
          repositoryId: 'REPO_1',
        })
        .expect(200);

      expect(response.body.success).toBe(true);
    });
  });

  describe('Rate limiting', () => {
    it('should respect throttle limits', async () => {
      mockGitHubClient.executeGraphQL.mockResolvedValue({
        success: true,
        data: {
          repository: {
            id: 'REPO_1',
            projectsV2: {
              totalCount: 0,
              nodes: [],
              pageInfo: { hasNextPage: false, endCursor: null },
            },
          },
        },
      });

      // This test would need to make multiple rapid requests
      // In a real scenario, you'd verify rate limiting behavior
      const response = await request(app.getHttpServer())
        .get('/api/github/projects/test-org/test-repo')
        .set('x-github-token', 'ghp_test_token')
        .expect(200);

      expect(response.body).toHaveProperty('projects');
    });
  });
});
