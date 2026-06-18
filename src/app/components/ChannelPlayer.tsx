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

const MAX_RETRIES = 2;
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
  const containerRef = useRef<HTMLDivElement>(null);
  const hlsRef = useRef<Hls | null>(null);
  const retryCountRef = useRef(0);
  const loadTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  
  const [loading, setLoading] = useState(true);
  const [buffering, setBuffering] = useState(false);
  const [isPlaying, setIsPlaying] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Gesture-controlled HUD states
  const [hudVolume, setHudVolume] = useState<number | null>(null); // 0-100
  const [hudSeekDelta, setHudSeekDelta] = useState<number | null>(null); // in seconds
  const [hudSeekTarget, setHudSeekTarget] = useState<string | null>(null); // e.g. "01:23"
  const [isLive, setIsLive] = useState(false);

  // Video quality levels
  const [levels, setLevels] = useState<{ index: number; name: string }[]>([]);
  const [currentLevel, setCurrentLevel] = useState<number>(-2); // -2 = uninitialized, -1 = Auto
  const [qualityMenuOpen, setQualityMenuOpen] = useState(false);

  // Touch gesture refs
  const touchStartRef = useRef<{ x: number; y: number; vol: number; time: number } | null>(null);
  const gestureTypeRef = useRef<'volume' | 'seek' | null>(null);
  const cleanupListenersRef = useRef<(() => void) | null>(null);

  const proxyUrl = useCallback((url: string) => {
    const encoded = encodeURIComponent(url);
    return `/api/stream?url=${encoded}`;
  }, []);

  const handleFullscreen = () => {
    const container = containerRef.current;
    if (!container) return;

    if (document.fullscreenElement) {
      document.exitFullscreen().catch(() => {});
    } else {
      if (container.requestFullscreen) {
        container.requestFullscreen().catch(() => {});
      } else if ((container as any).webkitRequestFullscreen) {
        (container as any).webkitRequestFullscreen();
      } else if ((container as any).mozRequestFullScreen) {
        (container as any).mozRequestFullScreen();
      } else if ((container as any).msRequestFullscreen) {
        (container as any).msRequestFullscreen();
      }
    }
  };

  const togglePlay = () => {
    const video = videoRef.current;
    if (!video) return;

    if (video.paused) {
      video.play().catch(() => {});
      setIsPlaying(true);
    } else {
      video.pause();
      setIsPlaying(false);
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
    setIsPlaying(true);
    setLevels([]);
    setCurrentLevel(-2);
    setQualityMenuOpen(false);
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

    // Attach HTML5 buffering and play/pause listeners
    const handleWaiting = () => setBuffering(true);
    const handlePlaying = () => setBuffering(false);
    const handlePlay = () => setIsPlaying(true);
    const handlePause = () => setIsPlaying(false);
    
    video.addEventListener('waiting', handleWaiting);
    video.addEventListener('playing', handlePlaying);
    video.addEventListener('play', handlePlay);
    video.addEventListener('pause', handlePause);
    
    cleanupListenersRef.current = () => {
      video.removeEventListener('waiting', handleWaiting);
      video.removeEventListener('playing', handlePlaying);
      video.removeEventListener('play', handlePlay);
      video.removeEventListener('pause', handlePause);
    };

    if (Hls.isSupported()) {
      const hls = new Hls({
        enableWorker: true,
        lowLatencyMode: true,
        maxBufferLength: 15, // Keep buffer small (15s) for live streams to avoid drift & 404s
        maxMaxBufferLength: 30, // Max 30s buffer
        maxBufferSize: 30 * 1024 * 1024, // 30MB
        maxBufferHole: 0.5,
        startLevel: -1,
        
        manifestLoadingTimeOut: 8000,
        manifestLoadingMaxRetry: 3,
        manifestLoadingRetryDelay: 1000,
        
        levelLoadingTimeOut: 8000,
        levelLoadingMaxRetry: 3,
        levelLoadingRetryDelay: 1000,
        
        fragLoadingTimeOut: 10000,
        fragLoadingMaxRetry: 4,
        fragLoadingRetryDelay: 1000,
        
        abrBandWidthFactor: 0.9,
        abrBandWidthUpFactor: 0.7,
        abrEwmaDefaultEstimate: 500000,
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

        // Load available quality levels
        const hlsLevels = hls.levels.map((level, idx) => ({
          index: idx,
          name: level.height ? `${level.height}p` : `Качество ${idx + 1}`,
        }));
        setLevels([{ index: -1, name: 'Авто' }, ...hlsLevels]);
        setCurrentLevel(hls.currentLevel);
      });

      hls.on(Events.LEVEL_LOADED, (_event, data) => {
        setIsLive(data.details.live);
      });

      hls.on(Events.LEVEL_SWITCHED, (_event, data) => {
        setCurrentLevel(data.level);
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
      ref={containerRef}
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

      {/* Center Play/Pause overlay */}
      {isActive && !errorMsg && !loading && !buffering && (
        <div className="player-center-play-btn-wrap" onClick={togglePlay}>
          <button 
            className={`player-center-play-btn ${!isPlaying ? 'paused' : ''}`} 
            aria-label={isPlaying ? 'Pause' : 'Play'}
          >
            {isPlaying ? '⏸' : '▶'}
          </button>
        </div>
      )}

      {/* Controls Overlay */}
      {isActive && !errorMsg && !loading && (
        <div className="player-controls-bottom-right">
          {/* Quality Selector */}
          {levels.length > 0 && (
            <div className="player-quality-selector-wrap">
              <button
                onClick={() => setQualityMenuOpen(!qualityMenuOpen)}
                className={`control-btn-player ${qualityMenuOpen ? 'btn-active' : ''}`}
                title="Выбор качества"
              >
                ⚙️ {currentLevel === -1 ? 'Авто' : levels.find(l => l.index === currentLevel)?.name || ''}
              </button>
              {qualityMenuOpen && (
                <div className="player-quality-menu">
                  {levels.map((lvl) => {
                    const isSelected = lvl.index === currentLevel;
                    return (
                      <button
                        key={lvl.index}
                        onClick={() => {
                          if (hlsRef.current) {
                            hlsRef.current.currentLevel = lvl.index;
                            setCurrentLevel(lvl.index);
                          }
                          setQualityMenuOpen(false);
                        }}
                        className={`quality-menu-item ${isSelected ? 'selected' : ''}`}
                      >
                        {lvl.name} {isSelected && '✓'}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          <button
            onClick={togglePlay}
            className="control-btn-player"
            title={isPlaying ? 'Пауза' : 'Воспроизвести'}
          >
            {isPlaying ? '⏸' : '▶'}
          </button>
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
