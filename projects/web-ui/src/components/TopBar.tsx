import { useRef } from 'react';
import { Search, Bell, Moon } from 'lucide-react';

interface TopBarProps {
  currentView: string;
  searchRef?: React.RefObject<HTMLInputElement>;
}

export function TopBar({ currentView, searchRef }: TopBarProps) {
  const localRef = useRef<HTMLInputElement>(null);
  const inputRef: React.RefObject<HTMLInputElement> = searchRef ?? localRef;

  const getBreadcrumb = () => {
    switch (currentView) {
      case 'overview':
        return 'Workspaces / Overview';
      case 'project-list':
        return 'Workspaces / acme-corp / Projects';
      case 'history':
        return 'System / History';
      case 'settings':
        return 'System / Settings';
      default:
        return 'Overview';
    }
  };

  return (
    <header className="h-12 bg-github-card border-b border-github-border px-4 flex items-center justify-between shrink-0">
      {/* Left: Breadcrumb */}
      <div className="flex items-center text-sm text-github-muted">
        <span className="font-medium text-github-text">{getBreadcrumb()}</span>
      </div>

      {/* Center: Search */}
      <div className="flex-1 max-w-xl mx-4">
        <div className="relative group">
          <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
            <Search className="h-4 w-4 text-github-muted group-focus-within:text-accent-blue transition-colors" />
          </div>
          <input
            ref={inputRef}
            type="text"
            className="block w-full bg-github-bg border border-github-border rounded-md py-1.5 pl-10 pr-12 text-sm text-github-text placeholder-github-text-muted focus:outline-none focus:border-accent-blue focus:ring-1 focus:ring-accent-blue transition-all"
            placeholder="Search projects, agents, issues..."
          />
          <div className="absolute inset-y-0 right-0 pr-3 flex items-center pointer-events-none">
            <kbd className="inline-flex items-center border border-github-border rounded px-1.5 font-mono text-[10px] font-medium text-github-muted">
              ⌘K
            </kbd>
          </div>
        </div>
      </div>

      {/* Right: Actions */}
      <div className="flex items-center space-x-3">
        <button className="relative p-1.5 text-github-muted hover:text-github-text transition-colors rounded-md hover:bg-github-hover">
          <Bell className="h-4 w-4" />
          <span className="absolute top-1 right-1 h-2 w-2 rounded-full bg-accent-red border-2 border-github-card" />
        </button>
        <button className="p-1.5 text-github-muted hover:text-github-text transition-colors rounded-md hover:bg-github-hover">
          <Moon className="h-4 w-4" />
        </button>
        <div className="h-8 w-8 rounded-full bg-accent-blue/20 flex items-center justify-center border border-accent-blue/30 text-accent-blue font-medium text-xs cursor-pointer hover:bg-accent-blue/30 transition-colors">
          JD
        </div>
      </div>
    </header>
  );
}
