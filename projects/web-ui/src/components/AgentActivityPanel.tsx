import { ChevronUp, ChevronDown } from 'lucide-react';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { generateSparkline } from '@/utils/sparkline';
import type { Agent } from '@/types';

interface AgentActivityPanelProps {
  isOpen: boolean;
  setIsOpen: (isOpen: boolean) => void;
}

export function AgentActivityPanel({ isOpen, setIsOpen }: AgentActivityPanelProps) {
  const agents: Agent[] = [
    { id: 'agent-7f2a', task: 'Building Real-Time Task History Audit System', workspace: 'acme-corp', status: 'Responding', type: 'success', duration: '2h 14m' },
    { id: 'agent-3c1b', task: 'Implement LLM Activity Status Bar', workspace: 'acme-corp', status: 'Responding', type: 'success', duration: '45m' },
    { id: 'agent-9d4e', task: 'Add API Call History Tracking', workspace: 'my-projects', status: 'Idle', type: 'warning', duration: '1h 02m' },
    { id: 'agent-2a8f', task: 'Build Desktop Menu Bar Agent Monitor', workspace: 'acme-corp', status: 'Responding', type: 'success', duration: '3h 51m' },
    { id: 'agent-5b6c', task: 'Refactor Authentication Module', workspace: 'open-source', status: 'Stopped', type: 'error', duration: '22m' },
  ];

  return (
    <div className={`border-t border-github-border bg-github-card flex flex-col transition-all duration-300 ease-in-out ${isOpen ? 'h-[240px]' : 'h-10'}`}>
      {/* Header */}
      <div
        className="h-10 flex items-center justify-between px-4 cursor-pointer hover:bg-github-hover border-b border-github-border/50"
        aria-expanded={isOpen}
        onClick={() => setIsOpen(!isOpen)}
      >
        <div className="flex items-center space-x-3">
          <span className="text-sm font-semibold text-github-text">Agent Activity</span>
          <span aria-live="polite" className="flex items-center px-2 py-0.5 rounded-full bg-accent-green/10 text-accent-green text-xs font-medium border border-accent-green/20">
            <span className="relative flex h-2 w-2 mr-1.5">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full opacity-75 bg-accent-green" />
              <span className="relative inline-flex rounded-full h-2 w-2 bg-accent-green" />
            </span>
            4 Running
          </span>
        </div>
        <button className="text-github-muted hover:text-github-text">
          {isOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronUp className="h-4 w-4" />}
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        <table className="w-full text-left border-collapse">
          <thead className="bg-github-bg sticky top-0 z-10 text-xs font-medium text-github-muted uppercase tracking-wider">
            <tr>
              <th className="px-4 py-2 font-medium w-12" />
              <th className="px-4 py-2 font-medium w-32">Agent ID</th>
              <th className="px-4 py-2 font-medium">Current Task</th>
              <th className="px-4 py-2 font-medium w-32">Workspace</th>
              <th className="px-4 py-2 font-medium w-32">Status</th>
              <th className="px-4 py-2 font-medium w-24">Duration</th>
              <th className="px-4 py-2 font-medium w-24">Activity</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-github-border/50">
            {agents.map((agent) => (
              <tr key={agent.id} className="hover:bg-github-hover/50 group text-sm">
                <td className="px-4 py-2">
                  <div className={`h-2 w-2 rounded-full ${agent.type === 'success' ? 'bg-accent-green animate-pulse' : agent.type === 'warning' ? 'bg-accent-amber' : 'bg-accent-red'}`} />
                </td>
                <td className="px-4 py-2 font-mono text-xs text-github-text-muted">{agent.id}</td>
                <td className="px-4 py-2 text-github-text truncate max-w-md" title={agent.task}>{agent.task}</td>
                <td className="px-4 py-2">
                  <span className="px-2 py-0.5 rounded-full bg-github-border text-xs text-github-text-muted">{agent.workspace}</span>
                </td>
                <td className="px-4 py-2">
                  <StatusBadge status={agent.status} type={agent.type} />
                </td>
                <td className="px-4 py-2 font-mono text-xs text-github-text-muted">{agent.duration}</td>
                <td className="px-4 py-2">
                  {agent.type === 'success' && (
                    <svg width="60" height="20" className="stroke-accent-green fill-none stroke-[1.5px] opacity-70 group-hover:opacity-100 transition-opacity">
                      <path d={generateSparkline()} />
                    </svg>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
