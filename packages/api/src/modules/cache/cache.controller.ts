import {
  Controller,
  Get,
  Post,
  Delete,
  Param,
  Query,
  HttpCode,
  HttpStatus,
  UseGuards,
  HttpException,
} from '@nestjs/common';
import { CacheService } from './cache.service';
import { UsersService } from '../users/users.service';
import { ApiKeyGuard } from '../auth/guards/api-key.guard';
import { SkipThrottle } from '../../common/decorators/skip-throttle.decorator';

@Controller('api/cache')
@UseGuards(ApiKeyGuard)
export class CacheController {
  constructor(
    private cacheService: CacheService,
    private usersService: UsersService,
  ) {}

  /**
   * Fetch and cache projects for an organization/user
   * POST /api/cache/projects/:owner
   */
  @Post('projects/:owner')
  @HttpCode(HttpStatus.OK)
  async refreshProjects(
    @Param('owner') owner: string,
    @Query('user_id') userId: string,
  ) {
    if (!userId) {
      throw new HttpException('user_id query parameter required', HttpStatus.BAD_REQUEST);
    }

    // Get user's GitHub token
    const user = await this.usersService.findByGithubId(userId);
    if (!user) {
      throw new HttpException('User not found', HttpStatus.NOT_FOUND);
    }

    // Fetch and cache projects
    const projects = await this.cacheService.fetchAndCacheProjects(
      user.access_token,
      owner,
      userId,
    );

    return {
      cached: projects.length,
      projects: projects.map((p) => ({
        id: p.project_id,
        number: p.project_number,
        title: p.title,
        url: p.url,
        is_closed: p.is_closed,
        last_fetched: p.last_fetched,
      })),
    };
  }

  /**
   * Get cached projects for an organization/user
   * GET /api/cache/projects/:owner
   */
  @Get('projects/:owner')
  @SkipThrottle()
  async getCachedProjects(@Param('owner') owner: string) {
    const projects = await this.cacheService.getCachedProjects(owner);

    return {
      count: projects.length,
      projects: projects.map((p) => ({
        id: p.project_id,
        number: p.project_number,
        title: p.title,
        description: p.description,
        url: p.url,
        owner_login: p.owner_login,
        repository_id: p.repository_id,
        repository_name: p.repository_name,
        is_closed: p.is_closed,
        fields: p.fields,
        last_fetched: p.last_fetched,
        is_stale: this.cacheService.isCacheStale(p.last_fetched),
      })),
    };
  }

  /**
   * Get cached projects linked to a repository
   * GET /api/cache/projects/:owner/:repo
   */
  @Get('projects/:owner/:repo')
  @SkipThrottle()
  async getCachedProjectsByRepo(
    @Param('owner') owner: string,
    @Param('repo') repo: string,
  ) {
    const projects = await this.cacheService.getCachedProjectsByRepo(owner, repo);

    return {
      count: projects.length,
      projects: projects.map((p) => ({
        id: p.project_id,
        number: p.project_number,
        title: p.title,
        description: p.description,
        url: p.url,
        is_closed: p.is_closed,
        fields: p.fields,
        last_fetched: p.last_fetched,
        is_stale: this.cacheService.isCacheStale(p.last_fetched),
      })),
    };
  }

  /**
   * Get cached items for a project
   * GET /api/cache/projects/:projectId/items
   */
  @Get('project/:projectId/items')
  @SkipThrottle()
  async getCachedProjectItems(@Param('projectId') projectId: string) {
    const items = await this.cacheService.getCachedProjectItems(projectId);

    return {
      count: items.length,
      items: items.map((i) => ({
        id: i.item_id,
        content_id: i.content_id,
        content_type: i.content_type,
        title: i.title,
        state: i.state,
        number: i.number,
        url: i.url,
        repository: `${i.repository_owner}/${i.repository_name}`,
        field_values: i.field_values,
        labels: i.labels,
        assignee: i.assignee_login,
        author: i.author_login,
        created_at: i.created_at,
        updated_at: i.updated_at_github,
        closed_at: i.closed_at,
        last_fetched: i.last_fetched,
        is_stale: this.cacheService.isCacheStale(i.last_fetched),
      })),
    };
  }

  /**
   * Refresh a single project's items
   * POST /api/cache/project/:projectId/refresh
   */
  @Post('project/:projectId/refresh')
  @HttpCode(HttpStatus.OK)
  async refreshProjectItems(
    @Param('projectId') projectId: string,
    @Query('user_id') userId: string,
  ) {
    if (!userId) {
      throw new HttpException('user_id query parameter required', HttpStatus.BAD_REQUEST);
    }

    // Get user's GitHub token
    const user = await this.usersService.findByGithubId(userId);
    if (!user) {
      throw new HttpException('User not found', HttpStatus.NOT_FOUND);
    }

    // Fetch and cache items
    const items = await this.cacheService.fetchAndCacheProjectItems(
      user.access_token,
      projectId,
      userId,
    );

    return {
      cached: items.length,
      project_id: projectId,
    };
  }

  /**
   * Invalidate cache for a project
   * DELETE /api/cache/project/:projectId
   */
  @Delete('project/:projectId')
  @HttpCode(HttpStatus.NO_CONTENT)
  async invalidateProject(@Param('projectId') projectId: string) {
    await this.cacheService.invalidateProject(projectId);
  }

  /**
   * Invalidate all cache for an owner
   * DELETE /api/cache/projects/:owner
   */
  @Delete('projects/:owner')
  @HttpCode(HttpStatus.NO_CONTENT)
  async invalidateOwnerCache(@Param('owner') owner: string) {
    await this.cacheService.invalidateOwnerCache(owner);
  }

  /**
   * Get cache statistics
   * GET /api/cache/stats
   */
  @Get('stats')
  async getCacheStats() {
    // This would return stats about cached data
    return {
      message: 'Cache statistics endpoint - to be implemented',
    };
  }
}
