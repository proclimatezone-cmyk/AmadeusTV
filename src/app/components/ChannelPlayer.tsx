'use client';

import { useEffect, useRef, useCallback, useState } from 'react';
import Hls, { ErrorData, Events } from 'hls.js';
import { Channel } from '@/lib/types';

interface ChannelPlayerProps {
  channel: Channel;
  isActive: boolean;
  onError: (channel: Channel) => void;
  onReady: () => void;
  muted: boolean;
  onToggleMute: () => void;
}

const MAX_RETRIES = 1;
const RETRY_DELAY_MS = 1000;
const LOAD_TIMEOUT_MS = 8000;

export default function ChannelPlayer({
  channel,
  isActive,
  onError,
  onReady,
  muted,
  onToggleMute,
}: ChannelPlayerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const hlsRef = useRef<Hls | null>(null);
  const retryCountRef = useRef(0);
  const loadTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const proxyUrl = useCallback((url: string) => {
    const encoded = btoa(url);
    return `/api/stream?url=${encoded}`;
  }, []);

  const destroyHls = useCallback(() => {
    if (loadTimeoutRef.current) {
      clearTimeout(loadTimeoutRef.current);
      loadTimeoutRef.current = null;
    }
    if (hlsRef.current) {
      hlsRef.current.destroy();
      hlsRef.current = null;
    }
  }, []);

  const initPlayer = useCallback(() => {
    const video = videoRef.current;
    if (!video || !isActive) return;

    destroyHls();
    setLoading(true);
    setErrorMsg(null);
    retryCountRef.current = 0;

    // Use proxy for the manifest URL
    const manifestUrl = proxyUrl(channel.url);

    if (Hls.isSupported()) {
      const hls = new Hls({
        enableWorker: true,
        lowLatencyMode: false,
        maxBufferLength: 30,
        maxMaxBufferLength: 60,
        maxBufferHole: 0.5,
        startLevel: -1,
        manifestLoadingTimeOut: 8000,
        manifestLoadingMaxRetry: 1,
        levelLoadingTimeOut: 8000,
        fragLoadingTimeOut: 10000,
      });

      // Failsafe: if nothing loads in LOAD_TIMEOUT_MS, force switch
      loadTimeoutRef.current = setTimeout(() => {
        if (loading && !errorMsg) {
          console.warn(`[HLS] Load timeout on "${channel.name}", auto-switching`);
          setErrorMsg('Канал не отвечает');
          setLoading(false);
          onError(channel);
        }
      }, LOAD_TIMEOUT_MS);

      hls.on(Events.MANIFEST_PARSED, () => {
        if (loadTimeoutRef.current) {
          clearTimeout(loadTimeoutRef.current);
          loadTimeoutRef.current = null;
        }
        setLoading(false);
        video.play().catch(() => {});
        onReady();
      });

      hls.on(Events.ERROR, (_event: string, data: ErrorData) => {
        if (!data.fatal) return;

        console.warn(`[HLS] Fatal error on "${channel.name}":`, data.type, data.details);

        if (data.type === Hls.ErrorTypes.MEDIA_ERROR) {
          // Try media recovery first
          if (retryCountRef.current < MAX_RETRIES) {
            retryCountRef.current++;
            console.log(`[HLS] Attempting media recovery (${retryCountRef.current}/${MAX_RETRIES})`);
            hls.recoverMediaError();
            return;
          }
        }

        if (data.type === Hls.ErrorTypes.NETWORK_ERROR) {
          // Retry with backoff
          if (retryCountRef.current < MAX_RETRIES) {
            retryCountRef.current++;
            const delay = RETRY_DELAY_MS * retryCountRef.current;
            console.log(`[HLS] Network retry in ${delay}ms (${retryCountRef.current}/${MAX_RETRIES})`);
            setTimeout(() => {
              hls.startLoad();
            }, delay);
            return;
          }
        }

        // All retries exhausted — signal auto-switch
        setErrorMsg(getErrorMessage(data));
        setLoading(false);
        onError(channel);
      });

      hls.loadSource(manifestUrl);
      hls.attachMedia(video);
      hlsRef.current = hls;
    } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
      // Native HLS (Safari)
      video.src = manifestUrl;
      video.addEventListener('loadedmetadata', () => {
        setLoading(false);
        video.play().catch(() => {});
        onReady();
      });
      video.addEventListener('error', () => {
        setErrorMsg('Stream unavailable');
        onError(channel);
      });
    } else {
      setErrorMsg('HLS not supported');
      onError(channel);
    }
  }, [channel, isActive, proxyUrl, destroyHls, onError, onReady]);

  // Init/destroy on active state change
  useEffect(() => {
    if (isActive) {
      initPlayer();
    } else {
      destroyHls();
      setLoading(true);
      setErrorMsg(null);
    }

    return () => {
      destroyHls();
    };
  }, [isActive, initPlayer, destroyHls]);

  // Sync muted state
  useEffect(() => {
    if (videoRef.current) {
      videoRef.current.muted = muted;
    }
  }, [muted]);

  return (
    <div className="player-container">
      <video
        ref={videoRef}
        className="player-video"
        playsInline
        autoPlay
        muted={muted}
        loop={false}
        preload="none"
      />

      {/* Loading overlay */}
      {loading && isActive && !errorMsg && (
        <div className="player-overlay-center">
          <div className="loading-spinner" />
          <p className="loading-text">Подключение...</p>
        </div>
      )}

      {/* Error overlay */}
      {errorMsg && (
        <div className="player-overlay-center">
          <div className="error-icon">⚠️</div>
          <p className="error-text">{errorMsg}</p>
          <p className="error-subtext">Переключение...</p>
        </div>
      )}

      {/* Mute button */}
      {isActive && !errorMsg && !loading && (
        <button
          onClick={onToggleMute}
          className="mute-btn"
          aria-label={muted ? 'Unmute' : 'Mute'}
        >
          {muted ? '🔇' : '🔊'}
        </button>
      )}
    </div>
  );
}

function getErrorMessage(data: ErrorData): string {
  switch (data.details) {
    case 'manifestLoadError':
    case 'manifestLoadTimeOut':
      return 'Канал недоступен';
    case 'manifestParsingError':
      return 'Ошибка формата';
    case 'levelLoadError':
    case 'levelLoadTimeOut':
      return 'Потеря соединения';
    case 'fragLoadError':
      return 'Ошибка загрузки';
    default:
      if (data.response && (data.response as { code?: number }).code === 403) {
        return 'Гео-блокировка (403)';
      }
      return 'Стрим недоступен';
  }
}
