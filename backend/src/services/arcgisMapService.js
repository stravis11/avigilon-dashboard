import axios from 'axios';
import { logger } from '../utils/logger.js';
import avigilonService from './avigilonServiceInstance.js';

const DEFAULT_CACHE_TTL = 60 * 60 * 1000;
const PAGE_SIZE = 2000;
const DEFAULT_CAMERA_TYPE_FIELD = 'Type_of_Camera';
const DEFAULT_CAMERA_DIRECTION_FIELD = 'Direction_of_Camera__Degrees_';

const normalizeText = (value) => String(value || '').trim().toLowerCase();

export const normalizeIp = (value) => {
  if (!value) return '';
  const raw = String(value).trim();
  if (!raw) return '';

  if (raw.startsWith('[')) {
    const end = raw.indexOf(']');
    return end > 0 ? raw.slice(1, end).toLowerCase() : raw.toLowerCase();
  }

  return raw.split(':')[0].trim().toLowerCase();
};

class ArcgisMapService {
  constructor() {
    this.featureLayerUrl = process.env.ARCGIS_FEATURE_LAYER_URL || '';
    this.apiKey = process.env.ARCGIS_API_KEY || '';
    this.ipField = process.env.ARCGIS_IP_FIELD || 'ipAddress';
    this.labelField = process.env.ARCGIS_LABEL_FIELD || '';
    this.typeField = process.env.ARCGIS_TYPE_FIELD || DEFAULT_CAMERA_TYPE_FIELD;
    this.directionField = process.env.ARCGIS_DIRECTION_FIELD || DEFAULT_CAMERA_DIRECTION_FIELD;
    this.referrer = process.env.ARCGIS_REFERER || '';
    this.cacheTTL = Number(process.env.ARCGIS_CACHE_TTL_MS) || DEFAULT_CACHE_TTL;
    this.cache = null;
    this.cacheExpiry = 0;

    logger.info('ArcgisMapService initialized:');
    logger.info('- ARCGIS_FEATURE_LAYER_URL:', this.featureLayerUrl ? 'Set' : 'MISSING');
    logger.info('- ARCGIS_API_KEY:', this.apiKey ? 'Set' : 'MISSING');
    logger.info('- ARCGIS_IP_FIELD:', this.ipField);
    logger.info('- ARCGIS_TYPE_FIELD:', this.typeField);
    logger.info('- ARCGIS_DIRECTION_FIELD:', this.directionField);
  }

  isConfigured() {
    return Boolean(this.featureLayerUrl && this.apiKey && this.ipField);
  }

  getQueryUrl() {
    return `${this.featureLayerUrl.replace(/\/+$/, '')}/query`;
  }

  async fetchArcgisFeatures() {
    if (!this.isConfigured()) {
      throw new Error('ArcGIS map integration is not configured');
    }

    const features = [];
    let offset = 0;
    let exceededTransferLimit = true;

    while (exceededTransferLimit) {
      const response = await axios.get(this.getQueryUrl(), {
        timeout: 30000,
        params: {
          f: 'json',
          where: '1=1',
          outFields: '*',
          returnGeometry: true,
          outSR: 4326,
          resultOffset: offset,
          resultRecordCount: PAGE_SIZE,
          token: this.apiKey,
        },
        headers: this.referrer ? { Referer: this.referrer } : {},
      });

      if (response.data?.error) {
        throw new Error(response.data.error.message || 'ArcGIS query failed');
      }

      const page = Array.isArray(response.data?.features) ? response.data.features : [];
      features.push(...page);
      exceededTransferLimit = Boolean(response.data?.exceededTransferLimit && page.length > 0);
      offset += page.length;

      if (page.length === 0) break;
    }

    logger.info(`ArcGIS map: fetched ${features.length} features`);
    return features;
  }

  async getAccCameras() {
    const response = await avigilonService.getCameras();
    return response?.result?.cameras || response?.cameras || response?.data || [];
  }

  getCameraIp(camera) {
    return normalizeIp(camera.ipAddress || camera.ip || camera.address);
  }

  getFeatureCoordinates(feature) {
    const geometry = feature?.geometry || {};
    const longitude = Number(geometry.x ?? geometry.longitude);
    const latitude = Number(geometry.y ?? geometry.latitude);

    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
      return null;
    }

