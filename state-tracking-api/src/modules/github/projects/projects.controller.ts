import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  Headers,
  HttpCode,
  HttpStatus,
  UseGuards,
  ValidationPipe,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiHeader,
  ApiBearerAuth,
  ApiParam,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { ProjectsService } from './projects.service';
import { ApiKeyGuard } from '../../auth/guards/api-key.guard';
import {
  CreateProjectDto,
  UpdateProjectDto,
  LinkProjectDto,
  UnlinkProjectDto,
} from './dto';

@ApiTags('GitHub Projects')
@Controller('api/github/projects')
@UseGuards(ApiKeyGuard)
@ApiBearerAuth()
export class ProjectsController {
  constructor(private readonly projectsService: ProjectsService) {}

  @Get(':owner/:repo')
  @ApiOperation({
    summary: 'List repository-linked projects',
    description: 'Fetch all GitHub Projects v2 linked to a specific repository. Results are cached for 5 minutes.',
  })
  @ApiParam({ name: 'owner', description: 'Repository owner', example: 'anthropics' })
  @ApiParam({ name: 'repo', description: 'Repository name', example: 'claude-projects' })
  @ApiHeader({ name: 'x-github-token', description: 'GitHub token', required: true })
  @ApiResponse({ status: 200, description: 'Projects retrieved successfully' })
  @ApiResponse({ status: 401, description: 'Invalid or missing GitHub token' })
  @Throttle({ default: { limit: 60, ttl: 60000 } })
  async listRepoProjects(
    @Param('owner') owner: string,
    @Param('repo') repo: string,
    @Headers('x-github-token') githubToken: string,
    @Headers('x-request-id') requestId?: string,
  ) {
    return this.projectsService.listRepoProjects(owner, repo, githubToken, requestId);
  }

  @Get(':owner')
  @ApiOperation({
    summary: 'List organization projects',
    description: 'Fetch all GitHub Projects v2 for an organization. Results are cached for 5 minutes.',
  })
  @ApiParam({ name: 'owner', description: 'Organization name', example: 'anthropics' })
  @ApiHeader({ name: 'x-github-token', description: 'GitHub token', required: true })
  @ApiResponse({ status: 200, description: 'Projects retrieved successfully' })
  @Throttle({ default: { limit: 60, ttl: 60000 } })
  async listOrgProjects(
    @Param('owner') owner: string,
    @Query('first') first?: number,
    @Headers('x-github-token') githubToken: string = '',
    @Headers('x-request-id') requestId?: string,
  ) {
    return this.projectsService.listOrgProjects(owner, githubToken, first, requestId);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Create a new project',
    description: 'Create a new GitHub Project v2.',
  })
  @ApiHeader({ name: 'x-github-token', description: 'GitHub token', required: true })
  @ApiResponse({ status: 201, description: 'Project created successfully' })
  @Throttle({ default: { limit: 20, ttl: 60000 } })
  async createProject(
    @Body(ValidationPipe) dto: CreateProjectDto,
    @Headers('x-github-token') githubToken: string,
    @Headers('x-request-id') requestId?: string,
  ) {
    return this.projectsService.createProject(dto, githubToken, requestId);
  }

  @Patch(':projectId')
  @ApiOperation({ summary: 'Update a project' })
  @ApiParam({ name: 'projectId', description: 'Project ID' })
  @ApiHeader({ name: 'x-github-token', description: 'GitHub token', required: true })
  @ApiResponse({ status: 200, description: 'Project updated successfully' })
  @Throttle({ default: { limit: 30, ttl: 60000 } })
  async updateProject(
    @Param('projectId') projectId: string,
    @Body(ValidationPipe) dto: UpdateProjectDto,
    @Headers('x-github-token') githubToken: string,
    @Headers('x-request-id') requestId?: string,
  ) {
    return this.projectsService.updateProject(projectId, dto, githubToken, requestId);
  }

  @Post(':projectId/link')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Link project to repository' })
  @ApiParam({ name: 'projectId', description: 'Project ID' })
  @ApiHeader({ name: 'x-github-token', description: 'GitHub token', required: true })
  @ApiResponse({ status: 200, description: 'Project linked successfully' })
  @Throttle({ default: { limit: 30, ttl: 60000 } })
  async linkProject(
    @Param('projectId') projectId: string,
    @Body(ValidationPipe) dto: LinkProjectDto,
    @Headers('x-github-token') githubToken: string,
    @Headers('x-request-id') requestId?: string,
  ) {
    return this.projectsService.linkProject(projectId, dto, githubToken, requestId);
  }

  @Delete(':projectId/link')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Unlink project from repository' })
  @ApiParam({ name: 'projectId', description: 'Project ID' })
  @ApiHeader({ name: 'x-github-token', description: 'GitHub token', required: true })
  @ApiResponse({ status: 200, description: 'Project unlinked successfully' })
  @Throttle({ default: { limit: 30, ttl: 60000 } })
  async unlinkProject(
    @Param('projectId') projectId: string,
    @Body(ValidationPipe) dto: UnlinkProjectDto,
    @Headers('x-github-token') githubToken: string,
    @Headers('x-request-id') requestId?: string,
  ) {
    return this.projectsService.unlinkProject(projectId, dto, githubToken, requestId);
  }
}
