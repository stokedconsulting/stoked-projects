import { useState, useEffect, useCallback } from 'react';
import { apiClient } from '@/api';
import type { AuthUser } from '@/api/types';

const TOKEN_KEY = 'stoked_auth_token';

export function useAuth() {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [token, setToken] = useState<string | null>(() => localStorage.getItem(TOKEN_KEY));
  const [loading, setLoading] = useState(true);

  const isAuthenticated = !!token && !!user;

  const login = useCallback(() => {
    const apiUrl = import.meta.env.VITE_API_URL || 'http://localhost:3000';
    const callbackUrl = `${window.location.origin}/auth/callback`;
    window.location.href = `${apiUrl}/api/auth/github/login?redirect_uri=${encodeURIComponent(callbackUrl)}`;
  }, []);

  const logout = useCallback(() => {
    localStorage.removeItem(TOKEN_KEY);
    setToken(null);
    setUser(null);
  }, []);

  const saveToken = useCallback((newToken: string) => {
    localStorage.setItem(TOKEN_KEY, newToken);
    setToken(newToken);
    apiClient.setGithubToken(newToken);
  }, []);

  useEffect(() => {
    if (!token) {
      setLoading(false);
      return;
    }
    apiClient.setGithubToken(token);
    apiClient.getCurrentUser(token)
      .then(setUser)
      .catch(() => {
        localStorage.removeItem(TOKEN_KEY);
        setToken(null);
      })
      .finally(() => setLoading(false));
  }, [token]);

  return { user, token, loading, isAuthenticated, login, logout, saveToken };
}
