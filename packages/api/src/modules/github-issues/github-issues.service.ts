import { Injectable, Logger, NotFoundException, Inject } from '@nestjs/common';
import { GitHubClientService } from '../github/client/github-client.service';
import { GitHubIssuesCacheService } from './github-issues-cache.service';
import {
  CreateIssueDto,
  UpdateIssueDto,
  LinkIssueDto,
  ListIssuesDto,
} from './dto';
import {
  GitHubIssue,
  IssueResponseWithWarnings,
  IssueState,
  ProjectField,
} from './types/github-issue.types';

/**
 * GitHub Issues Service
 *
 * Implements all GitHub Issues API operations:
 * - List issues (with 2-minute cache)
 * - Get specific issue (no cache)
 * - Create issue
 * - Update issue
 * - Close issue
 * - Link issue to project with status update
 */
@Injectable()
export class GitHubIssuesService {
  private readonly logger = new Logger(GitHubIssuesService.name);

  constructor(
    private readonly githubClient: GitHubClientService,
    private readonly cache: GitHubIssuesCacheService,
  ) {}

  /**
   * List repository issues (cached for 2 minutes)
   * AC-2.2.f: GET list cached for 2 minutes
   */
  async listIssues(
    owner: string,
    repo: string,
    filters: ListIssuesDto = new ListIssuesDto(),
  ): Promise<GitHubIssue[]> {
    // Build cache key from filters
    const cacheKey = this.buildCacheKey(owner, repo, filters);

    // Check cache first
    const cached = this.cache.getList(cacheKey);
    if (cached) {
      this.logger.debug(`Returning cached issues for ${owner}/${repo}`);
      return cached;
    }

    // Fetch from GitHub
    this.logger.log(`Fetching issues for ${owner}/${repo} from GitHub`);

    const query = `
      query($owner: String!, $name: String!, $states: [IssueState!], $labels: [String!], $first: Int!) {
        repository(owner: $owner, name: $name) {
          issues(
            states: $states
            labels: $labels
            first: $first
            orderBy: { field: CREATED_AT, direction: DESC }
          ) {
            nodes {
              id
              number
              title
              body
              state
              url
              createdAt
              updatedAt
              closedAt
              author {
                login
              }
              labels(first: 10) {
                nodes {
                  name
                }
              }
              assignees(first: 10) {
                nodes {
                  login
                }
              }
            }
          }
        }
      }
    `;

    const variables = {
      owner,
      name: repo,
      states: this.mapStateFilter(filters.state),
      labels: filters.labels ? filters.labels.split(',') : null,
      first: filters.perPage || 30,
    };

    const response = await this.githubClient.executeGraphQL<any>({
      query,
      variables,
    });

    if (!response.success) {
      this.logger.error(`Failed to fetch issues: ${response.error?.message}`);
      throw new Error(response.error?.message || 'Failed to fetch issues');
    }

    const issues: GitHubIssue[] = response.data?.repository?.issues?.nodes?.map((node: any) => ({
      id: node.id,
      number: node.number,
      title: node.title,
      body: node.body,
      state: node.state as IssueState,
      url: node.url,
      createdAt: node.createdAt,
      updatedAt: node.updatedAt,
      closedAt: node.closedAt,
      author: node.author,
      labels: node.labels?.nodes || [],
      assignees: node.assignees?.nodes || [],
    })) || [];

    // Cache the results
    this.cache.setList(cacheKey, issues);

    return issues;
  }

  /**
   * Get specific issue (no cache - always fresh)
   * AC-2.2.d: GET specific issue returns fresh data (no cache)
   */
  async getIssue(owner: string, repo: string, issueNumber: number): Promise<GitHubIssue> {
    this.logger.log(`Fetching issue #${issueNumber} from ${owner}/${repo}`);

    const query = `
      query($owner: String!, $name: String!, $number: Int!) {
        repository(owner: $owner, name: $name) {
          issue(number: $number) {
            id
            number
            title
            body
            state
            url
            createdAt
            updatedAt
            closedAt
            author {
              login
            }
            labels(first: 10) {
              nodes {
                name
              }
            }
            assignees(first: 10) {
              nodes {
                login
              }
            }
          }
        }
      }
    `;

    const response = await this.githubClient.executeGraphQL<any>({
      query,
      variables: { owner, name: repo, number: issueNumber },
    });

    if (!response.success) {
      this.logger.error(`Failed to fetch issue #${issueNumber}: ${response.error?.message}`);
      throw new Error(response.error?.message || 'Failed to fetch issue');
    }

    const issue = response.data?.repository?.issue;
    if (!issue) {
      throw new NotFoundException(`Issue #${issueNumber} not found in ${owner}/${repo}`);
    }

    return {
      id: issue.id,
      number: issue.number,
      title: issue.title,
      body: issue.body,
      state: issue.state as IssueState,
      url: issue.url,
      createdAt: issue.createdAt,
      updatedAt: issue.updatedAt,
      closedAt: issue.closedAt,
      author: issue.author,
      labels: issue.labels?.nodes || [],
      assignees: issue.assignees?.nodes || [],
    };
  }

