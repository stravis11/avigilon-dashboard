import React, { createContext, useContext, useState, useCallback, useEffect, useRef } from 'react';
import { useAuth } from './AuthContext';
import apiService from '../services/apiService';

const CameraDataContext = createContext(null);

// Helper to extract array from various API response shapes
const extractArray = (response, key) => {
  const paths = [
    response?.data?.result?.[key],
    response?.result?.[key],
    response?.data?.[key],
    response?.[key],
    response?.data,
    response,
  ];
  for (const path of paths) {
    if (Array.isArray(path)) return path;
  }
  return [];
};

export const CameraDataProvider = ({ children }) => {
  const { isAuthenticated } = useAuth();

  const [cameras, setCameras] = useState([]);
  const [servers, setServers] = useState([]);
  const [sites, setSites] = useState([]);
  const [dashboardStats, setDashboardStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [lastRefreshed, setLastRefreshed] = useState(null);

  // Prevent duplicate concurrent fetches
  const fetchingRef = useRef(false);
  const epochRef = useRef(0);

  const fetchAll = useCallback(async ({ triggerBackendRefresh = false } = {}) => {
    if (fetchingRef.current) return;
    fetchingRef.current = true;
    const epoch = epochRef.current;
    setLoading(true);
    setError(null);

    try {
      let refreshError = null;
      // Optionally tell the backend to re-poll ACC first
      if (triggerBackendRefresh) {
        try { await apiService.refreshCache(); } catch (err) { refreshError = err; }
      }

      // Fetch all core data in parallel from backend cache
      const [serversRes, camerasRes, sitesRes, statsRes, cacheRes] = await Promise.allSettled([
        apiService.getServers(),
        apiService.getCameras(),
        apiService.getSites(),
        apiService.getDashboardStats(),
        apiService.getCacheStatus(),
      ]);

      if (epoch !== epochRef.current) return;

      if (serversRes.status === 'fulfilled') {
        setServers(extractArray(serversRes.value, 'servers'));
      }
      if (camerasRes.status === 'fulfilled') {
        setCameras(extractArray(camerasRes.value, 'cameras'));
      }
      if (sitesRes.status === 'fulfilled') {
        setSites(extractArray(sitesRes.value, 'sites'));
      }
      if (statsRes.status === 'fulfilled') {
        const stats = statsRes.value?.data || statsRes.value;
        setDashboardStats(stats);
      }

      // If all core fetches failed, surface an error
      const allFailed = [serversRes, camerasRes].every(r => r.status === 'rejected');
      if (allFailed) {
        setError(camerasRes.reason?.message || 'Failed to load data');
      }

      const cache = cacheRes.status === 'fulfilled' ? cacheRes.value?.data : null;
      if (refreshError || cache?.isStale) {
        setError('Camera data could not be refreshed. Showing the last available inventory' + (cache?.lastRefreshed ? ` from ${new Date(cache.lastRefreshed).toLocaleString()}.` : '.'));
      }
      setLastRefreshed(cache?.lastRefreshed ? new Date(cache.lastRefreshed) : null);
    } catch (err) {
      if (epoch === epochRef.current) setError(err.message);
    } finally {
      if (epoch === epochRef.current) { setLoading(false); fetchingRef.current = false; }
    }
  }, []);

  // Fetch on first auth
  useEffect(() => {
    if (isAuthenticated) {
      fetchAll();
    } else {
      epochRef.current += 1; fetchingRef.current = false; setLoading(false); setError(null);
      setCameras([]); setServers([]); setSites([]); setDashboardStats(null); setLastRefreshed(null);
    }
  }, [isAuthenticated, fetchAll]);

  // Manual refresh (triggers backend ACC re-poll + re-fetch)
  const refresh = useCallback(() => fetchAll({ triggerBackendRefresh: true }), [fetchAll]);

  // Soft refresh (re-fetch from backend cache without triggering ACC poll)
  const softRefresh = useCallback(() => fetchAll(), [fetchAll]);

  return (
    <CameraDataContext.Provider value={{
      cameras,
      servers,
      sites,
      dashboardStats,
      loading,
      error,
      lastRefreshed,
      refresh,
      softRefresh,
    }}>
      {children}
    </CameraDataContext.Provider>
  );
};

export const useCameraData = () => {
  const ctx = useContext(CameraDataContext);
  if (!ctx) throw new Error('useCameraData must be used within CameraDataProvider');
  return ctx;
};

export default CameraDataContext;
