export interface ApiError {
  status: number;
  message: string;
}

export interface HealthStatus {
  status: string;
  uptime: number;
}

export interface GlobalOrchestration {
  totalWorkspaces: number;
  totalProjects: number;
  activeAgents: number;
  completionRate: number;
}

export interface WorkspaceOrchestration {
  id: string;
  name: string;
  projects: number;
  agents: number;
  completion: number;
}

export interface ActiveSession {
  id: string;
  task: string;
  workspace: string;
  status: string;
  duration: string;
  startedAt: string;
}

export interface StaleSession {
  id: string;
  task: string;
  lastActive: string;
}

export interface TaskRecord {
  id: string;
  type: string;
  text: string;
  agent: string;
  time: string;
  projectId?: string;
}

export interface TaskQuery {
  filter?: string;
  dateRange?: string;
  limit?: number;
  offset?: number;
}

export interface GitHubProject {
  id: string;
  number: number;
  title: string;
  url: string;
}

export interface ProjectItem {
  id: string;
  title: string;
  status: string;
  type: string;
}

export interface AuthUser {
  login: string;
  name: string;
  avatarUrl: string;
}
