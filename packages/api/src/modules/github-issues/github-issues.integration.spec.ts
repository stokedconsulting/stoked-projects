import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { GitHubIssuesModule } from './github-issues.module';
import { GitHubModule } from '../github/github.module';
import { GitHubClientService } from '../github/client/github-client.service';

/**
 * Integration Tests for GitHub Issues Module
 *
 * These tests verify end-to-end functionality with mocked GitHub API
 */
describe('GitHubIssuesModule (Integration)', () => {
  let app: INestApplication;
  let githubClient: GitHubClientService;

  const mockIssueData = {
    id: 'I_kwDOABCDEF01234567',
    number: 42,
    title: 'Integration Test Issue',
    body: 'Test body',
    state: 'OPEN',
    url: 'https://github.com/octocat/hello-world/issues/42',
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-01-01T00:00:00Z',
    author: { login: 'octocat' },
    labels: { nodes: [] },
    assignees: { nodes: [] },
  };

  beforeAll(async () => {
    const module: TestingModule = await Test.createTestingModule({
      imports: [
        GitHubModule.forRoot({
          token: 'test_token_123',
        }),
        GitHubIssuesModule,
      ],
    }).compile();

    app = module.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ transform: true }));
    await app.init();

    githubClient = module.get<GitHubClientService>(GitHubClientService);
  });

  afterAll(async () => {
    await app.close();
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('GET /api/github/issues/:owner/:repo', () => {
    it('should list issues with default filters', async () => {
      jest.spyOn(githubClient, 'executeGraphQL').mockResolvedValueOnce({
        success: true,
        data: {
          repository: {
            issues: {
              nodes: [mockIssueData],
            },
          },
        },
      });

      const response = await request(app.getHttpServer())
        .get('/api/github/issues/octocat/hello-world')
        .expect(200);

      expect(response.body).toHaveLength(1);
      expect(response.body[0].number).toBe(42);
    });

    it('should apply state filter', async () => {
      jest.spyOn(githubClient, 'executeGraphQL').mockResolvedValueOnce({
        success: true,
        data: {
          repository: {
            issues: {
              nodes: [{ ...mockIssueData, state: 'CLOSED', closedAt: '2024-01-02T00:00:00Z' }],
            },
          },
        },
      });

      const response = await request(app.getHttpServer())
        .get('/api/github/issues/octocat/hello-world?state=closed')
        .expect(200);

      expect(response.body).toHaveLength(1);
      expect(response.body[0].state).toBe('CLOSED');
    });

    it('should cache results for 2 minutes', async () => {
      jest.spyOn(githubClient, 'executeGraphQL').mockResolvedValueOnce({
        success: true,
        data: {
          repository: {
            issues: {
              nodes: [mockIssueData],
            },
          },
        },
      });

      // First request - should hit API
      await request(app.getHttpServer())
        .get('/api/github/issues/octocat/hello-world')
        .expect(200);

      expect(githubClient.executeGraphQL).toHaveBeenCalledTimes(1);

      // Second request - should use cache
      await request(app.getHttpServer())
        .get('/api/github/issues/octocat/hello-world')
        .expect(200);

      expect(githubClient.executeGraphQL).toHaveBeenCalledTimes(1); // Still 1, cache hit
    });
  });

  describe('GET /api/github/issues/:owner/:repo/:number', () => {
    it('should get specific issue without cache', async () => {
      jest.spyOn(githubClient, 'executeGraphQL').mockResolvedValueOnce({
        success: true,
        data: {
          repository: {
            issue: mockIssueData,
          },
        },
      });

      const response = await request(app.getHttpServer())
        .get('/api/github/issues/octocat/hello-world/42')
        .expect(200);

      expect(response.body.number).toBe(42);
      expect(response.body.title).toBe('Integration Test Issue');
    });

    it('should return 404 when issue not found', async () => {
      jest.spyOn(githubClient, 'executeGraphQL').mockResolvedValueOnce({
        success: true,
        data: {
          repository: {
            issue: null,
          },
        },
      });

      await request(app.getHttpServer())
        .get('/api/github/issues/octocat/hello-world/999')
        .expect(404);
    });

    it('should always fetch fresh data (no cache)', async () => {
      jest.spyOn(githubClient, 'executeGraphQL').mockResolvedValue({
        success: true,
        data: {
          repository: {
            issue: mockIssueData,
          },
        },
      });

      // First request
      await request(app.getHttpServer())
        .get('/api/github/issues/octocat/hello-world/42')
        .expect(200);

      // Second request - should hit API again (no cache)
      await request(app.getHttpServer())
        .get('/api/github/issues/octocat/hello-world/42')
        .expect(200);

      expect(githubClient.executeGraphQL).toHaveBeenCalledTimes(2);
    });
  });

  describe('POST /api/github/issues', () => {
    it('should create issue and return with number', async () => {
      // Mock repository ID fetch
      jest.spyOn(githubClient, 'executeGraphQL').mockResolvedValueOnce({
        success: true,
        data: { repository: { id: 'R_123' } },
      });

      // Mock issue creation
      jest.spyOn(githubClient, 'executeGraphQL').mockResolvedValueOnce({
        success: true,
        data: {
          createIssue: {
            issue: mockIssueData,
          },
        },
      });

      const response = await request(app.getHttpServer())
        .post('/api/github/issues')
        .send({
          owner: 'octocat',
          repo: 'hello-world',
          title: 'New Issue',
          body: 'Issue description',
        })
        .expect(201);

      expect(response.body.data).toBeDefined();
      expect(response.body.data.number).toBe(42);
    });

    it('should validate required fields', async () => {
      await request(app.getHttpServer())
        .post('/api/github/issues')
        .send({
          owner: 'octocat',
          // Missing repo and title
        })
        .expect(400);
    });

    it('should handle labels and assignees', async () => {
      // Mock repository ID
      jest.spyOn(githubClient, 'executeGraphQL').mockResolvedValueOnce({
        success: true,
        data: { repository: { id: 'R_123' } },
      });

      // Mock labels fetch
      jest.spyOn(githubClient, 'executeGraphQL').mockResolvedValueOnce({
        success: true,
        data: {
          repository: {
            labels: {
              nodes: [
                { id: 'L_1', name: 'bug' },
              ],
            },
          },
        },
      });

      // Mock user fetch
      jest.spyOn(githubClient, 'executeGraphQL').mockResolvedValueOnce({
        success: true,
        data: { user: { id: 'U_1' } },
      });

      // Mock create
      jest.spyOn(githubClient, 'executeGraphQL').mockResolvedValueOnce({
        success: true,
        data: {
          createIssue: {
            issue: {
              ...mockIssueData,
              labels: { nodes: [{ name: 'bug' }] },
              assignees: { nodes: [{ login: 'octocat' }] },
            },
          },
        },
      });

      const response = await request(app.getHttpServer())
        .post('/api/github/issues')
        .send({
          owner: 'octocat',
          repo: 'hello-world',
          title: 'Bug Report',
          labels: ['bug'],
          assignees: ['octocat'],
        })
        .expect(201);

      expect(response.body.data.labels).toHaveLength(1);
      expect(response.body.data.assignees).toHaveLength(1);
    });
  });

  describe('PATCH /api/github/issues/:owner/:repo/:number', () => {
    it('should update issue', async () => {
      // Mock get issue
      jest.spyOn(githubClient, 'executeGraphQL').mockResolvedValueOnce({
        success: true,
        data: { repository: { issue: mockIssueData } },
      });

      // Mock update
      jest.spyOn(githubClient, 'executeGraphQL').mockResolvedValueOnce({
        success: true,
        data: {
          updateIssue: {
            issue: {
              ...mockIssueData,
              title: 'Updated Title',
            },
          },
        },
      });

      const response = await request(app.getHttpServer())
        .patch('/api/github/issues/octocat/hello-world/42')
        .send({ title: 'Updated Title' })
        .expect(200);

      expect(response.body.title).toBe('Updated Title');
    });
  });

  describe('POST /api/github/issues/:owner/:repo/:number/close', () => {
    it('should close issue and update state', async () => {
      // Mock get issue
      jest.spyOn(githubClient, 'executeGraphQL').mockResolvedValueOnce({
        success: true,
        data: { repository: { issue: mockIssueData } },
      });

      // Mock close
      jest.spyOn(githubClient, 'executeGraphQL').mockResolvedValueOnce({
        success: true,
        data: {
          closeIssue: {
            issue: {
              ...mockIssueData,
              state: 'CLOSED',
              closedAt: '2024-01-02T00:00:00Z',
            },
          },
        },
      });

      const response = await request(app.getHttpServer())
        .post('/api/github/issues/octocat/hello-world/42/close')
        .expect(200);

      expect(response.body.state).toBe('CLOSED');
      expect(response.body.closedAt).toBeDefined();
    });
  });

  describe('POST /api/github/issues/:owner/:repo/:number/link', () => {
    it('should link issue to project with status', async () => {
      // Mock get issue
      jest.spyOn(githubClient, 'executeGraphQL').mockResolvedValueOnce({
        success: true,
        data: { repository: { issue: mockIssueData } },
      });

      // Mock add to project
      jest.spyOn(githubClient, 'executeGraphQL').mockResolvedValueOnce({
        success: true,
        data: {
          addProjectV2ItemById: {
            item: { id: 'PVTI_456' },
          },
        },
      });

      // Mock get status field
      jest.spyOn(githubClient, 'executeGraphQL').mockResolvedValueOnce({
        success: true,
        data: {
          node: {
            fields: {
              nodes: [
                {
                  id: 'FIELD_1',
                  name: 'Status',
                  options: [
                    { id: 'OPT_1', name: 'In Progress' },
                  ],
                },
              ],
            },
          },
        },
      });

      // Mock update status
      jest.spyOn(githubClient, 'executeGraphQL').mockResolvedValueOnce({
        success: true,
        data: {
          updateProjectV2ItemFieldValue: {
            projectV2Item: { id: 'PVTI_456' },
          },
        },
      });

      const response = await request(app.getHttpServer())
        .post('/api/github/issues/octocat/hello-world/42/link')
        .send({
          projectId: 'PVT_123',
          status: 'In Progress',
        })
        .expect(200);

      expect(response.body.data.itemId).toBe('PVTI_456');
      expect(response.body.data.issue).toBeDefined();
      expect(response.body.warnings).toBeUndefined();
    });

    it('should return warnings on partial failure', async () => {
      // Mock get issue
      jest.spyOn(githubClient, 'executeGraphQL').mockResolvedValueOnce({
        success: true,
        data: { repository: { issue: mockIssueData } },
      });

      // Mock add to project (succeeds)
      jest.spyOn(githubClient, 'executeGraphQL').mockResolvedValueOnce({
        success: true,
        data: {
          addProjectV2ItemById: {
            item: { id: 'PVTI_456' },
          },
        },
      });

      // Mock status field fetch (field not found)
      jest.spyOn(githubClient, 'executeGraphQL').mockResolvedValueOnce({
        success: true,
        data: {
          node: {
            fields: {
              nodes: [],
            },
          },
        },
      });

      const response = await request(app.getHttpServer())
        .post('/api/github/issues/octocat/hello-world/42/link')
        .send({
          projectId: 'PVT_123',
          status: 'Invalid Status',
        })
        .expect(200);

      expect(response.body.data.itemId).toBe('PVTI_456');
      expect(response.body.warnings).toBeDefined();
      expect(response.body.warnings.length).toBeGreaterThan(0);
    });
  });

  describe('Error Handling', () => {
    it('should handle GitHub API errors', async () => {
      jest.spyOn(githubClient, 'executeGraphQL').mockResolvedValueOnce({
        success: false,
        error: {
          code: 'GITHUB_AUTH_FAILED' as any,
          message: 'Bad credentials',
          retryable: false,
        },
      });

      await request(app.getHttpServer())
        .get('/api/github/issues/octocat/hello-world/42')
        .expect(500);
    });

    it('should validate path parameters', async () => {
      await request(app.getHttpServer())
        .get('/api/github/issues/octocat/hello-world/invalid')
        .expect(400);
    });

    it('should validate query parameters', async () => {
      jest.spyOn(githubClient, 'executeGraphQL').mockResolvedValueOnce({
        success: true,
        data: {
          repository: {
            issues: {
              nodes: [],
            },
          },
        },
      });

      await request(app.getHttpServer())
        .get('/api/github/issues/octocat/hello-world?perPage=200') // Max is 100
        .expect(400);
    });
  });
});
