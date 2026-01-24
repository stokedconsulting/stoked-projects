import {
  Controller,
  Get,
  Post,
  Patch,
  Body,
  Param,
  Query,
  HttpCode,
  HttpStatus,
  ParseIntPipe,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiParam,
  ApiBody,
} from '@nestjs/swagger';
import { GitHubIssuesService } from './github-issues.service';
import {
  CreateIssueDto,
  UpdateIssueDto,
  LinkIssueDto,
  ListIssuesDto,
} from './dto';
import { GitHubIssue, IssueResponseWithWarnings } from './types/github-issue.types';

/**
 * GitHub Issues Controller
 *
 * REST API endpoints for GitHub Issues operations
 */
@ApiTags('GitHub Issues')
@Controller('api/github/issues')
export class GitHubIssuesController {
  constructor(private readonly issuesService: GitHubIssuesService) {}

  /**
   * List repository issues
   * GET /api/github/issues/:owner/:repo
   */
  @Get(':owner/:repo')
  @ApiOperation({
    summary: 'List repository issues',
    description: 'Get list of issues for a repository with optional filters. Results are cached for 2 minutes.',
  })
  @ApiParam({ name: 'owner', description: 'Repository owner', example: 'octocat' })
  @ApiParam({ name: 'repo', description: 'Repository name', example: 'hello-world' })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'List of issues',
    type: [Object],
  })
  async listIssues(
    @Param('owner') owner: string,
    @Param('repo') repo: string,
    @Query() filters: ListIssuesDto,
  ): Promise<GitHubIssue[]> {
    return this.issuesService.listIssues(owner, repo, filters);
  }

  /**
   * Get specific issue
   * GET /api/github/issues/:owner/:repo/:number
   */
  @Get(':owner/:repo/:number')
  @ApiOperation({
    summary: 'Get specific issue',
    description: 'Get details of a specific issue. Always returns fresh data (no cache).',
  })
  @ApiParam({ name: 'owner', description: 'Repository owner', example: 'octocat' })
  @ApiParam({ name: 'repo', description: 'Repository name', example: 'hello-world' })
  @ApiParam({ name: 'number', description: 'Issue number', example: 1 })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Issue details',
    type: Object,
  })
  @ApiResponse({
    status: HttpStatus.NOT_FOUND,
    description: 'Issue not found',
  })
  async getIssue(
    @Param('owner') owner: string,
    @Param('repo') repo: string,
    @Param('number', ParseIntPipe) number: number,
  ): Promise<GitHubIssue> {
    return this.issuesService.getIssue(owner, repo, number);
  }

  /**
   * Create new issue
   * POST /api/github/issues
   */
  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Create new issue',
    description: 'Create a new issue in a repository',
  })
  @ApiBody({ type: CreateIssueDto })
  @ApiResponse({
    status: HttpStatus.CREATED,
    description: 'Issue created successfully',
    type: Object,
  })
  @ApiResponse({
    status: HttpStatus.BAD_REQUEST,
    description: 'Invalid request data',
  })
  async createIssue(
    @Body() dto: CreateIssueDto,
  ): Promise<IssueResponseWithWarnings<GitHubIssue>> {
    return this.issuesService.createIssue(dto);
  }

  /**
   * Update issue
   * PATCH /api/github/issues/:owner/:repo/:number
   */
  @Patch(':owner/:repo/:number')
  @ApiOperation({
    summary: 'Update issue',
    description: 'Update an existing issue',
  })
  @ApiParam({ name: 'owner', description: 'Repository owner', example: 'octocat' })
  @ApiParam({ name: 'repo', description: 'Repository name', example: 'hello-world' })
  @ApiParam({ name: 'number', description: 'Issue number', example: 1 })
  @ApiBody({ type: UpdateIssueDto })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Issue updated successfully',
    type: Object,
  })
  @ApiResponse({
    status: HttpStatus.NOT_FOUND,
    description: 'Issue not found',
  })
  async updateIssue(
    @Param('owner') owner: string,
    @Param('repo') repo: string,
    @Param('number', ParseIntPipe) number: number,
    @Body() dto: UpdateIssueDto,
  ): Promise<GitHubIssue> {
    return this.issuesService.updateIssue(owner, repo, number, dto);
  }

  /**
   * Close issue
   * POST /api/github/issues/:owner/:repo/:number/close
   */
  @Post(':owner/:repo/:number/close')
  @ApiOperation({
    summary: 'Close issue',
    description: 'Close an open issue',
  })
  @ApiParam({ name: 'owner', description: 'Repository owner', example: 'octocat' })
  @ApiParam({ name: 'repo', description: 'Repository name', example: 'hello-world' })
  @ApiParam({ name: 'number', description: 'Issue number', example: 1 })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Issue closed successfully',
    type: Object,
  })
  @ApiResponse({
    status: HttpStatus.NOT_FOUND,
    description: 'Issue not found',
  })
  async closeIssue(
    @Param('owner') owner: string,
    @Param('repo') repo: string,
    @Param('number', ParseIntPipe) number: number,
  ): Promise<GitHubIssue> {
    return this.issuesService.closeIssue(owner, repo, number);
  }

  /**
   * Link issue to project
   * POST /api/github/issues/:owner/:repo/:number/link
   */
  @Post(':owner/:repo/:number/link')
  @ApiOperation({
    summary: 'Link issue to project',
    description: 'Add issue to a GitHub Project and optionally set status/priority. Returns warnings if status/priority update fails.',
  })
  @ApiParam({ name: 'owner', description: 'Repository owner', example: 'octocat' })
  @ApiParam({ name: 'repo', description: 'Repository name', example: 'hello-world' })
  @ApiParam({ name: 'number', description: 'Issue number', example: 1 })
  @ApiBody({ type: LinkIssueDto })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Issue linked to project successfully (may include warnings)',
    schema: {
      type: 'object',
      properties: {
        data: {
          type: 'object',
          properties: {
            itemId: { type: 'string' },
            issue: { type: 'object' },
          },
        },
        warnings: {
          type: 'array',
          items: { type: 'string' },
        },
      },
    },
  })
  @ApiResponse({
    status: HttpStatus.NOT_FOUND,
    description: 'Issue or project not found',
  })
  async linkIssue(
    @Param('owner') owner: string,
    @Param('repo') repo: string,
    @Param('number', ParseIntPipe) number: number,
    @Body() dto: LinkIssueDto,
  ): Promise<IssueResponseWithWarnings<{ itemId: string; issue: GitHubIssue }>> {
    return this.issuesService.linkIssueToProject(owner, repo, number, dto);
  }
}
