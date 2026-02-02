import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import authService from '../services/authService';

const AuthContext = createContext();

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [accessToken, setAccessToken] = useState(() => localStorage.getItem('accessToken'));
  const [refreshToken, setRefreshToken] = useState(() => localStorage.getItem('refreshToken'));
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const clearAuth = useCallback(() => {
    setUser(null);
    setAccessToken(null);
    setRefreshToken(null);
    localStorage.removeItem('accessToken');
    localStorage.removeItem('refreshToken');
  }, []);

  const login = useCallback(async (username, password) => {
    try {
      setError(null);
      const response = await authService.login(username, password);
      if (response.success) {
        setUser(response.data.user);
        setAccessToken(response.data.accessToken);
        setRefreshToken(response.data.refreshToken);
        localStorage.setItem('accessToken', response.data.accessToken);
        localStorage.setItem('refreshToken', response.data.refreshToken);
        return { success: true };
      }
      throw new Error(response.error || 'Login failed');
    } catch (err) {
      const errorMessage = err.response?.data?.error || err.message || 'Login failed';
      setError(errorMessage);
      return { success: false, error: errorMessage };
    }
  }, []);

  const logout = useCallback(async () => {
    try {
      if (accessToken) {
        await authService.logout(accessToken);
      }
    } catch (err) {
      console.warn('Logout error:', err);
    } finally {
      clearAuth();
    }
  }, [accessToken, clearAuth]);

  const refreshAccessToken = useCallback(async () => {
    if (!refreshToken) return false;
    try {
      const response = await authService.refreshToken(refreshToken);
      if (response.success) {
        setAccessToken(response.data.accessToken);
        localStorage.setItem('accessToken', response.data.accessToken);
        return response.data.accessToken;
      }
      return false;
    } catch (err) {
      console.warn('Token refresh failed:', err);
      clearAuth();
      return false;
    }
  }, [refreshToken, clearAuth]);

  // Check auth state on mount
  useEffect(() => {
    const initAuth = async () => {
      if (accessToken) {
        try {
          const response = await authService.getCurrentUser(accessToken);
          if (response.success) {
            setUser(response.data);
          } else {
            // Token might be expired, try refresh
            const newToken = await refreshAccessToken();
            if (newToken) {
              const retryResponse = await authService.getCurrentUser(newToken);
              if (retryResponse.success) {
                setUser(retryResponse.data);
              } else {
                clearAuth();
              }
            }
          }
        } catch (err) {
          if (err.response?.status === 401) {
            const newToken = await refreshAccessToken();
            if (newToken) {
              try {
                const retryResponse = await authService.getCurrentUser(newToken);
                if (retryResponse.success) {
                  setUser(retryResponse.data);
                } else {
                  clearAuth();
                }
              } catch {
                clearAuth();
              }
            }
          } else {
            clearAuth();
          }
        }
      }
      setLoading(false);
    };
    initAuth();
  }, []); // Only run on mount

  const isAdmin = user?.role === 'admin';

  return (
    <AuthContext.Provider value={{
      user,
      accessToken,
      loading,
      error,
      isAdmin,
      isAuthenticated: !!user,
      login,
      logout,
      refreshAccessToken,
      clearAuth
    }}>
      {children}
    </AuthContext.Provider>
  );
};
