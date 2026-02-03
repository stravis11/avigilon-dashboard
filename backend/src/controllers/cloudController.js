import cloudApiService from '../services/cloudApiServiceInstance.js';

// Token Management

export const setCloudToken = async (req, res) => {
  try {
    const { token } = req.body;
    if (!token) {
      return res.status(400).json({ success: false, error: 'Token is required' });
    }
    const info = cloudApiService.setToken(token);
    res.json({ success: true, data: info });
  } catch (error) {
    res.status(400).json({ success: false, error: error.message });
  }
};

export const getCloudStatus = async (req, res) => {
  try {
    const status = cloudApiService.getTokenStatus();
    res.json({ success: true, data: status });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
};

export const clearCloudToken = async (req, res) => {
  try {
    cloudApiService.clearToken();
    res.json({ success: true, data: { message: 'Token cleared' } });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
};

// Cloud API Proxies

export const getCloudServers = async (req, res) => {
  try {
    const servers = await cloudApiService.getServers();
    res.json({ success: true, data: servers });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
};

export const getCloudServerDetails = async (req, res) => {
  try {
    const { serverId } = req.params;
    const details = await cloudApiService.getServerDetails(serverId);
    res.json({ success: true, data: details });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
};

export const getCloudHealthSummary = async (req, res) => {
  try {
    const summary = await cloudApiService.getAllServerHealthSummary();
    res.json({ success: true, data: summary });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
};

// Public token submission (for bookmarklet / token-fetcher) — called from index.js
export const submitCloudToken = async (req, res) => {
  try {
    const { token } = req.body;
    if (!token) {
      return res.status(400).json({ success: false, error: 'Token is required' });
    }
    const info = cloudApiService.setToken(token);
    res.json({ success: true, data: info });
  } catch (error) {
    res.status(400).json({ success: false, error: error.message });
  }
};

// Trigger token-fetcher to refresh the cloud token
export const triggerTokenRefresh = async (req, res) => {
  try {
    const tokenFetcherUrl = process.env.TOKEN_FETCHER_URL || 'http://token-fetcher:8080';
    const response = await fetch(`${tokenFetcherUrl}/trigger`, { method: 'POST' });
    if (!response.ok) {
      throw new Error(`Token fetcher responded with ${response.status}`);
    }
    const data = await response.json();
    res.json({ success: true, data: { message: 'Token refresh triggered. This may take a minute.' } });
  } catch (error) {
    res.status(500).json({ success: false, error: `Failed to trigger token refresh: ${error.message}` });
  }
};
