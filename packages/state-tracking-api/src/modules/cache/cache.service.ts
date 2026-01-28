import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Octokit } from '@octokit/rest';
import { ProjectCache, ProjectCacheDocument } from '../../schemas/project-cache.schema';
import { ItemCache, ItemCacheDocument } from '../../schemas/item-cache.schema';

@Injectable()
export class CacheService {
  private readonly logger = new Logger(CacheService.name);
  private readonly CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

  constructor(
    @InjectModel(ProjectCache.name)
    private projectCacheModel: Model<ProjectCacheDocument>,
    @InjectModel(ItemCache.name)
    private itemCacheModel: Model<ItemCacheDocument>,
  ) {}

  /**
   * Fetch and cache projects for an organization/user
   */
  async fetchAndCacheProjects(
    accessToken: string,
    ownerLogin: string,
    userId: string,
  ): Promise<ProjectCacheDocument[]> {
    this.logger.log(`Fetching projects for ${ownerLogin}`);

    const octokit = new Octokit({ auth: accessToken });
    const projects: ProjectCacheDocument[] = [];

    try {
      // Fetch organization projects
      const { data: orgProjects } = await octokit.graphql<any>(
        `
        query($login: String!, $cursor: String) {
          organization(login: $login) {
            projectsV2(first: 50, after: $cursor) {
              nodes {
                id
                number
                title
                shortDescription
                url
                closed
                fields(first: 50) {
                  nodes {
                    ... on ProjectV2Field {
                      id
                      name
                      dataType
                    }
                    ... on ProjectV2SingleSelectField {
                      id
                      name
                      dataType
                      options {
                        id
                        name
                      }
                    }
                  }
                }
              }
              pageInfo {
                hasNextPage
                endCursor
              }
            }
          }
        }
      `,
        { login: ownerLogin, cursor: null },
      );

      const cacheExpiresAt = new Date(Date.now() + this.CACHE_TTL_MS);

      for (const project of orgProjects.organization.projectsV2.nodes) {
        const cached = await this.projectCacheModel.findOneAndUpdate(
          { project_id: project.id },
          {
            project_id: project.id,
            project_number: project.number,
            title: project.title,
            description: project.shortDescription,
            url: project.url,
            owner_login: ownerLogin,
            is_closed: project.closed,
            fields: this.parseFields(project.fields.nodes),
            cached_by_user_id: userId,
            last_fetched: new Date(),
            cache_expires_at: cacheExpiresAt,
          },
          { upsert: true, new: true },
        );

        projects.push(cached);

        // Fetch and cache items for this project
        await this.fetchAndCacheProjectItems(
          accessToken,
          project.id,
          userId,
        );
      }

      this.logger.log(`Cached ${projects.length} projects for ${ownerLogin}`);
      return projects;
    } catch (error) {
      this.logger.error(
        `Error fetching projects for ${ownerLogin}: ${error.message}`,
      );
      throw error;
    }
  }

  /**
   * Fetch and cache items for a specific project
   */
  async fetchAndCacheProjectItems(
    accessToken: string,
    projectId: string,
    userId: string,
  ): Promise<ItemCacheDocument[]> {
    this.logger.log(`Fetching items for project ${projectId}`);

    const octokit = new Octokit({ auth: accessToken });
    const items: ItemCacheDocument[] = [];

    try {
      const { data } = await octokit.graphql<any>(
        `
        query($projectId: ID!, $cursor: String) {
          node(id: $projectId) {
            ... on ProjectV2 {
              items(first: 100, after: $cursor) {
                nodes {
                  id
                  content {
                    ... on Issue {
                      id
                      title
                      body
                      state
                      number
                      url
                      labels(first: 10) {
                        nodes {
                          name
                        }
                      }
                      assignees(first: 1) {
                        nodes {
                          login
                        }
                      }
                      author {
                        login
                      }
                      createdAt
                      updatedAt
                      closedAt
                      repository {
                        owner {
                          login
                        }
                        name
                      }
                    }
                    ... on PullRequest {
                      id
                      title
                      body
                      state
                      number
                      url
                      labels(first: 10) {
                        nodes {
                          name
                        }
                      }
                      assignees(first: 1) {
                        nodes {
                          login
                        }
                      }
                      author {
                        login
                      }
                      createdAt
                      updatedAt
                      closedAt
                      repository {
                        owner {
                          login
                        }
                        name
                      }
                    }
                  }
                  fieldValues(first: 20) {
                    nodes {
                      ... on ProjectV2ItemFieldTextValue {
                        text
                        field {
                          ... on ProjectV2Field {
                            name
                          }
                        }
                      }
                      ... on ProjectV2ItemFieldNumberValue {
                        number
                        field {
                          ... on ProjectV2Field {
                            name
                          }
                        }
                      }
                      ... on ProjectV2ItemFieldSingleSelectValue {
                        name
                        field {
                          ... on ProjectV2SingleSelectField {
                            name
                          }
                        }
                      }
                      ... on ProjectV2ItemFieldDateValue {
                        date
                        field {
                          ... on ProjectV2Field {
                            name
                          }
                        }
                      }
                    }
                  }
                }
                pageInfo {
                  hasNextPage
                  endCursor
                }
              }
            }
          }
        }
      `,
        { projectId, cursor: null },
      );

      const cacheExpiresAt = new Date(Date.now() + this.CACHE_TTL_MS);

      for (const item of data.node.items.nodes) {
        if (!item.content) continue;

        const content = item.content;
        const fieldValues = this.parseFieldValues(item.fieldValues.nodes);

        const cached = await this.itemCacheModel.findOneAndUpdate(
          { item_id: item.id },
          {
            item_id: item.id,
            project_id: projectId,
            content_id: content.id,
            content_type: content.__typename,
            title: content.title,
            body: content.body,
            state: content.state,
            number: content.number,
            url: content.url,
            repository_owner: content.repository.owner.login,
            repository_name: content.repository.name,
            field_values: fieldValues,
            labels: content.labels?.nodes?.map((l: any) => l.name) || [],
            assignee_login: content.assignees?.nodes?.[0]?.login,
            author_login: content.author?.login,
            created_at: new Date(content.createdAt),
            updated_at_github: new Date(content.updatedAt),
            closed_at: content.closedAt ? new Date(content.closedAt) : undefined,
            last_fetched: new Date(),
            cache_expires_at: cacheExpiresAt,
          },
          { upsert: true, new: true },
        );

        items.push(cached);
      }

      this.logger.log(`Cached ${items.length} items for project ${projectId}`);
      return items;
    } catch (error) {
      this.logger.error(
        `Error fetching items for project ${projectId}: ${error.message}`,
      );
      throw error;
    }
  }

