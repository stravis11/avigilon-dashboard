import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertCircle, Camera, ChevronDown, ChevronUp, HelpCircle, MapPin, Play, RefreshCw, Search, Wifi, WifiOff, X } from 'lucide-react';
import ArcGISMap from '@arcgis/core/Map';
import MapView from '@arcgis/core/views/MapView';
import Graphic from '@arcgis/core/Graphic';
import GraphicsLayer from '@arcgis/core/layers/GraphicsLayer';
import '@arcgis/core/assets/esri/themes/light/main.css';
import apiService from '../services/apiService';
import LiveStreamModal from '../components/LiveStreamModal';
import { useAuth } from '../context/AuthContext';
import { useCameraData } from '../context/CameraDataContext';

const REFRESH_INTERVAL_MS = 300000;
const DEFAULT_MAP_VIEW = {
  center: [-84.395, 33.776],
  zoom: 15,
};

const STATUS_STYLES = {
  online: {
    label: 'Online',
    color: [34, 197, 94],
    bg: 'bg-green-100 dark:bg-green-900/40',
    text: 'text-green-800 dark:text-green-300',
    icon: Wifi,
  },
  offline: {
    label: 'Offline',
    color: [239, 68, 68],
    bg: 'bg-red-100 dark:bg-red-900/40',
    text: 'text-red-800 dark:text-red-300',
    icon: WifiOff,
  },
  unmatched: {
    label: 'Unmatched',
    color: [245, 158, 11],
    bg: 'bg-amber-100 dark:bg-amber-900/40',
    text: 'text-amber-800 dark:text-amber-300',
    icon: AlertCircle,
  },
};

const CAMERA_LAYERS = {
  interior: {
    label: 'Interior Cameras',
    description: 'Interior Fixed, Interior PTZ, and Interior Fixed with Exterior View',
  },
  exterior: {
    label: 'Exterior Cameras',
    description: 'Exterior Fixed, Exterior PTZ, and Interior Fixed with Exterior View',
  },
};

