import axios from 'axios';
import crypto from 'crypto';
import https from 'https';
import dns from 'dns';
import { promisify } from 'util';

const dnsLookup = promisify(dns.lookup);

class AvigilonService {
  constructor() {
    this.baseURL = process.env.ACC_SERVER_URL;
    this.username = process.env.ACC_USERNAME;
    this.password = process.env.ACC_PASSWORD;
    this.userNonce = process.env.ACC_USER_NONCE;
    this.userKey = process.env.ACC_USER_KEY;
    this.clientName = process.env.ACC_CLIENT_NAME || 'AvigilonWebApp';
    this.sessionToken = null;
    this.sessionExpiry = null;
    this.axiosInstance = null;

    // Cache for expensive API calls
    this.cache = new Map();
    this.cacheTTL = 300000; // 5 minutes cache TTL

    // Debug: Log environment variable status
    console.log('AvigilonService initialized:');
    console.log('- ACC_SERVER_URL:', this.baseURL ? 'Set' : 'MISSING');
    console.log('- ACC_USERNAME:', this.username ? 'Set' : 'MISSING');
    console.log('- ACC_USER_NONCE:', this.userNonce ? 'Set' : 'MISSING');
    console.log('- ACC_USER_KEY:', this.userKey ? 'Set' : 'MISSING');

    // Validate required environment variables
    if (!this.userKey) {
      console.error('CRITICAL: ACC_USER_KEY is undefined!');
      console.error('Available env vars:', Object.keys(process.env).filter(k => k.startsWith('ACC_')));
    }
  }

  /**
   * Generate authorization token for ACC API login
   * Format: userNonce:timestamp:hexEncodedHash[:integrationIdentifier]
   * where hexEncodedHash = sha256(timestamp + userKey)
   */
  generateAuthorizationToken() {
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const message = timestamp + this.userKey;
    const hash = crypto.createHash('sha256').update(message).digest('hex');
    return `${this.userNonce}:${timestamp}:${hash}`;
  }

  /**
   * Initialize axios instance with base configuration
   */
  initializeAxios() {
    this.axiosInstance = axios.create({
      baseURL: this.baseURL,
      timeout: 180000,
      headers: {
        'Content-Type': 'application/json',
      },
      // Accept self-signed certificates (common with ACC servers)
      httpsAgent: new https.Agent({
        rejectUnauthorized: false,
        minVersion: 'TLSv1',
        maxVersion: 'TLSv1.3',
        keepAlive: true,
        keepAliveMsecs: 1000,
      }),
    });

    // Add request interceptor to include session token
    this.axiosInstance.interceptors.request.use(
      (config) => {
        if (this.sessionToken) {
          // Add session via header (preferred) and query param (fallback)
          config.headers['x-avg-session'] = this.sessionToken;
        }
        return config;
      },
      (error) => Promise.reject(error)
    );

    // Add response interceptor for error handling and session refresh
    this.axiosInstance.interceptors.response.use(
      (response) => response,
      async (error) => {
        const originalRequest = error.config;
        if (error.response?.status === 401 && !originalRequest._retry) {
          originalRequest._retry = true;
          // Session expired, re-authenticate
          console.log('Session expired, re-authenticating...');
          await this.login();
          originalRequest.headers['x-avg-session'] = this.sessionToken;
          return this.axiosInstance.request(originalRequest);
        }
        return Promise.reject(error);
      }
    );
  }

  /**
   * Get cached data if valid, otherwise return null
   */
  getCached(key) {
    const cached = this.cache.get(key);
    if (cached && Date.now() < cached.expiry) {
      console.log(`Cache hit for ${key}`);
      return cached.data;
    }
    if (cached) {
      this.cache.delete(key);
    }
    return null;
  }

  /**
   * Set cache data with TTL
   */
  setCache(key, data) {
    this.cache.set(key, {
      data,
      expiry: Date.now() + this.cacheTTL
    });
    console.log(`Cached ${key} for ${this.cacheTTL / 1000}s`);
  }

  /**
   * Clear all cache
   */
  clearCache() {
    this.cache.clear();
    console.log('Cache cleared');
  }

  /**
   * Check if session is valid (exists and not expired)
   */
  isSessionValid() {
    if (!this.sessionToken) return false;
    if (!this.sessionExpiry) return true;
    // Add 5 minute buffer before expiry
    return Date.now() < (this.sessionExpiry - 5 * 60 * 1000);
  }

  /**
   * Ensure we have a valid session, login if needed
   */
  async ensureSession() {
    if (!this.axiosInstance) {
      this.initializeAxios();
    }
    if (!this.isSessionValid()) {
      await this.login();
    }
  }

