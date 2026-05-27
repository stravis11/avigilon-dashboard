import fs from 'fs/promises';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { logger } from '../utils/logger.js';
import avigilonService from './avigilonServiceInstance.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_INTERVAL_MS = 24 * 60 * 60 * 1000;
const DEFAULT_SAMPLE_SIZE = 20;
const DEFAULT_LOOKBACK_DAYS = 365;
const DEFAULT_HISTORY_LIMIT = 5000;

const parsePositiveInt = (value, fallback) => {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

const toIsoOrNull = (date) => {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return null;
  return date.toISOString();
};

const quantile = (values, percentile) => {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.floor((sorted.length - 1) * percentile)));
  return sorted[index];
};

const selectCameraSample = (cameras, sampleSize) => {
  if (cameras.length <= sampleSize) return cameras;

  const preferred = cameras
    .filter((camera) => camera.recordedData !== false)
    .sort((a, b) => String(a.name || a.deviceName || a.id).localeCompare(String(b.name || b.deviceName || b.id)));
  const source = preferred.length >= sampleSize ? preferred : cameras;
  const result = [];
  const lastIndex = source.length - 1;

  for (let i = 0; i < sampleSize; i += 1) {
    const index = Math.round((i * lastIndex) / Math.max(1, sampleSize - 1));
    result.push(source[index]);
  }

  return [...new Map(result.map((camera) => [camera.id, camera])).values()];
};

const extractRanges = (timelineResult) => {
  const timelines = timelineResult?.timelines || timelineResult?.cameras || [];
  const ranges = [];

  timelines.forEach((timeline) => {
    ['record', 'unloaded'].forEach((key) => {
      const entries = Array.isArray(timeline?.[key]) ? timeline[key] : [];
      entries.forEach((entry) => {
        const start = new Date(entry.start || entry.from || entry.begin);
        const end = new Date(entry.end || entry.to || entry.finish || entry.start || entry.from || entry.begin);
        if (!Number.isNaN(start.getTime())) {
          ranges.push({ start, end: Number.isNaN(end.getTime()) ? start : end });
        }
      });
    });
  });

  return ranges;
};

const mapWithConcurrency = async (items, limit, mapper) => {
  const results = new Array(items.length);
  let nextIndex = 0;

  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (nextIndex < items.length) {
      const currentIndex = nextIndex;
      nextIndex += 1;
      results[currentIndex] = await mapper(items[currentIndex], currentIndex);
    }
  });

  await Promise.all(workers);
  return results;
};

class RecordingAvailabilityService {
  constructor() {
    this.intervalMs = parsePositiveInt(process.env.RECORDING_AVAILABILITY_INTERVAL_MS, DEFAULT_INTERVAL_MS);
    this.sampleSize = parsePositiveInt(process.env.RECORDING_AVAILABILITY_SAMPLE_SIZE, DEFAULT_SAMPLE_SIZE);
    this.lookbackDays = parsePositiveInt(process.env.RECORDING_AVAILABILITY_LOOKBACK_DAYS, DEFAULT_LOOKBACK_DAYS);
    this.historyLimit = parsePositiveInt(process.env.RECORDING_AVAILABILITY_HISTORY_LIMIT, DEFAULT_HISTORY_LIMIT);
    this.dataFilePath = process.env.RECORDING_AVAILABILITY_DATA_FILE ||
      join(__dirname, '..', 'data', 'recordingAvailability.json');

    this.store = {
      version: 1,
      latestCollectedAt: null,
      latest: {},
      history: [],
    };
    this.initialized = false;
    this.collectingPromise = null;
    this.interval = null;
  }

  async initialize() {
    if (this.initialized) return;
    await this.loadStore();
    this.initialized = true;
  }

  async loadStore() {
    try {
      const raw = await fs.readFile(this.dataFilePath, 'utf-8');
      const parsed = JSON.parse(raw);
      this.store = {
        version: 1,
        latestCollectedAt: parsed.latestCollectedAt || null,
        latest: parsed.latest || {},
        history: Array.isArray(parsed.history) ? parsed.history : [],
      };
    } catch (error) {
      if (error.code !== 'ENOENT') {
        logger.warn('Recording availability history could not be loaded:', error.message);
      }
    }
  }

