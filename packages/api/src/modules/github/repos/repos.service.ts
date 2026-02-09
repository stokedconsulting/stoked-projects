import {
  Injectable,
  Logger,
  NotFoundException,
  ForbiddenException,
  InternalServerErrorException,
} from '@nestjs/common';
import { GitHubClientService } from '../client/github-client.service';
import { ReposCacheService } from './repos-cache.service';
import { AppLoggerService } from '../../../common/logging/app-logger.service';
import {
  RepositoryMetadataDto,
  OrganizationMetadataDto,
  LinkedProjectsDto,
} from './dto/repository-metadata.dto';

/**
 * Service for repository and organization metadata queries
 */
@Injectable()
export class ReposService {
  private readonly logger = new Logger(ReposService.name);

  constructor(
    private readonly githubClient: GitHubClientService,
    private readonly cacheService: ReposCacheService,
    private readonly appLogger: AppLoggerService,
  ) {
    this.appLogger.setContext(ReposService.name);
  }

  /**
   * Get repository metadata
   *
   * @param owner - Repository owner
   * @param repo - Repository name
   * @param includeProjects - Whether to include linked projects
   * @returns Repository metadata
   */
  async getRepositoryMetadata(
    owner: string,
    repo: string,
    includeProjects = false,
  ): Promise<RepositoryMetadataDto> {
    // Validate inputs
    this.validateGitHubName(owner, 'owner');
    this.validateGitHubName(repo, 'repo');

    // Check cache first
    const cached = this.cacheService.getRepository(owner, repo, includeProjects);
    if (cached) {
      this.appLogger.log('Repository metadata retrieved from cache', {
        owner,
        repo,
        includeProjects,
      });
      return cached;
    }

    // Query GitHub
    const query = this.buildRepositoryQuery(includeProjects);
    const variables = { owner, name: repo };

    const response = await this.githubClient.executeGraphQL<any>({
      query,
      variables,
    });

    if (!response.success || !response.data) {
      return this.handleGitHubError(response.error, owner, repo);
    }

    const repository = response.data.repository;

    if (!repository) {
      throw new NotFoundException({
        code: 'REPOSITORY_NOT_FOUND',
        message: `Repository ${owner}/${repo} not found`,
      });
    }

    // Transform to DTO
    const metadata: RepositoryMetadataDto = {
      id: repository.id,
      name: repository.name,
      owner: repository.owner.login,
      description: repository.description,
      url: repository.url,
      defaultBranch: repository.defaultBranchRef?.name || 'main',
      isPrivate: repository.isPrivate,
    };

    // Add projects if requested
    if (includeProjects && repository.projectsV2) {
      metadata.projects = repository.projectsV2.nodes.map((project: any) => ({
        id: project.id,
        title: project.title,
        url: project.url,
        number: project.number,
      }));
    }

    // Cache the result
    this.cacheService.setRepository(owner, repo, includeProjects, metadata);

    this.appLogger.log('Repository metadata retrieved from GitHub', {
      owner,
      repo,
      includeProjects,
      projectCount: metadata.projects?.length || 0,
    });

    return metadata;
  }

  /**
   * Get organization metadata
   *
   * @param owner - Organization login
   * @returns Organization metadata
   */
  async getOrganizationMetadata(owner: string): Promise<OrganizationMetadataDto> {
    // Validate inputs
    this.validateGitHubName(owner, 'owner');

    // Check cache first
    const cached = this.cacheService.getOrganization(owner);
    if (cached) {
      this.appLogger.log('Organization metadata retrieved from cache', { owner });
      return cached;
    }

    // Query GitHub
    const query = `
      query GetOrganization($login: String!) {
        organization(login: $login) {
          id
          login
          name
          description
          url
          projectsV2(first: 0) {
            totalCount
          }
        }
      }
    `;

    const response = await this.githubClient.executeGraphQL<any>({
      query,
      variables: { login: owner },
    });

    if (!response.success || !response.data) {
      return this.handleGitHubError(response.error, owner);
    }

    const organization = response.data.organization;

    if (!organization) {
      throw new NotFoundException({
        code: 'ORGANIZATION_NOT_FOUND',
        message: `Organization ${owner} not found`,
      });
    }

    // Transform to DTO
    const metadata: OrganizationMetadataDto = {
      id: organization.id,
      login: organization.login,
      name: organization.name,
      description: organization.description,
      url: organization.url,
      projectsV2Count: organization.projectsV2.totalCount,
    };

    // Cache the result
    this.cacheService.setOrganization(owner, metadata);

    this.appLogger.log('Organization metadata retrieved from GitHub', {
      owner,
      projectsV2Count: metadata.projectsV2Count,
    });

    return metadata;
  }

