import { Injectable, Logger, HttpStatus } from '@nestjs/common';
import { GitHubClientService } from '../client/github-client.service';
import { GitHubLoggerService, GitHubOperation } from '../../../github/logging/github-logger.service';
import { ProjectsCacheService } from './projects-cache.service';
import {
  GitHubAuthException,
  GitHubValidationException,
  GitHubException,
} from '../../../github/errors/github.exception';
import {
  CreateProjectDto,
  UpdateProjectDto,
  LinkProjectDto,
  UnlinkProjectDto,
} from './dto';
import {
  Project,
  ListProjectsResponse,
  CreateProjectResponse,
  UpdateProjectResponse,
  LinkProjectResponse,
} from './interfaces/project.interface';

@Injectable()
export class ProjectsService {
  private readonly logger = new Logger(ProjectsService.name);
  private readonly CACHE_TTL = 300;

  constructor(
    private readonly githubClient: GitHubClientService,
    private readonly githubLogger: GitHubLoggerService,
    private readonly cacheService: ProjectsCacheService,
  ) {}

  async listRepoProjects(
    owner: string,
    repo: string,
    token: string,
    requestId?: string,
  ): Promise<ListProjectsResponse> {
    const cacheKey = `projects:repo:${owner}:${repo}`;
    const operation = this.githubLogger.startOperation(
      GitHubOperation.LIST_PROJECTS,
      requestId,
      undefined,
      { owner, repo },
    );

    try {
      const cached = this.cacheService.get<ListProjectsResponse>(cacheKey);
      if (cached) {
        this.logger.debug(`Cache hit for ${cacheKey}`);
        operation.endOperation('success');
        return cached;
      }

      this.validateToken(token);

      const query = `
        query($owner: String!, $repo: String!) {
          repository(owner: $owner, name: $repo) {
            id
            projectsV2(first: 100) {
              totalCount
              nodes {
                id
                number
                title
                url
                shortDescription
                readme
                closed
                public
                createdAt
                updatedAt
              }
              pageInfo {
                hasNextPage
                endCursor
              }
            }
          }
        }
      `;

      const response = await this.githubClient.executeGraphQL<any>({
        query,
        variables: { owner, repo },
      });

      if (!response.success) {
        throw this.handleGitHubError(response.error);
      }

      if (response.data?.errors) {
        const forbidden = response.data.errors.find(
          (e: any) => e.type === 'FORBIDDEN' || e.message?.includes('OAuth App access restrictions'),
        );
        if (forbidden) {
          throw new GitHubAuthException(
            HttpStatus.FORBIDDEN,
            `OAuth App access restrictions enabled for organization ${owner}`,
            { owner, repo },
          );
        }
      }

      const repository = response.data?.repository;
      if (!repository) {
        throw new GitHubValidationException(
          HttpStatus.NOT_FOUND,
          `Repository ${owner}/${repo} not found`,
          { owner, repo },
        );
      }

      const result: ListProjectsResponse = {
        projects: repository.projectsV2.nodes.map((node: any) => this.transformProject(node)),
        repositoryId: repository.id,
        totalCount: repository.projectsV2.totalCount,
        hasNextPage: repository.projectsV2.pageInfo.hasNextPage,
        endCursor: repository.projectsV2.pageInfo.endCursor,
      };

      this.cacheService.set(cacheKey, result, this.CACHE_TTL * 1000);

      operation.endOperation('success');
      return result;
    } catch (error) {
      operation.endOperation('error', error as Error);
      throw error;
    }
  }

  async listOrgProjects(
    owner: string,
    token: string,
    first: number = 100,
    requestId?: string,
  ): Promise<ListProjectsResponse> {
    const cacheKey = `projects:org:${owner}:${first}`;
    const operation = this.githubLogger.startOperation(
      GitHubOperation.LIST_PROJECTS,
      requestId,
      undefined,
      { owner, first },
    );

    try {
      const cached = this.cacheService.get<ListProjectsResponse>(cacheKey);
      if (cached) {
        this.logger.debug(`Cache hit for ${cacheKey}`);
        operation.endOperation('success');
        return cached;
      }

      this.validateToken(token);

      const query = `
        query($owner: String!, $first: Int!) {
          organization(login: $owner) {
            projectsV2(first: $first) {
              totalCount
              nodes {
                id
                number
                title
                url
                shortDescription
                readme
                closed
                public
                createdAt
                updatedAt
              }
              pageInfo {
                hasNextPage
                endCursor
              }
            }
          }
        }
      `;

      const response = await this.githubClient.executeGraphQL<any>({
        query,
        variables: { owner, first },
      });

      if (!response.success) {
        throw this.handleGitHubError(response.error);
      }

      const organization = response.data?.organization;
      if (!organization) {
        throw new GitHubValidationException(
          HttpStatus.NOT_FOUND,
          `Organization ${owner} not found`,
          { owner },
        );
      }

      const result: ListProjectsResponse = {
        projects: organization.projectsV2.nodes.map((node: any) => this.transformProject(node)),
        totalCount: organization.projectsV2.totalCount,
        hasNextPage: organization.projectsV2.pageInfo.hasNextPage,
        endCursor: organization.projectsV2.pageInfo.endCursor,
      };

      this.cacheService.set(cacheKey, result, this.CACHE_TTL * 1000);

      operation.endOperation('success');
      return result;
    } catch (error) {
      operation.endOperation('error', error as Error);
      throw error;
    }
  }