  /**
   * Login to ACC server using POST /login
   */
  async login() {
    try {
      if (!this.axiosInstance) {
        this.initializeAxios();
      }

      console.log('Logging in to ACC server:', this.baseURL);

      const authorizationToken = this.generateAuthorizationToken();

      const response = await this.axiosInstance.post('/mt/api/rest/v1/login', {
        username: this.username,
        password: this.password,
        clientName: this.clientName,
        authorizationToken: authorizationToken,
      });

      if (response.data?.status === 'success' && response.data?.result?.session) {
        this.sessionToken = response.data.result.session;
        // Session expires after 1 hour of inactivity
        this.sessionExpiry = Date.now() + 60 * 60 * 1000;
        console.log('Login successful, session obtained');
        return { success: true, message: 'Login successful' };
      }

      throw new Error(response.data?.message || 'Login failed - unexpected response');
    } catch (error) {
      console.error('Login failed:');
      console.error('- Error type:', error.code || error.name);
      console.error('- Message:', error.message);
      console.error('- Response status:', error.response?.status);
      console.error('- Response data:', JSON.stringify(error.response?.data, null, 2));
      throw new Error(`Failed to login: ${error.response?.data?.message || error.message}`);
    }
  }

  /**
   * Logout from ACC server
   */
  async logout() {
    try {
      if (this.sessionToken) {
        await this.axiosInstance.post('/mt/api/rest/v1/logout', {
          session: this.sessionToken,
        });
        console.log('Logout successful');
      }
    } catch (error) {
      console.warn('Logout error (non-critical):', error.message);
    } finally {
      this.sessionToken = null;
      this.sessionExpiry = null;
    }
  }

  /**
   * Get all sites from ACC
   * API: GET /sites
   */
  async getSites() {
    const cacheKey = 'sites';
    const cached = this.getCached(cacheKey);
    if (cached) return cached;

    try {
      await this.ensureSession();
      const response = await this.axiosInstance.get('/mt/api/rest/v1/sites');
      this.setCache(cacheKey, response.data);
      return response.data;
    } catch (error) {
      console.error('Failed to get sites:', error.message);
      throw error;
    }
  }

  /**
   * Get site information by ID
   * API: GET /site?id=xxx
   */
  async getSiteById(siteId) {
    try {
      await this.ensureSession();
      const response = await this.axiosInstance.get('/mt/api/rest/v1/site', {
        params: { id: siteId }
      });
      return response.data;
    } catch (error) {
      console.error(`Failed to get site ${siteId}:`, error.message);
      throw error;
    }
  }

  /**
   * Get all cameras
   * API: GET /cameras with optional verbosity parameter
   */
  async getCameras(verbosity = null) {
    const cacheKey = `cameras_${verbosity || 'default'}`;
    const cached = this.getCached(cacheKey);
    if (cached) return cached;

    try {
      await this.ensureSession();
      const params = verbosity ? { verbosity } : {};
      const response = await this.axiosInstance.get('/mt/api/rest/v1/cameras', {
        params
      });
      this.setCache(cacheKey, response.data);
      return response.data;
    } catch (error) {
      console.error('Failed to get cameras:', error.message);
      console.error('Response status:', error.response?.status);
      console.error('Response data:', JSON.stringify(error.response?.data, null, 2));
      throw error;
    }
  }

  /**
   * Get camera details by ID
   * API: GET /camera?id=xxx or GET /camera?ids=xxx,yyy
   */
  async getCameraById(cameraId) {
    try {
      await this.ensureSession();
      const response = await this.axiosInstance.get('/mt/api/rest/v1/camera', {
        params: { id: cameraId }
      });
      return response.data;
    } catch (error) {
      console.error(`Failed to get camera ${cameraId}:`, error.message);
      throw error;
    }
  }

  /**
   * Get multiple cameras by IDs
   * API: GET /camera?ids=xxx&ids=yyy
   */
  async getCamerasByIds(cameraIds) {
    try {
      await this.ensureSession();
      const response = await this.axiosInstance.get('/mt/api/rest/v1/camera', {
        params: { ids: cameraIds }
      });
      return response.data;
    } catch (error) {
      console.error(`Failed to get cameras:`, error.message);
      throw error;
    }
  }

  /**
   * Get camera snapshot (JPEG image)
   * API: GET /media?cameraId=xxx&format=jpeg&t=live
   */
  async getCameraSnapshot(cameraId, timestamp = 'live') {
    try {
      await this.ensureSession();
      const response = await this.axiosInstance.get('/mt/api/rest/v1/media', {
        params: {
          cameraId: cameraId,
          format: 'jpeg',
          t: timestamp
        },
        responseType: 'arraybuffer'
      });
      return response.data;
    } catch (error) {
      console.error(`Failed to get snapshot for camera ${cameraId}:`, error.message);
      throw error;
    }
  }

