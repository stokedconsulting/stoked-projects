import { Injectable, Logger, HttpException, HttpStatus } from '@nestjs/common';
import { Octokit } from '@octokit/rest';
import { GitHubAuthService } from '../auth/github-auth.service';

export interface Project {
  id: string;
  number: number;
  title: string;
  url: string;
}

export interface ProjectItem {
  id: string;
  databaseId?: number;
  content: {
    title: string;
    body: string;
    state: string;
    number: number;
    url: string;
    repository: {
      name: string;
      owner: {
        login: string;
      };
    };
  };
  fieldValues: Record<string, string>;
}

export interface ProjectField {
  id: string;
  name: string;
  options?: Array<{ id: string; name: string }>;
}

@Injectable()
export class ProjectsService {
  private readonly logger = new Logger(ProjectsService.name);

  constructor(private readonly githubAuth: GitHubAuthService) {}

  /**
   * Get authenticated Octokit instance
   */
  private async getOctokit(): Promise<Octokit> {
    const tokenMetadata = await this.githubAuth.getToken([
      'repo',
      'read:org',
      'read:project',
      'project',
    ]);

    return new Octokit({
      auth: tokenMetadata.token,
      userAgent: 'api/1.0.0',
    });
  }

  /**
   * Execute GraphQL query against GitHub API
   */
  private async fetchGraphQL(
    query: string,
    variables: any,
  ): Promise<{ data: any; errors: any[] | null }> {
    const octokit = await this.getOctokit();

    try {
      const response = await octokit.graphql(query, variables);
      return {
        data: response,
        errors: null,
      };
    } catch (error: any) {
      this.logger.error('GraphQL query failed', { error: error.message, variables });

      // Parse GraphQL errors
      if (error.errors) {
        return {
          data: null,
          errors: error.errors,
        };
      }

      throw new HttpException(
        `GitHub API error: ${error.message}`,
        HttpStatus.BAD_GATEWAY,
      );
    }
  }

  /**
   * Get projects linked to a repository
   */
  async getLinkedProjects(
    owner: string,
    repo: string,
  ): Promise<{ projects: Project[]; repositoryId?: string; error?: string; errors?: any[] }> {
    const query = `
      query($owner: String!, $repo: String!) {
        repository(owner: $owner, name: $repo) {
          id
          projectsV2(first: 100) {
            nodes {
              id
              number
              title
              url
            }
          }
        }
      }
    `;

    const { data, errors } = await this.fetchGraphQL(query, { owner, repo });

    if (errors) {
      const forbidden = errors.find(
        (e: any) =>
          e.type === 'FORBIDDEN' || e.message?.includes('OAuth App access restrictions'),
      );
      if (forbidden) {
        return {
          projects: [],
          error: `Organization has OAuth App access restrictions enabled. Please grant access in your Organization Settings on GitHub: https://github.com/organizations/${owner}/settings/oauth_application_policy`,
        };
      }
      return { projects: [], errors };
    }

    const nodes = data?.repository?.projectsV2?.nodes || [];
    const repositoryId = data?.repository?.id;
    const projects = nodes.filter((n: any) => n !== null);
    return { projects, repositoryId };
  }

  /**
   * Get organization projects (not linked to any repository)
   */
  async getOrganizationProjects(owner: string): Promise<Project[]> {
    // Try organization first
    const orgQuery = `
      query($owner: String!) {
        organization(login: $owner) {
          projectsV2(first: 100) {
            nodes {
              id
              number
              title
              url
              repositories(first: 1) {
                totalCount
              }
            }
          }
        }
      }
    `;

    const { data: orgData } = await this.fetchGraphQL(orgQuery, { owner });
    const orgNodes = orgData?.organization?.projectsV2?.nodes || [];

    // Filter unlinked projects
    const orgProjects = orgNodes
      .filter((n: any) => n !== null && n.repositories?.totalCount === 0)
      .map((n: any) => ({ id: n.id, number: n.number, title: n.title, url: n.url }));

    if (orgProjects.length > 0) {
      return orgProjects;
    }

    // Fallback to user query
    const userQuery = `
      query($owner: String!) {
        user(login: $owner) {
          projectsV2(first: 100) {
            nodes {
              id
              number
              title
              url
              repositories(first: 1) {
                totalCount
              }
            }
          }
        }
      }
    `;

    const { data: userData } = await this.fetchGraphQL(userQuery, { owner });
    const userNodes = userData?.user?.projectsV2?.nodes || [];

    const userProjects = userNodes
      .filter((n: any) => n !== null && n.repositories?.totalCount === 0)
      .map((n: any) => ({ id: n.id, number: n.number, title: n.title, url: n.url }));

    return userProjects;
  }

