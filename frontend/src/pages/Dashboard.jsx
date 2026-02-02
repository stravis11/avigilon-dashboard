import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { Server, Camera, MapPin, Activity, AlertCircle, ChevronUp, ChevronDown, X, RefreshCw } from 'lucide-react';
import apiService from '../services/apiService';

const STANDBY_SERVERS = ['GTPDACCSERVER10', 'GTPDACCSERVER3'];

const Dashboard = () => {
  const [serverInfo, setServerInfo] = useState(null);
  const [sites, setSites] = useState([]);
  const [dashboardStats, setDashboardStats] = useState(null);
  const [sitesLoading, setSitesLoading] = useState(true);
  const [statsLoading, setStatsLoading] = useState(true);
  const [error, setError] = useState(null);
  const [connectionStatus, setConnectionStatus] = useState('checking');
  const [sortColumn, setSortColumn] = useState('name');
  const [sortDirection, setSortDirection] = useState('asc');
  const [selectedServer, setSelectedServer] = useState(null);
  const [loadingMessage, setLoadingMessage] = useState('');

  // Load data on mount - simple approach, let apiClient handle auth
  useEffect(() => {
    loadDashboardData();
  }, []);

  const loadDashboardData = useCallback(async () => {
    setSitesLoading(true);
    setStatsLoading(true);
    setError(null);
    setConnectionStatus('checking');
    setLoadingMessage('Connecting to server...');

    // Helper to extract array from various response structures
    const extractArray = (response, key) => {
      const paths = [
        response?.data?.result?.[key],
        response?.result?.[key],
        response?.data?.[key],
        response?.[key],
        response?.data,
        response
      ];
      for (const path of paths) {
        if (Array.isArray(path)) return path;
      }
      return [];
    };

    // Load all data in parallel, update UI as each completes
    setLoadingMessage('Loading dashboard statistics...');

    // Dashboard stats (includes servers with pre-computed camera counts)
    apiService.getDashboardStats()
      .then((response) => {
        const stats = response?.data || response;
        console.log('Dashboard stats loaded:', stats);
        setDashboardStats(stats);
        setConnectionStatus('connected');
        setLoadingMessage(`Loaded ${stats?.totalServers || 0} servers, ${stats?.totalCameraChannels || 0} cameras`);
      })
      .catch((err) => {
        console.error('Failed to load dashboard stats:', err.message);
        setError(`Failed to load stats: ${err.message}`);
      })
      .finally(() => setStatsLoading(false));

    // Sites
    apiService.getSites()
      .then((response) => {
        const sitesList = extractArray(response, 'sites');
        console.log('Sites loaded:', sitesList.length);
        setSites(sitesList);
        setConnectionStatus('connected');
      })
      .catch((err) => {
        console.error('Failed to load sites:', err.message);
      })
      .finally(() => setSitesLoading(false));

    // Server info
    apiService.getServerInfo()
      .then((response) => {
        const info = response?.data?.result || response?.result || response?.data || response;
        setServerInfo(info);
        setConnectionStatus('connected');
      })
      .catch((err) => console.error('Failed to load server info:', err.message));
  }, []);

  const getStatusColor = (status) => {
    switch (status) {
      case 'connected':
        return 'bg-green-500';
      case 'disconnected':
        return 'bg-red-500';
      case 'checking':
        return 'bg-yellow-500';
      default:
        return 'bg-gray-500';
    }
  };

  // Handle column sort
  const handleSort = (column) => {
    if (sortColumn === column) {
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
    } else {
      setSortColumn(column);
      setSortDirection('asc');
    }
  };

  // Sort indicator component
  const SortIndicator = ({ column }) => {
    if (sortColumn !== column) {
      return <span className="ml-1 text-gray-300 dark:text-gray-600">&#8597;</span>;
    }
    return sortDirection === 'asc'
      ? <ChevronUp className="inline ml-1 h-4 w-4" />
      : <ChevronDown className="inline ml-1 h-4 w-4" />;
  };

  // Sorted servers (from pre-computed stats)
  const sortedServers = useMemo(() => {
    const serverStats = dashboardStats?.serverStats || [];
    return [...serverStats].sort((a, b) => {
      let aVal, bVal;
      switch (sortColumn) {
        case 'name':
          aVal = (a.name || '').toLowerCase();
          bVal = (b.name || '').toLowerCase();
          break;
        case 'ip':
          aVal = a.host || a.address || a.ip || '';
          bVal = b.host || b.address || b.ip || '';
          break;
        case 'cameraChannels':
          aVal = a.cameraChannels;
          bVal = b.cameraChannels;
          break;
        case 'views':
          aVal = a.viewCount;
          bVal = b.viewCount;
          break;
        case 'maxRecording':
          aVal = 30; // Currently hardcoded
          bVal = 30;
          break;
        default:
          aVal = a.name || '';
          bVal = b.name || '';
      }
      if (aVal < bVal) return sortDirection === 'asc' ? -1 : 1;
      if (aVal > bVal) return sortDirection === 'asc' ? 1 : -1;
      return 0;
    });
  }, [dashboardStats, sortColumn, sortDirection]);

  // Server Detail Modal Component
  const ServerDetailModal = ({ server, onClose }) => {
    if (!server) return null;

    return (
      <div
        className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4"
        onClick={onClose}
      >
        <div
          className="bg-white dark:bg-gray-800 rounded-lg shadow-xl max-w-lg w-full max-h-[90vh] overflow-hidden"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Modal Header */}
          <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 dark:border-gray-700">
            <div className="flex items-center space-x-3">
              <Server className="h-6 w-6 text-purple-500" />
              <h2 className="text-xl font-semibold text-gray-900 dark:text-white">
                {server.name || 'Server Details'}
              </h2>
            </div>
            <button
              onClick={onClose}
              className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
            >
              <X className="h-6 w-6" />
            </button>
          </div>

          {/* Modal Body */}
          <div className="px-6 py-4 overflow-y-auto max-h-[calc(90vh-120px)]">
            <div className="space-y-4">
              {/* Status Badge */}
              <div className="flex items-center space-x-2">
                <span className={`px-3 py-1 text-sm font-semibold rounded-full ${
                  server.isStandby
                    ? 'bg-yellow-100 dark:bg-yellow-900/50 text-yellow-800 dark:text-yellow-400'
                    : 'bg-green-100 dark:bg-green-900/50 text-green-800 dark:text-green-400'
                }`}>
                  {server.isStandby ? 'Standby' : 'Active'}
                </span>
              </div>

              {/* Server Details Grid */}
              <div className="grid grid-cols-1 gap-4">
                <div className="bg-gray-50 dark:bg-gray-700/50 rounded-lg p-4">
                  <h3 className="text-sm font-medium text-gray-500 dark:text-gray-400 mb-3">
                    Connection Details
                  </h3>
                  <dl className="space-y-2">
                    <div className="flex justify-between">
                      <dt className="text-sm text-gray-600 dark:text-gray-400">IP Address</dt>
                      <dd className="text-sm font-medium text-gray-900 dark:text-white">
                        {server.host || 'N/A'}
                      </dd>
                    </div>
                    <div className="flex justify-between">
                      <dt className="text-sm text-gray-600 dark:text-gray-400">Server ID</dt>
                      <dd className="text-sm font-mono text-gray-900 dark:text-white truncate max-w-[200px]" title={server.id}>
                        {server.id || 'N/A'}
                      </dd>
                    </div>
                  </dl>
                </div>

                <div className="bg-gray-50 dark:bg-gray-700/50 rounded-lg p-4">
                  <h3 className="text-sm font-medium text-gray-500 dark:text-gray-400 mb-3">
                    Statistics
                  </h3>
                  <dl className="space-y-2">
                    <div className="flex justify-between">
                      <dt className="text-sm text-gray-600 dark:text-gray-400">Camera Channels</dt>
                      <dd className="text-sm font-medium text-gray-900 dark:text-white">
                        {server.cameraChannels ?? 'N/A'}
                      </dd>
                    </div>
                    <div className="flex justify-between">
                      <dt className="text-sm text-gray-600 dark:text-gray-400">View Count</dt>
                      <dd className="text-sm font-medium text-gray-900 dark:text-white">
                        {server.viewCount ?? 'N/A'}
                      </dd>
                    </div>
                    <div className="flex justify-between">
                      <dt className="text-sm text-gray-600 dark:text-gray-400">Max Recording</dt>
                      <dd className="text-sm font-medium text-gray-900 dark:text-white">
                        30 days
                      </dd>
                    </div>
                  </dl>
                </div>
              </div>
            </div>
          </div>

          {/* Modal Footer */}
          <div className="px-6 py-4 border-t border-gray-200 dark:border-gray-700 flex justify-end">
            <button
              onClick={onClose}
              className="px-4 py-2 bg-gray-200 dark:bg-gray-700 text-gray-800 dark:text-gray-200 rounded-lg hover:bg-gray-300 dark:hover:bg-gray-600 transition-colors"
            >
              Close
            </button>
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900 transition-colors duration-300">
      {/* Header */}
      <header className="bg-white dark:bg-gray-800 shadow-sm transition-colors duration-300">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-3">
              {/* Georgia Tech Logo */}
              <img
                src="https://www.pngall.com/wp-content/uploads/15/Georgia-Tech-Logo-No-Background.png"
                alt="Georgia Tech Logo"
                className="h-10 w-auto"
              />
              <h1 className="text-2xl font-bold text-gray-900 dark:text-white">
                Georgia Tech Avigilon
              </h1>
            </div>
            <div className="flex items-center space-x-4">
              {loadingMessage && (statsLoading || sitesLoading) && (
                <span className="text-sm text-gray-500 dark:text-gray-400">{loadingMessage}</span>
              )}
              <button
                onClick={loadDashboardData}
                disabled={statsLoading && sitesLoading}
                className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors disabled:opacity-50"
                title="Refresh data"
              >
                <RefreshCw className={`h-5 w-5 text-gray-600 dark:text-gray-400 ${(statsLoading || sitesLoading) ? 'animate-spin' : ''}`} />
              </button>
              <div className="flex items-center space-x-2">
                <div className={`h-3 w-3 rounded-full ${getStatusColor(connectionStatus)}`}></div>
                <span className="text-sm text-gray-600 dark:text-gray-300 capitalize">{connectionStatus}</span>
              </div>
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Error Message */}
        {error && (
          <div className="mb-6 bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-800 rounded-lg p-4 flex items-start">
            <AlertCircle className="h-5 w-5 text-red-600 dark:text-red-400 mt-0.5 mr-3 flex-shrink-0" />
            <div>
              <h3 className="text-sm font-medium text-red-800 dark:text-red-300">Connection Error</h3>
              <p className="text-sm text-red-700 dark:text-red-400 mt-1">{error}</p>
              <button
                onClick={loadDashboardData}
                className="mt-2 text-sm text-red-600 dark:text-red-400 hover:text-red-800 dark:hover:text-red-300 underline"
              >
                Retry Connection
              </button>
            </div>
          </div>
        )}

        {/* Stats Cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-6 mb-8">
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow dark:shadow-gray-900/50 p-6 transition-colors duration-300">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-600 dark:text-gray-400">Total Servers</p>
                {statsLoading ? (
                  <div className="flex items-center space-x-2">
                    <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-purple-600"></div>
                    <span className="text-sm text-gray-500 dark:text-gray-400">Loading...</span>
                  </div>
                ) : (
                  <p className="text-3xl font-bold text-gray-900 dark:text-white">{dashboardStats?.totalServers || 0}</p>
                )}
              </div>
              <Server className="h-12 w-12 text-purple-500" />
            </div>
          </div>

          <div className="bg-white dark:bg-gray-800 rounded-lg shadow dark:shadow-gray-900/50 p-6 transition-colors duration-300">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-600 dark:text-gray-400">Total Sites</p>
                {sitesLoading ? (
                  <div className="flex items-center space-x-2">
                    <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-blue-600"></div>
                    <span className="text-sm text-gray-500 dark:text-gray-400">Loading...</span>
                  </div>
                ) : (
                  <p className="text-3xl font-bold text-gray-900 dark:text-white">{sites.length}</p>
                )}
              </div>
              <MapPin className="h-12 w-12 text-blue-500" />
            </div>
          </div>

          <div className="bg-white dark:bg-gray-800 rounded-lg shadow dark:shadow-gray-900/50 p-6 transition-colors duration-300">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-600 dark:text-gray-400">Total Views</p>
                {statsLoading ? (
                  <div className="flex items-center space-x-2">
                    <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-green-600"></div>
                    <span className="text-sm text-gray-500 dark:text-gray-400">Loading...</span>
                  </div>
                ) : (
                  <p className="text-3xl font-bold text-gray-900 dark:text-white">
                    {dashboardStats?.totalViews || 0}
                  </p>
                )}
              </div>
              <Camera className="h-12 w-12 text-green-500" />
            </div>
          </div>

          <div className="bg-white dark:bg-gray-800 rounded-lg shadow dark:shadow-gray-900/50 p-6 transition-colors duration-300">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-600 dark:text-gray-400">Total Cameras</p>
                {statsLoading ? (
                  <div className="flex items-center space-x-2">
                    <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-teal-600"></div>
                    <span className="text-sm text-gray-500 dark:text-gray-400">Loading...</span>
                  </div>
                ) : (
                  <p className="text-3xl font-bold text-gray-900 dark:text-white">
                    {dashboardStats?.totalCameraChannels || 0}
                  </p>
                )}
              </div>
              <Camera className="h-12 w-12 text-teal-500" />
            </div>
          </div>

          <div className="bg-white dark:bg-gray-800 rounded-lg shadow dark:shadow-gray-900/50 p-6 transition-colors duration-300">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-600 dark:text-gray-400">Connection</p>
                <p className="text-3xl font-bold text-gray-900 dark:text-white capitalize">
                  {connectionStatus}
                </p>
              </div>
              <Activity className="h-12 w-12 text-orange-500" />
            </div>
          </div>
        </div>

        {/* Server Info */}
        {serverInfo && (
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow dark:shadow-gray-900/50 mb-8 transition-colors duration-300">
            <div className="px-6 py-4 border-b border-gray-200 dark:border-gray-700">
              <h2 className="text-lg font-semibold text-gray-900 dark:text-white flex items-center">
                <Server className="h-5 w-5 mr-2" />
                Server Information
              </h2>
            </div>
            <div className="px-6 py-4">
              <dl className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {Object.entries(serverInfo).map(([key, value]) => (
                  <div key={key}>
                    <dt className="text-sm font-medium text-gray-500 dark:text-gray-400 capitalize">
                      {key.replace(/([A-Z])/g, ' $1').trim()}
                    </dt>
                    <dd className="mt-1 text-sm text-gray-900 dark:text-gray-200">
                      {typeof value === 'object' ? JSON.stringify(value) : String(value)}
                    </dd>
                  </div>
                ))}
              </dl>
            </div>
          </div>
        )}

        {/* Sites List */}
        {sites.length > 0 && (
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow dark:shadow-gray-900/50 mb-8 transition-colors duration-300">
            <div className="px-6 py-4 border-b border-gray-200 dark:border-gray-700">
              <h2 className="text-lg font-semibold text-gray-900 dark:text-white flex items-center">
                <MapPin className="h-5 w-5 mr-2" />
                Sites
              </h2>
            </div>
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
                <thead className="bg-gray-50 dark:bg-gray-700/50">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                      Name
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                      Status
                    </th>
                  </tr>
                </thead>
                <tbody className="bg-white dark:bg-gray-800 divide-y divide-gray-200 dark:divide-gray-700">
                  {sites.map((site) => (
                    <tr key={site.id} className="hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors">
                      <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900 dark:text-white">
                        {site.name || 'N/A'}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <span className="px-2 inline-flex text-xs leading-5 font-semibold rounded-full bg-green-100 dark:bg-green-900/50 text-green-800 dark:text-green-400">
                          Active
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Servers List */}
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow dark:shadow-gray-900/50 mb-8 transition-colors duration-300">
          <div className="px-6 py-4 border-b border-gray-200 dark:border-gray-700">
            <h2 className="text-lg font-semibold text-gray-900 dark:text-white flex items-center">
              <Server className="h-5 w-5 mr-2" />
              Servers
            </h2>
          </div>
          <div className="overflow-x-auto">
            {statsLoading ? (
              <div className="px-6 py-8 flex items-center justify-center">
                <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-blue-600 mr-3"></div>
                <span className="text-gray-500 dark:text-gray-400">Loading servers...</span>
              </div>
            ) : sortedServers.length > 0 ? (
              <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
                <thead className="bg-gray-50 dark:bg-gray-700/50">
                  <tr>
                    <th
                      className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-600/50 select-none transition-colors"
                      onClick={() => handleSort('name')}
                    >
                      Name <SortIndicator column="name" />
                    </th>
                    <th
                      className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-600/50 select-none transition-colors"
                      onClick={() => handleSort('ip')}
                    >
                      Server IP <SortIndicator column="ip" />
                    </th>
                    <th
                      className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-600/50 select-none transition-colors"
                      onClick={() => handleSort('cameraChannels')}
                    >
                      Camera Channels <SortIndicator column="cameraChannels" />
                    </th>
                    <th
                      className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-600/50 select-none transition-colors"
                      onClick={() => handleSort('views')}
                    >
                      Views <SortIndicator column="views" />
                    </th>
                    <th
                      className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-600/50 select-none transition-colors"
                      onClick={() => handleSort('maxRecording')}
                    >
                      Max Recording <SortIndicator column="maxRecording" />
                    </th>
                  </tr>
                </thead>
                <tbody className="bg-white dark:bg-gray-800 divide-y divide-gray-200 dark:divide-gray-700">
                  {sortedServers.map((server) => (
                    <tr
                      key={server.id}
                      className="hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors cursor-pointer"
                      onClick={() => setSelectedServer(server)}
                    >
                      <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900 dark:text-white">
                        {server.name || 'N/A'}
                        {server.isStandby && <span className="ml-2 text-gray-500 dark:text-gray-400 font-normal">(Standby)</span>}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 dark:text-gray-400">
                        {server.host || server.address || server.ip || 'N/A'}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 dark:text-gray-400">
                        {server.cameraChannels}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 dark:text-gray-400">
                        {server.viewCount}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 dark:text-gray-400">
                        30 days
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <div className="px-6 py-8 text-center text-gray-500 dark:text-gray-400">No servers found</div>
            )}
          </div>
        </div>
      </main>

      {/* Server Detail Modal */}
      {selectedServer && (
        <ServerDetailModal
          server={selectedServer}
          onClose={() => setSelectedServer(null)}
        />
      )}
    </div>
  );
};

export default Dashboard;
