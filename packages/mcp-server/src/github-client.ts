import { Octokit } from '@octokit/rest';

/**
 * GitHub client for direct GitHub API operations
 * Uses Octokit GraphQL API for ProjectsV2 and REST for other operations
 */
export class GitHubClient {
  private octokit: Octokit;

  constructor(token: string) {
    this.octokit = new Octokit({
      auth: token,
      userAgent: 'stoked-projects-mcp-server/0.1.0',
    });
  }

  /**
   * Create a new GitHub ProjectV2 (using GraphQL)
   * Note: Classic projects are deprecated, using ProjectsV2
   */
  async createProject(params: {
    owner: string;
    repo?: string;
    name: string;
    body?: string;
  }): Promise<{
    id: string;
    number: number;
    url: string;
    title: string;
  }> {
    const { owner, repo, name } = params;

    // Get owner ID first (repo or org)
    let ownerId: string;
    if (repo) {
      const repoData = await this.octokit.repos.get({ owner, repo });
      ownerId = repoData.data.node_id;
    } else {
      const orgData = await this.octokit.orgs.get({ org: owner });
      ownerId = orgData.data.node_id;
    }

    // Create ProjectV2 via GraphQL
    const query = `
      mutation($ownerId: ID!, $title: String!) {
        createProjectV2(input: {ownerId: $ownerId, title: $title}) {
          projectV2 {
            id
            number
            url
            title
          }
        }
      }
    `;

    const response = await this.octokit.graphql<{
      createProjectV2: {
        projectV2: {
          id: string;
          number: number;
          url: string;
          title: string;
        };
      };
    }>(query, {
      ownerId,
      title: name,
    });

    return response.createProjectV2.projectV2;
  }

  /**
   * Update a GitHub ProjectV2 (using GraphQL)
   */
  async updateProject(params: {
    projectId: string;
    name?: string;
    body?: string;
    state?: 'open' | 'closed';
  }): Promise<{
    id: string;
    number: number;
    url: string;
    title: string;
  }> {
    const query = `
      mutation($projectId: ID!, $title: String, $closed: Boolean) {
        updateProjectV2(input: {projectId: $projectId, title: $title, closed: $closed}) {
          projectV2 {
            id
            number
            url
            title
          }
        }
      }
    `;

    const response = await this.octokit.graphql<{
      updateProjectV2: {
        projectV2: {
          id: string;
          number: number;
          url: string;
          title: string;
        };
      };
    }>(query, {
      projectId: params.projectId,
      title: params.name,
      closed: params.state === 'closed',
    });

    return response.updateProjectV2.projectV2;
  }

  /**
   * List ProjectsV2 for a repository or organization (using GraphQL)
   */
  async listProjects(params: {
    owner: string;
    repo?: string;
  }): Promise<
    Array<{
      id: string;
      number: number;
      name: string;
      body: string | null;
      state: string;
      url: string;
    }>
  > {
    const { owner, repo } = params;

    const query = repo
      ? `
      query($owner: String!, $repo: String!) {
        repository(owner: $owner, name: $repo) {
          projectsV2(first: 100) {
            nodes {
              id
              number
              title
              shortDescription
              closed
              url
            }
          }
        }
      }
    `
      : `
      query($org: String!) {
        organization(login: $org) {
          projectsV2(first: 100) {
            nodes {
              id
              number
              title
              shortDescription
              closed
              url
            }
          }
        }
      }
    `;

    const response = await this.octokit.graphql<any>(
      query,
      repo ? { owner, repo } : { org: owner }
    );

    const projects = repo
      ? response.repository.projectsV2.nodes
      : response.organization.projectsV2.nodes;

    return projects.map((project: any) => ({
      id: project.id,
      number: project.number,
      name: project.title,
      body: project.shortDescription || null,
      state: project.closed ? 'closed' : 'open',
      url: project.url,
    }));
  }