  /**
   * Create new issue
   * AC-2.2.a: POST create returns issue with number
   */
  async createIssue(dto: CreateIssueDto): Promise<IssueResponseWithWarnings<GitHubIssue>> {
    this.logger.log(`Creating issue in ${dto.owner}/${dto.repo}: ${dto.title}`);

    const mutation = `
      mutation($repositoryId: ID!, $title: String!, $body: String, $labelIds: [ID!], $assigneeIds: [ID!]) {
        createIssue(input: {
          repositoryId: $repositoryId
          title: $title
          body: $body
          labelIds: $labelIds
          assigneeIds: $assigneeIds
        }) {
          issue {
            id
            number
            title
            body
            state
            url
            createdAt
            updatedAt
            author {
              login
            }
            labels(first: 10) {
              nodes {
                name
              }
            }
            assignees(first: 10) {
              nodes {
                login
              }
            }
          }
        }
      }
    `;

    // First, get repository ID
    const repoId = await this.getRepositoryId(dto.owner, dto.repo);

    // Get label IDs if labels provided
    let labelIds: string[] = [];
    if (dto.labels && dto.labels.length > 0) {
      labelIds = await this.getLabelIds(dto.owner, dto.repo, dto.labels);
    }

    // Get assignee IDs if assignees provided
    let assigneeIds: string[] = [];
    if (dto.assignees && dto.assignees.length > 0) {
      assigneeIds = await this.getUserIds(dto.assignees);
    }

    const response = await this.githubClient.executeGraphQL<any>({
      query: mutation,
      variables: {
        repositoryId: repoId,
        title: dto.title,
        body: dto.body,
        labelIds: labelIds.length > 0 ? labelIds : null,
        assigneeIds: assigneeIds.length > 0 ? assigneeIds : null,
      },
    });

    if (!response.success) {
      this.logger.error(`Failed to create issue: ${response.error?.message}`);
      throw new Error(response.error?.message || 'Failed to create issue');
    }

    const issue = response.data?.createIssue?.issue;

    // Invalidate cache for this repository
    this.cache.invalidateRepository(dto.owner, dto.repo);

    return {
      data: {
        id: issue.id,
        number: issue.number,
        title: issue.title,
        body: issue.body,
        state: issue.state as IssueState,
        url: issue.url,
        createdAt: issue.createdAt,
        updatedAt: issue.updatedAt,
        author: issue.author,
        labels: issue.labels?.nodes || [],
        assignees: issue.assignees?.nodes || [],
      },
    };
  }