  async createProject(
    dto: CreateProjectDto,
    token: string,
    requestId?: string,
  ): Promise<CreateProjectResponse> {
    const operation = this.githubLogger.startOperation(
      GitHubOperation.CREATE_PROJECT,
      requestId,
      undefined,
      { owner: dto.owner, title: dto.title },
    );

    try {
      this.validateToken(token);

      const ownerQuery = `
        query($owner: String!) {
          repositoryOwner(login: $owner) {
            id
          }
        }
      `;

      const ownerResponse = await this.githubClient.executeGraphQL<any>({
        query: ownerQuery,
        variables: { owner: dto.owner },
      });

      if (!ownerResponse.success || !ownerResponse.data?.repositoryOwner) {
        throw new GitHubValidationException(
          HttpStatus.NOT_FOUND,
          `Owner ${dto.owner} not found`,
          { owner: dto.owner },
        );
      }

      const ownerId = ownerResponse.data.repositoryOwner.id;

      const bodyArg = dto.body ? 'readme: $body,' : '';
      const repoIdArg = dto.repositoryId ? 'repositoryId: $repositoryId,' : '';
      
      const mutation = `
        mutation($ownerId: ID!, $title: String!, $body: String, $repositoryId: ID) {
          createProjectV2(input: {
            ownerId: $ownerId,
            title: $title,
            ${bodyArg}
            ${repoIdArg}
          }) {
            projectV2 {
              id
              number
              title
              url
              shortDescription
              readme
              closed
              public
              createdAt
              updatedAt
            }
          }
        }
      `;

      const response = await this.githubClient.executeGraphQL<any>({
        query: mutation,
        variables: {
          ownerId,
          title: dto.title,
          body: dto.body,
          repositoryId: dto.repositoryId,
        },
      });

      if (!response.success) {
        throw this.handleGitHubError(response.error);
      }

      const project = response.data?.createProjectV2?.projectV2;
      if (!project) {
        throw new GitHubValidationException(
          HttpStatus.BAD_REQUEST,
          'Failed to create project',
          { dto },
        );
      }

      this.invalidateCache(dto.owner);

      operation.endOperation('success');
      return {
        project: this.transformProject(project),
      };
    } catch (error) {
      operation.endOperation('error', error as Error);
      throw error;
    }
  }

  async updateProject(
    projectId: string,
    dto: UpdateProjectDto,
    token: string,
    requestId?: string,
  ): Promise<UpdateProjectResponse> {
    const operation = this.githubLogger.startOperation(
      GitHubOperation.UPDATE_PROJECT,
      requestId,
      undefined,
      { projectId, ...dto },
    );

    try {
      this.validateToken(token);

      const titleArg = dto.title ? 'title: $title,' : '';
      const bodyArg = dto.body !== undefined ? 'readme: $body,' : '';
      const closedArg = dto.closed !== undefined ? 'closed: $closed,' : '';
      const publicArg = dto.visibility ? 'public: $public,' : '';

      const mutation = `
        mutation($projectId: ID!, $title: String, $body: String, $closed: Boolean, $public: Boolean) {
          updateProjectV2(input: {
            projectId: $projectId,
            ${titleArg}
            ${bodyArg}
            ${closedArg}
            ${publicArg}
          }) {
            projectV2 {
              id
              number
              title
              url
              shortDescription
              readme
              closed
              public
              createdAt
              updatedAt
            }
          }
        }
      `;

      const response = await this.githubClient.executeGraphQL<any>({
        query: mutation,
        variables: {
          projectId,
          title: dto.title,
          body: dto.body,
          closed: dto.closed,
          public: dto.visibility === 'PUBLIC',
        },
      });

      if (!response.success) {
        throw this.handleGitHubError(response.error);
      }

      const project = response.data?.updateProjectV2?.projectV2;
      if (!project) {
        throw new GitHubValidationException(
          HttpStatus.NOT_FOUND,
          `Project ${projectId} not found or update failed`,
          { projectId },
        );
      }

      this.cacheService.clear();

      operation.endOperation('success');
      return {
        project: this.transformProject(project),
      };
    } catch (error) {
      operation.endOperation('error', error as Error);
      throw error;
    }
  }

