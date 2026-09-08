import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import authService from '../services/authService';
import { SESSION_EVENT, setSessionTokens, clearSession, renewAccessToken } from '../services/sessionClient';

const AuthContext = createContext();
export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used within an AuthProvider');
  return context;
};
export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [accessToken, setAccessToken] = useState(() => localStorage.getItem('accessToken'));
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const clearAuth = useCallback(() => { clearSession(); setUser(null); }, []);

  useEffect(() => {
    let active = true;
    const sync = () => {
      const token = localStorage.getItem('accessToken');
      setAccessToken(token);
      if (!token) setUser(null);
    };
    window.addEventListener(SESSION_EVENT, sync);
    window.addEventListener('storage', sync);
    const init = async () => {
      if (localStorage.getItem('accessToken')) {
        try {
          const response = await authService.getCurrentUser();
          if (active && localStorage.getItem('accessToken')) setUser(response.data);
        } catch { if (active) clearAuth(); }
      }
      if (active) setLoading(false);
    };
    init();
    return () => { active = false; window.removeEventListener(SESSION_EVENT, sync); window.removeEventListener('storage', sync); };
  }, [clearAuth]);

  const login = useCallback(async (username, password) => {
    try {
      setError(null);
      const response = await authService.login(username, password);
      if (!response.success) throw new Error(response.error || 'Login failed');
      setSessionTokens(response.data.accessToken, response.data.refreshToken);
      setUser(response.data.user);
      return { success: true };
    } catch (err) {
      const message = err.response?.data?.error || err.message;
      setError(message);
      return { success: false, error: message };
    }
  }, []);
  const logout = useCallback(async () => {
    try { await authService.logout(); } finally { clearAuth(); }
  }, [clearAuth]);
  const refreshAccessToken = useCallback(() => renewAccessToken().catch(() => false), []);
  const updateUser = useCallback(fields => setUser(prev => prev ? { ...prev, ...fields } : prev), []);
  return <AuthContext.Provider value={{ user, accessToken, loading, error, isAdmin: user?.role === 'admin', isAuthenticated: !!user, login, logout, refreshAccessToken, clearAuth, updateUser }}>{children}</AuthContext.Provider>;
};
