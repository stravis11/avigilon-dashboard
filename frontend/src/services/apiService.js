import axios from 'axios';

const API_BASE_URL = import.meta.env.VITE_API_URL || '/api';

const apiClient = axios.create({
  baseURL: API_BASE_URL,
  timeout: 180000,
  headers: {
    'Content-Type': 'application/json',
  },
});

// Request interceptor
apiClient.interceptors.request.use(
  (config) => {
    return config;
  },
  (error) => {
    return Promise.reject(error);
  }
);

// Response interceptor
apiClient.interceptors.response.use(
  (response) => response.data,
  (error) => {
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
  getCameraSnapshot: (cameraId) =>
    `${API_BASE_URL}/cameras/${cameraId}/snapshot`,

  // Dashboard
  getDashboardStats: () => apiClient.get('/dashboard/stats'),
};

export default apiService;
