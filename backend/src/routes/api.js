import express from 'express';
import {
  // Sites
  getSites,
  getSiteById,
  // Cameras
  getCameras,
  getCameraById,
  getCameraSnapshot,
  getMediaStreamInfo,
  // Servers
  getServerInfo,
  getServers,
  getServerIds,
  getServerById,
  // Recording
  getRecordingRetention,
  getServersMaxRecordingDays,
  // Health & Capabilities
  getHealth,
  getSiteHealth,
  getCapabilities,
  // Alarms
  getAlarms,
  getAlarmById,
  updateAlarm,
  // Events
  searchEvents,
  // Timeline
  getTimeline,
  // Connection
  testConnection,
  login,
  logout,
  // Dashboard
  getDashboardStats,
} from '../controllers/avigilonController.js';

const router = express.Router();

// Local health check (no ACC connection)
router.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// ACC Health check
router.get('/acc/health', getHealth);
router.get('/site/health', getSiteHealth);
router.get('/site/health/:siteId', getSiteHealth);

// Test connection & Authentication
router.get('/test-connection', testConnection);
router.post('/login', login);
router.post('/logout', logout);

// Capabilities
router.get('/capabilities', getCapabilities);

// Server info
router.get('/server', getServerInfo);
router.get('/servers', getServers);
router.get('/server/ids', getServerIds);
router.get('/servers/max-recording-days', getServersMaxRecordingDays);
router.get('/servers/:serverId', getServerById);
router.get('/servers/:serverId/retention', getRecordingRetention);

// Sites
router.get('/sites', getSites);
router.get('/sites/:siteId', getSiteById);

// Cameras
router.get('/cameras', getCameras);
router.get('/cameras/:cameraId', getCameraById);
router.get('/cameras/:cameraId/snapshot', getCameraSnapshot);
router.get('/cameras/:cameraId/stream', getMediaStreamInfo);
router.get('/cameras/:cameraId/timeline', getTimeline);

// Alarms
router.get('/alarms', getAlarms);
router.get('/alarms/:alarmId', getAlarmById);
router.put('/alarms/:alarmId', updateAlarm);

// Events
router.get('/events/search', searchEvents);

// Dashboard
router.get('/dashboard/stats', getDashboardStats);

export default router;