  async saveStore() {
    await fs.mkdir(dirname(this.dataFilePath), { recursive: true });
    const payload = JSON.stringify(this.store, null, 2);
    await fs.writeFile(this.dataFilePath, payload, 'utf-8');
  }

  startScheduler() {
    if (this.interval) return;

    this.initialize().then(() => {
      const latestAge = this.store.latestCollectedAt
        ? Date.now() - new Date(this.store.latestCollectedAt).getTime()
        : Infinity;

      if (latestAge > this.intervalMs) {
        this.refresh().catch((error) => {
          logger.warn('Initial recording availability collection failed:', error.message);
        });
      }
    });

    this.interval = setInterval(() => {
      this.refresh().catch((error) => {
        logger.warn('Scheduled recording availability collection failed:', error.message);
      });
    }, this.intervalMs);

    logger.info(`Recording availability scheduler started (every ${Math.round(this.intervalMs / 60000)} min)`);
  }

  getLatest() {
    return {
      generatedAt: this.store.latestCollectedAt,
      method: 'timeline_observed_storage_all',
      lookbackDays: this.lookbackDays,
      sampleSize: this.sampleSize,
      servers: Object.values(this.store.latest).sort((a, b) => a.serverName.localeCompare(b.serverName)),
    };
  }

  getHistory(serverId = null) {
    const history = serverId
      ? this.store.history.filter((entry) => entry.serverId === serverId)
      : this.store.history;
    return [...history].sort((a, b) => new Date(b.collectedAt) - new Date(a.collectedAt));
  }

  toCsv(serverId = null) {
    const rows = this.getHistory(serverId);
    const columns = [
      'collectedAt',
      'serverName',
      'serverId',
      'status',
      'confidence',
      'estimatedDays',
      'minDays',
      'medianDays',
      'maxDays',
      'successfulSamples',
      'sampleSize',
      'totalCameras',
      'oldestRecordingAt',
      'newestRecordingAt',
      'method',
    ];

    const escape = (value) => {
      if (value == null) return '';
      const text = String(value);
      return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
    };

    return [
      columns.join(','),
      ...rows.map((row) => columns.map((column) => escape(row[column])).join(',')),
    ].join('\n');
  }

  async refresh() {
    await this.initialize();
    if (this.collectingPromise) return this.collectingPromise;

    this.collectingPromise = this.collectAllServers()
      .finally(() => {
        this.collectingPromise = null;
      });

    return this.collectingPromise;
  }

  async collectAllServers() {
    logger.info('Recording availability collection starting...');
    const collectedAt = new Date().toISOString();
    const [serversData, camerasData] = await Promise.all([
      avigilonService.getServerIds(),
      avigilonService.getCameras(),
    ]);

    const servers = serversData?.result?.servers || [];
    const cameras = camerasData?.result?.cameras || [];
    const readings = await mapWithConcurrency(servers, 2, async (server) => {
      const camerasOnServer = cameras.filter((camera) => camera.serverId === server.id);
      return this.collectServer(server, camerasOnServer, collectedAt);
    });

    const latest = {};
    readings.forEach((reading) => {
      latest[reading.serverId] = reading;
    });

    this.store.latest = latest;
    this.store.latestCollectedAt = collectedAt;
    this.store.history = [...this.store.history, ...readings].slice(-this.historyLimit);
    await this.saveStore();

    logger.info(`Recording availability collection complete (${readings.length} servers)`);
    return this.getLatest();
  }

  async collectServer(server, camerasOnServer, collectedAt) {
    if (!camerasOnServer.length) {
      return this.buildReading(server, collectedAt, {
        totalCameras: 0,
        sampleSize: 0,
        cameraResults: [],
      });
    }

    const sample = selectCameraSample(camerasOnServer, this.sampleSize);
    const start = new Date(Date.now() - this.lookbackDays * DAY_MS).toISOString();
    const end = new Date().toISOString();
    const cameraResults = await mapWithConcurrency(
      sample,
      4,
      (camera) => this.collectCamera(camera, start, end)
    );

    return this.buildReading(server, collectedAt, {
      totalCameras: camerasOnServer.length,
      sampleSize: sample.length,
      cameraResults,
    });
  }

