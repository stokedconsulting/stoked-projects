import * as vscode from 'vscode';

/**
 * Configuration for API client
 */
export interface APIClientConfig {
  baseUrl?: string;
  timeout?: number;
}

/**
 * Project interface matching extension expectations
 */
export interface Project {
  id: string;
  number: number;
  title: string;
  url: string;
}

/**
 * ProjectItem interface matching extension expectations
 */
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

/**
 * HTTP API Client for GitHub operations
 * Replaces direct GraphQL calls with HTTP requests to api
 */
export class APIClient {
  private baseUrl: string;
  private timeout: number;
  private session: vscode.AuthenticationSession | undefined;
  private _outputChannel?: vscode.OutputChannel;

  constructor(config: APIClientConfig = {}, outputChannel?: vscode.OutputChannel) {
    this.baseUrl = config.baseUrl || 'https://claude-projects.truapi.com';
    this.timeout = config.timeout || 10000;
    this._outputChannel = outputChannel;
  }

  async initialize(): Promise<boolean> {
    // Check if this is a localhost connection
    const isLocalhost = this.baseUrl.includes('localhost') || this.baseUrl.includes('127.0.0.1');

    // For localhost, skip GitHub authentication (API runs in development mode)
    if (isLocalhost) {
      if (this._outputChannel) {
        this._outputChannel.appendLine('[APIClient] Using localhost - skipping GitHub authentication');
      }
      return true;
    }

    // For remote API, require GitHub authentication
    try {
      this.session = await vscode.authentication.getSession(
        'github',
        ['repo', 'read:org', 'read:project', 'project'],
        { createIfNone: true },
      );
      return !!this.session;
    } catch (e) {
      console.error('Failed to initialize API client:', e);
      vscode.window.showErrorMessage('Failed to authenticate with GitHub.');
      return false;
    }
  }

  /**
   * Make HTTP request with authentication and timeout
   */
  private async request<T>(
    method: string,
    path: string,
    body?: any,
  ): Promise<{ data: T | null; error?: string; errors?: any[] }> {
    const url = `${this.baseUrl}${path}`;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeout);

    // Check if this is a localhost connection
    const isLocalhost = this.baseUrl.includes('localhost') || this.baseUrl.includes('127.0.0.1');

    try {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      };

      // Only add authentication headers for non-localhost URLs
      // Localhost API runs in development mode and allows unauthenticated access
      if (!isLocalhost) {
        if (!this.session) {
          return { data: null, error: 'Not authenticated' };
        }
        headers['x-api-key'] = this.session.accessToken;
        headers['Authorization'] = `Bearer ${this.session.accessToken}`;
      }

      if (this._outputChannel) {
        this._outputChannel.appendLine(`[APIClient] ${method} ${path} (localhost: ${isLocalhost})`);
      }

