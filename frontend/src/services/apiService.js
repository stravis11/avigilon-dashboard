import { API_BASE_URL, createSessionClient } from './sessionClient';

const apiClient = createSessionClient(API_BASE_URL, { unwrap: true });

const apiService = {
  // Health check
  healthCheck: () => apiClient.get('/health'),

  // Test connection
  testConnection: () => apiClient.get('/test-connection'),

  // Server info
  getServerInfo: () => apiClient.get('/server'),
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

  // Camera map (ArcGIS-backed, read-only)
  getCameraMap: () => apiClient.get('/map/cameras'),
  refreshCameraMap: () => apiClient.post('/map/refresh'),

  // Cloud API (Hardware Health Monitoring)
  getCloudStatus: () => apiClient.get('/cloud/status'),
  setCloudToken: (token) => apiClient.post('/cloud/token', { token }),
  clearCloudToken: () => apiClient.delete('/cloud/token'),
  getCloudServers: () => apiClient.get('/cloud/servers'),
  getCloudServerDetails: (serverId) => apiClient.get(`/cloud/servers/${serverId}`),
  getCloudHealthSummary: () => apiClient.get('/cloud/health-summary'),
  refreshCloudToken: () => apiClient.post('/cloud/refresh-token'),

  // Zabbix (SNMP hardware details — OS, BIOS, iDRAC, DIMMs, fans, disks)
  getZabbixStatus: () => apiClient.get('/zabbix/status'),
  getZabbixServers: () => apiClient.get('/zabbix/servers'),
  getZabbixServerHealth: (ipOrName) => apiClient.get(`/zabbix/servers/${encodeURIComponent(ipOrName)}`),

  // Cache management
  refreshCache: () => apiClient.post('/cache/refresh'),
  getCacheStatus: () => apiClient.get('/cache/status'),
};

export default apiService;
