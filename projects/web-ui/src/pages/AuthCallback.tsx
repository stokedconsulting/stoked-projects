import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';

export function AuthCallback() {
  const navigate = useNavigate();
  const { saveToken } = useAuth();

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const token = params.get('token');

    if (token) {
      saveToken(token);
      navigate('/', { replace: true });
    } else {
      navigate('/login', { replace: true });
    }
  }, [navigate, saveToken]);

  return (
    <div className="flex items-center justify-center h-screen bg-github-bg">
      <div className="text-github-text-muted text-sm">Authenticating...</div>
    </div>
  );
}