  /**
   * Update issue
   */
  async updateIssue(
    owner: string,
    repo: string,
    issueNumber: number,
    dto: UpdateIssueDto,
  ): Promise<GitHubIssue> {
    this.logger.log(`Updating issue #${issueNumber} in ${owner}/${repo}`);

    // First get issue ID
    const issue = await this.getIssue(owner, repo, issueNumber);

    const mutation = `
      mutation($issueId: ID!, $title: String, $body: String, $state: IssueState, $labelIds: [ID!], $assigneeIds: [ID!]) {
        updateIssue(input: {
          id: $issueId
          title: $title
          body: $body
          state: $state
          labelIds: $labelIds
          assigneeIds: $assigneeIds
        }) {
          issue {
            id
            number
            title
            body
            state
            url
            createdAt
            updatedAt
            closedAt
            author {
              login
            }
            labels(first: 10) {
              nodes {
                name
              }
            }
            assignees(first: 10) {
              nodes {
                login
              }
            }
          }
        }
      }
    `;

    // Get label IDs if labels provided
    let labelIds: string[] | undefined;
    if (dto.labels) {
      labelIds = await this.getLabelIds(owner, repo, dto.labels);
    }

    // Get assignee IDs if assignees provided
    let assigneeIds: string[] | undefined;
    if (dto.assignees) {
      assigneeIds = await this.getUserIds(dto.assignees);
    }

    const response = await this.githubClient.executeGraphQL<any>({
      query: mutation,
      variables: {
        issueId: issue.id,
        title: dto.title,
        body: dto.body,
        state: dto.state?.toUpperCase(),
        labelIds,
        assigneeIds,
      },
    });

    if (!response.success) {
      this.logger.error(`Failed to update issue #${issueNumber}: ${response.error?.message}`);
      throw new Error(response.error?.message || 'Failed to update issue');
    }

    const updatedIssue = response.data?.updateIssue?.issue;

    // Invalidate cache for this repository
    this.cache.invalidateRepository(owner, repo);

    return {
      id: updatedIssue.id,
      number: updatedIssue.number,
      title: updatedIssue.title,
      body: updatedIssue.body,
      state: updatedIssue.state as IssueState,
      url: updatedIssue.url,
      createdAt: updatedIssue.createdAt,
      updatedAt: updatedIssue.updatedAt,
      closedAt: updatedIssue.closedAt,
      author: updatedIssue.author,
      labels: updatedIssue.labels?.nodes || [],
      assignees: updatedIssue.assignees?.nodes || [],
    };
  }

  /**
   * Close issue
   * AC-2.2.b: POST close updates state to closed
   */
  async closeIssue(owner: string, repo: string, issueNumber: number): Promise<GitHubIssue> {
    this.logger.log(`Closing issue #${issueNumber} in ${owner}/${repo}`);

    // First get issue ID
    const issue = await this.getIssue(owner, repo, issueNumber);

    const mutation = `
      mutation($issueId: ID!) {
        closeIssue(input: { issueId: $issueId }) {
          issue {
            id
            number
            title
            body
            state
            url
            createdAt
            updatedAt
            closedAt
            author {
              login
            }
            labels(first: 10) {
              nodes {
                name
              }
            }
            assignees(first: 10) {
              nodes {
                login
              }
            }
          }
        }
      }
    `;

    const response = await this.githubClient.executeGraphQL<any>({
      query: mutation,
      variables: { issueId: issue.id },
    });

    if (!response.success) {
      this.logger.error(`Failed to close issue #${issueNumber}: ${response.error?.message}`);
      throw new Error(response.error?.message || 'Failed to close issue');
    }

    const closedIssue = response.data?.closeIssue?.issue;

    // Invalidate cache for this repository
    this.cache.invalidateRepository(owner, repo);

    return {
      id: closedIssue.id,
      number: closedIssue.number,
      title: closedIssue.title,
      body: closedIssue.body,
      state: closedIssue.state as IssueState,
      url: closedIssue.url,
      createdAt: closedIssue.createdAt,
      updatedAt: closedIssue.updatedAt,
      closedAt: closedIssue.closedAt,
      author: closedIssue.author,
      labels: closedIssue.labels?.nodes || [],
      assignees: closedIssue.assignees?.nodes || [],
    };
  }