    return { latitude, longitude };
  }

  getObjectId(attributes = {}) {
    return attributes.OBJECTID ?? attributes.ObjectID ?? attributes.objectid ?? attributes.FID ?? attributes.fid;
  }

  getLabel(attributes = {}, ip) {
    if (this.labelField && attributes[this.labelField]) return String(attributes[this.labelField]);
    return attributes.name || attributes.Name || attributes.label || attributes.Label || ip || 'Camera location';
  }

  getCameraType(attributes = {}) {
    return attributes[this.typeField] || attributes['Type of Camera'] || '';
  }

  getDirectionDegrees(attributes = {}) {
    const rawDirection = attributes[this.directionField] ?? attributes['Direction of Camera (Degrees)'];
    const direction = Number(rawDirection);
    if (!Number.isFinite(direction)) return null;
    return ((direction % 360) + 360) % 360;
  }

  getLayerCategories(attributes = {}) {
    const cameraType = normalizeText(this.getCameraType(attributes));
    const layers = new Set();

    if (cameraType.includes('interior')) layers.add('interior');
    if (cameraType.includes('exterior')) layers.add('exterior');

    // Keep unclassified ArcGIS records visible instead of hiding them behind layer filters.
    if (layers.size === 0) {
      layers.add('interior');
      layers.add('exterior');
    }

    return [...layers];
  }

  buildFeed(features, cameras) {
    const camerasByIp = new Map();
    const matchedCameraIds = new Set();

    cameras.forEach((camera) => {
      const ip = this.getCameraIp(camera);
      if (!ip) return;
      if (!camerasByIp.has(ip)) camerasByIp.set(ip, []);
      camerasByIp.get(ip).push(camera);
    });

    const markers = [];
    const unmatchedArcgis = [];

    features.forEach((feature, index) => {
      const attributes = feature.attributes || {};
      const ip = normalizeIp(attributes[this.ipField]);
      const coordinates = this.getFeatureCoordinates(feature);
      const matchedCameras = ip ? (camerasByIp.get(ip) || []) : [];
      const objectId = this.getObjectId(attributes);
      const id = objectId != null ? String(objectId) : `feature-${index}`;
      const cameraType = this.getCameraType(attributes);
      const layers = this.getLayerCategories(attributes);
      const status = matchedCameras.length === 0
        ? 'unmatched'
        : matchedCameras.some(camera => camera.connectionState === 'CONNECTED')
          ? 'online'
          : 'offline';

      const marker = {
        id,
        ip,
        label: this.getLabel(attributes, ip),
        status,
        cameraType,
        directionDegrees: this.getDirectionDegrees(attributes),
        layers,
        coordinates,
        arcgis: {
          objectId,
          attributes,
        },
        cameras: matchedCameras.map((camera) => {
          matchedCameraIds.add(camera.id);
          return {
            id: camera.id,
            name: camera.name || camera.deviceName || 'Unnamed Camera',
            deviceName: camera.deviceName,
            connectionState: camera.connectionState || 'Unknown',
            ipAddress: this.getCameraIp(camera) || 'N/A',
            model: camera.model || camera.deviceModel || 'N/A',
            manufacturer: camera.manufacturer || 'N/A',
            serverId: camera.serverId,
            serial: camera.serial || null,
          };
        }),
      };

      markers.push(marker);
      if (status === 'unmatched') unmatchedArcgis.push(marker);
    });

    const accOnlyCameras = cameras
      .filter(camera => !matchedCameraIds.has(camera.id))
      .map(camera => ({
        id: camera.id,
        name: camera.name || camera.deviceName || 'Unnamed Camera',
        connectionState: camera.connectionState || 'Unknown',
        ipAddress: this.getCameraIp(camera) || 'N/A',
        model: camera.model || camera.deviceModel || 'N/A',
        serverId: camera.serverId,
      }));

    return {
      markers,
      unmatchedArcgis,
      accOnlyCameras,
      summary: {
        markers: markers.length,
        matchedMarkers: markers.filter(marker => marker.cameras.length > 0).length,
        unmatchedArcgis: unmatchedArcgis.length,
        accOnlyCameras: accOnlyCameras.length,
        interiorMarkers: markers.filter(marker => marker.layers.includes('interior')).length,
        exteriorMarkers: markers.filter(marker => marker.layers.includes('exterior')).length,
      },
      generatedAt: new Date().toISOString(),
      cacheTtlMs: this.cacheTTL,
      isStale: false,
    };
  }

  async refresh() {
    const [features, cameras] = await Promise.all([
      this.fetchArcgisFeatures(),
      this.getAccCameras(),
    ]);

    const feed = this.buildFeed(features, cameras);
    this.cache = feed;
    this.cacheExpiry = Date.now() + this.cacheTTL;
    return feed;
  }

  async getCameraMap({ forceRefresh = false } = {}) {
    if (!forceRefresh && this.cache && Date.now() < this.cacheExpiry) {
      return this.cache;
    }

    try {
      return await this.refresh();
    } catch (error) {
      if (this.cache) {
        logger.warn('ArcGIS map refresh failed; serving stale cache:', error.message);
        return {
          ...this.cache,
          isStale: true,
          staleReason: error.message,
        };
      }
      throw error;
    }
  }
}

export default ArcgisMapService;