  async linkProject(
    projectId: string,
    dto: LinkProjectDto,
    token: string,
    requestId?: string,
  ): Promise<LinkProjectResponse> {
    const operation = this.githubLogger.startOperation(
      'github.project.link',
      requestId,
      undefined,
      { projectId, repositoryId: dto.repositoryId },
    );

    try {
      this.validateToken(token);

      const mutation = `
        mutation($projectId: ID!, $repositoryId: ID!) {
          linkProjectV2ToRepository(input: {
            projectId: $projectId,
            repositoryId: $repositoryId
          }) {
            repository {
              id
              name
              owner {
                login
              }
            }
            projectV2 {
              id
              number
            }
          }
        }
      `;

      const response = await this.githubClient.executeGraphQL<any>({
        query: mutation,
        variables: {
          projectId,
          repositoryId: dto.repositoryId,
        },
      });

      if (!response.success) {
        throw this.handleGitHubError(response.error);
      }

      const result = response.data?.linkProjectV2ToRepository;
      if (!result) {
        throw new GitHubValidationException(
          HttpStatus.BAD_REQUEST,
          'Failed to link project to repository',
          { projectId, repositoryId: dto.repositoryId },
        );
      }

      this.cacheService.clear();

      operation.endOperation('success');
      return {
        success: true,
        project: {
          id: result.projectV2.id,
          number: result.projectV2.number,
        },
        repository: {
          id: result.repository.id,
          name: result.repository.name,
          owner: result.repository.owner.login,
        },
      };
    } catch (error) {
      operation.endOperation('error', error as Error);
      throw error;
    }
  }

  async unlinkProject(
    projectId: string,
    dto: UnlinkProjectDto,
    token: string,
    requestId?: string,
  ): Promise<LinkProjectResponse> {
    const operation = this.githubLogger.startOperation(
      'github.project.unlink',
      requestId,
      undefined,
      { projectId, repositoryId: dto.repositoryId },
    );

    try {
      this.validateToken(token);

      const mutation = `
        mutation($projectId: ID!, $repositoryId: ID!) {
          unlinkProjectV2FromRepository(input: {
            projectId: $projectId,
            repositoryId: $repositoryId
          }) {
            repository {
              id
              name
              owner {
                login
              }
            }
            projectV2 {
              id
              number
            }
          }
        }
      `;

      const response = await this.githubClient.executeGraphQL<any>({
        query: mutation,
        variables: {
          projectId,
          repositoryId: dto.repositoryId,
        },
      });

      if (!response.success) {
        throw this.handleGitHubError(response.error);
      }

      const result = response.data?.unlinkProjectV2FromRepository;
      if (!result) {
        throw new GitHubValidationException(
          HttpStatus.BAD_REQUEST,
          'Failed to unlink project from repository',
          { projectId, repositoryId: dto.repositoryId },
        );
      }

      this.cacheService.clear();

      operation.endOperation('success');
      return {
        success: true,
        project: {
          id: result.projectV2.id,
          number: result.projectV2.number,
        },
        repository: {
          id: result.repository.id,
          name: result.repository.name,
          owner: result.repository.owner.login,
        },
      };
    } catch (error) {
      operation.endOperation('error', error as Error);
      throw error;
    }
  }

  private transformProject(node: any): Project {
    return {
      id: node.id,
      number: node.number,
      title: node.title,
      url: node.url,
      shortDescription: node.shortDescription,
      readme: node.readme,
      closed: node.closed,
      public: node.public,
      createdAt: node.createdAt,
      updatedAt: node.updatedAt,
    };
  }

  private validateToken(token: string): void {
    if (!token || token.trim() === '') {
      throw new GitHubAuthException(
        HttpStatus.UNAUTHORIZED,
        'GitHub token is missing or empty',
      );
    }
  }

  private handleGitHubError(error: any): GitHubException {
    if (error instanceof GitHubException) {
      return error;
    }

    if (error.code === 'GITHUB_AUTH_FAILED') {
      return new GitHubAuthException(
        HttpStatus.UNAUTHORIZED,
        error.message,
        error.originalError,
      );
    }

    return new GitHubValidationException(
      HttpStatus.BAD_REQUEST,
      error.message || 'GitHub API error',
      error,
    );
  }

  private async invalidateCache(owner: string): Promise<void> {
    try {
      this.cacheService.clear();
    } catch (error) {
      this.logger.warn('Failed to invalidate cache', error);
    }
  }
}