  /**
   * Get projects linked to a repository
   *
   * @param owner - Repository owner
   * @param repo - Repository name
   * @returns Linked projects
   */
  async getLinkedProjects(owner: string, repo: string): Promise<LinkedProjectsDto> {
    // Validate inputs
    this.validateGitHubName(owner, 'owner');
    this.validateGitHubName(repo, 'repo');

    // Check cache first
    const cached = this.cacheService.getLinkedProjects(owner, repo);
    if (cached) {
      this.appLogger.log('Linked projects retrieved from cache', { owner, repo });
      return cached;
    }

    // Query GitHub
    const query = `
      query GetLinkedProjects($owner: String!, $name: String!) {
        repository(owner: $owner, name: $name) {
          id
          projectsV2(first: 100) {
            nodes {
              id
              title
              url
              number
            }
          }
        }
      }
    `;

    const response = await this.githubClient.executeGraphQL<any>({
      query,
      variables: { owner, name: repo },
    });

    if (!response.success || !response.data) {
      return this.handleGitHubError(response.error, owner, repo);
    }

    const repository = response.data.repository;

    if (!repository) {
      throw new NotFoundException({
        code: 'REPOSITORY_NOT_FOUND',
        message: `Repository ${owner}/${repo} not found`,
      });
    }

    // Transform to DTO
    const linkedProjects: LinkedProjectsDto = {
      repositoryId: repository.id,
      projects: repository.projectsV2.nodes.map((project: any) => ({
        id: project.id,
        title: project.title,
        url: project.url,
        number: project.number,
      })),
    };

    // Cache the result
    this.cacheService.setLinkedProjects(owner, repo, linkedProjects);

    this.appLogger.log('Linked projects retrieved from GitHub', {
      owner,
      repo,
      projectCount: linkedProjects.projects.length,
    });

    return linkedProjects;
  }

  /**
   * Build GraphQL query for repository metadata
   */
  private buildRepositoryQuery(includeProjects: boolean): string {
    const projectsFragment = includeProjects
      ? `
          projectsV2(first: 100) {
            nodes {
              id
              title
              url
              number
            }
          }
        `
      : '';

    return `
      query GetRepository($owner: String!, $name: String!) {
        repository(owner: $owner, name: $name) {
          id
          name
          owner {
            login
          }
          description
          url
          defaultBranchRef {
            name
          }
          isPrivate
          ${projectsFragment}
        }
      }
    `;
  }

  /**
   * Validate GitHub owner/repo names
   *
   * GitHub naming rules:
   * - Alphanumeric characters, hyphens, underscores
   * - Cannot start with hyphen
   * - Max 100 characters
   */
  private validateGitHubName(name: string, type: 'owner' | 'repo'): void {
    const pattern = /^[a-zA-Z0-9]([a-zA-Z0-9._-]{0,98}[a-zA-Z0-9])?$/;

    if (!pattern.test(name)) {
      throw new NotFoundException({
        code: type === 'owner' ? 'INVALID_OWNER_NAME' : 'INVALID_REPOSITORY_NAME',
        message: `Invalid ${type} name: ${name}`,
      });
    }
  }

  /**
   * Handle GitHub API errors
   */
  private handleGitHubError(error: any, owner: string, repo?: string): never {
    const context = repo ? { owner, repo } : { owner };

    // Authentication errors
    if (error?.code === 'GITHUB_AUTH_FAILED') {
      this.appLogger.error('GitHub authentication failed', error.message, context);
      throw new ForbiddenException({
        code: 'GITHUB_AUTH_FAILED',
        message: 'GitHub authentication failed. Check your token.',
      });
    }

    // Rate limit errors
    if (error?.code === 'RATE_LIMIT_EXCEEDED') {
      this.appLogger.warn('GitHub rate limit exceeded', context);
      throw new ForbiddenException({
        code: 'RATE_LIMIT_EXCEEDED',
        message: 'GitHub API rate limit exceeded. Please try again later.',
        retryAfter: error.retryAfter,
      });
    }

    // Check for OAuth restrictions (saml_enforced)
    if (
      error?.originalError?.errors &&
      error.originalError.errors.some((e: any) =>
        e.message?.toLowerCase().includes('saml'),
      )
    ) {
      const orgSettingsUrl = `https://github.com/organizations/${owner}/settings/oauth_application_policy`;
      this.appLogger.warn('OAuth restrictions detected', { ...context, orgSettingsUrl });
      throw new ForbiddenException({
        code: 'OAUTH_RESTRICTIONS',
        message: `This organization has OAuth restrictions enabled. Please authorize the application at: ${orgSettingsUrl}`,
        orgSettingsUrl,
      });
    }

    // Check for not found errors - return 404 for private repos without access
    if (
      error?.originalError?.errors &&
      error.originalError.errors.some((e: any) =>
        e.type?.toLowerCase().includes('not_found'),
      )
    ) {
      const message = repo
        ? `Repository ${owner}/${repo} not found`
        : `Organization ${owner} not found`;
      const code = repo ? 'REPOSITORY_NOT_FOUND' : 'ORGANIZATION_NOT_FOUND';

      this.appLogger.warn(message, context);
      throw new NotFoundException({ code, message });
    }

    // Unknown error
    this.appLogger.error('GitHub API error', error?.message || 'Unknown error', context);
    throw new InternalServerErrorException({
      code: 'GITHUB_API_ERROR',
      message: 'Failed to fetch data from GitHub',
    });
  }
}
