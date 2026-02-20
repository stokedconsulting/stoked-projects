import type { StatusType } from '@/types';

interface StatusBadgeProps {
  status: string;
  type?: StatusType;
  className?: string;
  pulse?: boolean;
}

const colorMap: Record<StatusType, string> = {
  success: 'bg-accent-green/10 text-accent-green border-accent-green/20',
  warning: 'bg-accent-amber/10 text-accent-amber border-accent-amber/20',
  error: 'bg-accent-red/10 text-accent-red border-accent-red/20',
  neutral: 'bg-accent-gray/10 text-accent-gray border-accent-gray/20',
  info: 'bg-accent-blue/10 text-accent-blue border-accent-blue/20',
};

const dotColorMap: Record<StatusType, string> = {
  success: 'bg-accent-green',
  warning: 'bg-accent-amber',
  error: 'bg-accent-red',
  neutral: 'bg-accent-gray',
  info: 'bg-accent-blue',
};

export function StatusBadge({ status, type = 'neutral', className = '', pulse = false }: StatusBadgeProps) {
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border ${colorMap[type]} ${className}`}>
      {type !== 'neutral' && (
        <span className="relative mr-1.5">
          <span className={`block w-1.5 h-1.5 rounded-full ${dotColorMap[type]}`} />
          {pulse && (
            <span className={`absolute inset-0 w-1.5 h-1.5 rounded-full ${dotColorMap[type]} animate-ping`} />
          )}
        </span>
      )}
      {status}
    </span>
  );
}
