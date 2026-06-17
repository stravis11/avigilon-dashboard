import React, { useEffect, useRef, useState, useCallback } from 'react';
import { X, AlertCircle, Maximize2, Volume2, VolumeX } from 'lucide-react';

const HDSM_PROTOTYPE_CAMERA_NAME = '4th St Apts 1st Flr Goldin Lobby Ent';

const parseSrd = (value) => {
  const parts = (value || '').split(',').map((part) => Number(part));
  if (parts.length !== 7 || parts.some((part) => Number.isNaN(part))) return null;
  const [, x, y, width, height, totalWidth, totalHeight] = parts;
  if (!width || !height || !totalWidth || !totalHeight) return null;
  return { x, y, width, height, totalWidth, totalHeight };
};

const getSupplementalValue = (adaptationSet, schemeIdUri) => {
  const property = Array.from(adaptationSet.querySelectorAll('SupplementalProperty'))
    .find((item) => item.getAttribute('schemeIdUri') === schemeIdUri);
  return property?.getAttribute('value') || '';
};

const getRole = (adaptationSet) => {
  return adaptationSet.querySelector('Role')?.getAttribute('value') || '';
};

const parseRepresentation = (representation, adaptationSet) => {
  const baseUrl = representation.querySelector('BaseURL')?.textContent;
  const width = Number(representation.getAttribute('width'));
  const height = Number(representation.getAttribute('height'));
  const bandwidth = Number(representation.getAttribute('bandwidth'));
  const codec = representation.getAttribute('codecs');
  const mimeType = representation.getAttribute('mimeType');

  if (!baseUrl || !width || !height || !codec || !mimeType) return null;

  return {
    id: representation.getAttribute('id') || `${width}x${height}`,
    streamUrl: baseUrl,
    width,
    height,
    bandwidth: Number.isNaN(bandwidth) ? 0 : bandwidth,
    codec,
    mimeType,
    fullMime: `${mimeType}; codecs="${codec}"`,
    role: getRole(adaptationSet),
    rotation: Number(getSupplementalValue(adaptationSet, 'urn:avg:rotation:v1') || 0),
    srd: parseSrd(getSupplementalValue(adaptationSet, 'urn:mpeg:dash:srd:2014'))
  };
};

const parseManifest = (mpdText) => {
  const parser = new DOMParser();
  const xml = parser.parseFromString(mpdText, 'text/xml');
  const adaptationSets = Array.from(xml.querySelectorAll('AdaptationSet'));
  const streams = adaptationSets.flatMap((adaptationSet) => {
    return Array.from(adaptationSet.querySelectorAll('Representation'))
      .map((representation) => parseRepresentation(representation, adaptationSet))
      .filter(Boolean);
  });

  const mainStreams = streams.filter((stream) => stream.role === 'main');
  const supplementaryTiles = streams
    .filter((stream) => stream.role === 'supplementary' && stream.srd)
    .sort((a, b) => (a.srd.y - b.srd.y) || (a.srd.x - b.srd.x));

  return { streams, mainStreams, supplementaryTiles };
};

const appendChunk = (sourceBuffer, chunk) => {
  return new Promise((resolve, reject) => {
    const doAppend = () => {
      try {
        sourceBuffer.appendBuffer(chunk);
        sourceBuffer.addEventListener('updateend', resolve, { once: true });
      } catch (error) {
        reject(error);
      }
    };

    if (sourceBuffer.updating) {
      sourceBuffer.addEventListener('updateend', doAppend, { once: true });
    } else {
      doAppend();
    }
  });
};

const trimBuffer = (video, sourceBuffer) => {
  try {
    if (!sourceBuffer.updating && sourceBuffer.buffered.length > 0) {
      const currentTime = video.currentTime;
      const bufferStart = sourceBuffer.buffered.start(0);
      if (currentTime - bufferStart > 30) {
        sourceBuffer.remove(bufferStart, currentTime - 15);
      }
    }
  } catch (error) {
    // Best-effort memory trimming only.
  }
};