  async collectCamera(camera, start, end) {
    try {
      await avigilonService.ensureSession();
      const response = await avigilonService.axiosInstance.get('/mt/api/rest/v1/timeline', {
        params: {
          cameraIds: camera.id,
          scope: '1000000_SECONDS',
          start,
          end,
          storage: 'ALL',
        },
      });

      const ranges = extractRanges(response.data?.result);
      if (!ranges.length) {
        return {
          cameraId: camera.id,
          cameraName: camera.name || camera.deviceName || camera.id,
          status: 'no_recording',
        };
      }

      const oldest = ranges.reduce((min, range) => range.start < min ? range.start : min, ranges[0].start);
      const newest = ranges.reduce((max, range) => range.end > max ? range.end : max, ranges[0].end);
      const days = Math.max(0, (Date.now() - oldest.getTime()) / DAY_MS);

      return {
        cameraId: camera.id,
        cameraName: camera.name || camera.deviceName || camera.id,
        status: 'ok',
        days,
        oldestRecordingAt: oldest.toISOString(),
        newestRecordingAt: newest.toISOString(),
      };
    } catch (error) {
      return {
        cameraId: camera.id,
        cameraName: camera.name || camera.deviceName || camera.id,
        status: 'error',
        error: error.message,
      };
    }
  }

  buildReading(server, collectedAt, { totalCameras, sampleSize, cameraResults }) {
    const successful = cameraResults.filter((result) => result.status === 'ok' && Number.isFinite(result.days));
    const dayValues = successful.map((result) => result.days);
    const oldestDates = successful.map((result) => new Date(result.oldestRecordingAt)).filter((date) => !Number.isNaN(date.getTime()));
    const newestDates = successful.map((result) => new Date(result.newestRecordingAt)).filter((date) => !Number.isNaN(date.getTime()));
    const oldest = oldestDates.length ? oldestDates.reduce((min, date) => date < min ? date : min, oldestDates[0]) : null;
    const newest = newestDates.length ? newestDates.reduce((max, date) => date > max ? date : max, newestDates[0]) : null;
    const successRatio = sampleSize > 0 ? successful.length / sampleSize : 0;

    let status = 'ok';
    let confidence = 'high';
    if (!totalCameras) {
      status = 'unavailable';
      confidence = 'none';
    } else if (successful.length === 0) {
      status = 'unavailable';
      confidence = 'none';
    } else if (successRatio < 0.5 || successful.length < Math.min(3, sampleSize)) {
      status = 'limited';
      confidence = 'low';
    } else if (successRatio < 0.8 || sampleSize < Math.min(this.sampleSize, totalCameras)) {
      status = 'limited';
      confidence = 'medium';
    }

    const maxDays = dayValues.length ? Math.max(...dayValues) : null;

    return {
      serverId: server.id,
      serverName: server.name || server.id,
      collectedAt,
      method: 'timeline_observed_storage_all',
      status,
      confidence,
      estimatedDays: maxDays == null ? null : Number(maxDays.toFixed(1)),
      minDays: dayValues.length ? Number(Math.min(...dayValues).toFixed(1)) : null,
      medianDays: dayValues.length ? Number(quantile(dayValues, 0.5).toFixed(1)) : null,
      maxDays: maxDays == null ? null : Number(maxDays.toFixed(1)),
      totalCameras,
      sampleSize,
      successfulSamples: successful.length,
      failedSamples: cameraResults.filter((result) => result.status === 'error').length,
      noRecordingSamples: cameraResults.filter((result) => result.status === 'no_recording').length,
      oldestRecordingAt: toIsoOrNull(oldest),
      newestRecordingAt: toIsoOrNull(newest),
    };
  }
}

export default new RecordingAvailabilityService();
