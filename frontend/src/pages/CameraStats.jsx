import React, { useState, useEffect, useRef } from 'react';
import { BarChart2, RefreshCw, AlertCircle, X, ChevronRight, Download, FileText, Sheet } from 'lucide-react';
import apiService from '../services/apiService';
import { exportCSV, exportPDF } from '../utils/exportReport';

const STANDBY_SERVERS = ['GTPDACCSERVER10', 'GTPDACCSERVER3'];
const COLORS = ['#2563eb','#dc2626','#16a34a','#ea580c','#9333ea','#0d9488','#db2777','#0284c7','#d97706','#65a30d'];

// Strip "(ONVIF)" suffix so Pelco (ONVIF) → Pelco, Avigilon (ONVIF) → Avigilon, etc.
const normalizeMfr = (mfr) => (mfr || 'Unknown').replace(/\s*\(ONVIF\)\s*$/i, '').trim() || 'Unknown';

// Avigilon generation grouping
const AVIGILON_MFR = 'Avigilon';
const GEN_ORDER = ['H6', 'H5', 'H4', 'H3', 'Other'];
const GEN_COLORS = { H6: '#9333ea', H5: '#16a34a', H4: '#2563eb', H3: '#ea580c', Other: '#6b7280' };
const getAvigilonGen = (model) => {
  if (!model) return 'Other';
  const m = model.toUpperCase();
  if (m.includes('H6')) return 'H6';
  if (m.includes('H5')) return 'H5';
  if (m.includes('H4')) return 'H4';
  if (m.includes('H3')) return 'H3';
  return 'Other';
};

// Use IP as a device key so multi-sensor cameras (same IP, multiple channels) count as one device
const deviceKey = (camera) => {
  const ip = (camera.ipAddress || camera.ip || camera.address || '').split(':')[0].trim();
  return ip || camera.id;
};

const getIpAddress = (camera) => {
  const ip = camera.ipAddress || camera.ip || camera.address || '';
  return ip.split(':')[0] || 'N/A';
};