  /**
   * Get media stream info (MPD format for video streaming)
   * API: GET /media?cameraId=xxx&format=mpd
   */
  async getMediaStreamInfo(cameraId) {
    try {
      await this.ensureSession();
      const response = await this.axiosInstance.get('/mt/api/rest/v1/media', {
        params: {
          cameraId: cameraId,
          format: 'mpd'
        }
      });
      return response.data;
    } catch (error) {
      console.error(`Failed to get media stream info for camera ${cameraId}:`, error.message);
      throw error;
    }
  }

  /**
   * Get server information
   * API: GET /server
   */
  async getServerInfo() {
    try {
      await this.ensureSession();
      const response = await this.axiosInstance.get('/mt/api/rest/v1/server');
      return response.data;
    } catch (error) {
      console.error('Failed to get server info:', error.message);
      throw error;
    }
  }

  /**
   * Get server details by ID
   * API: GET /server?ids=xxx
   */
  async getServerById(serverId) {
    try {
      await this.ensureSession();
      const response = await this.axiosInstance.get('/mt/api/rest/v1/server', {
        params: { ids: serverId }
      });
      return response.data;
    } catch (error) {
      console.error(`Failed to get server ${serverId}:`, error.message);
      throw error;
    }
  }

  /**
   * Get detailed server info for a single server
   * API: GET /server?id=xxx
   */
  async getServerDetails(serverId) {
    try {
      await this.ensureSession();
      const response = await this.axiosInstance.get('/mt/api/rest/v1/server', {
        params: { id: serverId }
      });
      console.log(`Server ${serverId} details:`, JSON.stringify(response.data, null, 2));
      return response.data;
    } catch (error) {
      console.error(`Failed to get server details for ${serverId}:`, error.message);
      return null;
    }
  }

  /**
   * Get all servers
   * API: GET /servers
   */
  async getServers() {
    const cacheKey = 'servers';
    const cached = this.getCached(cacheKey);
    if (cached) return cached;

    try {
      await this.ensureSession();
      const response = await this.axiosInstance.get('/mt/api/rest/v1/servers');
      this.setCache(cacheKey, response.data);
      return response.data;
    } catch (error) {
      console.error('Failed to get servers:', error.message);
      throw error;
    }
  }

  /**
   * Get server IDs
   * API: GET /server/ids
   */
  async getServerIds() {
    try {
      await this.ensureSession();
      const response = await this.axiosInstance.get('/mt/api/rest/v1/server/ids');
      return response.data;
    } catch (error) {
      console.error('Failed to get server IDs:', error.message);
      throw error;
    }
  }

  /**
   * Get recording retention settings for a server
   * API: GET /recording/retention?id=serverId
   */
  async getRecordingRetention(serverId) {
    try {
      await this.ensureSession();
      const response = await this.axiosInstance.get('/mt/api/rest/v1/recording/retention', {
        params: { id: serverId }
      });
      return response.data;
    } catch (error) {
      console.error(`Failed to get recording retention for server ${serverId}:`, error.message);
      throw error;
    }
  }

  /**
   * Get health status (no auth required)
   * API: GET /health
   */
  async getHealth() {
    try {
      if (!this.axiosInstance) {
        this.initializeAxios();
      }
      const response = await this.axiosInstance.get('/mt/api/rest/v1/health');
      console.log('Health response:', JSON.stringify(response.data, null, 2));
      return response.data;
    } catch (error) {
      console.error('Failed to get health:', error.message);
      throw error;
    }
  }

  /**
   * Get site/system health status - tries multiple endpoints
   */
  async getSiteHealth(siteId = null) {
    try {
      await this.ensureSession();

      // Try different possible endpoints for health/status info
      const endpoints = [
        '/mt/api/rest/v1/status',
        '/mt/api/rest/v1/system/status',
        '/mt/api/rest/v1/server/status',
        '/mt/api/rest/v1/diagnostics',
        '/mt/api/rest/v1/system/diagnostics',
        '/mt/api/rest/v1/health/detailed',
        '/mt/api/rest/v1/health/servers',
        '/mt/api/rest/v1/entities/health',
        '/mt/api/rest/v1/entities/status'
      ];

      for (const endpoint of endpoints) {
        try {
          const params = siteId ? { id: siteId } : {};
          const response = await this.axiosInstance.get(endpoint, { params });
          console.log(`Health data from ${endpoint}:`, JSON.stringify(response.data, null, 2));
          return { endpoint, data: response.data };
        } catch (err) {
          console.log(`Endpoint ${endpoint} failed:`, err.response?.status || err.message);
        }
      }

      return null;
    } catch (error) {
      console.error('Failed to get site health:', error.message);
      return null;
    }
  }

  /**
   * Get all alarms
   * API: GET /alarms
   */
  async getAlarms() {
    try {
      await this.ensureSession();
      const response = await this.axiosInstance.get('/mt/api/rest/v1/alarms');
      return response.data;
    } catch (error) {
      console.error('Failed to get alarms:', error.message);
      throw error;
    }
  }

