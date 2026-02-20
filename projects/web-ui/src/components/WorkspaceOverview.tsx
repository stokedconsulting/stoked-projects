import { Plus, Folder, Activity } from 'lucide-react';
import type { Workspace, AgentDotStatus } from '@/types';

interface WorkspaceOverviewProps {
  onSelectWorkspace: (id: string) => void;
}

const dotColorMap: Record<AgentDotStatus, string> = {
  success: 'bg-accent-green',
  warning: 'bg-accent-amber',
  error: 'bg-accent-red',
  neutral: 'bg-accent-gray',
};

export function WorkspaceOverview({ onSelectWorkspace }: WorkspaceOverviewProps) {
  const workspaces: Workspace[] = [
    { id: 'acme', name: 'acme-corp', color: 'bg-blue-500', projects: 12, agents: 3, completion: 78, dots: ['success', 'success', 'warning'], lastActive: '2 min ago' },
    { id: 'my-proj', name: 'my-projects', color: 'bg-green-500', projects: 8, agents: 1, completion: 45, dots: ['success'], lastActive: '15 min ago' },
    { id: 'open-src', name: 'open-source', color: 'bg-purple-500', projects: 23, agents: 0, completion: 91, dots: ['neutral', 'neutral'], lastActive: '2 days ago' },
    { id: 'side-exp', name: 'side-experiments', color: 'bg-orange-500', projects: 4, agents: 0, completion: 20, dots: ['error', 'neutral'], lastActive: '5 days ago' },
  ];

  return (
    <div className="p-8 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <h1 className="text-2xl font-semibold text-github-text">Workspaces</h1>
        <button className="flex items-center px-4 py-2 bg-accent-blue text-white rounded-md hover:bg-blue-600 transition-colors text-sm font-medium shadow-sm">
          <Plus className="h-4 w-4 mr-2" />
          Connect Workspace
        </button>
      </div>

      {/* Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {workspaces.map((ws) => (
          <div
            key={ws.id}
            onClick={() => onSelectWorkspace(ws.id)}
            className="group bg-github-card border border-github-border rounded-lg p-5 cursor-pointer hover:border-accent-blue transition-all duration-200 hover:shadow-lg hover:shadow-black/20"
          >
            {/* Card Header */}
            <div className="flex items-start justify-between mb-4">
              <div className="flex items-center">
                <div className={`h-10 w-10 rounded-full flex items-center justify-center text-white font-bold text-lg ${ws.color} shadow-inner`}>
                  {ws.name.charAt(0).toUpperCase()}
                </div>
                <div className="ml-3">
                  <h3 className="text-base font-semibold text-github-text group-hover:text-accent-blue transition-colors">
                    {ws.name}
                  </h3>
                  <span className="text-xs text-github-text-muted flex items-center mt-0.5">
                    <Folder className="h-3 w-3 mr-1" />
                    {ws.projects} Repos
                  </span>
                </div>
              </div>
              <div className="px-2 py-1 rounded bg-github-bg border border-github-border text-xs font-mono text-github-text-muted">
                {ws.projects} Projects
              </div>
            </div>

            {/* Stats Row */}
            <div className="flex items-center space-x-4 text-xs font-mono text-github-text-muted mb-4">
              <span className="flex items-center">
                <Activity className="h-3 w-3 mr-1.5 text-accent-blue" />
                {ws.agents} Running
              </span>
              <span className="w-px h-3 bg-github-border" />
              <span>{ws.completion}% Complete</span>
            </div>

            {/* Progress Bar */}
            <div className="w-full bg-github-border rounded-full h-1.5 mb-4 overflow-hidden">
              <div
                className="h-full rounded-full bg-gradient-to-r from-accent-blue to-accent-green opacity-80"
                style={{ width: `${ws.completion}%` }}
              />
            </div>

            {/* Footer */}
            <div className="flex items-center justify-between pt-4 border-t border-github-border/50">
              <div className="flex -space-x-1">
                {ws.dots.map((status, i) => (
                  <div
                    key={i}
                    className={`h-2.5 w-2.5 rounded-full ring-2 ring-github-card ${dotColorMap[status]}`}
                  />
                ))}
              </div>
              <span className="text-xs text-github-text-dim">
                Active {ws.lastActive}
              </span>
            </div>
          </div>
        ))}

        {/* Connect New Card */}
        <button className="flex flex-col items-center justify-center p-6 border-2 border-dashed border-github-border rounded-lg hover:border-accent-blue hover:bg-github-hover/30 transition-all group h-full min-h-[200px]">
          <div className="h-12 w-12 rounded-full bg-github-bg flex items-center justify-center mb-4 group-hover:scale-110 transition-transform border border-github-border">
            <Plus className="h-6 w-6 text-github-text-muted group-hover:text-accent-blue" />
          </div>
          <span className="text-sm font-medium text-github-text-muted group-hover:text-accent-blue">
            Connect Workspace
          </span>
        </button>
      </div>
    </div>
  );
}