const startMediaSourceStream = async ({
  video,
  stream,
  headers,
  signal,
  isDestroyed,
  onStarted,
  onError
}) => {
  if (!window.MediaSource || !MediaSource.isTypeSupported(stream.fullMime)) {
    throw new Error(`Browser does not support ${stream.fullMime}`);
  }

  const mediaSource = new MediaSource();
  video.src = URL.createObjectURL(mediaSource);

  await new Promise((resolve, reject) => {
    mediaSource.addEventListener('sourceopen', resolve, { once: true });
    mediaSource.addEventListener('error', () => reject(new Error('MediaSource error')), { once: true });
  });

  if (isDestroyed()) return;

  const sourceBuffer = mediaSource.addSourceBuffer(stream.fullMime);
  const streamRes = await fetch(stream.streamUrl, { headers, signal });
  if (!streamRes.ok) throw new Error(`Stream request failed: ${streamRes.status}`);
  if (!streamRes.body) throw new Error('ReadableStream not supported');

  const reader = streamRes.body.getReader();
  let hasStartedPlaying = false;

  const readLoop = async () => {
    while (!isDestroyed()) {
      const { done, value } = await reader.read();
      if (done || isDestroyed()) break;

      await appendChunk(sourceBuffer, value);

      if (!hasStartedPlaying && !isDestroyed()) {
        hasStartedPlaying = true;
        onStarted?.();
        video.play().catch(() => {});
      }

      trimBuffer(video, sourceBuffer);
    }
  };

  readLoop().catch((error) => {
    if (!isDestroyed() && error.name !== 'AbortError') {
      onError?.(error);
    }
  });
};

