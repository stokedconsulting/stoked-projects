"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.GitHubAPI = void 0;
const vscode = __importStar(require("vscode"));
class GitHubAPI {
    session;
    _outputChannel;
    constructor(outputChannel) {
        this._outputChannel = outputChannel;
    }
    async initialize() {
        try {
            this.session = await vscode.authentication.getSession("github", ["repo", "read:org", "read:project", "project"], { createIfNone: true });
            return !!this.session;
        }
        catch (e) {
            console.error("Failed to initialize GitHub API:", e);
            vscode.window.showErrorMessage("Failed to authenticate with GitHub.");
            return false;
        }
    }
    async fetchGraphQL(query, variables) {
        if (!this.session)
            return { data: null, errors: ["No session"] };
        try {
            const response = await fetch("https://api.github.com/graphql", {
                method: "POST",
                headers: {
                    Authorization: `Bearer ${this.session.accessToken}`,
                    "Content-Type": "application/json",
                    "User-Agent": "VS Code Extension (stoked-projects-vscode)",
                },
                body: JSON.stringify({ query, variables }),
            });
            const result = (await response.json());
            return {
                data: result.data,
                errors: result.errors || null,
            };
        }
        catch (error) {
            console.error("Fetch error:", error);
            return { data: null, errors: [String(error)] };
        }
    }
    async getLinkedProjects(owner, repo) {
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
            const forbidden = errors.find((e) => e.type === "FORBIDDEN" ||
                e.message?.includes("OAuth App access restrictions"));
            if (forbidden) {
                return {
                    projects: [],
                    error: `Organization has OAuth App access restrictions enabled. Please grant access to VS Code in your Organization Settings on GitHub: https://github.com/organizations/${owner}/settings/oauth_application_policy`,
                };
            }
        }
        const nodes = data?.repository?.projectsV2?.nodes || [];
        const repositoryId = data?.repository?.id;
        // Filter nulls
        const projects = nodes.filter((n) => n !== null);
        return { projects, repositoryId, errors: errors || undefined };
    }
    async getProjectItems(projectId) {
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
            .filter((node) => node !== null)
            .map((node) => {
            const fieldValues = {};
            if (node.fieldValues && node.fieldValues.nodes) {
                node.fieldValues.nodes.forEach((fv) => {
                    if (!fv.field)
                        return;
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
                fieldValues,
            };
        });
    }
    async getOrganizationProjects(owner) {
        // First try organization query - include repositories to filter out linked projects
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
        const { data: orgData, errors: orgErrors } = await this.fetchGraphQL(orgQuery, { owner });
        // Log any errors for debugging
        if (orgErrors && this._outputChannel) {
            this._outputChannel.appendLine(`[stoked-projects] Organization query errors for ${owner}: ${JSON.stringify(orgErrors)}`);
        }
        const orgNodes = orgData?.organization?.projectsV2?.nodes || [];
        if (this._outputChannel) {
            this._outputChannel.appendLine(`[stoked-projects] Organization query raw results for ${owner}:`);
            orgNodes.forEach((n) => {
                if (n !== null) {
                    this._outputChannel.appendLine(`  - #${n.number}: ${n.title} (linked repos: ${n.repositories?.totalCount})`);
                }
            });
        }
        // Filter out nulls AND projects that are linked to any repository
        const orgProjects = orgNodes
            .filter((n) => n !== null && n.repositories?.totalCount === 0)
            .map((n) => ({
            id: n.id,
            number: n.number,
            title: n.title,
            url: n.url,
        }));
        if (this._outputChannel) {
            this._outputChannel.appendLine(`[stoked-projects] Organization query returned ${orgProjects.length} unlinked projects for ${owner} (filtered from ${orgNodes.length} total)`);
            if (orgProjects.length > 0) {
                this._outputChannel.appendLine(`  Unlinked org projects: ${orgProjects.map((p) => `#${p.number}`).join(", ")}`);
            }
        }
        // If organization query found projects, return them
        if (orgProjects.length > 0) {
            return orgProjects;
        }
        // Fallback: try user query (owner might be a user, not an org)
        if (this._outputChannel) {
            this._outputChannel.appendLine(`[stoked-projects] Trying user query fallback for ${owner}`);
        }
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
        const { data: userData, errors: userErrors } = await this.fetchGraphQL(userQuery, { owner });
        if (userErrors && this._outputChannel) {
            this._outputChannel.appendLine(`[stoked-projects] User query errors for ${owner}: ${JSON.stringify(userErrors)}`);
        }
        const userNodes = userData?.user?.projectsV2?.nodes || [];
        if (this._outputChannel) {
            this._outputChannel.appendLine(`[stoked-projects] User query raw results for ${owner}:`);
            userNodes.forEach((n) => {
                if (n !== null) {
                    this._outputChannel.appendLine(`  - #${n.number}: ${n.title} (linked repos: ${n.repositories?.totalCount})`);
                }
            });
        }
        // Filter out nulls AND projects that are linked to any repository
        const userProjects = userNodes
            .filter((n) => n !== null && n.repositories?.totalCount === 0)
            .map((n) => ({
            id: n.id,
            number: n.number,
            title: n.title,
            url: n.url,
        }));
        if (this._outputChannel) {
            this._outputChannel.appendLine(`[stoked-projects] User query returned ${userProjects.length} unlinked projects for ${owner} (filtered from ${userNodes.length} total)`);
            if (userProjects.length > 0) {
                this._outputChannel.appendLine(`  Unlinked user projects: ${userProjects.map((p) => `#${p.number}`).join(", ")}`);
            }
        }
        return userProjects;
    }
    async getProjectFields(projectId) {
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
    async updateItemFieldValue(projectId, itemId, fieldId, optionId) {
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
            console.error("Update failed:", errors);
            return false;
        }
        return true;
    }
    async deleteProjectItem(projectId, itemId) {
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
            console.error("Delete failed:", errors);
            return false;
        }
        return true;
    }
    async deleteProject(projectId) {
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
            console.error("Delete project failed:", errors);
            return false;
        }
        return true;
    }
    async linkProjectToRepository(projectId, repositoryId) {
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
        const { errors } = await this.fetchGraphQL(query, {
            projectId,
            repositoryId,
        });
        if (errors) {
            console.error("Link project to repository failed:", errors);
            return false;
        }
        return true;
    }
    async unlinkProjectFromRepository(projectId, repositoryId) {
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
        const { errors } = await this.fetchGraphQL(query, {
            projectId,
            repositoryId,
        });
        if (errors) {
            console.error("Unlink project from repository failed:", errors);
            return false;
        }
        return true;
    }
    async getRepositoryId(owner, repo) {
        const query = `
        query($owner: String!, $repo: String!) {
          repository(owner: $owner, name: $repo) {
            id
          }
        }
        `;
        const { data, errors } = await this.fetchGraphQL(query, { owner, repo });
        if (errors || !data?.repository?.id) {
            console.error("Failed to get repository ID:", {
                owner,
                repo,
                errors,
                data,
            });
            if (this._outputChannel) {
                this._outputChannel.appendLine(`[stoked-projects] Failed to get repository ID for ${owner}/${repo}`);
                this._outputChannel.appendLine(`  Errors: ${JSON.stringify(errors)}`);
                this._outputChannel.appendLine(`  Data: ${JSON.stringify(data)}`);
            }
            return null;
        }
        return data.repository.id;
    }
    async closeIssue(owner, repo, issueNumber) {
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
            console.error("Failed to get issue ID:", idErrors);
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
            console.error("Close issue failed:", errors);
            return false;
        }
        return true;
    }
    /**
     * Update workspace orchestration desired count
     * Not implemented for direct GraphQL - use APIClient instead
     */
    async updateWorkspaceDesired(workspaceId, desired) {
        throw new Error('Orchestration not supported in direct GraphQL mode. Use APIClient instead.');
    }
    /**
     * Get workspace orchestration data
     * Not implemented for direct GraphQL - use APIClient instead
     */
    async getWorkspaceOrchestration(workspaceId) {
        throw new Error('Orchestration not supported in direct GraphQL mode. Use APIClient instead.');
    }
}
exports.GitHubAPI = GitHubAPI;
//# sourceMappingURL=github-api.js.map