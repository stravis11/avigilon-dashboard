import React, { useState, useEffect, useRef } from 'react';
import { Camera, RefreshCw, AlertCircle, X, ChevronUp, ChevronDown, ImageOff, Search, ChevronLeft, ChevronRight } from 'lucide-react';
import apiService from '../services/apiService';

const STANDBY_SERVERS = ['GTPDACCSERVER10', 'GTPDACCSERVER3'];
const PAGE_SIZE_OPTIONS = [10, 25, 50, 100, 200];
const DEFAULT_PAGE_SIZE = 50;

// Thumbnail component with lazy loading and staggered requests
const CameraThumbnail = ({ cameraId, cameraName, index = 0 }) => {
  const [status, setStatus] = useState('idle'); // idle, waiting, loading, loaded, error
  const [shouldLoad, setShouldLoad] = useState(false);
  const containerRef = useRef(null);

  // Use Intersection Observer to detect when thumbnail is visible
  useEffect(() => {
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          // Stagger loading: delay based on index to spread out requests
          const delay = (index % 10) * 100; // 0-900ms delay, cycles every 10 items
          setTimeout(() => setShouldLoad(true), delay);
          observer.disconnect();
        }
      },
      { rootMargin: '50px' } // Start loading 50px before visible
    );

    if (containerRef.current) {
      observer.observe(containerRef.current);
    }

    return () => observer.disconnect();
  }, [index]);

  return (
    <div ref={containerRef} className="w-20 h-14 bg-gray-200 dark:bg-gray-700 rounded overflow-hidden relative">
      {(status === 'idle' || status === 'loading') && (
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="animate-pulse bg-gray-300 dark:bg-gray-600 w-full h-full"></div>
        </div>
      )}
      {status === 'error' && (
        <div className="absolute inset-0 flex items-center justify-center">
          <ImageOff className="h-5 w-5 text-gray-400 dark:text-gray-500" />
        </div>
      )}
      {shouldLoad && (
        <img
          src={apiService.getCameraSnapshot(cameraId)}
          alt={cameraName || 'Camera'}
          className={`w-full h-full object-cover ${status === 'loaded' ? '' : 'opacity-0 absolute'}`}
          onLoad={() => setStatus('loaded')}
          onError={() => setStatus('error')}
          loading="lazy"
        />
      )}
    </div>
  );
};

// Helper functions to extract camera data
const getIpAddress = (camera) => {
  const ip = camera.ipAddress || camera.ip || camera.address || '';
  // Remove port if present (e.g., "172.23.11.162:443" -> "172.23.11.162")
  return ip.split(':')[0] || 'N/A';
};

const getMacAddress = (camera) => {
  return camera.physicalAddress || camera.macAddress || camera.mac || 'N/A';
};

