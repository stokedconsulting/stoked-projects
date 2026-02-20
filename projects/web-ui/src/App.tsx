import { useState, useRef } from 'react';
import { Sidebar } from './components/Sidebar';
import { TopBar } from './components/TopBar';
import { WorkspaceOverview } from './components/WorkspaceOverview';
import { AgentActivityPanel } from './components/AgentActivityPanel';
import { ProjectList } from './components/ProjectList';
import { TaskHistory } from './components/TaskHistory';
import { useGlobalKeyboard } from './hooks/useGlobalKeyboard';

export function App() {
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const [isAgentPanelOpen, setIsAgentPanelOpen] = useState(true);
  const [currentView, setCurrentView] = useState('overview');
  const [_selectedWorkspace, setSelectedWorkspace] = useState<string | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  useGlobalKeyboard(searchRef);

  const handleWorkspaceSelect = (id: string) => {
    setSelectedWorkspace(id);
    setCurrentView('project-list');
  };

  const renderMainContent = () => {
    switch (currentView) {
      case 'overview':
        return <WorkspaceOverview onSelectWorkspace={handleWorkspaceSelect} />;
      case 'project-list':
        return <ProjectList onBack={() => setCurrentView('overview')} />;
      case 'history':
        return <TaskHistory />;
      case 'settings':
        return (
          <div className="flex items-center justify-center h-full text-github-text-muted">
            <div className="text-center">
              <h2 className="text-xl font-semibold mb-2">Settings</h2>
              <p>Settings panel is under construction.</p>
            </div>
          </div>
        );
      default:
        return <WorkspaceOverview onSelectWorkspace={handleWorkspaceSelect} />;
    }
  };

  return (
    <div className="flex h-screen w-full bg-github-bg text-github-text overflow-hidden font-sans">
      <Sidebar
        collapsed={isSidebarCollapsed}
        setCollapsed={setIsSidebarCollapsed}
        currentView={currentView}
        setCurrentView={setCurrentView}
      />
      <div className="flex-1 flex flex-col min-w-0">
        <TopBar currentView={currentView} searchRef={searchRef} />
        <main className="flex-1 overflow-y-auto relative scroll-smooth">
          {renderMainContent()}
        </main>
        <AgentActivityPanel
          isOpen={isAgentPanelOpen}
          setIsOpen={setIsAgentPanelOpen}
        />
      </div>
    </div>
  );
}
