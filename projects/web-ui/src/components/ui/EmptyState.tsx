import { Inbox } from 'lucide-react';

interface EmptyStateProps {
  title?: string;
  message?: string;
  icon?: React.ComponentType<{ className?: string }>;
}

export function EmptyState({ title = 'No data', message = 'Nothing to show here yet.', icon: Icon = Inbox }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center p-12 text-center">
      <Icon className="h-12 w-12 text-github-text-dim mb-4" />
      <h3 className="text-lg font-medium text-github-text-muted mb-1">{title}</h3>
      <p className="text-sm text-github-text-dim">{message}</p>
    </div>
  );
}