  /**
   * Get alarm by ID
   * API: GET /alarm?id=xxx
   */
  async getAlarmById(alarmId) {
    try {
      await this.ensureSession();
      const response = await this.axiosInstance.get('/mt/api/rest/v1/alarm', {
        params: { id: alarmId }
      });
      return response.data;
    } catch (error) {
      console.error(`Failed to get alarm ${alarmId}:`, error.message);
      throw error;
    }
  }

  /**
   * Update alarm (claim, acknowledge, trigger, dismiss)
   * API: PUT /alarm
   */
  async updateAlarm(alarmId, action, note = null) {
    try {
      await this.ensureSession();
      const body = {
        session: this.sessionToken,
        id: alarmId,
        action: action // CLAIM, UNCLAIM, ACKNOWLEDGE, TRIGGER, DISMISS
      };
      if (note) {
        body.note = note;
      }
      const response = await this.axiosInstance.put('/mt/api/rest/v1/alarm', body);
      return response.data;
    } catch (error) {
      console.error(`Failed to update alarm ${alarmId}:`, error.message);
      throw error;
    }
  }

  /**
   * Search events
   * API: GET /events/search
   */
  async searchEvents(queryType, options = {}) {
    try {
      await this.ensureSession();
      const params = {
        queryType: queryType, // TIME_RANGE, ACTIVE, CONTINUE
        ...options
      };
      const response = await this.axiosInstance.get('/mt/api/rest/v1/events/search', {
        params
      });
      return response.data;
    } catch (error) {
      console.error('Failed to search events:', error.message);
      throw error;
    }
  }

  /**
   * Get timeline for a camera
   * API: GET /timeline
   */
  async getTimeline(cameraId, from, to) {
    try {
      await this.ensureSession();
      const response = await this.axiosInstance.get('/mt/api/rest/v1/timeline', {
        params: {
          cameraId,
          from,
          to
        }
      });
      return response.data;
    } catch (error) {
      console.error('Failed to get timeline:', error.message);
      throw error;
    }
  }

  /**
   * Get maximum recording days for a server by checking camera timelines
   * Checks a sample camera from the server to find oldest recording
   */
  async getServerMaxRecordingDays(serverId, camerasOnServer) {
    try {
      if (!camerasOnServer || camerasOnServer.length === 0) {
        return null;
      }

      // Pick first camera from this server that has recorded data
      const sampleCamera = camerasOnServer.find(cam => cam.recordedData) || camerasOnServer[0];

      await this.ensureSession();

      // Query timeline starting from 90 days ago with largest scope
      const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);

      const response = await this.axiosInstance.get('/mt/api/rest/v1/timeline', {
        params: {
          cameraIds: sampleCamera.id,
          scope: '1000000_SECONDS',
          start: ninetyDaysAgo.toISOString()
        }
      });

      // Find earliest recording timestamp from timeline
      const result = response.data?.result;
      if (result && result.cameras && result.cameras.length > 0) {
        const cameraTimeline = result.cameras[0];
        if (cameraTimeline.unloaded && cameraTimeline.unloaded.length > 0) {
          // unloaded contains time ranges with recordings
          const earliestRange = cameraTimeline.unloaded[0];
          if (earliestRange && earliestRange.start) {
            const earliestDate = new Date(earliestRange.start);
            const now = new Date();
            const daysDiff = Math.floor((now - earliestDate) / (1000 * 60 * 60 * 24));
            return daysDiff;
          }
        }
      }

      return null;
    } catch (error) {
      console.error(`Failed to get max recording days for server ${serverId}:`, error.message);
      if (error.response?.data) {
        console.error('Response:', JSON.stringify(error.response.data));
      }
      return null;
    }
  }

  /**
   * Get WEP capabilities
   * API: GET /wep-capabilities
   */
  async getCapabilities() {
    try {
      await this.ensureSession();
      const response = await this.axiosInstance.get('/mt/api/rest/v1/wep-capabilities');
      return response.data;
    } catch (error) {
      console.error('Failed to get capabilities:', error.message);
      throw error;
    }
  }

  /**
   * Test connection to ACC server
   */
  async testConnection() {
    try {
      if (!this.axiosInstance) {
        this.initializeAxios();
      }

      console.log('Testing connection to:', this.baseURL);

      // First check health endpoint (no auth required)
      const healthResponse = await this.getHealth();
      console.log('Health check passed:', healthResponse);

      // Now try to login
      await this.login();

      return {
        success: true,
        message: 'Connection and authentication successful',
        health: healthResponse
      };
    } catch (error) {
      console.error('Test connection error:', error.message);
      return { success: false, message: error.message };
    }
  }
}

// Export the class, not an instance
// The instance will be created after environment variables are loaded
export default AvigilonService;