const Cameras = () => {
  const [cameras, setCameras] = useState([]);
  const [servers, setServers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [selectedCamera, setSelectedCamera] = useState(null);
  const [sortColumn, setSortColumn] = useState('name');
  const [sortDirection, setSortDirection] = useState('asc');
  const [totalCount, setTotalCount] = useState(0);
  const [filteredCount, setFilteredCount] = useState(0);
  const [offlineCount, setOfflineCount] = useState(0);
  const [showOfflineOnly, setShowOfflineOnly] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);

  useEffect(() => {
    loadCameras();
  }, []);

  // Helper to extract array from response
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

  const loadCameras = async () => {
    try {
      setLoading(true);
      setError(null);

      // Load servers and cameras in parallel
      const [serversResponse, camerasResponse] = await Promise.all([
        apiService.getServers(),
        apiService.getCameras()
      ]);

      // Extract servers list
      const serversList = extractArray(serversResponse, 'servers');
      setServers(serversList);

      // Get standby server IDs
      const standbyServerIds = serversList
        .filter(server => STANDBY_SERVERS.includes(server.name))
        .map(server => server.id);

      // Extract cameras array from response
      let camerasList = extractArray(camerasResponse, 'cameras');

      setTotalCount(camerasList.length);

      // Filter out cameras from standby servers
      const activeCameras = camerasList.filter(
        camera => !standbyServerIds.includes(camera.serverId)
      );
      setFilteredCount(activeCameras.length);

      // Calculate offline camera count
      const offlineCameras = activeCameras.filter(
        camera => camera.connectionState && camera.connectionState !== 'CONNECTED'
      );
      setOfflineCount(offlineCameras.length);

      // Load all cameras (pagination handles display)
      setCameras(activeCameras);
      setCurrentPage(1);
    } catch (err) {
      console.error('Failed to load cameras:', err);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleCameraClick = async (camera) => {
    try {
      const details = await apiService.getCameraById(camera.id);
      setSelectedCamera({
        ...camera,
        details: details?.data || details?.result || details,
      });
    } catch (err) {
      console.error('Failed to load camera details:', err);
      setSelectedCamera(camera);
    }
  };

  const handleSort = (column) => {
    if (sortColumn === column) {
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
    } else {
      setSortColumn(column);
      setSortDirection('asc');
    }
  };

  // Get server name by ID
  const getServerName = (serverId) => {
    const server = servers.find(s => s.id === serverId);
    return server?.name || serverId || 'N/A';
  };

  const SortIndicator = ({ column }) => {
    if (sortColumn !== column) {
      return <span className="ml-1 text-gray-300 dark:text-gray-600">&#8597;</span>;
    }
    return sortDirection === 'asc'
      ? <ChevronUp className="inline ml-1 h-4 w-4" />
      : <ChevronDown className="inline ml-1 h-4 w-4" />;
  };

  // Search filter function - searches across all camera fields
  const matchesSearch = (camera, query) => {
    if (!query.trim()) return true;
    const searchLower = query.toLowerCase();

    // Searchable fields
    const searchableValues = [
      camera.name,
      camera.deviceName,
      camera.ipAddress,
      camera.ip,
      camera.address,
      camera.physicalAddress,
      camera.macAddress,
      camera.mac,
      camera.model,
      camera.deviceModel,
      camera.manufacturer,
      camera.serial,
      camera.firmwareVersion,
      camera.connectionState,
      camera.id,
      camera.serverId,
      camera.location,
      camera.timezone,
    ];

    return searchableValues.some(value =>
      value && String(value).toLowerCase().includes(searchLower)
    );
  };

  // Filter cameras by search query and offline status, then sort
  const filteredBySearch = cameras.filter(camera => {
    // First check offline filter
    if (showOfflineOnly && camera.connectionState === 'CONNECTED') {
      return false;
    }
    // Then check search query
    return matchesSearch(camera, searchQuery);
  });

  const sortedCameras = [...filteredBySearch].sort((a, b) => {
    let aVal, bVal;
    switch (sortColumn) {
      case 'name':
        aVal = (a.name || a.deviceName || '').toLowerCase();
        bVal = (b.name || b.deviceName || '').toLowerCase();
        break;
      case 'ip':
        aVal = getIpAddress(a);
        bVal = getIpAddress(b);
        break;
      case 'mac':
        aVal = getMacAddress(a);
        bVal = getMacAddress(b);
        break;
      case 'model':
        aVal = (a.model || a.deviceModel || '').toLowerCase();
        bVal = (b.model || b.deviceModel || '').toLowerCase();
        break;
      default:
        aVal = a.name || '';
        bVal = b.name || '';
    }
    if (aVal < bVal) return sortDirection === 'asc' ? -1 : 1;
    if (aVal > bVal) return sortDirection === 'asc' ? 1 : -1;
    return 0;
  });

  // Pagination calculations
  const totalPages = Math.ceil(sortedCameras.length / pageSize);
  const startIndex = (currentPage - 1) * pageSize;
  const endIndex = startIndex + pageSize;
  const paginatedCameras = sortedCameras.slice(startIndex, endIndex);

  // Reset to page 1 when search or filter changes
  useEffect(() => {
    setCurrentPage(1);
  }, [searchQuery, showOfflineOnly]);

  // Ensure current page is valid when data changes
  useEffect(() => {
    if (currentPage > totalPages && totalPages > 0) {
      setCurrentPage(totalPages);
    }
  }, [totalPages, currentPage]);

  // Handle page size change
  const handlePageSizeChange = (newSize) => {
    setPageSize(newSize);
    setCurrentPage(1);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-gray-50 dark:bg-gray-900 transition-colors duration-300">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto"></div>
          <p className="mt-4 text-gray-600 dark:text-gray-400">Loading cameras...</p>
          <p className="mt-2 text-sm text-gray-500 dark:text-gray-500">This may take a moment due to large data size</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900 transition-colors duration-300">
      {/* Header */}
      <header className="bg-white dark:bg-gray-800 shadow-sm transition-colors duration-300">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-3">
              <Camera className="h-8 w-8 text-blue-600 dark:text-blue-400" />
              <div>
                <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Camera Management</h1>
                <p className="text-sm text-gray-500 dark:text-gray-400 flex items-center gap-2 flex-wrap">
                  <span>
                    {filteredCount} active cameras
                    {totalCount !== filteredCount && ` (${totalCount - filteredCount} on standby servers excluded)`}
                  </span>
                  {offlineCount > 0 && (
                    <button
                      onClick={() => {
                        setShowOfflineOnly(!showOfflineOnly);
                        setCurrentPage(1);
                      }}
                      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium transition-colors ${
                        showOfflineOnly
                          ? 'bg-red-600 text-white'
                          : 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400 hover:bg-red-200 dark:hover:bg-red-900/50'
                      }`}
                    >
                      <AlertCircle className="h-3 w-3" />
                      {offlineCount} offline
                      {showOfflineOnly && <X className="h-3 w-3 ml-1" />}
                    </button>
                  )}
                </p>
              </div>
            </div>
            <button
              onClick={loadCameras}
              className="flex items-center space-x-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 dark:bg-blue-500 dark:hover:bg-blue-600 transition-colors"
            >
              <RefreshCw className="h-4 w-4" />
              <span>Refresh</span>
            </button>
          </div>
          {/* Search Bar */}
          <div className="mt-4">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-5 w-5 text-gray-400 dark:text-gray-500" />
              <input
                type="text"
                placeholder="Search by name, IP, MAC, model, serial, location..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-10 pr-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-500 dark:placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 dark:focus:ring-blue-400 focus:border-transparent transition-colors"
              />
              {searchQuery && (
                <button
                  onClick={() => setSearchQuery('')}
                  className="absolute right-3 top-1/2 transform -translate-y-1/2 text-gray-400 hover:text-gray-600 dark:text-gray-500 dark:hover:text-gray-300"
                >
                  <X className="h-4 w-4" />
                </button>
              )}
            </div>
            {searchQuery && (
              <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">
                Found {filteredBySearch.length} camera{filteredBySearch.length !== 1 ? 's' : ''} matching "{searchQuery}"
              </p>
            )}
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Error Message */}
        {error && (
          <div className="mb-6 bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-800 rounded-lg p-4 flex items-start">
            <AlertCircle className="h-5 w-5 text-red-600 dark:text-red-400 mt-0.5 mr-3 flex-shrink-0" />
            <div>
              <h3 className="text-sm font-medium text-red-800 dark:text-red-300">Error Loading Cameras</h3>
              <p className="text-sm text-red-700 dark:text-red-400 mt-1">{error}</p>
              <button
                onClick={loadCameras}
                className="mt-2 text-sm text-red-600 dark:text-red-400 hover:underline"
              >
                Retry
              </button>
            </div>
          </div>
        )}

        {/* Cameras Table */}
        {sortedCameras.length > 0 && (
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow dark:shadow-gray-900/50 overflow-hidden transition-colors duration-300">
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
                <thead className="bg-gray-50 dark:bg-gray-700/50">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider w-24">
                      Snapshot
                    </th>
                    <th
                      className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-600/50 select-none transition-colors"
                      onClick={() => handleSort('name')}
                    >
                      Name <SortIndicator column="name" />
                    </th>
                    <th
                      className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-600/50 select-none transition-colors"
                      onClick={() => handleSort('ip')}
                    >
                      IP Address <SortIndicator column="ip" />
                    </th>
                    <th
                      className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-600/50 select-none transition-colors"
                      onClick={() => handleSort('mac')}
                    >
                      MAC Address <SortIndicator column="mac" />
                    </th>
                    <th
                      className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-600/50 select-none transition-colors"
                      onClick={() => handleSort('model')}
                    >
                      Model <SortIndicator column="model" />
                    </th>
                  </tr>
                </thead>
                <tbody className="bg-white dark:bg-gray-800 divide-y divide-gray-200 dark:divide-gray-700">
                  {paginatedCameras.map((camera, index) => (
                    <tr
                      key={camera.id}
                      onClick={() => handleCameraClick(camera)}
                      className="hover:bg-gray-50 dark:hover:bg-gray-700/50 cursor-pointer transition-colors"
                    >
                      <td className="px-4 py-3 whitespace-nowrap">
                        <CameraThumbnail cameraId={camera.id} cameraName={camera.name} index={index} />
                      </td>
                      <td className="px-4 py-3">
                        <div className="text-sm font-medium text-gray-900 dark:text-white">
                          {camera.name || camera.deviceName || 'Unnamed Camera'}
                        </div>
                        {camera.deviceName && camera.deviceName !== camera.name && (
                          <div className="text-xs text-gray-500 dark:text-gray-400">
                            {camera.deviceName}
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-500 dark:text-gray-400 font-mono">
                        {getIpAddress(camera)}
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-500 dark:text-gray-400 font-mono">
                        {getMacAddress(camera)}
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-500 dark:text-gray-400">
                        {camera.model || camera.deviceModel || 'N/A'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Pagination Controls */}
            <div className="px-4 py-3 border-t border-gray-200 dark:border-gray-700 flex flex-col sm:flex-row items-center justify-between gap-4">
              {/* Page size selector */}
              <div className="flex items-center space-x-2">
                <span className="text-sm text-gray-500 dark:text-gray-400">Show</span>
                <select
                  value={pageSize}
                  onChange={(e) => handlePageSizeChange(Number(e.target.value))}
                  className="border border-gray-300 dark:border-gray-600 rounded px-2 py-1 text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  {PAGE_SIZE_OPTIONS.map(size => (
                    <option key={size} value={size}>{size}</option>
                  ))}
                </select>
                <span className="text-sm text-gray-500 dark:text-gray-400">per page</span>
              </div>

              {/* Page info */}
              <div className="text-sm text-gray-500 dark:text-gray-400">
                Showing {startIndex + 1} to {Math.min(endIndex, sortedCameras.length)} of {sortedCameras.length} cameras
              </div>

              {/* Page navigation */}
              <div className="flex items-center space-x-1">
                <button
                  onClick={() => setCurrentPage(1)}
                  disabled={currentPage === 1}
                  className="px-2 py-1 text-sm border border-gray-300 dark:border-gray-600 rounded hover:bg-gray-100 dark:hover:bg-gray-700 disabled:opacity-50 disabled:cursor-not-allowed text-gray-700 dark:text-gray-300 transition-colors"
                >
                  First
                </button>
                <button
                  onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                  disabled={currentPage === 1}
                  className="p-1 border border-gray-300 dark:border-gray-600 rounded hover:bg-gray-100 dark:hover:bg-gray-700 disabled:opacity-50 disabled:cursor-not-allowed text-gray-700 dark:text-gray-300 transition-colors"
                >
                  <ChevronLeft className="h-4 w-4" />
                </button>

                {/* Page numbers */}
                <div className="flex items-center space-x-1">
                  {(() => {
                    const pages = [];
                    const maxVisible = 5;
                    let start = Math.max(1, currentPage - Math.floor(maxVisible / 2));
                    let end = Math.min(totalPages, start + maxVisible - 1);

                    if (end - start + 1 < maxVisible) {
                      start = Math.max(1, end - maxVisible + 1);
                    }

                    for (let i = start; i <= end; i++) {
                      pages.push(
                        <button
                          key={i}
                          onClick={() => setCurrentPage(i)}
                          className={`px-3 py-1 text-sm border rounded transition-colors ${
                            currentPage === i
                              ? 'bg-blue-600 text-white border-blue-600'
                              : 'border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700'
                          }`}
                        >
                          {i}
                        </button>
                      );
                    }
                    return pages;
                  })()}
                </div>

                <button
                  onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                  disabled={currentPage === totalPages}
                  className="p-1 border border-gray-300 dark:border-gray-600 rounded hover:bg-gray-100 dark:hover:bg-gray-700 disabled:opacity-50 disabled:cursor-not-allowed text-gray-700 dark:text-gray-300 transition-colors"
                >
                  <ChevronRight className="h-4 w-4" />
                </button>
                <button
                  onClick={() => setCurrentPage(totalPages)}
                  disabled={currentPage === totalPages}
                  className="px-2 py-1 text-sm border border-gray-300 dark:border-gray-600 rounded hover:bg-gray-100 dark:hover:bg-gray-700 disabled:opacity-50 disabled:cursor-not-allowed text-gray-700 dark:text-gray-300 transition-colors"
                >
                  Last
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Empty State */}
        {sortedCameras.length === 0 && !loading && !error && (
          <div className="text-center py-12">
            <Camera className="h-16 w-16 text-gray-400 dark:text-gray-600 mx-auto mb-4" />
            {searchQuery ? (
              <>
                <h3 className="text-lg font-medium text-gray-900 dark:text-white mb-2">No cameras match your search</h3>
                <p className="text-gray-600 dark:text-gray-400">
                  Try adjusting your search terms or{' '}
                  <button
                    onClick={() => setSearchQuery('')}
                    className="text-blue-600 dark:text-blue-400 hover:underline"
                  >
                    clear the search
                  </button>
                </p>
              </>
            ) : (
              <>
                <h3 className="text-lg font-medium text-gray-900 dark:text-white mb-2">No cameras found</h3>
                <p className="text-gray-600 dark:text-gray-400">
                  Check your ACC connection or add cameras to your system.
                </p>
              </>
            )}
          </div>
        )}
      </main>

      {/* Camera Details Modal */}
      {selectedCamera && (
        <div
          className="fixed inset-0 bg-black bg-opacity-50 dark:bg-opacity-70 flex items-center justify-center p-4 z-50"
          onClick={() => setSelectedCamera(null)}
        >
          <div
            className="bg-white dark:bg-gray-800 rounded-lg max-w-3xl w-full max-h-[90vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="sticky top-0 bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 px-6 py-4 flex items-center justify-between z-10">
              <h2 className="text-xl font-bold text-gray-900 dark:text-white">
                {selectedCamera.name || selectedCamera.deviceName || 'Camera Details'}
              </h2>
              <button
                onClick={() => setSelectedCamera(null)}
                className="p-2 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-full transition-colors"
              >
                <X className="h-5 w-5 text-gray-500 dark:text-gray-400" />
              </button>
            </div>

            <div className="p-6">
              {/* Camera Snapshot */}
              <div className="mb-6">
                <div className="bg-gray-200 dark:bg-gray-700 rounded-lg overflow-hidden aspect-video flex items-center justify-center">
                  <img
                    src={apiService.getCameraSnapshot(selectedCamera.id)}
                    alt={selectedCamera.name || 'Camera snapshot'}
                    className="w-full h-full object-contain"
                    onError={(e) => {
                      e.target.style.display = 'none';
                      if (e.target.nextSibling) e.target.nextSibling.style.display = 'flex';
                    }}
                  />
                  <div className="hidden flex-col items-center justify-center text-gray-400 dark:text-gray-500">
                    <ImageOff className="h-12 w-12 mb-2" />
                    <span>Snapshot unavailable</span>
                  </div>
                </div>
              </div>

              {/* Camera Information */}
              <div className="space-y-6">
                <div>
                  <h3 className="text-sm font-medium text-gray-500 dark:text-gray-400 mb-3">Camera Information</h3>
                  <dl className="grid grid-cols-2 gap-4">
                    <div>
                      <dt className="text-sm text-gray-600 dark:text-gray-400">Name</dt>
                      <dd className="text-sm font-medium text-gray-900 dark:text-white">
                        {selectedCamera.name || 'N/A'}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-sm text-gray-600 dark:text-gray-400">IP Address</dt>
                      <dd className="text-sm font-medium text-gray-900 dark:text-white font-mono">
                        {getIpAddress(selectedCamera)}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-sm text-gray-600 dark:text-gray-400">MAC Address</dt>
                      <dd className="text-sm font-medium text-gray-900 dark:text-white font-mono">
                        {getMacAddress(selectedCamera)}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-sm text-gray-600 dark:text-gray-400">Model</dt>
                      <dd className="text-sm font-medium text-gray-900 dark:text-white">
                        {selectedCamera.model || 'N/A'}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-sm text-gray-600 dark:text-gray-400">Manufacturer</dt>
                      <dd className="text-sm font-medium text-gray-900 dark:text-white">
                        {selectedCamera.manufacturer || 'N/A'}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-sm text-gray-600 dark:text-gray-400">Serial Number</dt>
                      <dd className="text-sm font-medium text-gray-900 dark:text-white font-mono">
                        {selectedCamera.serial || 'N/A'}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-sm text-gray-600 dark:text-gray-400">Firmware</dt>
                      <dd className="text-sm font-medium text-gray-900 dark:text-white">
                        {selectedCamera.firmwareVersion || 'N/A'}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-sm text-gray-600 dark:text-gray-400">Connection State</dt>
                      <dd>
                        <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${
                          selectedCamera.connectionState === 'CONNECTED'
                            ? 'bg-green-100 dark:bg-green-900/50 text-green-800 dark:text-green-400'
                            : 'bg-red-100 dark:bg-red-900/50 text-red-800 dark:text-red-400'
                        }`}>
                          {selectedCamera.connectionState || 'Unknown'}
                        </span>
                      </dd>
                    </div>
                    <div>
                      <dt className="text-sm text-gray-600 dark:text-gray-400">Server</dt>
                      <dd className="text-sm font-medium text-gray-900 dark:text-white">
                        {getServerName(selectedCamera.serverId)}
                      </dd>
                    </div>
                    <div className="col-span-2">
                      <dt className="text-sm text-gray-600 dark:text-gray-400">Camera ID</dt>
                      <dd className="text-sm font-medium text-gray-900 dark:text-white font-mono text-xs break-all">
                        {selectedCamera.id}
                      </dd>
                    </div>
                  </dl>
                </div>

                {selectedCamera.details && Object.keys(selectedCamera.details).length > 0 && (
                  <div>
                    <h3 className="text-sm font-medium text-gray-500 dark:text-gray-400 mb-3">Full API Response</h3>
                    <pre className="text-xs bg-gray-50 dark:bg-gray-900 text-gray-800 dark:text-gray-200 p-4 rounded-lg overflow-auto max-h-64">
                      {JSON.stringify(selectedCamera.details, null, 2)}
                    </pre>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default Cameras;
