import {
  Zap,
  History,
  Settings,
  ChevronLeft,
  ChevronRight,
  Activity
} from 'lucide-react';

interface SidebarProps {
  collapsed: boolean;
  setCollapsed: (collapsed: boolean) => void;
  currentView: string;
  setCurrentView: (view: string) => void;
}

export function Sidebar({
  collapsed,
  setCollapsed,
  currentView,
  setCurrentView
}: SidebarProps) {
  const workspaces = [
    { id: 'acme', name: 'acme-corp', color: 'bg-blue-500', agents: 3 },
    { id: 'my-proj', name: 'my-projects', color: 'bg-green-500', agents: 1 },
    { id: 'open-src', name: 'open-source', color: 'bg-purple-500', agents: 0 },
  ];

  const activeAgents = [
    { id: 'a1', name: 'Building Real-Time...', status: 'active' },
    { id: 'a2', name: 'Implement LLM...', status: 'active' },
    { id: 'a3', name: 'Add API Call...', status: 'idle' },
    { id: 'a4', name: 'Desktop Menu...', status: 'active' },
  ];

  return (
    <aside
      className={`
        flex flex-col border-r border-github-border bg-github-card transition-all duration-300 ease-in-out
        ${collapsed ? 'w-14' : 'w-60'}
      `}>
      {/* Header / Logo */}
      <div className="h-12 flex items-center px-4 border-b border-github-border">
        <div className="flex items-center text-accent-blue font-bold">
          <Zap className="h-5 w-5 mr-2 fill-current" />
          {!collapsed && <span className="tracking-tight">STOKED</span>}
        </div>
      </div>

      {/* Navigation */}
      <div className="flex-1 overflow-y-auto py-4 space-y-6">
        {/* Workspaces Section */}
        <div>
          {!collapsed && (
            <div className="px-4 mb-2 text-[10px] font-semibold text-github-muted uppercase tracking-wider">
              Workspaces
            </div>
          )}
          <div className="space-y-0.5 px-2">
            {workspaces.map((ws) => (
              <button
                key={ws.id}
                onClick={() => setCurrentView('overview')}
                className={`
                  w-full flex items-center px-2 py-1.5 rounded-md text-sm transition-colors group
                  ${currentView === 'overview' ? 'bg-accent-blue/10 text-accent-blue' : 'text-github-text hover:bg-github-hover'}
                `}
                title={collapsed ? ws.name : undefined}>
                <div
                  className={`h-5 w-5 rounded flex items-center justify-center text-[10px] font-bold text-white ${ws.color} shrink-0`}>
                  {ws.name.charAt(0).toUpperCase()}
                </div>
                {!collapsed && (
                  <>
                    <span className="ml-3 truncate flex-1 text-left">{ws.name}</span>
                    {ws.agents > 0 && (
                      <span className="ml-2 px-1.5 py-0.5 rounded-full bg-github-border text-[10px] text-github-muted font-mono">
                        {ws.agents}
                      </span>
                    )}
                  </>
                )}
              </button>
            ))}
          </div>
        </div>

        {/* Active Agents Section */}
        <div>
          {!collapsed && (
            <div className="px-4 mb-2 flex items-center justify-between text-[10px] font-semibold text-github-muted uppercase tracking-wider">
              <span>Active Agents</span>
              <span className="text-accent-green">4 running</span>
            </div>
          )}
          <div className="space-y-0.5 px-2">
            {activeAgents.map((agent) => (
              <button
                key={agent.id}
                className="w-full flex items-center px-2 py-1.5 rounded-md text-sm text-github-text hover:bg-github-hover group"
                title={collapsed ? agent.name : undefined}>
                <div className="relative h-5 w-5 flex items-center justify-center shrink-0">
                  <Activity
                    className={`h-4 w-4 ${agent.status === 'active' ? 'text-accent-green' : 'text-accent-amber'}`}
                  />
                  {agent.status === 'active' && (
                    <span className="absolute top-0 right-0 h-1.5 w-1.5 rounded-full bg-accent-green animate-pulse" />
                  )}
                </div>
                {!collapsed && (
                  <span className="ml-3 truncate text-xs text-github-text-muted group-hover:text-github-text transition-colors text-left">
                    {agent.name}
                  </span>
                )}
              </button>
            ))}
          </div>
        </div>

        {/* Main Nav Items */}
        <div className="space-y-0.5 px-2">
          <button
            onClick={() => setCurrentView('history')}
            className={`
              w-full flex items-center px-2 py-1.5 rounded-md text-sm transition-colors
              ${currentView === 'history' ? 'bg-accent-blue/10 text-accent-blue' : 'text-github-text hover:bg-github-hover'}
            `}
            title={collapsed ? 'History' : undefined}>
            <History className="h-5 w-5 shrink-0" />
            {!collapsed && <span className="ml-3">History</span>}
          </button>

          <button
            onClick={() => setCurrentView('settings')}
            className={`
              w-full flex items-center px-2 py-1.5 rounded-md text-sm transition-colors
              ${currentView === 'settings' ? 'bg-accent-blue/10 text-accent-blue' : 'text-github-text hover:bg-github-hover'}
            `}
            title={collapsed ? 'Settings' : undefined}>
            <Settings className="h-5 w-5 shrink-0" />
            {!collapsed && <span className="ml-3">Settings</span>}
          </button>
        </div>
      </div>

      {/* Collapse Toggle */}
      <div className="p-2 border-t border-github-border">
        <button
          onClick={() => setCollapsed(!collapsed)}
          className="w-full flex items-center justify-center p-1.5 rounded-md text-github-muted hover:bg-github-hover hover:text-github-text transition-colors">
          {collapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}
        </button>
      </div>
    </aside>
  );
}