  /**
   * Get project items
   */
  async getProjectItems(projectId: string): Promise<ProjectItem[]> {
    const query = `
      query($projectId: ID!) {
        node(id: $projectId) {
          ... on ProjectV2 {
            items(first: 100) {
              nodes {
                id
                databaseId
                fieldValues(first: 10) {
                  nodes {
                    ... on ProjectV2ItemFieldTextValue {
                      text
                      field { ... on ProjectV2FieldCommon { name } }
                    }
                    ... on ProjectV2ItemFieldDateValue {
                      date
                      field { ... on ProjectV2FieldCommon { name } }
                    }
                    ... on ProjectV2ItemFieldSingleSelectValue {
                      name
                      field { ... on ProjectV2FieldCommon { name } }
                    }
                    ... on ProjectV2ItemFieldNumberValue {
                      number
                      field { ... on ProjectV2FieldCommon { name } }
                    }
                  }
                }
                content {
                  ... on Issue {
                    title
                    body
                    state
                    number
                    url
                    repository {
                      name
                      owner { login }
                    }
                  }
                  ... on PullRequest {
                    title
                    body
                    state
                    number
                    url
                    repository {
                      name
                      owner { login }
                    }
                  }
                  ... on DraftIssue {
                    title
                    body
                  }
                }
              }
            }
          }
        }
      }
    `;

    const { data } = await this.fetchGraphQL(query, { projectId });
    const nodes = data?.node?.items?.nodes || [];

    return nodes
      .filter((node: any) => node !== null)
      .map((node: any) => {
        const fieldValues: Record<string, string> = {};
        if (node.fieldValues && node.fieldValues.nodes) {
          node.fieldValues.nodes.forEach((fv: any) => {
            if (!fv.field) return;
            const fieldName = fv.field.name;
            const value = fv.text || fv.name || fv.date || fv.number;
            if (value !== undefined) {
              fieldValues[fieldName] = String(value);
            }
          });
        }

        return {
          id: node.id,
          databaseId: node.databaseId,
          content: node.content,
          fieldValues,
        };
      });
  }

  /**
   * Get project fields (for updates)
   */
  async getProjectFields(projectId: string): Promise<ProjectField[]> {
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

    const { data } = await this.fetchGraphQL(query, { projectId });
    return data?.node?.fields?.nodes || [];
  }

  /**
   * Update project item field value
   */
  async updateItemFieldValue(
    projectId: string,
    itemId: string,
    fieldId: string,
    optionId: string,
  ): Promise<boolean> {
    const query = `
      mutation($projectId: ID!, $itemId: ID!, $fieldId: ID!, $optionId: String!) {
        updateProjectV2ItemFieldValue(input: {
          projectId: $projectId
          itemId: $itemId
          fieldId: $fieldId
          value: {
            singleSelectOptionId: $optionId
          }
        }) {
          projectV2Item {
            id
          }
        }
      }
    `;

    const { errors } = await this.fetchGraphQL(query, {
      projectId,
      itemId,
      fieldId,
      optionId,
    });

    if (errors) {
      this.logger.error('Update failed', { errors });
      return false;
    }
    return true;
  }

  /**
   * Delete project item
   */
  async deleteProjectItem(projectId: string, itemId: string): Promise<boolean> {
    const query = `
      mutation($projectId: ID!, $itemId: ID!) {
        deleteProjectV2Item(input: {
          projectId: $projectId
          itemId: $itemId
        }) {
          deletedItemId
        }
      }
    `;

    const { errors } = await this.fetchGraphQL(query, { projectId, itemId });

    if (errors) {
      this.logger.error('Delete failed', { errors });
      return false;
    }
    return true;
  }

  /**
   * Delete project
   */
  async deleteProject(projectId: string): Promise<boolean> {
    const query = `
      mutation($projectId: ID!) {
        deleteProjectV2(input: {
          projectId: $projectId
        }) {
          projectV2 {
            id
          }
        }
      }
    `;

    const { errors } = await this.fetchGraphQL(query, { projectId });

    if (errors) {
      this.logger.error('Delete project failed', { errors });
      return false;
    }
    return true;
  }

  /**
   * Link project to repository
   */
  async linkProjectToRepository(projectId: string, repositoryId: string): Promise<boolean> {
    const query = `
      mutation($projectId: ID!, $repositoryId: ID!) {
        linkProjectV2ToRepository(input: {
          projectId: $projectId
          repositoryId: $repositoryId
        }) {
          repository {
            id
          }
        }
      }
    `;

    const { errors } = await this.fetchGraphQL(query, { projectId, repositoryId });

    if (errors) {
      this.logger.error('Link project to repository failed', { errors });
      return false;
    }
    return true;
  }

  /**
   * Unlink project from repository
   */
  async unlinkProjectFromRepository(projectId: string, repositoryId: string): Promise<boolean> {
    const query = `
      mutation($projectId: ID!, $repositoryId: ID!) {
        unlinkProjectV2FromRepository(input: {
          projectId: $projectId
          repositoryId: $repositoryId
        }) {
          repository {
            id
          }
        }
      }
    `;

    const { errors } = await this.fetchGraphQL(query, { projectId, repositoryId });

    if (errors) {
      this.logger.error('Unlink project from repository failed', { errors });
      return false;
    }
    return true;
  }

  /**
   * Get repository ID
   */
  async getRepositoryId(owner: string, repo: string): Promise<string | null> {
    const query = `
      query($owner: String!, $repo: String!) {
        repository(owner: $owner, name: $repo) {
          id
        }
      }
    `;

    const { data, errors } = await this.fetchGraphQL(query, { owner, repo });

    if (errors || !data?.repository?.id) {
      this.logger.error('Failed to get repository ID', { owner, repo, errors, data });
      return null;
    }

    return data.repository.id;
  }
}