  /**
   * Link issue to project and optionally update status
   * AC-2.2.c: POST link adds issue to project and updates status
   * AC-2.2.e: Project link failure still creates issue with warning
   */
  async linkIssueToProject(
    owner: string,
    repo: string,
    issueNumber: number,
    dto: LinkIssueDto,
  ): Promise<IssueResponseWithWarnings<{ itemId: string; issue: GitHubIssue }>> {
    this.logger.log(`Linking issue #${issueNumber} to project ${dto.projectId}`);

    const warnings: string[] = [];

    // Get issue details
    const issue = await this.getIssue(owner, repo, issueNumber);

    // Add issue to project
    const addMutation = `
      mutation($projectId: ID!, $contentId: ID!) {
        addProjectV2ItemById(input: {
          projectId: $projectId
          contentId: $contentId
        }) {
          item {
            id
          }
        }
      }
    `;

    const addResponse = await this.githubClient.executeGraphQL<any>({
      query: addMutation,
      variables: {
        projectId: dto.projectId,
        contentId: issue.id,
      },
    });

    if (!addResponse.success) {
      const errorMsg = `Failed to add issue to project: ${addResponse.error?.message}`;
      this.logger.error(errorMsg);
      throw new Error(errorMsg);
    }

    const itemId = addResponse.data?.addProjectV2ItemById?.item?.id;

    if (!itemId) {
      throw new Error('Failed to get project item ID after adding to project');
    }

    this.logger.log(`Issue #${issueNumber} added to project with item ID: ${itemId}`);

    // Update status if provided
    if (dto.status) {
      try {
        await this.updateProjectItemStatus(dto.projectId, itemId, dto.status);
        this.logger.log(`Updated project item status to: ${dto.status}`);
      } catch (error: any) {
        const warning = `Issue added to project but status update failed: ${error.message}`;
        warnings.push(warning);
        this.logger.warn(warning);
      }
    }

    // Update priority if provided
    if (dto.priority) {
      try {
        await this.updateProjectItemField(dto.projectId, itemId, 'Priority', dto.priority);
        this.logger.log(`Updated project item priority to: ${dto.priority}`);
      } catch (error: any) {
        const warning = `Issue added to project but priority update failed: ${error.message}`;
        warnings.push(warning);
        this.logger.warn(warning);
      }
    }

    return {
      data: { itemId, issue },
      warnings: warnings.length > 0 ? warnings : undefined,
    };
  }

  /**
   * Helper: Get repository ID
   */
  private async getRepositoryId(owner: string, repo: string): Promise<string> {
    const query = `
      query($owner: String!, $name: String!) {
        repository(owner: $owner, name: $name) {
          id
        }
      }
    `;

    const response = await this.githubClient.executeGraphQL<any>({
      query,
      variables: { owner, name: repo },
    });

    if (!response.success || !response.data?.repository?.id) {
      throw new Error(`Repository ${owner}/${repo} not found`);
    }

    return response.data.repository.id;
  }

  /**
   * Helper: Get label IDs from label names
   */
  private async getLabelIds(owner: string, repo: string, labelNames: string[]): Promise<string[]> {
    const query = `
      query($owner: String!, $name: String!, $first: Int!) {
        repository(owner: $owner, name: $name) {
          labels(first: $first) {
            nodes {
              id
              name
            }
          }
        }
      }
    `;

    const response = await this.githubClient.executeGraphQL<any>({
      query,
      variables: { owner, name: repo, first: 100 },
    });

    if (!response.success) {
      this.logger.warn(`Failed to fetch labels, continuing without them`);
      return [];
    }

    const labels = response.data?.repository?.labels?.nodes || [];
    return labels
      .filter((label: any) => labelNames.includes(label.name))
      .map((label: any) => label.id);
  }

  /**
   * Helper: Get user IDs from usernames
   */
  private async getUserIds(usernames: string[]): Promise<string[]> {
    const userIds: string[] = [];

    for (const username of usernames) {
      const query = `
        query($login: String!) {
          user(login: $login) {
            id
          }
        }
      `;

      const response = await this.githubClient.executeGraphQL<any>({
        query,
        variables: { login: username },
      });

      if (response.success && response.data?.user?.id) {
        userIds.push(response.data.user.id);
      } else {
        this.logger.warn(`User ${username} not found, skipping`);
      }
    }

    return userIds;
  }

  /**
   * Helper: Update project item status field
   */
  private async updateProjectItemStatus(
    projectId: string,
    itemId: string,
    statusValue: string,
  ): Promise<void> {
    // First, get the project's Status field ID and option ID
    const fieldInfo = await this.getProjectStatusField(projectId, statusValue);

    if (!fieldInfo) {
      throw new Error(`Status field or value "${statusValue}" not found in project`);
    }

    const mutation = `
      mutation($projectId: ID!, $itemId: ID!, $fieldId: ID!, $value: ProjectV2FieldValue!) {
        updateProjectV2ItemFieldValue(input: {
          projectId: $projectId
          itemId: $itemId
          fieldId: $fieldId
          value: $value
        }) {
          projectV2Item {
            id
          }
        }
      }
    `;

    const response = await this.githubClient.executeGraphQL<any>({
      query: mutation,
      variables: {
        projectId,
        itemId,
        fieldId: fieldInfo.fieldId,
        value: { singleSelectOptionId: fieldInfo.optionId },
      },
    });

    if (!response.success) {
      throw new Error(`Failed to update status: ${response.error?.message}`);
    }
  }

