import * as vscode from 'vscode';

export interface Project {
  id: string;
  number: number;
  title: string;
  url: string;
}

export interface ProjectItem {
  id: string;
  databaseId?: number; // Project item number
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
      }
    }
  };
  fieldValues: Record<string, string>;
}

export class GitHubAPI {
  private session: vscode.AuthenticationSession | undefined;

  constructor() { }

  async initialize(): Promise<boolean> {
    try {
      this.session = await vscode.authentication.getSession('github', ['repo', 'read:org', 'read:project', 'project'], { createIfNone: true });
      return !!this.session;
    } catch (e) {
      console.error('Failed to initialize GitHub API:', e);
      vscode.window.showErrorMessage('Failed to authenticate with GitHub.');
      return false;
    }
  }

  private async fetchGraphQL(query: string, variables: any): Promise<{ data: any, errors: any[] | null }> {
    if (!this.session) return { data: null, errors: ['No session'] };

    try {
      const response = await fetch('https://api.github.com/graphql', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.session.accessToken}`,
          'Content-Type': 'application/json',
          'User-Agent': 'VS Code Extension (gh-projects-vscode)'
        },
        body: JSON.stringify({ query, variables }),
      });

      const result = await response.json() as any;
      return {
        data: result.data,
        errors: result.errors || null
      };
    } catch (error) {
      console.error('Fetch error:', error);
      return { data: null, errors: [String(error)] };
    }
  }

  async getLinkedProjects(owner: string, repo: string): Promise<{ projects: Project[], error?: string, errors?: any[] }> {
    const query = `
            query($owner: String!, $repo: String!) {
                repository(owner: $owner, name: $repo) {
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
      const forbidden = errors.find((e: any) => e.type === 'FORBIDDEN' || e.message?.includes('OAuth App access restrictions'));
      if (forbidden) {
        return { projects: [], error: 'Organization has OAuth App access restrictions enabled. Please grant access to VS Code in your Organization Settings on GitHub.' };
      }
    }

    const nodes = data?.repository?.projectsV2?.nodes || [];
    // Filter nulls
    const projects = nodes.filter((n: any) => n !== null);
    return { projects, errors: errors || undefined };
  }

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
            // Handle different value types
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
          fieldValues
        };
      });
  }
  async getOrganizationProjects(owner: string): Promise<Project[]> {
    const query = `
            query($owner: String!) {
                organization(login: $owner) {
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

    const { data } = await this.fetchGraphQL(query, { owner });
    const nodes = data?.organization?.projectsV2?.nodes || [];
    return nodes.filter((n: any) => n !== null);
  }

  async getProjectFields(projectId: string): Promise<any[]> {
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

  async updateItemFieldValue(projectId: string, itemId: string, fieldId: string, optionId: string): Promise<boolean> {
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
    const { errors } = await this.fetchGraphQL(query, { projectId, itemId, fieldId, optionId });
    if (errors) {
      console.error('Update failed:', errors);
      return false;
    }
    return true;
  }

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
      console.error('Delete failed:', errors);
      return false;
    }
    return true;
  }

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
      console.error('Delete project failed:', errors);
      return false;
    }
    return true;
  }

  async closeIssue(owner: string, repo: string, issueNumber: number): Promise<boolean> {
    // First, get the issue ID
    const getIdQuery = `
        query($owner: String!, $repo: String!, $issueNumber: Int!) {
          repository(owner: $owner, name: $repo) {
            issueOrPullRequest(number: $issueNumber) {
              ... on Issue {
                id
              }
              ... on PullRequest {
                id
              }
            }
          }
        }
        `;

    const { data: idData, errors: idErrors } = await this.fetchGraphQL(getIdQuery, { owner, repo, issueNumber });

    if (idErrors || !idData?.repository?.issueOrPullRequest?.id) {
      console.error('Failed to get issue ID:', idErrors);
      return false;
    }

    const issueId = idData.repository.issueOrPullRequest.id;

    // Close the issue
    const closeQuery = `
        mutation($issueId: ID!) {
          closeIssue(input: {
            issueId: $issueId
          }) {
            issue {
              id
              state
            }
          }
        }
        `;

    const { errors } = await this.fetchGraphQL(closeQuery, { issueId });
    if (errors) {
      console.error('Close issue failed:', errors);
      return false;
    }
    return true;
  }
}
