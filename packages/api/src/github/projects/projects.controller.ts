import {
  Controller,
  Get,
  Post,
  Delete,
  Param,
  Query,
  Body,
  HttpException,
  HttpStatus,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { ProjectsService, Project, ProjectItem, ProjectField } from './projects.service';
import { ApiKeyGuard } from '../../modules/auth/guards/api-key.guard';

@ApiTags('github-projects')
@Controller('api/github/projects')
@UseGuards(ApiKeyGuard)
@ApiBearerAuth()
export class ProjectsController {
  constructor(private readonly projectsService: ProjectsService) {}

  @Get('linked/:owner/:repo')
  @ApiOperation({ summary: 'Get projects linked to a repository' })
  @ApiResponse({ status: 200, description: 'Projects retrieved successfully' })
  @ApiResponse({ status: 403, description: 'OAuth restrictions or authentication failed' })
  async getLinkedProjects(
    @Param('owner') owner: string,
    @Param('repo') repo: string,
  ): Promise<{ projects: Project[]; repositoryId?: string; error?: string }> {
    const result = await this.projectsService.getLinkedProjects(owner, repo);

    if (result.errors) {
      throw new HttpException(
        { message: 'GitHub API error', errors: result.errors },
        HttpStatus.BAD_GATEWAY,
      );
    }

    return result;
  }

  @Get('org/:owner')
  @ApiOperation({ summary: 'Get organization projects (unlinked)' })
  @ApiResponse({ status: 200, description: 'Projects retrieved successfully' })
  async getOrganizationProjects(@Param('owner') owner: string): Promise<Project[]> {
    return this.projectsService.getOrganizationProjects(owner);
  }

  @Get(':projectId/items')
  @ApiOperation({ summary: 'Get project items' })
  @ApiResponse({ status: 200, description: 'Items retrieved successfully' })
  async getProjectItems(@Param('projectId') projectId: string): Promise<ProjectItem[]> {
    return this.projectsService.getProjectItems(projectId);
  }

  @Get(':projectId/fields')
  @ApiOperation({ summary: 'Get project fields' })
  @ApiResponse({ status: 200, description: 'Fields retrieved successfully' })
  async getProjectFields(@Param('projectId') projectId: string): Promise<ProjectField[]> {
    return this.projectsService.getProjectFields(projectId);
  }

  @Post(':projectId/items/:itemId/update-field')
  @ApiOperation({ summary: 'Update project item field value' })
  @ApiResponse({ status: 200, description: 'Field updated successfully' })
  async updateItemFieldValue(
    @Param('projectId') projectId: string,
    @Param('itemId') itemId: string,
    @Body() body: { fieldId: string; optionId: string },
  ): Promise<{ success: boolean }> {
    const success = await this.projectsService.updateItemFieldValue(
      projectId,
      itemId,
      body.fieldId,
      body.optionId,
    );

    if (!success) {
      throw new HttpException('Failed to update field value', HttpStatus.BAD_REQUEST);
    }

    return { success };
  }

  @Delete(':projectId/items/:itemId')
  @ApiOperation({ summary: 'Delete project item' })
  @ApiResponse({ status: 200, description: 'Item deleted successfully' })
  async deleteProjectItem(
    @Param('projectId') projectId: string,
    @Param('itemId') itemId: string,
  ): Promise<{ success: boolean }> {
    const success = await this.projectsService.deleteProjectItem(projectId, itemId);

    if (!success) {
      throw new HttpException('Failed to delete item', HttpStatus.BAD_REQUEST);
    }

    return { success };
  }

  @Delete(':projectId')
  @ApiOperation({ summary: 'Delete project' })
  @ApiResponse({ status: 200, description: 'Project deleted successfully' })
  async deleteProject(@Param('projectId') projectId: string): Promise<{ success: boolean }> {
    const success = await this.projectsService.deleteProject(projectId);

    if (!success) {
      throw new HttpException('Failed to delete project', HttpStatus.BAD_REQUEST);
    }

    return { success };
  }

  @Post(':projectId/link')
  @ApiOperation({ summary: 'Link project to repository' })
  @ApiResponse({ status: 200, description: 'Project linked successfully' })
  async linkProjectToRepository(
    @Param('projectId') projectId: string,
    @Body() body: { repositoryId: string },
  ): Promise<{ success: boolean }> {
    const success = await this.projectsService.linkProjectToRepository(
      projectId,
      body.repositoryId,
    );

    if (!success) {
      throw new HttpException('Failed to link project', HttpStatus.BAD_REQUEST);
    }

    return { success };
  }

  @Delete(':projectId/link')
  @ApiOperation({ summary: 'Unlink project from repository' })
  @ApiResponse({ status: 200, description: 'Project unlinked successfully' })
  async unlinkProjectFromRepository(
    @Param('projectId') projectId: string,
    @Body() body: { repositoryId: string },
  ): Promise<{ success: boolean }> {
    const success = await this.projectsService.unlinkProjectFromRepository(
      projectId,
      body.repositoryId,
    );

    if (!success) {
      throw new HttpException('Failed to unlink project', HttpStatus.BAD_REQUEST);
    }

    return { success };
  }

  @Get('repo/:owner/:repo/id')
  @ApiOperation({ summary: 'Get repository ID' })
  @ApiResponse({ status: 200, description: 'Repository ID retrieved successfully' })
  @ApiResponse({ status: 404, description: 'Repository not found' })
  async getRepositoryId(
    @Param('owner') owner: string,
    @Param('repo') repo: string,
  ): Promise<{ repositoryId: string }> {
    const repositoryId = await this.projectsService.getRepositoryId(owner, repo);

    if (!repositoryId) {
      throw new HttpException('Repository not found', HttpStatus.NOT_FOUND);
    }

    return { repositoryId };
  }
}
