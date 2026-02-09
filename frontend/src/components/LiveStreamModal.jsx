import React, { useEffect, useRef, useState, useCallback } from 'react';
import { X, AlertCircle, Maximize2, Volume2, VolumeX } from 'lucide-react';

const LiveStreamModal = ({ cameraId, cameraName, onClose }) => {
  const videoRef = useRef(null);
  const abortRef = useRef(null);
  const [status, setStatus] = useState('loading'); // loading, playing, error
  const [errorMessage, setErrorMessage] = useState('');
  const [isMuted, setIsMuted] = useState(true);

  const stableOnClose = useCallback(onClose, [onClose]);

  useEffect(() => {
    let destroyed = false;
    const abortController = new AbortController();
    abortRef.current = abortController;

    const initStream = async () => {
      try {
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

        // 2. Parse the MPD XML to extract codec, mimeType, and stream URL
        const parser = new DOMParser();
        const xml = parser.parseFromString(mpdText, 'text/xml');
        const representations = xml.querySelectorAll('Representation');

        if (representations.length === 0) {
          throw new Error('No video representations found in manifest');
        }

        // Pick the first (highest quality) representation
        const rep = representations[0];
        const codec = rep.getAttribute('codecs');
        const mimeType = rep.getAttribute('mimeType');
        const baseUrlEl = rep.querySelector('BaseURL');
        if (!baseUrlEl) throw new Error('No BaseURL found in manifest');

        const streamUrl = baseUrlEl.textContent;
        const fullMime = `${mimeType}; codecs="${codec}"`;

        // 3. Check MediaSource support
        if (!window.MediaSource || !MediaSource.isTypeSupported(fullMime)) {
          throw new Error(`Browser does not support ${fullMime}`);
        }

        // 4. Create MediaSource and attach to video element
        const mediaSource = new MediaSource();
        const video = videoRef.current;
        if (!video || destroyed) return;

        video.src = URL.createObjectURL(mediaSource);

        await new Promise((resolve, reject) => {
          mediaSource.addEventListener('sourceopen', resolve, { once: true });
          mediaSource.addEventListener('error', () => reject(new Error('MediaSource error')), { once: true });
        });

        if (destroyed) return;

        const sourceBuffer = mediaSource.addSourceBuffer(fullMime);

        // 5. Fetch the video stream from the proxy
        const streamRes = await fetch(streamUrl, {
          headers,
          signal: abortController.signal
        });
        if (!streamRes.ok) throw new Error(`Stream request failed: ${streamRes.status}`);
        if (!streamRes.body) throw new Error('ReadableStream not supported');

        const reader = streamRes.body.getReader();
        let hasStartedPlaying = false;

        // Helper: wait for sourceBuffer to finish updating then append
        const appendChunk = (chunk) => {
          return new Promise((resolve, reject) => {
            const doAppend = () => {
              try {
                sourceBuffer.appendBuffer(chunk);
                sourceBuffer.addEventListener('updateend', resolve, { once: true });
              } catch (e) {
                reject(e);
              }
            };

            if (sourceBuffer.updating) {
              sourceBuffer.addEventListener('updateend', doAppend, { once: true });
            } else {
              doAppend();
            }
          });
        };

        // Keep buffer trimmed to avoid memory issues (keep last 30s)
        const trimBuffer = () => {
          try {
            if (!sourceBuffer.updating && sourceBuffer.buffered.length > 0) {
              const currentTime = video.currentTime;
              const bufferStart = sourceBuffer.buffered.start(0);
              if (currentTime - bufferStart > 30) {
                sourceBuffer.remove(bufferStart, currentTime - 15);
              }
            }
          } catch (e) {
            // Non-critical
          }
        };

        // 6. Read chunks and feed to SourceBuffer
        const readLoop = async () => {
          while (!destroyed) {
            const { done, value } = await reader.read();
            if (done || destroyed) break;

            await appendChunk(value);

            if (!hasStartedPlaying && !destroyed) {
              hasStartedPlaying = true;
              setStatus('playing');
              video.play().catch(() => {});
            }

            trimBuffer();
          }
        };

        readLoop().catch((err) => {
          if (!destroyed && err.name !== 'AbortError') {
            console.error('Stream read error:', err);
            setStatus('error');
            setErrorMessage(err.message || 'Stream interrupted');
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
    };
  }, [cameraId]);

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
    const video = videoRef.current;
    if (video) {
      video.muted = !video.muted;
      setIsMuted(video.muted);
    }
  };

  const toggleFullscreen = () => {
    const container = videoRef.current?.parentElement;
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
        <div className="flex-1 bg-black flex items-center justify-center relative">
          <video
            ref={videoRef}
            className="w-full h-full object-contain"
            autoPlay
            muted
            playsInline
          />

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
