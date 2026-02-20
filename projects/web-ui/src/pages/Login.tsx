import { Zap } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';

export function Login() {
  const { login } = useAuth();

  return (
    <div className="flex items-center justify-center h-screen bg-github-bg">
      <div className="bg-github-card border border-github-border rounded-lg p-8 max-w-sm w-full mx-4">
        <div className="flex items-center justify-center mb-6">
          <Zap className="h-8 w-8 text-accent-blue fill-current mr-2" />
          <span className="text-xl font-bold text-github-text tracking-tight">STOKED</span>
        </div>
        <p className="text-sm text-github-text-muted text-center mb-6">
          Sign in to access the Stoked Projects Dashboard
        </p>
        <button
          onClick={login}
          className="w-full flex items-center justify-center px-4 py-2.5 bg-github-secondary border border-github-border rounded-md text-sm font-medium text-github-text hover:bg-github-hover transition-colors"
        >
          <svg className="h-5 w-5 mr-2" viewBox="0 0 24 24" fill="currentColor">
            <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0024 12c0-6.63-5.37-12-12-12z" />
          </svg>
          Sign in with GitHub
        </button>
      </div>
    </div>
  );
}