const CameraStats = () => {
  const [cameras, setCameras] = useState([]);
  const [servers, setServers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [filteredCount, setFilteredCount] = useState(0);
  const [offlineCount, setOfflineCount] = useState(0);

  const [offlineOpen, setOfflineOpen] = useState(false);
  const [selectedMfr, setSelectedMfr] = useState(null);   // expanded manufacturer
  const [selectedGen, setSelectedGen] = useState(null);   // Avigilon generation (H4/H5/H6/Other)
  const [selectedModel, setSelectedModel] = useState(null); // selected model within mfr/gen
  const [exportOpen, setExportOpen] = useState(false);
  const [exporting, setExporting] = useState(false);
  const exportRef = useRef(null);

  useEffect(() => { loadData(); }, []);

  // Close export dropdown when clicking outside
  useEffect(() => {
    const handler = (e) => { if (exportRef.current && !exportRef.current.contains(e.target)) setExportOpen(false); };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const handleExport = async (format) => {
    setExportOpen(false);
    setExporting(format);
    const data = { cameras, filteredCount, offlineCount, mfrBreakdown, servers };
    try {
      if (format === 'csv') exportCSV(data);
      else await exportPDF(data);
    } finally {
      setExporting(false);
    }
  };

  const extractArray = (response, key) => {
    const paths = [
      response?.data?.result?.[key],
      response?.result?.[key],
      response?.data?.[key],
      response?.[key],
      response?.data,
      response,
    ];
    for (const path of paths) {
      if (Array.isArray(path)) return path;
    }
    return [];
  };

  const loadData = async () => {
    try {
      setLoading(true);
      setError(null);
      const [serversResponse, camerasResponse] = await Promise.all([
        apiService.getServers(),
        apiService.getCameras(),
      ]);
      const serversList = extractArray(serversResponse, 'servers');
      setServers(serversList);
      const standbyIds = serversList
        .filter(s => STANDBY_SERVERS.includes(s.name))
        .map(s => s.id);
      const all = extractArray(camerasResponse, 'cameras');
      const active = all.filter(c => !standbyIds.includes(c.serverId));
      const offline = active.filter(c => c.connectionState && c.connectionState !== 'CONNECTED');
      setFilteredCount(active.length);
      setOfflineCount(offline.length);
      setCameras(active);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const getServerName = (serverId) => {
    const server = servers.find(s => s.id === serverId);
    return server?.name || 'N/A';
  };

  // ── Derived stats ────────────────────────────────────────────────────────────

  const onlineCount = filteredCount - offlineCount;
  const onlinePercent = filteredCount > 0 ? Math.round((onlineCount / filteredCount) * 100) : 0;
  const onlineColor = onlinePercent >= 95
    ? { text: 'text-green-600 dark:text-green-400', bar: '#22c55e', border: 'border-green-200 dark:border-green-800' }
    : onlinePercent >= 80
    ? { text: 'text-yellow-600 dark:text-yellow-400', bar: '#eab308', border: 'border-yellow-200 dark:border-yellow-800' }
    : { text: 'text-red-600 dark:text-red-400', bar: '#ef4444', border: 'border-red-200 dark:border-red-800' };

  // Unique physical devices (grouped by IP, fall back to camera ID)
  const totalDevices = new Set(cameras.map(deviceKey)).size;
  const onlineDevices = new Set(cameras.filter(c => c.connectionState === 'CONNECTED').map(deviceKey)).size;
  const devicePercent = totalDevices > 0 ? Math.round((onlineDevices / totalDevices) * 100) : 0;
  const deviceColor = devicePercent >= 95
    ? { text: 'text-green-600 dark:text-green-400', bar: '#22c55e', border: 'border-green-200 dark:border-green-800' }
    : devicePercent >= 80
    ? { text: 'text-yellow-600 dark:text-yellow-400', bar: '#eab308', border: 'border-yellow-200 dark:border-yellow-800' }
    : { text: 'text-red-600 dark:text-red-400', bar: '#ef4444', border: 'border-red-200 dark:border-red-800' };

  // Manufacturer breakdown — count unique devices (by IP) per manufacturer
  const mfrDeviceKeys = {};
  cameras.forEach(camera => {
    const mfr = normalizeMfr(camera.manufacturer);
    if (!mfrDeviceKeys[mfr]) mfrDeviceKeys[mfr] = new Set();
    mfrDeviceKeys[mfr].add(deviceKey(camera));
  });
  const mfrBreakdown = Object.entries(mfrDeviceKeys)
    .map(([mfr, keys]) => [mfr, keys.size])
    .sort(([, a], [, b]) => b - a);

  // All cameras for the selected manufacturer
  const mfrCameras = selectedMfr ? cameras.filter(c => normalizeMfr(c.manufacturer) === selectedMfr) : [];
  const mfrDeviceCount = selectedMfr ? (mfrDeviceKeys[selectedMfr]?.size ?? 0) : 0;
  const isAvigilon = selectedMfr === AVIGILON_MFR;

  // Avigilon generation breakdown (H4 / H5 / H6 / Other) — unique devices per generation
  const genDeviceKeys = {};
  if (isAvigilon) {
    mfrCameras.forEach(camera => {
      const gen = getAvigilonGen(camera.model || camera.deviceModel);
      if (!genDeviceKeys[gen]) genDeviceKeys[gen] = new Set();
      genDeviceKeys[gen].add(deviceKey(camera));
    });
  }
  const genBreakdown = Object.entries(genDeviceKeys)
    .map(([gen, keys]) => [gen, keys.size])
    .sort(([a], [b]) => GEN_ORDER.indexOf(a) - GEN_ORDER.indexOf(b));
  const genDeviceCount = selectedGen ? (genDeviceKeys[selectedGen]?.size ?? 0) : 0;

  // Model breakdown — scoped to selected generation for Avigilon, full mfr otherwise
  const modelSourceCameras = isAvigilon && selectedGen
    ? mfrCameras.filter(c => getAvigilonGen(c.model || c.deviceModel) === selectedGen)
    : mfrCameras;
  const modelDeviceCount = isAvigilon && selectedGen ? genDeviceCount : mfrDeviceCount;
  const mfrModelDeviceKeys = {};
  modelSourceCameras.forEach(camera => {
    const model = camera.model || camera.deviceModel || 'Unknown';
    if (!mfrModelDeviceKeys[model]) mfrModelDeviceKeys[model] = new Set();
    mfrModelDeviceKeys[model].add(deviceKey(camera));
  });
  const mfrModelBreakdown = Object.entries(mfrModelDeviceKeys)
    .map(([model, keys]) => [model, keys.size])
    .sort(([, a], [, b]) => b - a);

  // Camera detail list
  let detailCameras = [];
  let detailTitle = '';
  let detailDotColor = null;
  if (offlineOpen) {
    detailCameras = cameras.filter(c => c.connectionState && c.connectionState !== 'CONNECTED');
    detailTitle = 'Offline Cameras';
    detailDotColor = '#ef4444';
  } else if (selectedMfr && selectedModel) {
    detailCameras = mfrCameras.filter(c => (c.model || c.deviceModel || 'Unknown') === selectedModel);
    detailTitle = `${selectedModel}`;
    const modelIdx = mfrModelBreakdown.findIndex(([m]) => m === selectedModel);
    detailDotColor = COLORS[modelIdx % COLORS.length];
  }

  // ── Handlers ─────────────────────────────────────────────────────────────────

  const handleOfflineClick = () => {
    const opening = !offlineOpen;
    setOfflineOpen(opening);
    if (opening) {
      setSelectedMfr(null);
      setSelectedGen(null);
      setSelectedModel(null);
    }
  };

  const handleMfrClick = (mfr) => {
    if (selectedMfr === mfr) {
      setSelectedMfr(null);
      setSelectedGen(null);
      setSelectedModel(null);
    } else {
      setSelectedMfr(mfr);
      setSelectedGen(null);
      setSelectedModel(null);
      setOfflineOpen(false);
    }
  };

  const handleGenClick = (gen) => {
    setSelectedGen(selectedGen === gen ? null : gen);
    setSelectedModel(null);
  };

  const handleModelClick = (model) => {
    setSelectedModel(selectedModel === model ? null : model);
  };

  const closeDetail = () => {
    setOfflineOpen(false);
    setSelectedModel(null);
  };

  // ── Render ────────────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-gray-50 dark:bg-gray-900">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto"></div>
          <p className="mt-4 text-gray-600 dark:text-gray-400">Loading camera data...</p>
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
              <BarChart2 className="h-8 w-8 text-blue-600 dark:text-blue-400" />
              <div>
                <h1 className="text-lg sm:text-2xl font-bold text-gray-900 dark:text-white">Camera Statistics</h1>
                <p className="text-sm text-gray-500 dark:text-gray-400">{filteredCount} active cameras</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {/* Export dropdown */}
              <div className="relative" ref={exportRef}>
                <button
                  onClick={() => setExportOpen(o => !o)}
                  disabled={!!exporting || loading || filteredCount === 0}
                  className="flex items-center space-x-2 px-3 sm:px-4 py-2 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-200 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {exporting ? (
                    <RefreshCw className="h-4 w-4 animate-spin" />
                  ) : (
                    <Download className="h-4 w-4" />
                  )}
                  <span className="hidden sm:inline">{exporting ? 'Exporting…' : 'Export'}</span>
                </button>
                {exportOpen && (
                  <div className="absolute right-0 mt-1 w-44 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg z-20 overflow-hidden">
                    <button
                      onClick={() => handleExport('pdf')}
                      className="flex items-center gap-3 w-full px-4 py-2.5 text-sm text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
                    >
                      <FileText className="h-4 w-4 text-red-500" />
                      PDF Report
                    </button>
                    <button
                      onClick={() => handleExport('csv')}
                      className="flex items-center gap-3 w-full px-4 py-2.5 text-sm text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors border-t border-gray-100 dark:border-gray-700"
                    >
                      <Sheet className="h-4 w-4 text-green-600" />
                      CSV Data
                    </button>
                  </div>
                )}
              </div>
              <button
                onClick={loadData}
                className="flex items-center space-x-2 px-3 sm:px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 dark:bg-blue-500 dark:hover:bg-blue-600 transition-colors"
              >
                <RefreshCw className="h-4 w-4" />
                <span className="hidden sm:inline">Refresh</span>
              </button>
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-6">
        {/* Error */}
        {error && (
          <div className="bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-800 rounded-lg p-4 flex items-start">
            <AlertCircle className="h-5 w-5 text-red-600 dark:text-red-400 mt-0.5 mr-3 flex-shrink-0" />
            <div>
              <h3 className="text-sm font-medium text-red-800 dark:text-red-300">Error Loading Data</h3>
              <p className="text-sm text-red-700 dark:text-red-400 mt-1">{error}</p>
              <button onClick={loadData} className="mt-2 text-sm text-red-600 dark:text-red-400 hover:underline">Retry</button>
            </div>
          </div>
        )}

        {!loading && filteredCount > 0 && (
          <>
            {/* ── Top stat cards ─────────────────────────────────────────────── */}
            <div className="flex flex-wrap gap-4">
              {/* Camera Views Online */}
              <div className={`flex flex-col gap-1.5 bg-white dark:bg-gray-800 border ${onlineColor.border} rounded-lg shadow-sm dark:shadow-gray-900/50 px-5 py-4`}>
                <span className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Camera Views Online</span>
                <div className="flex items-baseline gap-2">
                  <span className={`text-3xl font-bold ${onlineColor.text}`}>{onlinePercent}%</span>
                  <span className="text-sm text-gray-500 dark:text-gray-400">{onlineCount} of {filteredCount}</span>
                </div>
                <div className="w-48 h-1.5 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
                  <div className="h-full rounded-full" style={{ width: `${onlinePercent}%`, backgroundColor: onlineColor.bar }} />
                </div>
              </div>

              {/* Camera Devices Online */}
              <div className={`flex flex-col gap-1.5 bg-white dark:bg-gray-800 border ${deviceColor.border} rounded-lg shadow-sm dark:shadow-gray-900/50 px-5 py-4`}>
                <span className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Camera Devices Online</span>
                <div className="flex items-baseline gap-2">
                  <span className={`text-3xl font-bold ${deviceColor.text}`}>{devicePercent}%</span>
                  <span className="text-sm text-gray-500 dark:text-gray-400">{onlineDevices} of {totalDevices} devices</span>
                </div>
                <div className="w-48 h-1.5 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
                  <div className="h-full rounded-full" style={{ width: `${devicePercent}%`, backgroundColor: deviceColor.bar }} />
                </div>
              </div>

              {/* Cameras Offline */}
              <button
                onClick={handleOfflineClick}
                className={`flex flex-col gap-1.5 bg-white dark:bg-gray-800 border rounded-lg shadow-sm dark:shadow-gray-900/50 px-5 py-4 text-left transition-all ${
                  offlineOpen
                    ? 'border-red-400 dark:border-red-500 ring-2 ring-red-300 dark:ring-red-700'
                    : 'border-gray-200 dark:border-gray-700 hover:border-red-300 dark:hover:border-red-700'
                }`}
              >
                <span className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Cameras Offline</span>
                <div className="flex items-baseline gap-2">
                  <span className={`text-3xl font-bold ${offlineCount > 0 ? 'text-red-600 dark:text-red-400' : 'text-gray-400 dark:text-gray-500'}`}>
                    {offlineCount > 0 ? `${Math.round((offlineCount / filteredCount) * 100)}%` : '0%'}
                  </span>
                  <span className="text-sm text-gray-500 dark:text-gray-400">
                    {offlineCount > 0 ? `${offlineCount} offline · click to view` : 'all online'}
                  </span>
                </div>
                <div className="w-48 h-1.5 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
                  <div className="h-full rounded-full bg-red-500" style={{ width: `${Math.round((offlineCount / filteredCount) * 100)}%` }} />
                </div>
              </button>
            </div>

            {/* ── By Manufacturer ────────────────────────────────────────────── */}
            {mfrBreakdown.length > 0 && (
              <div className="space-y-3">
                <div className="flex items-center gap-3">
                  <h2 className="text-sm font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">By Manufacturer</h2>
                  {selectedMfr && (
                    <button
                      onClick={() => { setSelectedMfr(null); setSelectedModel(null); }}
                      className="text-xs text-blue-600 dark:text-blue-400 hover:underline flex items-center gap-1"
                    >
                      <X className="h-3 w-3" /> Clear
                    </button>
                  )}
                </div>

                {/* Stacked proportion bar */}
                <div className="w-full h-3 rounded-full overflow-hidden flex gap-px">
                  {mfrBreakdown.map(([mfr, count], i) => (
                    <div
                      key={mfr}
                      className="h-full cursor-pointer transition-opacity hover:opacity-80"
                      style={{ width: `${(count / totalDevices) * 100}%`, backgroundColor: COLORS[i % COLORS.length] }}
                      title={`${mfr}: ${count} device${count !== 1 ? 's' : ''}`}
                      onClick={() => handleMfrClick(mfr)}
                    />
                  ))}
                </div>

                {/* Manufacturer cards */}
                <div className="flex flex-wrap gap-3">
                  {mfrBreakdown.map(([mfr, count], i) => {
                    const pct = Math.round((count / totalDevices) * 100);
                    const isSelected = selectedMfr === mfr;
                    return (
                      <button
                        key={mfr}
                        onClick={() => handleMfrClick(mfr)}
                        className={`flex flex-col gap-1.5 bg-white dark:bg-gray-800 border rounded-lg shadow-sm dark:shadow-gray-900/50 px-4 py-3 text-left transition-all min-w-[140px] ${
                          isSelected
                            ? 'ring-2 ring-offset-1 dark:ring-offset-gray-900'
                            : 'border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600'
                        }`}
                        style={isSelected ? { borderColor: COLORS[i % COLORS.length], '--tw-ring-color': COLORS[i % COLORS.length] + '60' } : {}}
                      >
                        <div className="flex items-center gap-1.5">
                          <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: COLORS[i % COLORS.length] }} />
                          <span className={`text-xs font-medium uppercase tracking-wider truncate ${isSelected ? 'text-gray-900 dark:text-white' : 'text-gray-500 dark:text-gray-400'}`} title={mfr}>
                            {mfr}
                          </span>
                          {isSelected && <ChevronRight className="h-3 w-3 ml-auto text-gray-400 flex-shrink-0" />}
                        </div>
                        <div className="flex items-baseline gap-1.5">
                          <span className="text-2xl font-bold text-gray-900 dark:text-white">{count}</span>
                          <span className="text-sm text-gray-500 dark:text-gray-400">{pct}%</span>
                        </div>
                        <div className="w-full h-1.5 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
                          <div className="h-full rounded-full" style={{ width: `${pct}%`, backgroundColor: COLORS[i % COLORS.length] }} />
                        </div>
                      </button>
                    );
                  })}
                </div>

                {/* Avigilon: Generation cards (H4 / H5 / H6 / Other) */}
                {isAvigilon && genBreakdown.length > 0 && (
                  <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-sm dark:shadow-gray-900/50 px-5 py-4">
                    <div className="flex items-center gap-2 mb-3">
                      <div
                        className="w-2 h-2 rounded-full flex-shrink-0"
                        style={{ backgroundColor: COLORS[mfrBreakdown.findIndex(([m]) => m === AVIGILON_MFR) % COLORS.length] }}
                      />
                      <span className="text-sm font-semibold text-gray-900 dark:text-white">Avigilon</span>
                      <span className="text-xs text-gray-500 dark:text-gray-400 uppercase tracking-wider ml-1">— Generation</span>
                      {selectedGen && (
                        <button
                          onClick={() => { setSelectedGen(null); setSelectedModel(null); }}
                          className="text-xs text-blue-600 dark:text-blue-400 hover:underline flex items-center gap-1 ml-auto"
                        >
                          <X className="h-3 w-3" /> Clear
                        </button>
                      )}
                    </div>
                    {/* Stacked generation bar */}
                    <div className="w-full h-2 rounded-full overflow-hidden flex gap-px mb-3">
                      {genBreakdown.map(([gen, count]) => (
                        <div
                          key={gen}
                          className="h-full cursor-pointer transition-opacity hover:opacity-80"
                          style={{ width: `${(count / mfrDeviceCount) * 100}%`, backgroundColor: GEN_COLORS[gen] }}
                          title={`${gen}: ${count} device${count !== 1 ? 's' : ''}`}
                          onClick={() => handleGenClick(gen)}
                        />
                      ))}
                    </div>
                    {/* Generation stat cards */}
                    <div className="flex flex-wrap gap-3">
                      {genBreakdown.map(([gen, count]) => {
                        const pct = Math.round((count / mfrDeviceCount) * 100);
                        const isSelected = selectedGen === gen;
                        return (
                          <button
                            key={gen}
                            onClick={() => handleGenClick(gen)}
                            className={`flex flex-col gap-1.5 bg-gray-50 dark:bg-gray-700/50 border rounded-lg px-4 py-3 text-left transition-all min-w-[110px] ${
                              isSelected
                                ? 'ring-2 ring-offset-1 dark:ring-offset-gray-800'
                                : 'border-gray-200 dark:border-gray-600 hover:border-gray-300 dark:hover:border-gray-500'
                            }`}
                            style={isSelected ? { borderColor: GEN_COLORS[gen], '--tw-ring-color': GEN_COLORS[gen] + '60' } : {}}
                          >
                            <div className="flex items-center gap-1.5">
                              <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: GEN_COLORS[gen] }} />
                              <span className={`text-xs font-medium uppercase tracking-wider ${isSelected ? 'text-gray-900 dark:text-white' : 'text-gray-500 dark:text-gray-400'}`}>
                                {gen}
                              </span>
                              {isSelected && <ChevronRight className="h-3 w-3 ml-auto text-gray-400 flex-shrink-0" />}
                            </div>
                            <div className="flex items-baseline gap-1.5">
                              <span className="text-2xl font-bold text-gray-900 dark:text-white">{count}</span>
                              <span className="text-sm text-gray-500 dark:text-gray-400">{pct}%</span>
                            </div>
                            <div className="w-full h-1.5 bg-gray-200 dark:bg-gray-600 rounded-full overflow-hidden">
                              <div className="h-full rounded-full" style={{ width: `${pct}%`, backgroundColor: GEN_COLORS[gen] }} />
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* Model breakdown — for non-Avigilon when mfr selected, or Avigilon when gen selected */}
                {selectedMfr && (!isAvigilon || selectedGen) && mfrModelBreakdown.length > 0 && (
                  <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-sm dark:shadow-gray-900/50 px-5 py-4">
                    <div className="flex items-center gap-2 mb-3">
                      <div
                        className="w-2 h-2 rounded-full flex-shrink-0"
                        style={{ backgroundColor: isAvigilon && selectedGen ? GEN_COLORS[selectedGen] : COLORS[mfrBreakdown.findIndex(([m]) => m === selectedMfr) % COLORS.length] }}
                      />
                      <span className="text-sm font-semibold text-gray-900 dark:text-white">
                        {isAvigilon && selectedGen ? `${selectedMfr} ${selectedGen}` : selectedMfr}
                      </span>
                      <span className="text-xs text-gray-500 dark:text-gray-400 uppercase tracking-wider ml-1">— Models</span>
                    </div>
                    {/* Stacked model bar */}
                    <div className="w-full h-2 rounded-full overflow-hidden flex gap-px mb-3">
                      {mfrModelBreakdown.map(([model, count], i) => (
                        <div
                          key={model}
                          className="h-full cursor-pointer transition-opacity hover:opacity-80"
                          style={{ width: `${(count / modelDeviceCount) * 100}%`, backgroundColor: COLORS[i % COLORS.length] }}
                          title={`${model}: ${count} device${count !== 1 ? 's' : ''}`}
                          onClick={() => handleModelClick(model)}
                        />
                      ))}
                    </div>
                    {/* Model legend rows */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-6 gap-y-0.5">
                      {mfrModelBreakdown.map(([model, count], i) => {
                        const isActive = selectedModel === model;
                        const pct = Math.round((count / modelDeviceCount) * 100);
                        return (
                          <button
                            key={model}
                            onClick={() => handleModelClick(model)}
                            className={`flex items-center gap-2 py-1.5 px-2 rounded text-left transition-colors w-full group ${
                              isActive ? 'bg-gray-100 dark:bg-gray-700' : 'hover:bg-gray-50 dark:hover:bg-gray-700/50'
                            }`}
                          >
                            <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: COLORS[i % COLORS.length] }} />
                            <span className={`text-sm truncate flex-1 ${isActive ? 'font-medium text-gray-900 dark:text-white' : 'text-gray-600 dark:text-gray-300 group-hover:text-gray-900 dark:group-hover:text-white'}`} title={model}>
                              {model}
                            </span>
                            <span className="text-sm font-semibold text-gray-900 dark:text-white flex-shrink-0">{count}</span>
                            <span className="text-xs text-gray-400 dark:text-gray-500 flex-shrink-0 w-8 text-right">{pct}%</span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* ── Camera detail table ────────────────────────────────────────── */}
            {(offlineOpen || selectedModel) && detailCameras.length > 0 && (
              <div className="bg-white dark:bg-gray-800 rounded-lg shadow dark:shadow-gray-900/50 overflow-hidden">
                <div className="flex items-center justify-between px-5 py-3 border-b border-gray-200 dark:border-gray-700">
                  <div className="flex items-center gap-2">
                    <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: detailDotColor }} />
                    <h2 className="font-semibold text-gray-900 dark:text-white">{detailTitle}</h2>
                    <span className="text-sm text-gray-500 dark:text-gray-400">({detailCameras.length})</span>
                  </div>
                  <button
                    onClick={closeDetail}
                    className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
                  >
                    <X className="h-4 w-4 text-gray-500 dark:text-gray-400" />
                  </button>
                </div>
                <div className="overflow-x-auto">
                  <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
                    <thead className="bg-gray-50 dark:bg-gray-700/50">
                      <tr>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Name</th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Status</th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider hidden sm:table-cell">IP Address</th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider hidden md:table-cell">Model</th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider hidden lg:table-cell">Server</th>
                      </tr>
                    </thead>
                    <tbody className="bg-white dark:bg-gray-800 divide-y divide-gray-200 dark:divide-gray-700">
                      {detailCameras.map(camera => (
                        <tr key={camera.id} className="hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors">
                          <td className="px-4 py-3 text-sm font-medium text-gray-900 dark:text-white">
                            {camera.name || camera.deviceName || 'Unnamed'}
                          </td>
                          <td className="px-4 py-3 whitespace-nowrap">
                            <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${
                              camera.connectionState === 'CONNECTED'
                                ? 'bg-green-100 dark:bg-green-900/50 text-green-800 dark:text-green-400'
                                : 'bg-red-100 dark:bg-red-900/50 text-red-800 dark:text-red-400'
                            }`}>
                              {camera.connectionState || 'Unknown'}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-sm text-gray-500 dark:text-gray-400 font-mono hidden sm:table-cell">
                            {getIpAddress(camera)}
                          </td>
                          <td className="px-4 py-3 text-sm text-gray-500 dark:text-gray-400 hidden md:table-cell">
                            {camera.model || camera.deviceModel || 'N/A'}
                          </td>
                          <td className="px-4 py-3 text-sm text-gray-500 dark:text-gray-400 hidden lg:table-cell">
                            {getServerName(camera.serverId)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </>
        )}
      </main>
    </div>
  );
};

export default CameraStats;