  /**
   * Helper: Update project item custom field
   */
  private async updateProjectItemField(
    projectId: string,
    itemId: string,
    fieldName: string,
    value: string,
  ): Promise<void> {
    // Get field info
    const fieldInfo = await this.getProjectField(projectId, fieldName, value);

    if (!fieldInfo) {
      throw new Error(`Field "${fieldName}" with value "${value}" not found in project`);
    }

    const mutation = `
      mutation($projectId: ID!, $itemId: ID!, $fieldId: ID!, $value: ProjectV2FieldValue!) {
        updateProjectV2ItemFieldValue(input: {
          projectId: $projectId
          itemId: $itemId
          fieldId: $fieldId
          value: $value
        }) {
          projectV2Item {
            id
          }
        }
      }
    `;

    const response = await this.githubClient.executeGraphQL<any>({
      query: mutation,
      variables: {
        projectId,
        itemId,
        fieldId: fieldInfo.fieldId,
        value: { singleSelectOptionId: fieldInfo.optionId },
      },
    });

    if (!response.success) {
      throw new Error(`Failed to update ${fieldName}: ${response.error?.message}`);
    }
  }

  /**
   * Helper: Get project Status field and option IDs
   */
  private async getProjectStatusField(
    projectId: string,
    statusValue: string,
  ): Promise<{ fieldId: string; optionId: string } | null> {
    const query = `
      query($projectId: ID!) {
        node(id: $projectId) {
          ... on ProjectV2 {
            fields(first: 20) {
              nodes {
                ... on ProjectV2SingleSelectField {
                  id
                  name
                  options {
                    id
                    name
                  }
                }
              }
            }
          }
        }
      }
    `;

    const response = await this.githubClient.executeGraphQL<any>({
      query,
      variables: { projectId },
    });

    if (!response.success) {
      return null;
    }

    const fields = response.data?.node?.fields?.nodes || [];
    const statusField = fields.find((f: any) => f.name === 'Status');

    if (!statusField) {
      return null;
    }

    const option = statusField.options?.find((o: any) => o.name === statusValue);

    if (!option) {
      return null;
    }

    return {
      fieldId: statusField.id,
      optionId: option.id,
    };
  }

  /**
   * Helper: Get project field and option IDs
   */
  private async getProjectField(
    projectId: string,
    fieldName: string,
    value: string,
  ): Promise<{ fieldId: string; optionId: string } | null> {
    const query = `
      query($projectId: ID!) {
        node(id: $projectId) {
          ... on ProjectV2 {
            fields(first: 20) {
              nodes {
                ... on ProjectV2SingleSelectField {
                  id
                  name
                  options {
                    id
                    name
                  }
                }
              }
            }
          }
        }
      }
    `;

    const response = await this.githubClient.executeGraphQL<any>({
      query,
      variables: { projectId },
    });

    if (!response.success) {
      return null;
    }

    const fields = response.data?.node?.fields?.nodes || [];
    const field = fields.find((f: any) => f.name === fieldName);

    if (!field) {
      return null;
    }

    const option = field.options?.find((o: any) => o.name === value);

    if (!option) {
      return null;
    }

    return {
      fieldId: field.id,
      optionId: option.id,
    };
  }

  /**
   * Helper: Map state filter to GraphQL enum
   */
  private mapStateFilter(state?: string): string[] | null {
    if (!state || state === 'all') {
      return null;
    }
    return [state.toUpperCase()];
  }

  /**
   * Helper: Build cache key from filters
   */
  private buildCacheKey(owner: string, repo: string, filters: ListIssuesDto): string {
    const parts = [`${owner}/${repo}`];

    if (filters.state) parts.push(`state:${filters.state}`);
    if (filters.labels) parts.push(`labels:${filters.labels}`);
    if (filters.assignee) parts.push(`assignee:${filters.assignee}`);
    if (filters.creator) parts.push(`creator:${filters.creator}`);
    if (filters.sort) parts.push(`sort:${filters.sort}`);
    if (filters.direction) parts.push(`dir:${filters.direction}`);

    return parts.join('|');
  }
}