  /**
   * Get cached projects for an owner (serves from cache)
   */
  async getCachedProjects(ownerLogin: string): Promise<ProjectCacheDocument[]> {
    return this.projectCacheModel
      .find({ owner_login: ownerLogin })
      .sort({ project_number: 1 })
      .exec();
  }

  /**
   * Get cached projects linked to a specific repository
   */
  async getCachedProjectsByRepo(
    ownerLogin: string,
    repoName: string,
  ): Promise<ProjectCacheDocument[]> {
    return this.projectCacheModel
      .find({
        owner_login: ownerLogin,
        repository_name: repoName,
      })
      .sort({ project_number: 1 })
      .exec();
  }

  /**
   * Get cached items for a project (serves from cache)
   */
  async getCachedProjectItems(projectId: string): Promise<ItemCacheDocument[]> {
    return this.itemCacheModel
      .find({ project_id: projectId })
      .sort({ number: 1 })
      .exec();
  }

  /**
   * Get a single cached project by ID
   */
  async getCachedProject(projectId: string): Promise<ProjectCacheDocument | null> {
    return this.projectCacheModel.findOne({ project_id: projectId }).exec();
  }

  /**
   * Get a single cached item
   */
  async getCachedItem(itemId: string): Promise<ItemCacheDocument | null> {
    return this.itemCacheModel.findOne({ item_id: itemId }).exec();
  }

  /**
   * Invalidate cache for a project (force refresh on next request)
   */
  async invalidateProject(projectId: string): Promise<void> {
    await this.projectCacheModel.deleteOne({ project_id: projectId });
    await this.itemCacheModel.deleteMany({ project_id: projectId });
    this.logger.log(`Invalidated cache for project ${projectId}`);
  }

  /**
   * Invalidate all cached projects for an owner
   */
  async invalidateOwnerCache(ownerLogin: string): Promise<void> {
    const projects = await this.projectCacheModel.find({ owner_login: ownerLogin });
    const projectIds = projects.map((p) => p.project_id);

    await this.projectCacheModel.deleteMany({ owner_login: ownerLogin });
    await this.itemCacheModel.deleteMany({ project_id: { $in: projectIds } });

    this.logger.log(`Invalidated all cache for ${ownerLogin}`);
  }

  /**
   * Check if cache is stale (older than TTL)
   */
  isCacheStale(lastFetched: Date): boolean {
    const age = Date.now() - lastFetched.getTime();
    return age > this.CACHE_TTL_MS;
  }

  /**
   * Parse field definitions from GraphQL response
   */
  private parseFields(fields: any[]): Record<string, any> {
    const parsed: Record<string, any> = {};

    for (const field of fields) {
      parsed[field.name] = {
        id: field.id,
        dataType: field.dataType,
        options: field.options || undefined,
      };
    }

    return parsed;
  }

  /**
   * Parse field values from GraphQL response
   */
  private parseFieldValues(fieldValues: any[]): Record<string, any> {
    const parsed: Record<string, any> = {};

    for (const fieldValue of fieldValues) {
      if (!fieldValue.field) continue;

      const fieldName = fieldValue.field.name;
      const value =
        fieldValue.text ||
        fieldValue.number ||
        fieldValue.name ||
        fieldValue.date;

      if (value !== undefined) {
        parsed[fieldName] = value;
      }
    }

    return parsed;
  }
}
