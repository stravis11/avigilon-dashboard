import axios from 'axios';
import { logger } from '../utils/logger.js';

class CloudApiService {
  constructor() {
    this.baseURL = process.env.CLOUD_API_URL || 'https://ingress.cluster.prodeastus01.acs314159.com/api/hms/api/v1';
    this.siteId = process.env.CLOUD_SITE_ID || 'f307cd33-dbdc-ef11-95f5-6045bddc0699';
    this.jwtToken = null;
    this.tokenSetAt = null;
    this.tokenPayload = null;
    this.axiosInstance = null;

    // Cache for API calls
    this.cache = new Map();
    this.cacheTTL = 300000; // 5 minutes for individual requests
    this.healthSummaryCacheTTL = 86400000; // 24 hours for health summary

    logger.info('CloudApiService initialized:');
    logger.info('- CLOUD_API_URL:', this.baseURL ? 'Set' : 'MISSING');
    logger.info('- CLOUD_SITE_ID:', this.siteId ? 'Set' : 'MISSING');
  }

  /**
   * Decode a JWT payload without verification (we don't have the signing key)
   */
  decodeJwtPayload(token) {
    try {
      const parts = token.split('.');
      if (parts.length !== 3) throw new Error('Invalid JWT format');
      const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString());
      return payload;
    } catch (error) {
      throw new Error('Failed to decode JWT: ' + error.message);
    }
  }

  /**
   * Store a JWT token for cloud API calls
   */
  setToken(token) {
    const payload = this.decodeJwtPayload(token);
    this.jwtToken = token;
    this.tokenPayload = payload;
    this.tokenSetAt = new Date();
    this.clearCache();

    // Re-initialize axios with new token
    this.initializeAxios();

    logger.info('Cloud JWT token set. Expires:', new Date(payload.exp * 1000).toISOString());

    // Eagerly fetch and cache health data while the token is still valid
    // (token expires in ~1 hour, but we cache health data for 24 hours)
    this.eagerFetchHealthData();

    return {
      expiresAt: payload.exp,
      issuedAt: payload.iat,
      setAt: this.tokenSetAt.toISOString(),
    };
  }

  /**
   * Eagerly fetch all cloud health data in the background.
   * Called after a new token is set so data is captured before the token expires.
   */
  eagerFetchHealthData() {
    logger.info('Starting eager fetch of cloud health data...');
    this.getAllServerHealthSummary()
      .then((summary) => {
        logger.info(`Eager fetch complete: ${summary.length} servers cached for 24 hours`);
      })
      .catch((err) => {
        console.error('Eager fetch failed:', err.message);
      });
  }

  /**
   * Get the current token status
   */
  getTokenStatus() {
    if (!this.jwtToken) {
      return { hasToken: false, isExpired: true, expiresAt: null, setAt: null };
    }

    const now = Math.floor(Date.now() / 1000);
    const bufferSeconds = 300; // 5-minute buffer
    const isExpired = this.tokenPayload.exp - bufferSeconds < now;

    return {
      hasToken: true,
      isExpired,
      expiresAt: this.tokenPayload.exp,
      expiresAtFormatted: new Date(this.tokenPayload.exp * 1000).toISOString(),
      setAt: this.tokenSetAt?.toISOString() || null,
      hasCachedData: this.cache.has('cloud_health_summary'),
    };
  }

  /**
   * Clear the stored token
   */
  clearToken() {
    this.jwtToken = null;
    this.tokenPayload = null;
    this.tokenSetAt = null;
    this.clearCache();
    logger.info('Cloud JWT token cleared');
  }

  /**
   * Ensure we have a valid token before making API calls
   */
  ensureToken() {
    const status = this.getTokenStatus();
    if (!status.hasToken) {
      throw new Error('No cloud API token configured. Submit a token from the Avigilon cloud portal.');
    }
    if (status.isExpired) {
      throw new Error('Cloud API token has expired. Please submit a new token from the Avigilon cloud portal.');
    }
  }

  /**
   * Initialize axios instance
   */
  initializeAxios() {
    this.axiosInstance = axios.create({
      baseURL: this.baseURL,
      timeout: 30000,
      headers: {
        'Content-Type': 'application/json',
      },
    });

    // Add request interceptor to include JWT
    this.axiosInstance.interceptors.request.use(
      (config) => {
        if (this.jwtToken) {
          config.headers['Authorization'] = `Bearer ${this.jwtToken}`;
        }
        return config;
      },
      (error) => Promise.reject(error)
    );

    // Add response interceptor for 401 detection
    this.axiosInstance.interceptors.response.use(
      (response) => response,
      (error) => {
        if (error.response?.status === 401) {
          console.warn('Cloud API returned 401 - token may be expired');
          // Mark token as expired by setting exp to 0
          if (this.tokenPayload) {
            this.tokenPayload.exp = 0;
          }
        }
        return Promise.reject(error);
      }
    );
  }

  /**
   * Get cached data if valid
   */
  getCached(key) {
    const cached = this.cache.get(key);
    if (cached && Date.now() < cached.expiry) {
      logger.debug(`Cloud cache hit for ${key}`);
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
  setCache(key, data, ttl = null) {
    const cacheTTL = ttl || this.cacheTTL;
    this.cache.set(key, {
      data,
      expiry: Date.now() + cacheTTL
    });
    logger.debug(`Cloud cached ${key} for ${cacheTTL / 1000}s`);
  }

  /**
   * Clear all cache
   */
  clearCache() {
    this.cache.clear();
    logger.debug('Cloud cache cleared');
  }

  /**
   * Get all servers from cloud API
   * API: GET /servers?page=1&pageSize=100&site={siteId}
   */
  async getServers(page = 1, pageSize = 100) {
    const cacheKey = `cloud_servers_${page}_${pageSize}`;
    const cached = this.getCached(cacheKey);
    if (cached) return cached;

    this.ensureToken();
    if (!this.axiosInstance) this.initializeAxios();

    const response = await this.axiosInstance.get('/servers', {
      params: {
        page,
        pageSize,
        site: this.siteId,
        keyword: '',
        sort: 'connectionState',
        order: 'DESC',
      },
    });

    logger.info(`Cloud servers: fetched ${response.data?.servers?.length || 0} servers`);
    this.setCache(cacheKey, response.data);
    return response.data;
  }

  /**
   * Get detailed server info from cloud API
   * API: GET /servers/{serverId}
   */
  async getServerDetails(serverId) {
    const cacheKey = `cloud_server_${serverId}`;
    const cached = this.getCached(cacheKey);
    if (cached) return cached;

    this.ensureToken();
    if (!this.axiosInstance) this.initializeAxios();

    const response = await this.axiosInstance.get(`/servers/${serverId}`);
    this.setCache(cacheKey, response.data);
    return response.data;
  }

  /**
   * Get health summary for all servers
   * Fetches server list, then details for each in parallel
   * Returns normalized hardware health data
   */
  async getAllServerHealthSummary() {
    const cacheKey = 'cloud_health_summary';
    const cached = this.getCached(cacheKey);
    if (cached) return cached;

    this.ensureToken();
    if (!this.axiosInstance) this.initializeAxios();

    // Get server list
    const serverList = await this.getServers();
    const servers = serverList?.servers || [];

    if (servers.length === 0) {
      return [];
    }

    // Fetch details for each server in parallel
    const details = await Promise.allSettled(
      servers.map(server => this.getServerDetails(server.id))
    );

    // Normalize into health summary
    const healthSummary = servers.map((server, index) => {
      const detail = details[index].status === 'fulfilled' ? details[index].value : null;
      return this.normalizeServerHealth(server, detail);
    });

    this.setCache(cacheKey, healthSummary, this.healthSummaryCacheTTL);
    return healthSummary;
  }

  /**
   * Normalize cloud server data into a consistent health structure
   * Based on actual cloud API response structure
   */
  normalizeServerHealth(server, detail) {
    const d = detail || {};
    const hw = d.hardware || {};

    // Calculate memory usage from raw byte values
    const totalMemBytes = (d.availablePhysicalMemoryBytes || 0) + (d.physicalMemoryUsageBytes || 0);
    const usedMemBytes = d.physicalMemoryUsageBytes || 0;
    const memoryUsagePercent = totalMemBytes > 0 ? Math.round((usedMemBytes / totalMemBytes) * 100) : null;
    const totalMemGB = totalMemBytes > 0 ? (totalMemBytes / (1024 ** 3)).toFixed(1) : null;
    const usedMemGB = usedMemBytes > 0 ? (usedMemBytes / (1024 ** 3)).toFixed(1) : null;

    return {
      cloudServerId: server.id,
      serverName: server.name || d.name || 'Unknown',
      connectionState: server.connectionState || d.connectionState || 'Unknown',
      model: d.modelName || server.platformId || null,
      serviceTag: d.serviceTag || null,
      version: d.version || server.version || null,
      lastSeen: server.time || d.time || null,
      ipAddress: server.ipAddress || d.ipAddress || null,
      hardware: {
        psus: hw.powerSupplies || [],
        temperatureProbes: hw.temperatureProbes || [],
        coolingDevices: hw.coolingDevices || [],
        disks: hw.arrayDisks || [],
      },
      cpu: d.systemCPU != null ? {
        systemPercent: d.systemCPU,
        processPercent: d.processCPU,
      } : null,
      memory: totalMemBytes > 0 ? {
        usagePercent: memoryUsagePercent,
        usedGB: usedMemGB,
        totalGB: totalMemGB,
      } : null,
      networks: d.networks || [],
      license: d.license || null,
      analytics: d.analyticsService || null,
      startTime: d.startTime || null,
    };
  }

}

export default CloudApiService;
