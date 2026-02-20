import { AlertTriangle } from 'lucide-react';

interface ErrorBannerProps {
  message: string;
  onRetry?: () => void;
}

export function ErrorBanner({ message, onRetry }: ErrorBannerProps) {
  return (
    <div className="mx-8 my-4 p-4 bg-accent-red/10 border border-accent-red/20 rounded-lg flex items-center justify-between">
      <div className="flex items-center space-x-3">
        <AlertTriangle className="h-5 w-5 text-accent-red shrink-0" />
        <span className="text-sm text-accent-red">{message}</span>
      </div>
      {onRetry && (
        <button
          onClick={onRetry}
          className="px-3 py-1 text-xs font-medium text-accent-red border border-accent-red/30 rounded-md hover:bg-accent-red/10 transition-colors"
        >
          Retry
        </button>
      )}
    </div>
  );
}
