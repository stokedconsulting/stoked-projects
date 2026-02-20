import { useState } from 'react';
import {
  GitMerge, CheckCircle, Play, AlertCircle, XCircle, Plus, Calendar
} from 'lucide-react';
import type { TimelineEvent } from '@/types';

export function TaskHistory() {
  const [activeFilter, setActiveFilter] = useState('All');
  const filters = ['All', 'Issues', 'Phases', 'Agent Sessions', 'Status Changes'];

  const events: TimelineEvent[] = [
    { id: 1, type: 'issue_closed', icon: GitMerge, color: 'text-accent-blue', bg: 'bg-accent-blue/10', text: 'Agent closed issue #45 in Project #82', agent: 'agent-2a8f', time: '2 min ago', group: 'Today' },
    { id: 2, type: 'phase_complete', icon: CheckCircle, color: 'text-accent-green', bg: 'bg-accent-green/10', text: 'Phase 2 completed in Project #86', agent: 'agent-3c1b', time: '15 min ago', group: 'Today' },
    { id: 3, type: 'session_start', icon: Play, color: 'text-accent-blue', bg: 'bg-accent-blue/10', text: 'Agent session started for Project #90', agent: 'agent-7f2a', time: '1 hour ago', group: 'Today' },
    { id: 4, type: 'idle_timeout', icon: AlertCircle, color: 'text-accent-amber', bg: 'bg-accent-amber/10', text: 'Agent idle timeout in Project #87', agent: 'agent-9d4e', time: '1h 30m ago', group: 'Today' },
    { id: 5, type: 'issue_closed', icon: GitMerge, color: 'text-accent-blue', bg: 'bg-accent-blue/10', text: 'Agent closed issue #38 in Project #79', agent: 'agent-5b6c', time: '2 hours ago', group: 'Today' },
    { id: 6, type: 'phase_complete', icon: CheckCircle, color: 'text-accent-green', bg: 'bg-accent-green/10', text: 'Phase 4 completed in Project #86', agent: 'agent-3c1b', time: '2h 15m ago', group: 'Today' },
    { id: 7, type: 'stopped', icon: XCircle, color: 'text-accent-red', bg: 'bg-accent-red/10', text: 'Agent stopped in Project #74', agent: 'agent-5b6c', time: '3 hours ago', group: 'Today' },
    { id: 8, type: 'created', icon: Plus, color: 'text-github-muted', bg: 'bg-github-border', text: 'New project #90 created', agent: 'system', time: '4 hours ago', group: 'Today' },
    { id: 9, type: 'session_start', icon: Play, color: 'text-accent-blue', bg: 'bg-accent-blue/10', text: 'Agent session started for Project #87', agent: 'agent-9d4e', time: 'Yesterday', group: 'Yesterday' },
    { id: 10, type: 'phase_complete', icon: CheckCircle, color: 'text-accent-green', bg: 'bg-accent-green/10', text: 'Phase 1 completed in Project #82', agent: 'agent-2a8f', time: 'Yesterday', group: 'Yesterday' },
  ];

  const groups = [...new Set(events.map(e => e.group))];

  return (
    <div className="flex flex-col h-full max-w-5xl mx-auto w-full p-8">
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <h1 className="text-2xl font-semibold text-github-text">Task History</h1>
        <button className="flex items-center px-3 py-1.5 border border-github-border rounded-md text-sm text-github-text-muted hover:text-github-text hover:bg-github-hover transition-colors">
          <Calendar className="h-4 w-4 mr-2" />
          Last 30 Days
        </button>
      </div>

      {/* Filters */}
      <div className="flex items-center space-x-2 mb-8 overflow-x-auto pb-2">
        {filters.map((filter) => (
          <button
            key={filter}
            onClick={() => setActiveFilter(filter)}
            className={`px-4 py-1.5 rounded-full text-sm font-medium transition-all whitespace-nowrap ${
              activeFilter === filter
                ? 'bg-accent-blue text-white shadow-sm'
                : 'bg-github-card border border-github-border text-github-text-muted hover:border-github-text-muted hover:text-github-text'
            }`}
          >
            {filter}
          </button>
        ))}
      </div>

      {/* Timeline */}
      <div className="relative border-l border-github-border ml-3.5 space-y-8 pb-12">
        {groups.map((groupName, gi) => (
          <div key={groupName} className={`relative ${gi > 0 ? 'pt-4' : ''}`}>
            <span className={`absolute -left-[21px] ${gi > 0 ? 'top-4' : 'top-0'} bg-github-bg px-1 text-xs font-semibold text-github-muted uppercase tracking-wider`}>
              {groupName}
            </span>
            <div className={`${gi > 0 ? 'pt-10' : 'pt-6'} space-y-6`}>
              {events
                .filter((e) => e.group === groupName)
                .map((event, i) => (
                  <div
                    key={event.id}
                    className="relative pl-8 group"
                    style={gi === 0 ? { animationDelay: `${i * 50}ms` } : undefined}
                  >
                    <div className={`absolute -left-[9px] top-1 h-5 w-5 rounded-full border-2 border-github-bg flex items-center justify-center ${event.bg}`}>
                      <event.icon className={`h-3 w-3 ${event.color}`} />
                    </div>
                    <div className="flex items-start justify-between p-3 -mt-2 rounded-lg hover:bg-github-hover/50 transition-colors cursor-default">
                      <div>
                        <p className="text-sm text-github-text font-medium">{event.text}</p>
                        <div className="flex items-center mt-1 space-x-2">
                          <span className="px-1.5 py-0.5 rounded bg-github-border text-[10px] font-mono text-github-text-muted">
                            {event.agent}
                          </span>
                        </div>
                      </div>
                      <span className="text-xs font-mono text-github-text-dim whitespace-nowrap ml-4">
                        {event.time}
                      </span>
                    </div>
                  </div>
                ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
