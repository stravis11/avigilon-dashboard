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
  getServerExtendedInfo,
  // Recording
  getRecordingRetention,
  getServersMaxRecordingDays,
  // Health & Capabilities
  getHealth,
  getSiteHealth,
  getCapabilities,
  getEntities,
  getEventSubtopics,
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

import {
  setCloudToken,
  getCloudStatus,
  clearCloudToken,
  getCloudServers,
  getCloudServerDetails,
  getCloudHealthSummary,
  triggerTokenRefresh,
} from '../controllers/cloudController.js';

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

// Entities & Events (for health monitoring)
router.get('/entities', getEntities);
router.get('/event-subtopics', getEventSubtopics);

// Server info
router.get('/server', getServerInfo);
router.get('/servers', getServers);
router.get('/server/ids', getServerIds);
router.get('/servers/max-recording-days', getServersMaxRecordingDays);
router.get('/servers/:serverId', getServerById);
router.get('/servers/:serverId/retention', getRecordingRetention);
router.get('/servers/:serverId/extended', getServerExtendedInfo);

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

// Cloud API (Hardware Health Monitoring)
router.post('/cloud/token', setCloudToken);
router.get('/cloud/status', getCloudStatus);
router.delete('/cloud/token', clearCloudToken);
router.get('/cloud/servers', getCloudServers);
router.get('/cloud/servers/:serverId', getCloudServerDetails);
router.get('/cloud/health-summary', getCloudHealthSummary);
router.post('/cloud/refresh-token', triggerTokenRefresh);

export default router;
