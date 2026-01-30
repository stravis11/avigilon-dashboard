import avigilonService from '../services/avigilonServiceInstance.js';
import dns from 'dns';
import { promisify } from 'util';

const dnsLookup = promisify(dns.lookup);
const DNS_SUFFIX = '.police.gatech.edu';

// Helper to resolve server hostname to IP
async function resolveServerIP(serverName) {
  try {
    const fqdn = serverName + DNS_SUFFIX;
    const result = await dnsLookup(fqdn);
    return result.address;
  } catch (error) {
    console.warn(`DNS lookup failed for ${serverName}: ${error.message}`);
    return null;
  }
}

// Sites
export const getSites = async (req, res) => {
  try {
    const sites = await avigilonService.getSites();
    res.json({ success: true, data: sites });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
};

export const getSiteById = async (req, res) => {
  try {
    const { siteId } = req.params;
    const site = await avigilonService.getSiteById(siteId);
    res.json({ success: true, data: site });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
};

// Cameras
export const getCameras = async (req, res) => {
  try {
    const { verbosity } = req.query;
    const cameras = await avigilonService.getCameras(verbosity);
    res.json({ success: true, data: cameras });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
};

export const getCameraById = async (req, res) => {
  try {
    const { cameraId } = req.params;
    const camera = await avigilonService.getCameraById(cameraId);
    res.json({ success: true, data: camera });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
};

export const getCameraSnapshot = async (req, res) => {
  try {
    const { cameraId } = req.params;
    const { t } = req.query; // timestamp, default 'live'
    const snapshot = await avigilonService.getCameraSnapshot(cameraId, t || 'live');
    res.set('Content-Type', 'image/jpeg');
    res.send(snapshot);
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
};

export const getMediaStreamInfo = async (req, res) => {
  try {
    const { cameraId } = req.params;
    const streamInfo = await avigilonService.getMediaStreamInfo(cameraId);
    res.json({ success: true, data: streamInfo });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
};

// Servers
export const getServerInfo = async (req, res) => {
  try {
    const info = await avigilonService.getServerInfo();
    res.json({ success: true, data: info });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
};

export const getServers = async (req, res) => {
  try {
    const servers = await avigilonService.getServers();
    res.json({ success: true, data: servers });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
};

export const getServerIds = async (req, res) => {
  try {
    const serverIds = await avigilonService.getServerIds();

    // Enrich servers with resolved IP addresses
    // Note: Avigilon API /server/ids only returns id and name, no uptime data available
    if (serverIds?.result?.servers) {
      const serversWithIPs = await Promise.all(
        serverIds.result.servers.map(async (server) => {
          const ip = await resolveServerIP(server.name);
          return {
            ...server,
            ip,
            uptime: null // Avigilon API doesn't provide uptime info
          };
        })
      );
      serverIds.result.servers = serversWithIPs;
    }

    res.json({ success: true, data: serverIds });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
};

export const getServerById = async (req, res) => {
  try {
    const { serverId } = req.params;
    const server = await avigilonService.getServerById(serverId);
    res.json({ success: true, data: server });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
};

// Recording
export const getRecordingRetention = async (req, res) => {
  try {
    const { serverId } = req.params;
    const retention = await avigilonService.getRecordingRetention(serverId);
    res.json({ success: true, data: retention });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
};

export const getServersMaxRecordingDays = async (req, res) => {
  try {
    // Get all servers and cameras
    const [serversData, camerasData] = await Promise.all([
      avigilonService.getServerIds(),
      avigilonService.getCameras()
    ]);

    const servers = serversData?.result?.servers || [];
    const cameras = camerasData?.result?.cameras || [];

    // For each server, get max recording days
    const results = await Promise.all(
      servers.map(async (server) => {
        const camerasOnServer = cameras.filter(cam => cam.serverId === server.id);
        const maxDays = await avigilonService.getServerMaxRecordingDays(server.id, camerasOnServer);
        return {
          serverId: server.id,
          serverName: server.name,
          maxRecordingDays: maxDays
        };
      })
    );

    res.json({ success: true, data: results });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
};

// Health & Capabilities
export const getHealth = async (req, res) => {
  try {
    const health = await avigilonService.getHealth();
    res.json({ success: true, data: health });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
};

export const getSiteHealth = async (req, res) => {
  try {
    const { siteId } = req.params;
    const health = await avigilonService.getSiteHealth(siteId);
    res.json({ success: true, data: health });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
};

export const getCapabilities = async (req, res) => {
  try {
    const capabilities = await avigilonService.getCapabilities();
    res.json({ success: true, data: capabilities });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
};

// Alarms
export const getAlarms = async (req, res) => {
  try {
    const alarms = await avigilonService.getAlarms();
    res.json({ success: true, data: alarms });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
};

export const getAlarmById = async (req, res) => {
  try {
    const { alarmId } = req.params;
    const alarm = await avigilonService.getAlarmById(alarmId);
    res.json({ success: true, data: alarm });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
};

export const updateAlarm = async (req, res) => {
  try {
    const { alarmId } = req.params;
    const { action, note } = req.body;

    if (!action) {
      return res.status(400).json({
        success: false,
        error: 'Action is required (CLAIM, UNCLAIM, ACKNOWLEDGE, TRIGGER, DISMISS)'
      });
    }

    const result = await avigilonService.updateAlarm(alarmId, action, note);
    res.json({ success: true, data: result });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
};

// Events
export const searchEvents = async (req, res) => {
  try {
    const { queryType, serverId, from, to, eventTopics, limit, token } = req.query;

    if (!queryType) {
      return res.status(400).json({
        success: false,
        error: 'queryType is required (TIME_RANGE, ACTIVE, CONTINUE)'
      });
    }

    const options = {};
    if (serverId) options.serverId = serverId;
    if (from) options.from = from;
    if (to) options.to = to;
    if (eventTopics) options.eventTopics = eventTopics;
    if (limit) options.limit = parseInt(limit);
    if (token) options.token = token;

    const events = await avigilonService.searchEvents(queryType, options);
    res.json({ success: true, data: events });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
};

// Timeline
export const getTimeline = async (req, res) => {
  try {
    const { cameraId } = req.params;
    const { from, to } = req.query;

    if (!from || !to) {
      return res.status(400).json({
        success: false,
        error: 'from and to timestamps are required'
      });
    }

    const timeline = await avigilonService.getTimeline(cameraId, from, to);
    res.json({ success: true, data: timeline });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
};

// Test connection
export const testConnection = async (req, res) => {
  try {
    const result = await avigilonService.testConnection();
    res.json(result);
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
};

// Login (manual trigger)
export const login = async (req, res) => {
  try {
    const result = await avigilonService.login();
    res.json({ success: true, data: result });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
};

// Logout
export const logout = async (req, res) => {
  try {
    await avigilonService.logout();
    res.json({ success: true, message: 'Logged out successfully' });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
};

// Dashboard Stats (pre-computed for faster loading)
export const getDashboardStats = async (req, res) => {
  try {
    const stats = await avigilonService.getDashboardStats();
    res.json({ success: true, data: stats });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
};