  /**
   * Create an issue
   */
  async createIssue(params: {
    owner: string;
    repo: string;
    title: string;
    body?: string;
    assignees?: string[];
    labels?: string[];
  }): Promise<{
    number: number;
    id: string;
    url: string;
    title: string;
    state: string;
  }> {
    const response = await this.octokit.issues.create({
      owner: params.owner,
      repo: params.repo,
      title: params.title,
      body: params.body,
      assignees: params.assignees,
      labels: params.labels,
    });

    return {
      number: response.data.number,
      id: response.data.node_id,
      url: response.data.html_url,
      title: response.data.title,
      state: response.data.state,
    };
  }

  /**
   * Update an issue
   */
  async updateIssue(params: {
    owner: string;
    repo: string;
    issueNumber: number;
    title?: string;
    body?: string;
    state?: 'open' | 'closed';
    assignees?: string[];
    labels?: string[];
  }): Promise<{
    number: number;
    id: string;
    url: string;
    title: string;
    state: string;
  }> {
    const response = await this.octokit.issues.update({
      owner: params.owner,
      repo: params.repo,
      issue_number: params.issueNumber,
      title: params.title,
      body: params.body,
      state: params.state,
      assignees: params.assignees,
      labels: params.labels,
    });

    return {
      number: response.data.number,
      id: response.data.node_id,
      url: response.data.html_url,
      title: response.data.title,
      state: response.data.state,
    };
  }

  /**
   * Close an issue
   */
  async closeIssue(params: {
    owner: string;
    repo: string;
    issueNumber: number;
  }): Promise<{
    number: number;
    id: string;
    url: string;
    state: string;
  }> {
    const response = await this.octokit.issues.update({
      owner: params.owner,
      repo: params.repo,
      issue_number: params.issueNumber,
      state: 'closed',
    });

    return {
      number: response.data.number,
      id: response.data.node_id,
      url: response.data.html_url,
      state: response.data.state,
    };
  }

  /**
   * Get repository metadata
   */
  async getRepo(params: {
    owner: string;
    repo: string;
  }): Promise<{
    id: string;
    name: string;
    fullName: string;
    description: string | null;
    url: string;
    private: boolean;
    defaultBranch: string;
  }> {
    const response = await this.octokit.repos.get({
      owner: params.owner,
      repo: params.repo,
    });

    return {
      id: response.data.node_id,
      name: response.data.name,
      fullName: response.data.full_name,
      description: response.data.description || null,
      url: response.data.html_url,
      private: response.data.private,
      defaultBranch: response.data.default_branch,
    };
  }

  /**
   * Get organization metadata
   */
  async getOrg(params: { org: string }): Promise<{
    id: string;
    login: string;
    name: string | null;
    description: string | null;
    url: string;
    publicRepos: number;
  }> {
    const response = await this.octokit.orgs.get({
      org: params.org,
    });

    return {
      id: response.data.node_id,
      login: response.data.login,
      name: response.data.name || null,
      description: response.data.description || null,
      url: response.data.html_url,
      publicRepos: response.data.public_repos,
    };
  }

  /**
   * Link issue to project (using GraphQL for ProjectV2)
   */
  async linkIssueToProject(params: {
    projectId: string;
    issueId: string;
  }): Promise<{ itemId: string }> {
    const query = `
      mutation($projectId: ID!, $contentId: ID!) {
        addProjectV2ItemById(input: {projectId: $projectId, contentId: $contentId}) {
          item {
            id
          }
        }
      }
    `;

    const response = await this.octokit.graphql<{
      addProjectV2ItemById: { item: { id: string } };
    }>(query, {
      projectId: params.projectId,
      contentId: params.issueId,
    });

    return {
      itemId: response.addProjectV2ItemById.item.id,
    };
  }

  /**
   * Link project to repository (using GraphQL for ProjectV2)
   */
  async linkProjectToRepo(params: {
    projectId: string;
    repositoryId: string;
  }): Promise<{ success: boolean }> {
    const query = `
      mutation($projectId: ID!, $repositoryId: ID!) {
        linkProjectV2ToRepository(input: {projectId: $projectId, repositoryId: $repositoryId}) {
          repository {
            id
          }
        }
      }
    `;

    await this.octokit.graphql(query, {
      projectId: params.projectId,
      repositoryId: params.repositoryId,
    });

    return { success: true };
  }
}

/**
 * Create a GitHub client instance with authentication
 */
export function createGitHubClient(token: string): GitHubClient {
  return new GitHubClient(token);
}
