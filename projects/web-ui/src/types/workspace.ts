export type AgentDotStatus = 'success' | 'warning' | 'error' | 'neutral';

export interface Workspace {
  id: string;
  name: string;
  color: string;
  projects: number;
  agents: number;
  completion: number;
  dots: AgentDotStatus[];
  lastActive: string;
}