const LiveStreamModal = ({ cameraId, cameraName, onClose }) => {
  const videoRef = useRef(null);
  const hdsmContainerRef = useRef(null);
  const fullscreenContainerRef = useRef(null);
  const abortRef = useRef(null);
  const [status, setStatus] = useState('loading'); // loading, playing, error
  const [errorMessage, setErrorMessage] = useState('');
  const [isMuted, setIsMuted] = useState(true);
  const [hdsmLayout, setHdsmLayout] = useState(null);

  const stableOnClose = useCallback(onClose, [onClose]);

  useEffect(() => {
    let destroyed = false;
    const abortController = new AbortController();
    abortRef.current = abortController;

    const initStream = async () => {
      try {
        setHdsmLayout(null);
        const token = localStorage.getItem('accessToken');
        const headers = token ? { 'Authorization': `Bearer ${token}` } : {};

        // 1. Fetch the MPD manifest to get codec info and stream URL
        const manifestRes = await fetch(`/api/cameras/${cameraId}/stream/manifest`, {
          headers,
          signal: abortController.signal
        });
        if (!manifestRes.ok) throw new Error(`Manifest request failed: ${manifestRes.status}`);

        const mpdText = await manifestRes.text();
        if (destroyed) return;

        const manifest = parseManifest(mpdText);
        if (manifest.streams.length === 0) {
          throw new Error('No video representations found in manifest');
        }

        const isGoldinPrototype = (cameraName || '').toLowerCase().includes(HDSM_PROTOTYPE_CAMERA_NAME.toLowerCase());
        if (isGoldinPrototype && manifest.supplementaryTiles.length > 0) {
          const firstTile = manifest.supplementaryTiles[0];
          const layout = {
            totalWidth: firstTile.srd.totalWidth,
            totalHeight: firstTile.srd.totalHeight,
            rotation: firstTile.rotation || 0,
            tiles: manifest.supplementaryTiles
          };

          setHdsmLayout(layout);

          await new Promise((resolve) => requestAnimationFrame(resolve));
          if (destroyed) return;

          const tileVideos = Array.from(hdsmContainerRef.current?.querySelectorAll('video[data-tile-id]') || []);
          if (tileVideos.length === 0) {
            throw new Error('HDSM tile video elements were not created');
          }

          let startedTiles = 0;
          await Promise.all(layout.tiles.map((tile) => {
            const video = tileVideos.find((item) => item.dataset.tileId === tile.id);
            if (!video) return Promise.resolve();
            video.muted = true;
            video.playsInline = true;
            return startMediaSourceStream({
              video,
              stream: tile,
              headers,
              signal: abortController.signal,
              isDestroyed: () => destroyed,
              onStarted: () => {
                startedTiles += 1;
                if (startedTiles === 1) setStatus('playing');
              },
              onError: (error) => {
                console.error('HDSM tile stream error:', error);
              }
            });
          }));

          return;
        }

        // Current standard playback path: use the first full-frame/main stream when available.
        const stream = manifest.mainStreams[0] || manifest.streams[0];
        const video = videoRef.current;
        if (!video || destroyed) return;

        await startMediaSourceStream({
          video,
          stream,
          headers,
          signal: abortController.signal,
          isDestroyed: () => destroyed,
          onStarted: () => setStatus('playing'),
          onError: (error) => {
            console.error('Stream read error:', error);
            setStatus('error');
            setErrorMessage(error.message || 'Stream interrupted');
          }
        });
      } catch (err) {
        if (!destroyed && err.name !== 'AbortError') {
          console.error('Failed to initialize stream:', err);
          setStatus('error');
          setErrorMessage(err.message || 'Failed to connect to camera');
        }
      }
    };

    initStream();

    return () => {
      destroyed = true;
      abortController.abort();
      if (videoRef.current) {
        videoRef.current.pause();
        videoRef.current.src = '';
      }
      const tileVideos = Array.from(hdsmContainerRef.current?.querySelectorAll('video') || []);
      tileVideos.forEach((video) => {
        video.pause();
        video.src = '';
      });
    };
  }, [cameraId, cameraName]);

  // Escape key handler
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') {
        stableOnClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [stableOnClose]);

  const toggleMute = () => {
    const videos = hdsmLayout
      ? Array.from(hdsmContainerRef.current?.querySelectorAll('video') || [])
      : [videoRef.current].filter(Boolean);

    if (videos.length > 0) {
      const muted = !videos[0].muted;
      videos.forEach((video) => { video.muted = muted; });
      setIsMuted(muted);
    }
  };

  const toggleFullscreen = () => {
    const container = fullscreenContainerRef.current;
    if (container) {
      if (document.fullscreenElement) {
        document.exitFullscreen();
      } else {
        container.requestFullscreen();
      }
    }
  };

  return (
    <div
      className="fixed inset-0 bg-black bg-opacity-90 flex items-center justify-center z-[60]"
      onClick={stableOnClose}
    >
      <div
        className="relative w-full h-full max-w-[95vw] max-h-[95vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-2 bg-black bg-opacity-60 rounded-t-lg">
          <div className="flex items-center space-x-2">
            <div className="w-2 h-2 bg-red-500 rounded-full animate-pulse" />
            <span className="text-white font-medium">
              LIVE - {cameraName || 'Camera'}
            </span>
          </div>
          <button
            onClick={stableOnClose}
            className="p-2 text-white hover:bg-white hover:bg-opacity-20 rounded-full transition-colors"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Video Container */}
        <div ref={fullscreenContainerRef} className="flex-1 bg-black flex items-center justify-center relative">
          {hdsmLayout ? (
            <div className="relative w-full h-full flex items-center justify-center overflow-hidden bg-black">
              <div
                ref={hdsmContainerRef}
                className="relative max-w-full max-h-full bg-black"
                style={{
                  aspectRatio: `${hdsmLayout.totalWidth} / ${hdsmLayout.totalHeight}`,
                  width: '100%',
                  height: 'auto',
                  transform: hdsmLayout.rotation ? `rotate(${hdsmLayout.rotation}deg)` : undefined
                }}
              >
                {hdsmLayout.tiles.map((tile) => (
                  <video
                    key={tile.id}
                    data-tile-id={tile.id}
                    className="absolute object-fill"
                    muted
                    playsInline
                    autoPlay
                    style={{
                      left: `${(tile.srd.x / tile.srd.totalWidth) * 100}%`,
                      top: `${(tile.srd.y / tile.srd.totalHeight) * 100}%`,
                      width: `${(tile.srd.width / tile.srd.totalWidth) * 100}%`,
                      height: `${(tile.srd.height / tile.srd.totalHeight) * 100}%`
                    }}
                  />
                ))}
              </div>
              <div className="absolute left-3 top-3 rounded bg-black/60 px-2 py-1 text-xs text-white">
                HDSM prototype: {hdsmLayout.tiles.length} tiles
              </div>
            </div>
          ) : (
            <video
              ref={videoRef}
              className="w-full h-full object-contain"
              autoPlay
              muted
              playsInline
            />
          )}

          {/* Loading overlay */}
          {status === 'loading' && (
            <div className="absolute inset-0 flex flex-col items-center justify-center bg-black bg-opacity-60">
              <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-white mb-4"></div>
              <span className="text-white text-lg">Connecting to camera...</span>
            </div>
          )}

          {/* Error overlay */}
          {status === 'error' && (
            <div className="absolute inset-0 flex flex-col items-center justify-center bg-black bg-opacity-80">
              <AlertCircle className="h-12 w-12 text-red-400 mb-4" />
              <span className="text-white text-lg mb-2">Stream Unavailable</span>
              <span className="text-gray-400 text-sm">{errorMessage}</span>
              <button
                onClick={stableOnClose}
                className="mt-4 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
              >
                Close
              </button>
            </div>
          )}

          {/* Controls overlay (bottom) */}
          {status === 'playing' && (
            <div className="absolute bottom-0 left-0 right-0 p-4 bg-gradient-to-t from-black to-transparent opacity-0 hover:opacity-100 transition-opacity">
              <div className="flex items-center justify-end space-x-2">
                <button
                  onClick={toggleMute}
                  className="p-2 text-white hover:bg-white hover:bg-opacity-20 rounded-full transition-colors"
                >
                  {isMuted ? <VolumeX className="h-5 w-5" /> : <Volume2 className="h-5 w-5" />}
                </button>
                <button
                  onClick={toggleFullscreen}
                  className="p-2 text-white hover:bg-white hover:bg-opacity-20 rounded-full transition-colors"
                >
                  <Maximize2 className="h-5 w-5" />
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default LiveStreamModal;
