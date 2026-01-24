import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiParam,
  ApiQuery,
  ApiBearerAuth,
} from '@nestjs/swagger';
import { ReposService } from './repos.service';
import {
  RepositoryMetadataDto,
  OrganizationMetadataDto,
  LinkedProjectsDto,
  GetRepositoryQueryDto,
} from './dto/repository-metadata.dto';
import { ApiKeyGuard } from '../../auth/guards/api-key.guard';

/**
 * Controller for repository and organization metadata queries
 */
@ApiTags('GitHub Repos')
@Controller('api/github')
@UseGuards(ApiKeyGuard)
@ApiBearerAuth()
export class ReposController {
  constructor(private readonly reposService: ReposService) {}

  /**
   * Get repository metadata
   */
  @Get('repos/:owner/:repo')
  @ApiOperation({
    summary: 'Get repository metadata',
    description:
      'Retrieve metadata for a GitHub repository. Optionally include linked projects by setting include_projects=true.',
  })
  @ApiParam({
    name: 'owner',
    description: 'Repository owner (username or organization)',
    example: 'octocat',
  })
  @ApiParam({
    name: 'repo',
    description: 'Repository name',
    example: 'hello-world',
  })
  @ApiQuery({
    name: 'include_projects',
    required: false,
    type: String,
    description: 'Include linked projects in response (true/false)',
    example: 'true',
  })
  @ApiResponse({
    status: 200,
    description: 'Repository metadata retrieved successfully',
    type: RepositoryMetadataDto,
  })
  @ApiResponse({
    status: 404,
    description: 'Repository not found or inaccessible',
    schema: {
      type: 'object',
      properties: {
        code: { type: 'string', example: 'REPOSITORY_NOT_FOUND' },
        message: { type: 'string', example: 'Repository octocat/hello-world not found' },
      },
    },
  })
  @ApiResponse({
    status: 403,
    description: 'OAuth restrictions or rate limit exceeded',
    schema: {
      type: 'object',
      properties: {
        code: { type: 'string', example: 'OAUTH_RESTRICTIONS' },
        message: {
          type: 'string',
          example:
            'This organization has OAuth restrictions enabled. Please authorize the application at: https://github.com/organizations/my-org/settings/oauth_application_policy',
        },
        orgSettingsUrl: {
          type: 'string',
          example: 'https://github.com/organizations/my-org/settings/oauth_application_policy',
        },
      },
    },
  })
  async getRepository(
    @Param('owner') owner: string,
    @Param('repo') repo: string,
    @Query() query: GetRepositoryQueryDto,
  ): Promise<RepositoryMetadataDto> {
    const includeProjects = query.include_projects === 'true';
    return this.reposService.getRepositoryMetadata(owner, repo, includeProjects);
  }

  /**
   * Get organization metadata
   */
  @Get('orgs/:owner')
  @ApiOperation({
    summary: 'Get organization metadata',
    description: 'Retrieve metadata for a GitHub organization, including project count.',
  })
  @ApiParam({
    name: 'owner',
    description: 'Organization login',
    example: 'github',
  })
  @ApiResponse({
    status: 200,
    description: 'Organization metadata retrieved successfully',
    type: OrganizationMetadataDto,
  })
  @ApiResponse({
    status: 404,
    description: 'Organization not found',
    schema: {
      type: 'object',
      properties: {
        code: { type: 'string', example: 'ORGANIZATION_NOT_FOUND' },
        message: { type: 'string', example: 'Organization github not found' },
      },
    },
  })
  @ApiResponse({
    status: 403,
    description: 'OAuth restrictions or rate limit exceeded',
    schema: {
      type: 'object',
      properties: {
        code: { type: 'string', example: 'OAUTH_RESTRICTIONS' },
        message: {
          type: 'string',
          example:
            'This organization has OAuth restrictions enabled. Please authorize the application at: https://github.com/organizations/github/settings/oauth_application_policy',
        },
        orgSettingsUrl: {
          type: 'string',
          example: 'https://github.com/organizations/github/settings/oauth_application_policy',
        },
      },
    },
  })
  async getOrganization(@Param('owner') owner: string): Promise<OrganizationMetadataDto> {
    return this.reposService.getOrganizationMetadata(owner);
  }

  /**
   * Get projects linked to a repository
   */
  @Get('repos/:owner/:repo/linked-projects')
  @ApiOperation({
    summary: 'Get projects linked to a repository',
    description:
      'Retrieve all GitHub Projects (ProjectsV2) linked to a specific repository.',
  })
  @ApiParam({
    name: 'owner',
    description: 'Repository owner (username or organization)',
    example: 'octocat',
  })
  @ApiParam({
    name: 'repo',
    description: 'Repository name',
    example: 'hello-world',
  })
  @ApiResponse({
    status: 200,
    description: 'Linked projects retrieved successfully',
    type: LinkedProjectsDto,
  })
  @ApiResponse({
    status: 404,
    description: 'Repository not found or inaccessible',
    schema: {
      type: 'object',
      properties: {
        code: { type: 'string', example: 'REPOSITORY_NOT_FOUND' },
        message: { type: 'string', example: 'Repository octocat/hello-world not found' },
      },
    },
  })
  @ApiResponse({
    status: 403,
    description: 'OAuth restrictions or rate limit exceeded',
  })
  async getLinkedProjects(
    @Param('owner') owner: string,
    @Param('repo') repo: string,
  ): Promise<LinkedProjectsDto> {
    return this.reposService.getLinkedProjects(owner, repo);
  }
}
