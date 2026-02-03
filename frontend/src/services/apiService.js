import axios from 'axios';

const API_BASE_URL = import.meta.env.VITE_API_URL || '/api';

const apiClient = axios.create({
  baseURL: API_BASE_URL,
  timeout: 180000,
  headers: {
    'Content-Type': 'application/json',
  },
});

// Request interceptor - add auth token
apiClient.interceptors.request.use(
  (config) => {
    const token = localStorage.getItem('accessToken');
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  },
  (error) => {
    return Promise.reject(error);
  }
);

// Response interceptor - handle 401 errors with token refresh
apiClient.interceptors.response.use(
  (response) => response.data,
  async (error) => {
    const originalRequest = error.config;

    // If 401 and we haven't tried refreshing yet
    if (error.response?.status === 401 && !originalRequest._retry) {
      originalRequest._retry = true;

      const refreshToken = localStorage.getItem('refreshToken');
      if (refreshToken) {
        try {
          const response = await axios.post(`${API_BASE_URL}/auth/refresh`, { refreshToken });
          if (response.data.success) {
            const newToken = response.data.data.accessToken;
            localStorage.setItem('accessToken', newToken);
            originalRequest.headers.Authorization = `Bearer ${newToken}`;
            return apiClient.request(originalRequest);
          }
        } catch (refreshError) {
          // Refresh failed, clear auth and redirect to login
          localStorage.removeItem('accessToken');
          localStorage.removeItem('refreshToken');
          window.location.href = '/login';
          return Promise.reject(refreshError);
        }
      } else {
        // No refresh token, redirect to login
        window.location.href = '/login';
      }
    }

    const message = error.response?.data?.error || error.message || 'An error occurred';
    return Promise.reject(new Error(message));
  }
);

const apiService = {
  // Health check
  healthCheck: () => apiClient.get('/health'),

  // Test connection
  testConnection: () => apiClient.get('/test-connection'),

  // Server info
  getServerInfo: () => apiClient.get('/server/info'),
  getServers: () => apiClient.get('/server/ids'),

  // Sites
  getSites: () => apiClient.get('/sites'),
  getSiteById: (siteId) => apiClient.get(`/sites/${siteId}`),

  // Cameras
  getCameras: (siteId = null) => {
    const params = siteId ? { siteId } : {};
    return apiClient.get('/cameras', { params });
  },
  getCameraById: (cameraId) => apiClient.get(`/cameras/${cameraId}`),
  getCameraStatus: (cameraId) => apiClient.get(`/cameras/${cameraId}/status`),
  updateCamera: (cameraId, settings) => apiClient.put(`/cameras/${cameraId}`, settings),
  // Returns the snapshot URL - for authenticated requests, use fetchCameraSnapshotBlob
  getCameraSnapshotUrl: (cameraId) =>
    `${API_BASE_URL}/cameras/${cameraId}/snapshot`,

  // Fetch camera snapshot as blob URL (for authenticated image loading)
  fetchCameraSnapshotBlob: async (cameraId) => {
    const response = await apiClient.get(`/cameras/${cameraId}/snapshot`, {
      responseType: 'blob',
    });
    return URL.createObjectURL(response);
  },

  // Dashboard
  getDashboardStats: () => apiClient.get('/dashboard/stats'),

  // Cloud API (Hardware Health Monitoring)
  getCloudStatus: () => apiClient.get('/cloud/status'),
  setCloudToken: (token) => apiClient.post('/cloud/token', { token }),
  clearCloudToken: () => apiClient.delete('/cloud/token'),
  getCloudServers: () => apiClient.get('/cloud/servers'),
  getCloudServerDetails: (serverId) => apiClient.get(`/cloud/servers/${serverId}`),
  getCloudHealthSummary: () => apiClient.get('/cloud/health-summary'),
  refreshCloudToken: () => apiClient.post('/cloud/refresh-token'),
};

export default apiService;
