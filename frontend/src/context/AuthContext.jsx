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

const clearLegacyTokenStorage = () => {
  localStorage.removeItem('accessToken');
  localStorage.removeItem('refreshToken');
};

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const clearAuth = useCallback(() => {
    setUser(null);
    clearLegacyTokenStorage();
  }, []);

  const login = useCallback(async (username, password) => {
    try {
      setError(null);
      const response = await authService.login(username, password);
      if (response.success) {
        setUser(response.data.user);
        clearLegacyTokenStorage();
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
      await authService.logout();
    } catch (err) {
      console.warn('Logout error:', err);
    } finally {
      clearAuth();
    }
  }, [clearAuth]);

  const refreshAccessToken = useCallback(async () => {
    try {
      const response = await authService.refreshToken();
      if (response.success) {
        if (response.data?.user) setUser(response.data.user);
        return true;
      }
      return false;
    } catch (err) {
      console.warn('Token refresh failed:', err);
      clearAuth();
      return false;
    }
  }, [clearAuth]);

  // Check auth state on mount via HttpOnly cookies
  useEffect(() => {
    const initAuth = async () => {
      clearLegacyTokenStorage();
      try {
        const response = await authService.getCurrentUser();
        if (response.success) {
          setUser(response.data);
        } else {
          setUser(null);
        }
      } catch (err) {
        if (err.response?.status === 401) {
          try {
            const refresh = await authService.refreshToken();
            if (refresh.success) {
              if (refresh.data?.user) {
                setUser(refresh.data.user);
              } else {
                const retryResponse = await authService.getCurrentUser();
                if (retryResponse.success) setUser(retryResponse.data);
                else setUser(null);
              }
            } else {
              setUser(null);
            }
          } catch {
            setUser(null);
          }
        } else {
          setUser(null);
        }
      }
      setLoading(false);
    };
    initAuth();
  }, []); // Only run on mount

  const isAdmin = user?.role === 'admin';

  const updateUser = useCallback((updatedFields) => {
    setUser(prev => prev ? { ...prev, ...updatedFields } : prev);
  }, []);

  return (
    <AuthContext.Provider value={{
      user,
      loading,
      error,
      isAdmin,
      isAuthenticated: !!user,
      login,
      logout,
      refreshAccessToken,
      clearAuth,
      updateUser,
    }}>
      {children}
    </AuthContext.Provider>
  );
};