      const response = await fetch(url, {
        method,
        headers,
        body: body ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const errorBody = await response.json().catch(() => ({}));
        if (this._outputChannel) {
          this._outputChannel.appendLine(
            `[APIClient] Error ${response.status}: ${JSON.stringify(errorBody)}`,
          );
        }
        return {
          data: null,
          error: errorBody.message || `HTTP ${response.status}: ${response.statusText}`,
          errors: errorBody.errors,
        };
      }

      const data = await response.json();
      return { data };
    } catch (error: any) {
      clearTimeout(timeoutId);
      if (error.name === 'AbortError') {
        return { data: null, error: 'Request timeout' };
      }
      if (this._outputChannel) {
        this._outputChannel.appendLine(`[APIClient] Request failed: ${error.message}`);
      }
      return { data: null, error: error.message };
    }
  }

  /**
   * Get projects linked to a repository
   */
  async getLinkedProjects(
    owner: string,
    repo: string,
  ): Promise<{ projects: Project[]; repositoryId?: string; error?: string; errors?: any[] }> {
    return this.request<{ projects: Project[]; repositoryId?: string; error?: string }>(
      'GET',
      `/api/github/projects/linked/${owner}/${repo}`,
    ).then((result) => ({
      projects: result.data?.projects || [],
      repositoryId: result.data?.repositoryId,
      error: result.error || result.data?.error,
      errors: result.errors,
    }));
  }

  /**
   * Get organization projects (unlinked)
   */
  async getOrganizationProjects(owner: string): Promise<Project[]> {
    const result = await this.request<Project[]>('GET', `/api/github/projects/org/${owner}`);
    return result.data || [];
  }

  /**
   * Get project items
   */
  async getProjectItems(projectId: string): Promise<ProjectItem[]> {
    const result = await this.request<ProjectItem[]>(
      'GET',
      `/api/github/projects/${projectId}/items`,
    );
    return result.data || [];
  }

  /**
   * Get project fields
   */
  async getProjectFields(projectId: string): Promise<any[]> {
    const result = await this.request<any[]>('GET', `/api/github/projects/${projectId}/fields`);
    return result.data || [];
  }

  /**
   * Update item field value
   */
  async updateItemFieldValue(
    projectId: string,
    itemId: string,
    fieldId: string,
    optionId: string,
  ): Promise<boolean> {
    const result = await this.request<{ success: boolean }>(
      'POST',
      `/api/github/projects/${projectId}/items/${itemId}/update-field`,
      { fieldId, optionId },
    );
    return result.data?.success || false;
  }

  /**
   * Delete project item
   */
  async deleteProjectItem(projectId: string, itemId: string): Promise<boolean> {
    const result = await this.request<{ success: boolean }>(
      'DELETE',
      `/api/github/projects/${projectId}/items/${itemId}`,
    );
    return result.data?.success || false;
  }

  /**
   * Delete project
   */
  async deleteProject(projectId: string): Promise<boolean> {
    const result = await this.request<{ success: boolean }>(
      'DELETE',
      `/api/github/projects/${projectId}`,
    );
    return result.data?.success || false;
  }

  /**
   * Link project to repository
   */
  async linkProjectToRepository(projectId: string, repositoryId: string): Promise<boolean> {
    const result = await this.request<{ success: boolean }>(
      'POST',
      `/api/github/projects/${projectId}/link`,
      { repositoryId },
    );
    return result.data?.success || false;
  }

  /**
   * Unlink project from repository
   */
  async unlinkProjectFromRepository(projectId: string, repositoryId: string): Promise<boolean> {
    const result = await this.request<{ success: boolean }>(
      'DELETE',
      `/api/github/projects/${projectId}/link`,
      { repositoryId },
    );
    return result.data?.success || false;
  }

  /**
   * Get repository ID
   */
  async getRepositoryId(owner: string, repo: string): Promise<string | null> {
    const result = await this.request<{ repositoryId: string }>(
      'GET',
      `/api/github/projects/repo/${owner}/${repo}/id`,
    );
    return result.data?.repositoryId || null;
  }

  /**
   * Close an issue
   */
  async closeIssue(owner: string, repo: string, issueNumber: number): Promise<boolean> {
    const result = await this.request<{ success: boolean; state: string }>(
      'POST',
      `/api/github/repos/${owner}/${repo}/issues/${issueNumber}/close`,
    );
    return result.data?.success || false;
  }

  /**
   * Update workspace orchestration desired count
   */
  async updateWorkspaceDesired(
    workspaceId: string,
    desired: number,
  ): Promise<{
    workspace: { workspace_id: string; running: number; desired: number };
    global: { running: number; desired: number };
  } | null> {
    const encodedWorkspaceId = encodeURIComponent(workspaceId);
    const result = await this.request<{
      workspace: { workspace_id: string; running: number; desired: number };
      global: { running: number; desired: number };
    }>('PUT', `/api/orchestration/workspace/${encodedWorkspaceId}/desired`, {
      desired,
    });

    // If there's an error, log it and throw
    if (result.error) {
      if (this._outputChannel) {
        this._outputChannel.appendLine(
          `[APIClient] updateWorkspaceDesired failed: ${result.error}`,
        );
      }
      throw new Error(result.error);
    }

    return result.data;
  }

  /**
   * Update worktree status for a project (cached on API + broadcast via Socket.io)
   */
  async updateWorktreeStatus(
    projectNumber: number,
    worktree: {
      hasWorktree: boolean;
      worktreePath: string;
      branch: string;
      hasUncommittedChanges: boolean;
      hasUnpushedCommits: boolean;
      hasPR: boolean;
      prNumber: number | null;
      prMerged: boolean;
    },
    workspaceId?: string,
  ): Promise<void> {
    try {
      await this.request('PUT', `/api/events/worktree/${projectNumber}`, {
        ...worktree,
        workspaceId,
      });
    } catch (error) {
      // Non-fatal — log and move on
      if (this._outputChannel) {
        this._outputChannel.appendLine(
          `[APIClient] updateWorktreeStatus failed (non-fatal): ${error instanceof Error ? error.message : error}`,
        );
      }
    }
  }

  /**
   * Get workspace orchestration data
   */
  async getWorkspaceOrchestration(workspaceId: string): Promise<{
    workspace: { workspace_id: string; running: number; desired: number };
    global: { running: number; desired: number };
  } | null> {
    const encodedWorkspaceId = encodeURIComponent(workspaceId);
    const result = await this.request<{
      workspace: { workspace_id: string; running: number; desired: number };
      global: { running: number; desired: number };
    }>('GET', `/api/orchestration/workspace/${encodedWorkspaceId}`);

    // If there's an error, log it and throw
    if (result.error) {
      if (this._outputChannel) {
        this._outputChannel.appendLine(
          `[APIClient] getWorkspaceOrchestration failed: ${result.error}`,
        );
      }
      throw new Error(result.error);
    }

    return result.data;
  }
}
