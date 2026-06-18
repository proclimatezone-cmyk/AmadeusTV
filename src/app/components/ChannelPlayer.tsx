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

const MAX_RETRIES = 5;
const RETRY_DELAY_MS = 2000;
const LOAD_TIMEOUT_MS = 15000;

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
  const [buffering, setBuffering] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Gesture-controlled HUD states
  const [hudVolume, setHudVolume] = useState<number | null>(null); // 0-100
  const [hudSeekDelta, setHudSeekDelta] = useState<number | null>(null); // in seconds
  const [hudSeekTarget, setHudSeekTarget] = useState<string | null>(null); // e.g. "01:23"
  const [isLive, setIsLive] = useState(false);

  // Touch gesture refs
  const touchStartRef = useRef<{ x: number; y: number; vol: number; time: number } | null>(null);
  const gestureTypeRef = useRef<'volume' | 'seek' | null>(null);
  const cleanupListenersRef = useRef<(() => void) | null>(null);

  const proxyUrl = useCallback((url: string) => {
    const encoded = encodeURIComponent(url);
    return `/api/stream?url=${encoded}`;
  }, []);

  const handleFullscreen = () => {
    const video = videoRef.current;
    if (!video) return;

    if (video.requestFullscreen) {
      video.requestFullscreen();
    } else if ((video as any).webkitRequestFullscreen) {
      (video as any).webkitRequestFullscreen();
    } else if ((video as any).mozRequestFullScreen) {
      (video as any).mozRequestFullScreen();
    } else if ((video as any).msRequestFullscreen) {
      (video as any).msRequestFullscreen();
    }
  };

  const destroyHls = useCallback(() => {
    if (cleanupListenersRef.current) {
      cleanupListenersRef.current();
      cleanupListenersRef.current = null;
    }
    if (loadTimeoutRef.current) {
      clearTimeout(loadTimeoutRef.current);
      loadTimeoutRef.current = null;
    }
    if (hlsRef.current) {
      hlsRef.current.destroy();
      hlsRef.current = null;
    }
    setBuffering(false);
  }, []);

  const initPlayer = useCallback(() => {
    const video = videoRef.current;
    if (!video || !isActive) return;

    destroyHls();
    setLoading(true);
    setBuffering(false);
    setErrorMsg(null);
    setIsLive(false);
    retryCountRef.current = 0;

    const manifestUrl = proxyUrl(channel.url);

    // Apply saved volume/mute settings
    const savedVol = localStorage.getItem('amadeus_player_volume');
    const savedMuted = localStorage.getItem('amadeus_player_muted');
    if (savedVol !== null) {
      video.volume = parseFloat(savedVol);
    } else {
      video.volume = 0.5; // default
    }
    if (savedMuted !== null) {
      video.muted = savedMuted === 'true';
    } else {
      video.muted = muted;
    }

    // Attach HTML5 buffering listeners
    const handleWaiting = () => setBuffering(true);
    const handlePlaying = () => setBuffering(false);
    
    video.addEventListener('waiting', handleWaiting);
    video.addEventListener('playing', handlePlaying);
    
    cleanupListenersRef.current = () => {
      video.removeEventListener('waiting', handleWaiting);
      video.removeEventListener('playing', handlePlaying);
    };

    if (Hls.isSupported()) {
      const hls = new Hls({
        enableWorker: true,
        lowLatencyMode: false,
        maxBufferLength: 60, // 60s buffer to prevent stalls on slow internet
        maxMaxBufferLength: 120,
        maxBufferHole: 0.5,
        startLevel: -1,
        
        manifestLoadingTimeOut: 12000,
        manifestLoadingMaxRetry: 4,
        manifestLoadingRetryDelay: 1000,
        
        levelLoadingTimeOut: 12000,
        levelLoadingMaxRetry: 4,
        levelLoadingRetryDelay: 1000,
        
        fragLoadingTimeOut: 15000,
        fragLoadingMaxRetry: 6,
        fragLoadingRetryDelay: 1000,
        
        abrBandWidthFactor: 0.8,
        abrBandWidthUpFactor: 0.6,
        abrEwmaDefaultEstimate: 400000,
      });

      loadTimeoutRef.current = setTimeout(() => {
        if (loading && !errorMsg) {
          console.warn(`[HLS] Load timeout on "${channel.name}", auto-switching`);
          setErrorMsg('Канал не отвечает');
          setLoading(false);
          onError(channel);
        }
      }, LOAD_TIMEOUT_MS);

      hls.on(Events.MANIFEST_PARSED, (_event, data) => {
        if (loadTimeoutRef.current) {
          clearTimeout(loadTimeoutRef.current);
          loadTimeoutRef.current = null;
        }
        setLoading(false);
        video.play().catch(() => {});
        onReady();
      });

      hls.on(Events.LEVEL_LOADED, (_event, data) => {
        setIsLive(data.details.live);
      });

      hls.on(Events.ERROR, (_event: string, data: ErrorData) => {
        if (!data.fatal) return;

        console.warn(`[HLS] Fatal error on "${channel.name}":`, data.type, data.details);

        if (data.type === Hls.ErrorTypes.MEDIA_ERROR) {
          if (retryCountRef.current < MAX_RETRIES) {
            retryCountRef.current++;
            hls.recoverMediaError();
            return;
          }
        }

        if (data.type === Hls.ErrorTypes.NETWORK_ERROR) {
          if (retryCountRef.current < MAX_RETRIES) {
            retryCountRef.current++;
            const delay = RETRY_DELAY_MS * retryCountRef.current;
            setTimeout(() => {
              hls.startLoad();
            }, delay);
            return;
          }
        }

        setErrorMsg(getErrorMessage(data));
        setLoading(false);
        onError(channel);
      });

      hls.loadSource(manifestUrl);
      hls.attachMedia(video);
      hlsRef.current = hls;
    } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
      video.src = manifestUrl;
      video.addEventListener('loadedmetadata', () => {
        setLoading(false);
        video.play().catch(() => {});
        onReady();
      });
      video.addEventListener('error', () => {
        setErrorMsg('Стрим недоступен');
        onError(channel);
      });
    } else {
      setErrorMsg('HLS не поддерживается');
      onError(channel);
    }
  }, [channel, isActive, proxyUrl, destroyHls, onError, onReady, muted]);

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

  useEffect(() => {
    if (videoRef.current) {
      videoRef.current.muted = muted;
    }
  }, [muted]);

  // Touch Gesture Handlers
  const handleTouchStart = (e: React.TouchEvent<HTMLDivElement>) => {
    const video = videoRef.current;
    if (!video || !isActive || loading || errorMsg) return;

    const touch = e.touches[0];
    touchStartRef.current = {
      x: touch.clientX,
      y: touch.clientY,
      vol: video.muted ? 0 : video.volume,
      time: video.currentTime,
    };
    gestureTypeRef.current = null;
  };

  const handleTouchMove = (e: React.TouchEvent<HTMLDivElement>) => {
    const video = videoRef.current;
    const start = touchStartRef.current;
    if (!video || !start) return;

    const touch = e.touches[0];
    const dx = touch.clientX - start.x;
    const dy = touch.clientY - start.y;

    // Detect gesture type if not set yet
    if (!gestureTypeRef.current) {
      const absX = Math.abs(dx);
      const absY = Math.abs(dy);
      if (absX > 15 || absY > 15) {
        if (absX > absY) {
          gestureTypeRef.current = 'seek';
        } else {
          gestureTypeRef.current = 'volume';
        }
      }
    }

    // Process gesture
    if (gestureTypeRef.current === 'volume') {
      if (e.cancelable) e.preventDefault();
      // Swipe up increases volume, swipe down decreases. Sensitivity: 200px drag for 0-100%
      const volumeChange = -dy / 200;
      let newVol = Math.max(0, Math.min(1, start.vol + volumeChange));
      video.volume = newVol;
      if (newVol > 0 && video.muted) {
        video.muted = false;
        // Notify parent if parent state tracks muted
        if (muted) {
          onToggleMute();
        }
      }
      setHudVolume(Math.round(newVol * 100));
      setHudSeekDelta(null);
    } else if (gestureTypeRef.current === 'seek') {
      if (e.cancelable) e.preventDefault();
      
      if (isLive) {
        // Live feedback
        setHudSeekDelta(dx > 0 ? 1 : -1);
        setHudSeekTarget('LIVE');
        setHudVolume(null);
      } else {
        const duration = video.duration;
        if (duration && isFinite(duration)) {
          // Drag 300px for 90s seek
          const seekChange = (dx / 300) * 90;
          let targetTime = Math.max(0, Math.min(duration, start.time + seekChange));
          const delta = Math.round(targetTime - start.time);
          
          setHudSeekDelta(delta);
          setHudSeekTarget(formatTime(targetTime));
          setHudVolume(null);
        }
      }
    }
  };

  const handleTouchEnd = () => {
    const video = videoRef.current;
    const start = touchStartRef.current;
    
    if (video && start) {
      if (gestureTypeRef.current === 'seek' && !isLive) {
        const duration = video.duration;
        if (duration && isFinite(duration) && hudSeekDelta !== null) {
          video.currentTime = Math.max(0, Math.min(duration, start.time + hudSeekDelta));
        }
      } else if (gestureTypeRef.current === 'volume') {
        localStorage.setItem('amadeus_player_volume', video.volume.toString());
        localStorage.setItem('amadeus_player_muted', video.muted ? 'true' : 'false');
      }
    }

    // Reset touch trackers
    touchStartRef.current = null;
    gestureTypeRef.current = null;

    // Fade out HUD slowly
    setTimeout(() => {
      setHudVolume(null);
      setHudSeekDelta(null);
      setHudSeekTarget(null);
    }, 600);
  };

  return (
    <div 
      className="player-container"
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
    >
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
        <div className="player-overlay-center player-loading-bg">
          <div className="loading-spinner" />
          <p className="loading-text">Подключение...</p>
        </div>
      )}

      {/* Buffering overlay (transparent) */}
      {buffering && !loading && isActive && !errorMsg && (
        <div className="player-overlay-center player-buffering-bg">
          <div className="loading-spinner" />
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

      {/* Volume Gesture HUD */}
      {hudVolume !== null && (
        <div className="player-hud">
          <div className="player-hud-icon">{hudVolume === 0 ? '🔇' : hudVolume > 50 ? '🔊' : '🔉'}</div>
          <div className="player-hud-text">{hudVolume}%</div>
          <div className="player-hud-bar">
            <div className="player-hud-bar-fill" style={{ width: `${hudVolume}%` }} />
          </div>
        </div>
      )}

      {/* Seek Gesture HUD */}
      {hudSeekDelta !== null && (
        <div className="player-hud">
          <div className="player-hud-icon">{hudSeekDelta >= 0 ? '⏩' : '⏪'}</div>
          <div className="player-hud-text">
            {hudSeekDelta > 0 ? `+${hudSeekDelta}s` : hudSeekDelta < 0 ? `${hudSeekDelta}s` : ''}
          </div>
          {hudSeekTarget && <div className="player-hud-subtext">{hudSeekTarget}</div>}
        </div>
      )}

      {/* Controls Overlay */}
      {isActive && !errorMsg && !loading && (
        <div className="player-controls-bottom-right">
          <button
            onClick={handleFullscreen}
            className="control-btn-player"
            title="Во весь экран"
          >
            ⛶
          </button>
          <button
            onClick={onToggleMute}
            className="control-btn-player"
            title={muted ? 'Включить звук' : 'Выключить звук'}
          >
            {muted ? '🔇' : '🔊'}
          </button>
        </div>
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
      return 'Ошибка формата плейлиста';
    case 'levelLoadError':
    case 'levelLoadTimeOut':
      return 'Потеря соединения со стримом';
    case 'fragLoadError':
      return 'Ошибка загрузки сегмента';
    default:
      if (data.response && (data.response as { code?: number }).code === 403) {
        return 'Гео-блокировка (403)';
      }
      return 'Стрим недоступен';
  }
}

function formatTime(seconds: number): string {
  if (isNaN(seconds)) return '00:00';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);

  const mm = m < 10 ? `0${m}` : m;
  const ss = s < 10 ? `0${s}` : s;

  if (h > 0) {
    return `${h}:${mm}:${ss}`;
  }
  return `${mm}:${ss}`;
}
