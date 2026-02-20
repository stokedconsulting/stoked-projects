import type {
  HealthStatus, GlobalOrchestration, WorkspaceOrchestration,
  ActiveSession, StaleSession, TaskRecord, TaskQuery,
  GitHubProject, ProjectItem, AuthUser
} from './types';

class ApiClientError extends Error {
  constructor(public status: number, message: string) {
    super(message);
    this.name = 'ApiClientError';
  }
}

export class ApiClient {
  private baseUrl: string;
  private apiKey: string | null = null;
  private githubToken: string | null = null;

  constructor(baseUrl?: string) {
    this.baseUrl = baseUrl || import.meta.env.VITE_API_URL || 'http://localhost:3000';
  }

  setApiKey(key: string) { this.apiKey = key; }
  setGithubToken(token: string) { this.githubToken = token; }

  private async request<T>(path: string, options?: RequestInit): Promise<T> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...(this.apiKey ? { 'x-api-key': this.apiKey } : {}),
      ...(this.githubToken ? { 'x-github-token': this.githubToken } : {}),
    };

    const res = await fetch(`${this.baseUrl}${path}`, {
      ...options,
      headers: { ...headers, ...options?.headers },
    });

    if (!res.ok) {
      const body = await res.text();
      throw new ApiClientError(res.status, body || res.statusText);
    }

    return res.json();
  }

  // Health
  getHealthStatus() { return this.request<HealthStatus>('/health'); }

  // Orchestration
  getGlobalOrchestration() { return this.request<GlobalOrchestration>('/api/orchestration/global'); }
  getWorkspaces() { return this.request<WorkspaceOrchestration[]>('/api/orchestration/workspaces'); }
  getWorkspaceOrchestration(id: string) { return this.request<WorkspaceOrchestration>(`/api/orchestration/workspace/${id}`); }

  // GitHub Projects
  getOrganizationProjects(owner: string) { return this.request<GitHubProject[]>(`/api/github/projects/org/${owner}`); }
  getLinkedProjects(owner: string, repo: string) { return this.request<GitHubProject[]>(`/api/github/projects/linked/${owner}/${repo}`); }
  getProjectItems(projectId: string) { return this.request<ProjectItem[]>(`/api/github/projects/${projectId}/items`); }

  // Sessions
  getActiveSessions() { return this.request<ActiveSession[]>('/sessions/active'); }
  getStaleSessions() { return this.request<StaleSession[]>('/sessions/stale'); }
  getSessionsByProject(projectId: string) { return this.request<ActiveSession[]>(`/sessions/by-project/${projectId}`); }

  // Tasks
  getTasks(query?: TaskQuery) {
    const params = new URLSearchParams();
    if (query?.filter) params.set('filter', query.filter);
    if (query?.dateRange) params.set('dateRange', query.dateRange);
    if (query?.limit) params.set('limit', String(query.limit));
    if (query?.offset) params.set('offset', String(query.offset));
    const qs = params.toString();
    return this.request<TaskRecord[]>(`/tasks${qs ? `?${qs}` : ''}`);
  }

  // Auth
  getCurrentUser(token: string) { return this.request<AuthUser>(`/api/auth/github/me?token=${encodeURIComponent(token)}`); }
}

export { ApiClientError };
