import { useState, Fragment } from 'react';
import {
  ArrowLeft, Plus, Search, Filter, ChevronDown, ChevronRight,
  CheckSquare, Square, MoreHorizontal
} from 'lucide-react';
import { StatusBadge } from '@/components/ui/StatusBadge';
import type { Project } from '@/types';

interface ProjectListProps {
  onBack: () => void;
}

export function ProjectList({ onBack }: ProjectListProps) {
  const [expandedRows, setExpandedRows] = useState<number[]>([]);

  const toggleRow = (id: number) => {
    setExpandedRows((prev) =>
      prev.includes(id) ? prev.filter((rowId) => rowId !== id) : [...prev, id]
    );
  };

  const projects: Project[] = [
    {
      id: 90,
      name: 'Build Real-Time Task History Audit System',
      phase: 3,
      totalPhases: 5,
      status: 'In Progress',
      statusType: 'info',
      items: 8,
      totalItems: 12,
      updated: '2 min ago',
      workItems: [
        { id: '90-1', desc: 'Design database schema for audit logs', done: true },
        { id: '90-2', desc: 'Implement API endpoints for history retrieval', done: true },
        { id: '90-3', desc: 'Create frontend timeline component', done: false },
        { id: '90-4', desc: 'Integrate real-time websocket updates', done: false },
      ],
    },
    {
      id: 87,
      name: 'Implement LLM Activity Status Bar',
      phase: 2,
      totalPhases: 4,
      status: 'In Progress',
      statusType: 'info',
      items: 5,
      totalItems: 8,
      updated: '45 min ago',
      workItems: [
        { id: '87-1', desc: 'Setup status state management', done: true },
        { id: '87-2', desc: 'Design status bar UI', done: false },
      ],
    },
    {
      id: 86,
      name: 'Add API Call History Tracking',
      phase: 4,
      totalPhases: 4,
      status: 'Complete',
      statusType: 'success',
      items: 12,
      totalItems: 12,
      updated: '2 hours ago',
      workItems: [],
    },
    {
      id: 82,
      name: 'Build Desktop Menu Bar Agent Monitor',
      phase: 1,
      totalPhases: 6,
      status: 'In Progress',
      statusType: 'info',
      items: 2,
      totalItems: 18,
      updated: '1 day ago',
      workItems: [],
    },
    {
      id: 79,
      name: 'Implement Workspace Sync',
      phase: 5,
      totalPhases: 5,
      status: 'Complete',
      statusType: 'success',
      items: 15,
      totalItems: 15,
      updated: '3 days ago',
      workItems: [],
    },
    {
      id: 74,
      name: 'Add Real-Time Notifications',
      phase: 2,
      totalPhases: 3,
      status: 'Blocked',
      statusType: 'error',
      items: 6,
      totalItems: 9,
      updated: '5 days ago',
      workItems: [],
    },
  ];

  return (
    <div className="flex flex-col h-full bg-github-canvas text-github-text">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-github-border">
        <div className="flex items-center gap-3">
          <button
            onClick={onBack}
            className="flex items-center gap-1.5 text-sm text-github-text-muted hover:text-github-text transition-colors"
          >
            <ArrowLeft className="w-4 h-4" />
            Back
          </button>
          <span className="text-github-border">|</span>
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 rounded-md bg-accent-blue flex items-center justify-center text-xs font-bold text-white">
              S
            </div>
            <span className="text-sm font-medium text-github-text">stoked-io</span>
          </div>
          <span className="text-github-text-muted text-sm">/</span>
          <span className="text-sm font-semibold text-github-text">Projects</span>
        </div>
        <button className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium bg-accent-green text-white rounded-md hover:bg-accent-green/90 transition-colors">
          <Plus className="w-4 h-4" />
          New Project
        </button>
      </div>

      {/* Filter bar */}
      <div className="flex items-center gap-3 px-6 py-3 border-b border-github-border bg-github-canvas-subtle">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-github-text-muted" />
          <input
            type="text"
            placeholder="Search projects..."
            className="w-full pl-8 pr-3 py-1.5 text-sm bg-github-canvas border border-github-border rounded-md text-github-text placeholder-github-text-muted focus:outline-none focus:border-accent-blue transition-colors"
          />
        </div>
        <button className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-github-text-muted border border-github-border rounded-md hover:bg-github-canvas-subtle hover:text-github-text transition-colors">
          <Filter className="w-3.5 h-3.5" />
          Status
          <ChevronDown className="w-3 h-3" />
        </button>
        <button className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-github-text-muted border border-github-border rounded-md hover:bg-github-canvas-subtle hover:text-github-text transition-colors">
          Sort
          <ChevronDown className="w-3 h-3" />
        </button>
        <span className="ml-auto text-xs text-github-text-muted">{projects.length} projects</span>
      </div>

      {/* Table */}
      <div className="flex-1 overflow-auto">
        <table className="w-full text-sm border-collapse">
          <thead>
            <tr className="border-b border-github-border bg-github-canvas-subtle">
              <th className="w-8 px-3 py-2" />
              <th className="w-12 px-3 py-2 text-left text-xs font-medium text-github-text-muted">#</th>
              <th className="px-3 py-2 text-left text-xs font-medium text-github-text-muted">Project Name</th>
              <th className="w-40 px-3 py-2 text-left text-xs font-medium text-github-text-muted">Phase Progress</th>
              <th className="w-28 px-3 py-2 text-left text-xs font-medium text-github-text-muted">Status</th>
              <th className="w-20 px-3 py-2 text-left text-xs font-medium text-github-text-muted">Items</th>
              <th className="w-28 px-3 py-2 text-left text-xs font-medium text-github-text-muted">Last Updated</th>
              <th className="w-10 px-3 py-2" />
            </tr>
          </thead>
          <tbody>
            {projects.map((project) => {
              const isExpanded = expandedRows.includes(project.id);
              return (
                <Fragment key={project.id}>
                  {/* Main row */}
                  <tr
                    className="border-b border-github-border hover:bg-github-canvas-subtle/50 cursor-pointer transition-colors"
                    onClick={() => project.workItems.length > 0 && toggleRow(project.id)}
                  >
                    {/* Expand chevron */}
                    <td className="px-3 py-3 text-github-text-muted">
                      {project.workItems.length > 0 ? (
                        isExpanded ? (
                          <ChevronDown className="w-4 h-4" />
                        ) : (
                          <ChevronRight className="w-4 h-4" />
                        )
                      ) : null}
                    </td>
                    {/* ID */}
                    <td className="px-3 py-3 text-github-text-muted font-mono text-xs">
                      #{project.id}
                    </td>
                    {/* Name */}
                    <td className="px-3 py-3">
                      <span className="font-medium text-github-text hover:text-accent-blue transition-colors">
                        {project.name}
                      </span>
                    </td>
                    {/* Phase progress */}
                    <td className="px-3 py-3">
                      <div className="flex items-center gap-2">
                        <div className="flex gap-0.5 flex-1">
                          {Array.from({ length: project.totalPhases }).map((_, i) => {
                            const phaseNum = i + 1;
                            let segClass = 'bg-github-border'; // future
                            if (phaseNum < project.phase) {
                              segClass = 'bg-accent-green'; // completed
                            } else if (phaseNum === project.phase) {
                              segClass = 'bg-accent-blue animate-pulse'; // current
                            }
                            return (
                              <div
                                key={i}
                                className={`h-1.5 flex-1 rounded-full ${segClass}`}
                              />
                            );
                          })}
                        </div>
                        <span className="text-xs text-github-text-muted whitespace-nowrap">
                          {project.phase}/{project.totalPhases}
                        </span>
                      </div>
                    </td>
                    {/* Status */}
                    <td className="px-3 py-3">
                      <StatusBadge
                        status={project.status}
                        type={project.statusType}
                        pulse={project.statusType === 'info'}
                      />
                    </td>
                    {/* Items */}
                    <td className="px-3 py-3 text-github-text-muted text-xs">
                      {project.items}/{project.totalItems}
                    </td>
                    {/* Last updated */}
                    <td className="px-3 py-3 text-github-text-muted text-xs whitespace-nowrap">
                      {project.updated}
                    </td>
                    {/* Actions */}
                    <td className="px-3 py-3" onClick={(e) => e.stopPropagation()}>
                      <button className="p-1 text-github-text-muted hover:text-github-text rounded transition-colors">
                        <MoreHorizontal className="w-4 h-4" />
                      </button>
                    </td>
                  </tr>

                  {/* Expanded work items row */}
                  {isExpanded && project.workItems.length > 0 && (
                    <tr className="border-b border-github-border bg-github-canvas-subtle/30">
                      <td colSpan={8} className="px-0 py-0">
                        <div className="pl-14 pr-6 py-2">
                          <div className="border border-github-border rounded-md overflow-hidden">
                            {project.workItems.map((item) => (
                              <div
                                key={item.id}
                                className="flex items-center gap-3 px-3 py-2 border-b border-github-border last:border-b-0 hover:bg-github-canvas-subtle/50 transition-colors"
                              >
                                {item.done ? (
                                  <CheckSquare className="w-4 h-4 text-accent-green flex-shrink-0" />
                                ) : (
                                  <Square className="w-4 h-4 text-github-text-muted flex-shrink-0" />
                                )}
                                <span
                                  className={`text-sm ${item.done ? 'line-through text-github-text-muted' : 'text-github-text'}`}
                                >
                                  {item.desc}
                                </span>
                                <span className="ml-auto text-xs text-github-text-muted font-mono">
                                  {item.id}
                                </span>
                              </div>
                            ))}
                            <div className="px-3 py-2 bg-github-canvas-subtle/50 border-t border-github-border">
                              <button className="text-xs text-accent-blue hover:underline">
                                View all {project.totalItems} items →
                              </button>
                            </div>
                          </div>
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