const getCameraSymbol = (color, directionDegrees) => {
  const [r, g, b] = color;
  const fill = `rgb(${r}, ${g}, ${b})`;
  const angle = Number(directionDegrees);
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">
      <g fill="none" stroke="white" stroke-width="5" stroke-linecap="round" stroke-linejoin="round">
        <path d="M16 26v-5"/>
        <path d="M11.5 26h9"/>
        <path d="M8 14.5h15.5"/>
        <path d="M23.5 14.5 28 10v9z"/>
      </g>
      <g fill="${fill}" stroke="${fill}" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
        <path d="M16 26v-5"/>
        <path d="M11.5 26h9"/>
        <path d="M6.5 10.5h15c1.3 0 2.4 1.1 2.4 2.4v3.2c0 1.3-1.1 2.4-2.4 2.4h-15c-1.3 0-2.4-1.1-2.4-2.4v-3.2c0-1.3 1.1-2.4 2.4-2.4z"/>
        <path d="M23.9 13.1 29 9.8v9.4l-5.1-3.3z"/>
      </g>
      <circle cx="10" cy="14.5" r="2.2" fill="white"/>
      <circle cx="10" cy="14.5" r="1.1" fill="${fill}"/>
    </svg>
  `;
  return {
    type: 'picture-marker',
    url: `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`,
    width: 18,
    height: 18,
    angle: Number.isFinite(angle) ? angle - 90 : -90,
  };
};

const formatDateTime = (value) => {
  if (!value) return 'Never';
  return new Date(value).toLocaleString();
};

const getArcgisValue = (attributes = {}, keys = []) => {
  const entry = Object.entries(attributes).find(([key, value]) => (
    keys.some(candidate => candidate.toLowerCase() === key.toLowerCase())
    && value !== null
    && value !== undefined
    && String(value).trim() !== ''
  ));
  return entry ? entry[1] : '';
};

const isRetiredValue = (value) => {
  if (value === true) return true;
  if (value === false || value === null || value === undefined) return false;
  return ['true', 'yes', 'y', '1', 'retired'].includes(String(value).trim().toLowerCase());
};

const CameraMap = () => {
  const mapDivRef = useRef(null);
  const viewRef = useRef(null);
  const layerRef = useRef(null);
  const mapDataRef = useRef(null);
  const searchControlRef = useRef(null);
  const hasSetDefaultViewRef = useRef(false);
  const { isAdmin } = useAuth();
  const { servers } = useCameraData();

  const [mapData, setMapData] = useState(null);
  const [selectedMarker, setSelectedMarker] = useState(null);
  const [liveStreamCamera, setLiveStreamCamera] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [qualityPanel, setQualityPanel] = useState(null);
  const [summaryHelp, setSummaryHelp] = useState(null);
  const [visibleLayers, setVisibleLayers] = useState({ interior: true, exterior: true });
  const [isLayerControlExpanded, setIsLayerControlExpanded] = useState(true);
  const [searchControlPosition, setSearchControlPosition] = useState({ x: 72, y: 16 });
  const [isDraggingSearch, setIsDraggingSearch] = useState(false);

  const serverNames = useMemo(() => {
    const names = {};
    servers.forEach((server) => {
      names[server.id] = server.name || server.id;
    });
    return names;
  }, [servers]);

  const loadMapData = useCallback(async ({ force = false } = {}) => {
    setError(null);
    if (force) setRefreshing(true);
    else setLoading(true);

    try {
      const response = force && isAdmin
        ? await apiService.refreshCameraMap()
        : await apiService.getCameraMap();
      const data = response?.data || response;
      setMapData(data);
      setSelectedMarker((current) => {
        if (!current) return null;
        return data.markers.find(marker => marker.id === current.id) || null;
      });
    } catch (err) {
      setError(err.message || 'Failed to load camera map');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [isAdmin]);

  useEffect(() => {
    loadMapData();
    const interval = window.setInterval(() => loadMapData(), REFRESH_INTERVAL_MS);
    return () => window.clearInterval(interval);
  }, [loadMapData]);

  useEffect(() => {
    mapDataRef.current = mapData;
  }, [mapData]);

  const layerFilteredMarkers = useMemo(() => {
    const markers = mapData?.markers || [];
    return markers.filter(marker => (marker.layers || ['interior', 'exterior'])
      .some(layer => visibleLayers[layer]));
  }, [mapData, visibleLayers]);

  const filteredMarkers = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    if (!query) return layerFilteredMarkers;
    return layerFilteredMarkers.filter((marker) => {
      const values = [
        marker.label,
        marker.ip,
        marker.status,
        marker.cameraType,
        ...(marker.layers || []),
        ...Object.values(marker.arcgis?.attributes || {}),
        ...marker.cameras.flatMap(camera => [
          camera.name,
          camera.deviceName,
          camera.model,
          camera.manufacturer,
          camera.connectionState,
          serverNames[camera.serverId],
        ]),
      ];
      return values.some(value => value && String(value).toLowerCase().includes(query));
    });
  }, [layerFilteredMarkers, searchQuery, serverNames]);

  useEffect(() => {
    if (!mapDivRef.current || viewRef.current) return;

    const graphicsLayer = new GraphicsLayer({ title: 'Camera locations' });
    const map = new ArcGISMap({
      basemap: 'osm',
      layers: [graphicsLayer],
    });

    const view = new MapView({
      container: mapDivRef.current,
      map,
      center: DEFAULT_MAP_VIEW.center,
      zoom: DEFAULT_MAP_VIEW.zoom,
      constraints: {
        snapToZoom: false,
      },
    });

    const clickHandle = view.on('click', async (event) => {
      const hit = await view.hitTest(event);
      const graphic = hit.results.find(result => result.graphic?.attributes?.markerId)?.graphic;
      if (!graphic) return;
      const marker = mapDataRef.current?.markers.find(item => item.id === graphic.attributes.markerId);
      if (marker) setSelectedMarker(marker);
    });

    viewRef.current = view;
    layerRef.current = graphicsLayer;

    const resizeObserver = new ResizeObserver(() => {
      view.resize();
    });
    resizeObserver.observe(mapDivRef.current);
    const handleWindowResize = () => view.resize();
    window.addEventListener('resize', handleWindowResize);

    return () => {
      clickHandle.remove();
      resizeObserver.disconnect();
      window.removeEventListener('resize', handleWindowResize);
      view.destroy();
      viewRef.current = null;
      layerRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!layerRef.current || !mapData) return;

    const pointGraphics = [];
    const graphics = filteredMarkers
      .filter(marker => marker.coordinates)
      .map((marker) => {
        const style = STATUS_STYLES[marker.status] || STATUS_STYLES.unmatched;
        const pointGraphic = new Graphic({
          geometry: {
            type: 'point',
            longitude: marker.coordinates.longitude,
            latitude: marker.coordinates.latitude,
            spatialReference: { wkid: 4326 },
          },
          symbol: getCameraSymbol(style.color, marker.directionDegrees),
          attributes: {
            markerId: marker.id,
            label: marker.label,
          },
        });
        pointGraphics.push(pointGraphic);
        return pointGraphic;
      });

    layerRef.current.removeAll();
    layerRef.current.addMany(graphics);

    if (!viewRef.current) return;

    const hasSearch = Boolean(searchQuery.trim());
    if (hasSearch && pointGraphics.length > 0) {
      const target = pointGraphics.length === 1
        ? {
          center: [pointGraphics[0].geometry.longitude, pointGraphics[0].geometry.latitude],
          zoom: 18,
        }
        : pointGraphics.map(graphic => graphic.geometry);
      viewRef.current.goTo(target, { padding: 80 }).catch(() => {});
      return;
    }

    if (hasSearch && graphics.length === 0) return;

    if (!hasSetDefaultViewRef.current || !hasSearch) {
      hasSetDefaultViewRef.current = true;
      viewRef.current.goTo(DEFAULT_MAP_VIEW, { animate: false }).catch(() => {});
    }
  }, [filteredMarkers, mapData, searchQuery]);

  const selectMarker = (marker) => {
    setSelectedMarker(marker);
    if (marker.coordinates && viewRef.current) {
      viewRef.current.goTo({
        center: [marker.coordinates.longitude, marker.coordinates.latitude],
        zoom: Math.max(viewRef.current.zoom, 18),
      }).catch(() => {});
    }
  };

  const startSearchDrag = (event) => {
    if (!mapDivRef.current || !searchControlRef.current) return;
    if (event.target.closest('input,button')) return;

    event.preventDefault();
    setIsDraggingSearch(true);

    const startX = event.clientX;
    const startY = event.clientY;
    const initialPosition = { ...searchControlPosition };

    const handlePointerMove = (moveEvent) => {
      const mapRect = mapDivRef.current?.getBoundingClientRect();
      const controlRect = searchControlRef.current?.getBoundingClientRect();
      if (!mapRect || !controlRect) return;

      const maxX = Math.max(16, mapRect.width - controlRect.width - 16);
      const maxY = Math.max(16, mapRect.height - controlRect.height - 16);
      const nextX = Math.min(Math.max(16, initialPosition.x + moveEvent.clientX - startX), maxX);
      const nextY = Math.min(Math.max(16, initialPosition.y + moveEvent.clientY - startY), maxY);
      setSearchControlPosition({ x: nextX, y: nextY });
    };

    const stopDrag = () => {
      setIsDraggingSearch(false);
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', stopDrag);
    };

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', stopDrag);
  };

  const renderStatusBadge = (status) => {
    const style = STATUS_STYLES[status] || STATUS_STYLES.unmatched;
    const Icon = style.icon;
    return (
      <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${style.bg} ${style.text}`}>
        <Icon className="h-3 w-3" />
        {style.label}
      </span>
    );
  };

  const summary = mapData?.summary || {};
  const unmatchedMarkers = mapData?.unmatchedArcgis || [];
  const accOnlyCameras = mapData?.accOnlyCameras || [];
  const layerCounts = {
    interior: summary.interiorMarkers ?? 0,
    exterior: summary.exteriorMarkers ?? 0,
  };
  const toggleLayer = (layer) => {
    setVisibleLayers(current => ({
      ...current,
      [layer]: !current[layer],
    }));
  };

  const summaryItems = [
    {
      label: 'Locations',
      value: summary.markers ?? 0,
      help: 'ArcGIS map points currently shown as camera locations. ArcGIS is the source of truth for these locations.',
    },
    {
      label: 'Matched',
      value: summary.matchedMarkers ?? 0,
      help: 'ArcGIS locations that matched one or more ACC camera views by IP address.',
    },
    {
      label: 'Unmatched',
      value: summary.unmatchedArcgis ?? 0,
      panel: 'unmatched',
      title: 'ArcGIS Points Without ACC Matches',
      help: 'ArcGIS camera points with an IP address that did not match any current ACC camera. These stay on the map as warnings.',
    },
    {
      label: 'Missing from ArcGIS',
      value: summary.accOnlyCameras ?? 0,
      panel: 'missing',
      title: 'ACC Cameras Missing From ArcGIS',
      help: 'ACC cameras that exist in Avigilon but do not have a matching ArcGIS point, so they are counted here but omitted from the map.',
    },
  ];

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900 transition-colors duration-300">
      <header className="bg-white dark:bg-gray-800 shadow-sm transition-colors duration-300">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center space-x-3">
              <MapPin className="h-8 w-8 text-blue-600 dark:text-blue-400" />
              <div>
                <h1 className="text-lg sm:text-2xl font-bold text-gray-900 dark:text-white">Camera Map</h1>
                <p className="text-sm text-gray-500 dark:text-gray-400">
                  ArcGIS locations with ACC camera status and live video
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <span className="hidden sm:inline text-sm text-gray-500 dark:text-gray-400">
                Updated {formatDateTime(mapData?.generatedAt)}
              </span>
              <button
                onClick={() => loadMapData({ force: true })}
                disabled={refreshing}
                className="inline-flex items-center gap-2 px-3 sm:px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 dark:bg-blue-500 dark:hover:bg-blue-600 disabled:opacity-60 disabled:cursor-not-allowed transition-colors"
              >
                <RefreshCw className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} />
                <span className="hidden sm:inline">Refresh</span>
              </button>
            </div>
          </div>
        </div>
      </header>

      <main className="w-full px-3 sm:px-4 lg:px-5 py-4">
        {error && (
          <div className="mb-4 bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-800 rounded-lg p-4 flex items-start">
            <AlertCircle className="h-5 w-5 text-red-600 dark:text-red-400 mt-0.5 mr-3 flex-shrink-0" />
            <div>
              <h3 className="text-sm font-medium text-red-800 dark:text-red-300">Error Loading Camera Map</h3>
              <p className="text-sm text-red-700 dark:text-red-400 mt-1">{error}</p>
            </div>
          </div>
        )}

        {mapData?.isStale && (
          <div className="mb-4 bg-amber-50 dark:bg-amber-900/30 border border-amber-200 dark:border-amber-800 rounded-lg p-4 flex items-start">
            <AlertCircle className="h-5 w-5 text-amber-600 dark:text-amber-400 mt-0.5 mr-3 flex-shrink-0" />
            <div>
              <h3 className="text-sm font-medium text-amber-800 dark:text-amber-300">Showing Cached Map Data</h3>
              <p className="text-sm text-amber-700 dark:text-amber-400 mt-1">{mapData.staleReason}</p>
            </div>
          </div>
        )}

        <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_22rem] gap-4">
          <section className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow dark:shadow-gray-900/50 overflow-hidden">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-px bg-gray-200 dark:bg-gray-700">
              {summaryItems.map((item) => {
                const isInteractive = Boolean(item.panel);
                const isActive = qualityPanel === item.panel;
                const isHelpOpen = summaryHelp === item.label;
                const cardTone = isActive ? 'bg-blue-50 dark:bg-blue-900/20' : 'bg-white dark:bg-gray-800';
                const itemContent = (
                  <div className={`relative px-4 py-3 ${cardTone}`}>
                    <div className="flex items-center gap-1.5">
                      <span className="text-xs uppercase tracking-wider text-gray-500 dark:text-gray-400">{item.label}</span>
                      <button
                        type="button"
                        onClick={() => setSummaryHelp(current => (current === item.label ? null : item.label))}
                        className="inline-flex h-5 w-5 items-center justify-center rounded-full text-gray-400 hover:bg-gray-100 hover:text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500 dark:text-gray-500 dark:hover:bg-gray-700 dark:hover:text-gray-200"
                        aria-label={`What ${item.label} means`}
                        aria-expanded={isHelpOpen}
                      >
                        <HelpCircle className="h-3.5 w-3.5" />
                      </button>
                    </div>
                    {isInteractive ? (
                      <button
                        type="button"
                        onClick={() => setQualityPanel(current => (current === item.panel ? null : item.panel))}
                        className="mt-1 text-left text-2xl font-bold text-gray-900 hover:text-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 dark:text-white dark:hover:text-blue-300"
                        aria-pressed={isActive}
                        title={item.title}
                      >
                        {item.value}
                      </button>
                    ) : (
                      <div className="mt-1 text-2xl font-bold text-gray-900 dark:text-white">{item.value}</div>
                    )}
                    {isHelpOpen && (
                      <div className="absolute left-3 right-3 top-12 z-30 rounded-md border border-gray-200 bg-white p-3 text-xs leading-5 text-gray-700 shadow-lg dark:border-gray-700 dark:bg-gray-900 dark:text-gray-200">
                        {item.help}
                      </div>
                    )}
                  </div>
                );

                if (!isInteractive) {
                  return (
                    <div key={item.label}>{itemContent}</div>
                  );
                }

                return (
                  <div
                    key={item.label}
                    className="transition-colors"
                  >
                    {itemContent}
                  </div>
                );
              })}
            </div>

            <div className="relative h-[calc(100vh-14.5rem)] min-h-[420px] max-h-none">
              <div ref={mapDivRef} className="absolute inset-0" />
              <div
                ref={searchControlRef}
                className={`absolute z-10 w-[min(calc(100%-2rem),28rem)] ${isDraggingSearch ? 'cursor-grabbing' : 'cursor-grab'}`}
                style={{
                  left: searchControlPosition.x,
                  top: searchControlPosition.y,
                }}
                onPointerDown={startSearchDrag}
              >
                <div className="bg-white/95 dark:bg-gray-800/95 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg backdrop-blur">
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
                    <input
                      type="text"
                      placeholder="Search cameras on map..."
                      value={searchQuery}
                      onChange={(event) => setSearchQuery(event.target.value)}
                      className="w-full pl-9 pr-9 py-2.5 border-0 rounded-lg bg-transparent text-sm text-gray-900 dark:text-white placeholder-gray-500 dark:placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                    {searchQuery && (
                      <button
                        type="button"
                        onClick={() => setSearchQuery('')}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
                        aria-label="Clear map search"
                      >
                        <X className="h-4 w-4" />
                      </button>
                    )}
                  </div>
                  {searchQuery && (
                    <div className="border-t border-gray-200 dark:border-gray-700 px-3 py-1.5 text-xs text-gray-600 dark:text-gray-300">
                      Showing {filteredMarkers.length} matching map camera{filteredMarkers.length === 1 ? '' : 's'}
                    </div>
                  )}
                </div>
              </div>
              {loading && (
                <div className="absolute inset-0 bg-white/80 dark:bg-gray-900/80 flex items-center justify-center">
                  <div className="text-center">
                    <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto"></div>
                    <p className="mt-4 text-gray-600 dark:text-gray-400">Loading camera map...</p>
                  </div>
                </div>
              )}
              <div className="absolute right-4 top-4 z-10 w-64 rounded-lg border border-gray-200 bg-white/95 shadow-lg backdrop-blur dark:border-gray-700 dark:bg-gray-800/95">
                <button
                  type="button"
                  onClick={() => setIsLayerControlExpanded(current => !current)}
                  className="flex w-full items-center justify-between gap-3 px-3 py-2.5 text-left"
                  aria-expanded={isLayerControlExpanded}
                  aria-label={isLayerControlExpanded ? 'Collapse map layers' : 'Expand map layers'}
                >
                  <div className="min-w-0">
                    <h2 className="text-sm font-semibold text-gray-900 dark:text-white">Layers</h2>
                    <p className="truncate text-xs text-gray-500 dark:text-gray-400">
                      {Object.entries(CAMERA_LAYERS)
                        .filter(([layer]) => visibleLayers[layer])
                        .map(([, config]) => config.label.replace(' Cameras', ''))
                        .join(', ') || 'None visible'}
                    </p>
                  </div>
                  <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-gray-500 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-700">
                    {isLayerControlExpanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                  </span>
                </button>
                {isLayerControlExpanded && (
                  <div className="space-y-2 border-t border-gray-200 px-3 py-3 dark:border-gray-700">
                    {Object.entries(CAMERA_LAYERS).map(([layer, config]) => (
                      <label
                        key={layer}
                        className="flex cursor-pointer items-start gap-2 rounded-md px-2 py-1.5 hover:bg-gray-50 dark:hover:bg-gray-700/60"
                      >
                        <input
                          type="checkbox"
                          checked={visibleLayers[layer]}
                          onChange={() => toggleLayer(layer)}
                          className="mt-0.5 h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-700"
                        />
                        <span className="min-w-0 flex-1">
                          <span className="flex items-center justify-between gap-2">
                            <span className="text-sm font-medium text-gray-800 dark:text-gray-200">{config.label}</span>
                            <span className="text-xs text-gray-500 dark:text-gray-400">{layerCounts[layer]}</span>
                          </span>
                          <span className="block text-xs text-gray-500 dark:text-gray-400">{config.description}</span>
                        </span>
                      </label>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </section>

          <aside className="space-y-4">
            {qualityPanel && (
              <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow dark:shadow-gray-900/50 overflow-hidden">
                <div className="p-4 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between">
                  <div>
                    <h2 className="font-semibold text-gray-900 dark:text-white">
                      {qualityPanel === 'unmatched' ? 'Unmatched ArcGIS Points' : 'Missing From ArcGIS'}
                    </h2>
                    <p className="text-xs text-gray-500 dark:text-gray-400">
                      {qualityPanel === 'unmatched'
                        ? `${unmatchedMarkers.length} map point${unmatchedMarkers.length === 1 ? '' : 's'} without an ACC IP match`
                        : `${accOnlyCameras.length} ACC camera${accOnlyCameras.length === 1 ? '' : 's'} without an ArcGIS point`}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setQualityPanel(null)}
                    className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
                    aria-label="Close data quality list"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>

                <div className="max-h-80 overflow-y-auto divide-y divide-gray-200 dark:divide-gray-700">
                  {qualityPanel === 'unmatched' && unmatchedMarkers.map((marker) => (
                    (() => {
                      const attributes = marker.arcgis?.attributes || {};
                      const cameraId = getArcgisValue(attributes, ['Camera_ID', 'Camera ID', 'camera_id']);
                      const location = getArcgisValue(attributes, ['Location']);
                      const model = getArcgisValue(attributes, ['Model']);
                      const floor = getArcgisValue(attributes, ['Floor', 'LEVEL_ID']);
                      const cameraType = getArcgisValue(attributes, ['Type_of_Camera', 'Type of Camera']);
                      const retired = getArcgisValue(attributes, ['Retired']);
                      const notes = getArcgisValue(attributes, ['Notes']);
                      const direction = getArcgisValue(attributes, ['Direction_of_Camera__Degrees_', 'Direction of Camera (Degrees)']);
                      const objectId = marker.arcgis?.objectId || getArcgisValue(attributes, ['FID2', 'OBJECTID']);

                      return (
                        <button
                          key={marker.id}
                          type="button"
                          onClick={() => selectMarker(marker)}
                          className="w-full text-left px-4 py-3 hover:bg-gray-50 dark:hover:bg-gray-700/60 transition-colors"
                        >
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                              <div className="font-medium text-sm text-gray-900 dark:text-white truncate">{marker.label}</div>
                              <div className="text-xs text-gray-500 dark:text-gray-400 font-mono">{marker.ip || 'No IP'}</div>
                            </div>
                            <div className="flex flex-col items-end gap-1">
                              {renderStatusBadge(marker.status)}
                              {isRetiredValue(retired) && (
                                <span className="inline-flex px-2 py-0.5 rounded-full text-xs font-medium bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300">
                                  Retired
                                </span>
                              )}
                            </div>
                          </div>

                          <dl className="mt-2 grid grid-cols-[auto,minmax(0,1fr)] gap-x-2 gap-y-1 text-xs">
                            {[
                              ['Camera ID', cameraId],
                              ['Location', location],
                              ['Model', model],
                              ['Floor', floor],
                              ['Type', cameraType],
                              ['Direction', direction ? `${direction} deg` : ''],
                              ['Object', objectId],
                            ].filter(([, value]) => value !== null && value !== undefined && String(value).trim() !== '').map(([label, value]) => (
                              <React.Fragment key={label}>
                                <dt className="text-gray-500 dark:text-gray-400">{label}</dt>
                                <dd className="text-gray-700 dark:text-gray-300 truncate">{String(value)}</dd>
                              </React.Fragment>
                            ))}
                          </dl>

                          {notes && (
                            <div className="mt-2 text-xs text-gray-600 dark:text-gray-300 line-clamp-2">
                              {String(notes)}
                            </div>
                          )}

                          {marker.coordinates && (
                            <div className="mt-2 text-xs text-gray-500 dark:text-gray-400">
                              {marker.coordinates.latitude.toFixed(6)}, {marker.coordinates.longitude.toFixed(6)}
                            </div>
                          )}
                        </button>
                      );
                    })()
                  ))}

                  {qualityPanel === 'missing' && accOnlyCameras.map((camera) => (
                    <div key={camera.id} className="px-4 py-3">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="font-medium text-sm text-gray-900 dark:text-white truncate">{camera.name}</div>
                          <div className="text-xs text-gray-500 dark:text-gray-400 font-mono">{camera.ipAddress || 'No IP'}</div>
                          <div className="text-xs text-gray-500 dark:text-gray-400 truncate">{camera.model || 'N/A'}</div>
                          <div className="text-xs text-gray-500 dark:text-gray-400 truncate">
                            {serverNames[camera.serverId] || camera.serverId || 'N/A'}
                          </div>
                        </div>
                        <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium shrink-0 ${
                          camera.connectionState === 'CONNECTED'
                            ? 'bg-green-100 dark:bg-green-900/50 text-green-800 dark:text-green-400'
                            : 'bg-red-100 dark:bg-red-900/50 text-red-800 dark:text-red-400'
                        }`}>
                          {camera.connectionState}
                        </span>
                      </div>
                      <button
                        type="button"
                        onClick={() => setLiveStreamCamera(camera)}
                        className="mt-3 inline-flex items-center gap-2 w-full justify-center px-3 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors text-sm font-medium"
                      >
                        <Play className="h-4 w-4" />
                        Live Video
                      </button>
                    </div>
                  ))}

                  {((qualityPanel === 'unmatched' && unmatchedMarkers.length === 0)
                    || (qualityPanel === 'missing' && accOnlyCameras.length === 0)) && (
                    <div className="px-4 py-8 text-center text-sm text-gray-500 dark:text-gray-400">
                      No records in this list.
                    </div>
                  )}
                </div>
              </div>
            )}

            <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow dark:shadow-gray-900/50 overflow-hidden">
              <div className="p-4 border-b border-gray-200 dark:border-gray-700">
                <h2 className="font-semibold text-gray-900 dark:text-white">Map Cameras</h2>
                <p className="text-xs text-gray-500 dark:text-gray-400">
                  {searchQuery
                    ? `${filteredMarkers.length} matching camera${filteredMarkers.length === 1 ? '' : 's'}`
                    : `${filteredMarkers.length} camera location${filteredMarkers.length === 1 ? '' : 's'}`}
                </p>
              </div>
              <div className="max-h-72 overflow-y-auto divide-y divide-gray-200 dark:divide-gray-700">
                {filteredMarkers.map((marker) => (
                  <button
                    key={marker.id}
                    onClick={() => selectMarker(marker)}
                    className={`w-full text-left px-4 py-3 hover:bg-gray-50 dark:hover:bg-gray-700/60 transition-colors ${
                      selectedMarker?.id === marker.id ? 'bg-blue-50 dark:bg-blue-900/20' : ''
                    }`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="font-medium text-sm text-gray-900 dark:text-white truncate">{marker.label}</div>
                        <div className="text-xs text-gray-500 dark:text-gray-400 font-mono">{marker.ip || 'No IP'}</div>
                      </div>
                      {renderStatusBadge(marker.status)}
                    </div>
                    <div className="mt-2 text-xs text-gray-500 dark:text-gray-400">
                      {marker.cameras.length > 0
                        ? `${marker.cameras.length} camera view${marker.cameras.length === 1 ? '' : 's'}`
                        : 'No matching ACC camera'}
                    </div>
                    <div className="mt-2 flex flex-wrap gap-1">
                      {(marker.layers || []).map(layer => (
                        <span key={layer} className="rounded-full bg-gray-100 px-2 py-0.5 text-xs capitalize text-gray-600 dark:bg-gray-700 dark:text-gray-300">
                          {layer}
                        </span>
                      ))}
                      {marker.directionDegrees !== null && marker.directionDegrees !== undefined && (
                        <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-600 dark:bg-gray-700 dark:text-gray-300">
                          {marker.directionDegrees} deg
                        </span>
                      )}
                    </div>
                  </button>
                ))}
                {filteredMarkers.length === 0 && (
                  <div className="px-4 py-8 text-center text-sm text-gray-500 dark:text-gray-400">
                    No map cameras match your search.
                  </div>
                )}
              </div>
            </div>

            <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow dark:shadow-gray-900/50">
              <div className="p-4 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between">
                <h2 className="font-semibold text-gray-900 dark:text-white">Camera Details</h2>
                {selectedMarker && renderStatusBadge(selectedMarker.status)}
              </div>

              {selectedMarker ? (
                <div className="p-4 space-y-4">
                  <div>
                    <h3 className="text-lg font-semibold text-gray-900 dark:text-white">{selectedMarker.label}</h3>
                    <p className="text-sm text-gray-500 dark:text-gray-400 font-mono">{selectedMarker.ip || 'No IP address'}</p>
                    {selectedMarker.cameraType && (
                      <p className="text-sm text-gray-600 dark:text-gray-300">{selectedMarker.cameraType}</p>
                    )}
                    <div className="mt-2 flex flex-wrap gap-1">
                      {(selectedMarker.layers || []).map(layer => (
                        <span key={layer} className="rounded-full bg-gray-100 px-2 py-0.5 text-xs capitalize text-gray-600 dark:bg-gray-700 dark:text-gray-300">
                          {layer}
                        </span>
                      ))}
                      {selectedMarker.directionDegrees !== null && selectedMarker.directionDegrees !== undefined && (
                        <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-600 dark:bg-gray-700 dark:text-gray-300">
                          Direction {selectedMarker.directionDegrees} deg
                        </span>
                      )}
                    </div>
                    {selectedMarker.coordinates && (
                      <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                        {selectedMarker.coordinates.latitude.toFixed(6)}, {selectedMarker.coordinates.longitude.toFixed(6)}
                      </p>
                    )}
                  </div>

                  {selectedMarker.cameras.length > 0 ? (
                    <div className="space-y-3">
                      {selectedMarker.cameras.map((camera) => (
                        <div key={camera.id} className="border border-gray-200 dark:border-gray-700 rounded-lg p-3">
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                              <div className="font-medium text-sm text-gray-900 dark:text-white truncate">{camera.name}</div>
                              <div className="text-xs text-gray-500 dark:text-gray-400">{camera.model}</div>
                              <div className="text-xs text-gray-500 dark:text-gray-400">{serverNames[camera.serverId] || camera.serverId || 'N/A'}</div>
                            </div>
                            <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium shrink-0 ${
                              camera.connectionState === 'CONNECTED'
                                ? 'bg-green-100 dark:bg-green-900/50 text-green-800 dark:text-green-400'
                                : 'bg-red-100 dark:bg-red-900/50 text-red-800 dark:text-red-400'
                            }`}>
                              {camera.connectionState}
                            </span>
                          </div>
                          <button
                            onClick={() => setLiveStreamCamera(camera)}
                            className="mt-3 inline-flex items-center gap-2 w-full justify-center px-3 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors text-sm font-medium"
                          >
                            <Play className="h-4 w-4" />
                            Live Video
                          </button>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="bg-amber-50 dark:bg-amber-900/30 border border-amber-200 dark:border-amber-800 rounded-lg p-3 text-sm text-amber-800 dark:text-amber-300">
                      This ArcGIS location does not match any ACC camera by IP address.
                    </div>
                  )}

                  <div>
                    <h4 className="text-xs font-medium uppercase tracking-wider text-gray-500 dark:text-gray-400 mb-2">ArcGIS Attributes</h4>
                    <dl className="grid grid-cols-[auto,minmax(0,1fr)] gap-x-3 gap-y-1.5 text-xs">
                      {Object.entries(selectedMarker.arcgis?.attributes || {}).slice(0, 12).map(([key, value]) => (
                        <React.Fragment key={key}>
                          <dt className="text-gray-500 dark:text-gray-400 truncate">{key}</dt>
                          <dd className="text-gray-700 dark:text-gray-300 truncate">{String(value ?? '')}</dd>
                        </React.Fragment>
                      ))}
                    </dl>
                  </div>
                </div>
              ) : (
                <div className="p-8 text-center">
                  <Camera className="h-12 w-12 mx-auto text-gray-400 dark:text-gray-600 mb-3" />
                  <p className="text-sm text-gray-500 dark:text-gray-400">Select a marker or list item to view camera details.</p>
                </div>
              )}
            </div>
          </aside>
        </div>
      </main>

      {liveStreamCamera && (
        <LiveStreamModal
          cameraId={liveStreamCamera.id}
          cameraName={liveStreamCamera.name || liveStreamCamera.deviceName}
          onClose={() => setLiveStreamCamera(null)}
        />
      )}
    </div>
  );
};

export default CameraMap;
