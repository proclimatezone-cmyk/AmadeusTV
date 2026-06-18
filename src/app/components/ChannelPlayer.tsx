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
  onNextChannel: () => void;
  onRetry: () => void;
  autoSwitch: boolean;
  forceProxy: boolean;
}

const MAX_RETRIES = 2;
const RETRY_DELAY_MS = 1000;
const LOAD_TIMEOUT_MS = 5000;

export default function ChannelPlayer({
  channel,
  isActive,
  onError,
  onReady,
  muted,
  onToggleMute,
  onNextChannel,
  onRetry,
  autoSwitch,
  forceProxy,
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
  const [useProxyState, setUseProxyState] = useState(false);

  // Reset useProxyState back to false when channel changes
  useEffect(() => {
    setUseProxyState(false);
  }, [channel.id]);

  // Player controls state
  const [duration, setDuration] = useState(0);
  const [controlsVisible, setControlsVisible] = useState(true);
  const [volume, setVolume] = useState(0.5);
  const [showDoubleTapFeedback, setShowDoubleTapFeedback] = useState<'left' | 'right' | null>(null);

  // Gesture-controlled HUD states
  const [hudVolume, setHudVolume] = useState<number | null>(null); // 0-100
  const [hudSeekDelta, setHudSeekDelta] = useState<number | null>(null); // in seconds
  const [hudSeekTarget, setHudSeekTarget] = useState<string | null>(null); // e.g. "01:23"
  const [isLive, setIsLive] = useState(false);

  // Video quality levels
  const [levels, setLevels] = useState<{ index: number; name: string }[]>([]);
  const [currentLevel, setCurrentLevel] = useState<number>(-2); // -2 = uninitialized, -1 = Auto
  const [qualityMenuOpen, setQualityMenuOpen] = useState(false);

  // DOM Refs to prevent React re-renders during playback
  const timelineSliderRef = useRef<HTMLInputElement>(null);
  const timeCurrentRef = useRef<HTMLSpanElement>(null);

  // Touch gesture refs
  const touchStartRef = useRef<{ x: number; y: number; vol: number; time: number } | null>(null);
  const gestureTypeRef = useRef<'volume' | 'seek' | null>(null);
  const cleanupListenersRef = useRef<(() => void) | null>(null);
  const controlsTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Single/Double Click detection refs
  const lastClickTimeRef = useRef(0);
  const clickTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const proxyUrl = useCallback((url: string) => {
    const encoded = encodeURIComponent(url);
    return `/api/stream?url=${encoded}`;
  }, []);

  const handleFullscreen = () => {
    const container = containerRef.current;
    const video = videoRef.current;
    if (!container) return;

    const isFullscreen = document.fullscreenElement || 
                         (document as any).webkitFullscreenElement || 
                         (document as any).mozFullScreenElement || 
                         (document as any).msFullscreenElement;

    if (isFullscreen) {
      if (document.exitFullscreen) {
        document.exitFullscreen().catch(() => {});
      } else if ((document as any).webkitExitFullscreen) {
        (document as any).webkitExitFullscreen();
      } else if ((document as any).mozCancelFullScreen) {
        (document as any).mozCancelFullScreen();
      } else if ((document as any).msExitFullscreen) {
        (document as any).msExitFullscreen();
      }
    } else {
      if (container.requestFullscreen) {
        container.requestFullscreen().catch(() => {});
      } else if ((container as any).webkitRequestFullscreen) {
        (container as any).webkitRequestFullscreen();
      } else if ((container as any).mozRequestFullScreen) {
        (container as any).mozRequestFullScreen();
      } else if ((container as any).msRequestFullscreen) {
        (container as any).msRequestFullscreen();
      } else if (video && (video as any).webkitEnterFullscreen) {
        try {
          (video as any).webkitEnterFullscreen();
        } catch (err) {
          console.error('[Player] webkitEnterFullscreen failed:', err);
        }
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

  const showControlsTemporarily = useCallback(() => {
    setControlsVisible(true);
    if (controlsTimeoutRef.current) {
      clearTimeout(controlsTimeoutRef.current);
    }
    controlsTimeoutRef.current = setTimeout(() => {
      setControlsVisible(false);
    }, 3500);
  }, []);

  const handleMouseMove = () => {
    showControlsTemporarily();
  };

  useEffect(() => {
    showControlsTemporarily();
    return () => {
      if (controlsTimeoutRef.current) {
        clearTimeout(controlsTimeoutRef.current);
      }
    };
  }, [channel.id, showControlsTemporarily]);

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
    setDuration(0);
    retryCountRef.current = 0;

    if (timelineSliderRef.current) {
      timelineSliderRef.current.value = '0';
      timelineSliderRef.current.style.setProperty('--progress-percent', '0%');
      timelineSliderRef.current.style.setProperty('--buffer-percent', '0%');
    }
    if (timeCurrentRef.current) {
      timeCurrentRef.current.innerText = '00:00';
    }

    const shouldProxy = forceProxy || useProxyState;
    const manifestUrl = shouldProxy ? proxyUrl(channel.url) : channel.url;
    console.log(`[Player] Initializing "${channel.name}". Mode: ${shouldProxy ? 'PROXY' : 'DIRECT'}. URL: ${manifestUrl}`);

    // Apply saved volume/mute settings
    const savedVol = localStorage.getItem('amadeus_player_volume');
    const savedMuted = localStorage.getItem('amadeus_player_muted');
    if (savedVol !== null) {
      const vol = parseFloat(savedVol);
      video.volume = vol;
      setVolume(vol);
    } else {
      video.volume = 0.5; // default
      setVolume(0.5);
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
        maxBufferLength: 45, // Prefetch up to 45s of video ahead for stable streaming on weak networks
        maxMaxBufferLength: 90, // Max 90s buffer
        maxBufferSize: 60 * 1024 * 1024, // 60MB
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
          if (!shouldProxy) {
            console.warn(`[Player] Direct load timeout on "${channel.name}". Retrying via proxy.`);
            setUseProxyState(true);
          } else {
            console.warn(`[Player] Proxy load timeout on "${channel.name}"`);
            setErrorMsg('Канал не отвечает');
            setLoading(false);
            if (autoSwitch) {
              onError(channel);
            }
          }
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

        if (!shouldProxy) {
          console.warn(`[Player] Network error in direct mode. Falling back to proxy.`);
          setUseProxyState(true);
        } else {
          setErrorMsg(getErrorMessage(data));
          setLoading(false);
          if (autoSwitch) {
            onError(channel);
          }
        }
      });

      hls.loadSource(manifestUrl);
      hls.attachMedia(video);
      hlsRef.current = hls;
    } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
      video.src = manifestUrl;
      video.addEventListener('loadedmetadata', () => {
        setLoading(false);
        setIsLive(video.duration === Infinity || isNaN(video.duration) || video.duration === 0);
        video.play().catch(() => {});
        onReady();
      });
      video.addEventListener('error', () => {
        if (!shouldProxy) {
          console.warn(`[Player] Native error in direct mode. Falling back to proxy.`);
          setUseProxyState(true);
        } else {
          setErrorMsg('Стрим недоступен');
          if (autoSwitch) {
            onError(channel);
          }
        }
      });
    } else {
      if (!shouldProxy) {
        setUseProxyState(true);
      } else {
        setErrorMsg('HLS не поддерживается');
        if (autoSwitch) {
          onError(channel);
        }
      }
    }
  }, [channel, isActive, proxyUrl, destroyHls, onError, onReady, muted, autoSwitch, forceProxy, useProxyState]);

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

  // Video Events Handlers
  const handleTimeUpdate = () => {
    const video = videoRef.current;
    const slider = timelineSliderRef.current;
    const timeText = timeCurrentRef.current;
    if (!video) return;

    const curTime = video.currentTime;
    if (slider) {
      slider.value = curTime.toString();
      const dur = video.duration || 1;
      slider.style.setProperty('--progress-percent', `${(curTime / dur) * 100}%`);
    }
    if (timeText) {
      timeText.innerText = formatTime(curTime);
    }
  };

  const handleDurationChange = () => {
    const video = videoRef.current;
    if (!video) return;
    setDuration(video.duration);
    setIsLive(video.duration === Infinity || isNaN(video.duration) || video.duration === 0);
  };

  const handleProgress = () => {
    const video = videoRef.current;
    const slider = timelineSliderRef.current;
    if (!video || !video.buffered.length || !slider) return;

    const curTime = video.currentTime;
    let bufEnd = 0;
    for (let i = 0; i < video.buffered.length; i++) {
      if (video.buffered.start(i) <= curTime && video.buffered.end(i) >= curTime) {
        bufEnd = video.buffered.end(i);
        break;
      }
    }
    const dur = video.duration || 1;
    slider.style.setProperty('--buffer-percent', `${(bufEnd / dur) * 100}%`);
  };

  const handleSeekChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const video = videoRef.current;
    if (!video) return;
    const targetTime = parseFloat(e.target.value);
    video.currentTime = targetTime;
    e.target.style.setProperty('--progress-percent', `${(targetTime / (video.duration || 1)) * 100}%`);
    if (timeCurrentRef.current) {
      timeCurrentRef.current.innerText = formatTime(targetTime);
    }
  };

  const handleVolumeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const video = videoRef.current;
    if (!video) return;
    const val = parseFloat(e.target.value);
    setVolume(val);
    video.volume = val;
    localStorage.setItem('amadeus_player_volume', val.toString());
    
    if (val > 0 && muted) {
      onToggleMute();
      localStorage.setItem('amadeus_player_muted', 'false');
    } else if (val === 0 && !muted) {
      onToggleMute();
      localStorage.setItem('amadeus_player_muted', 'true');
    }
  };

  // Click & Double click handles (YouTube gestures)
  const handleVideoClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;

    const xRelative = e.clientX - rect.left;
    const width = rect.width;
    const isRightSide = xRelative > width / 2;

    const now = Date.now();
    const DOUBLE_PRESS_DELAY = 300;

    if (now - lastClickTimeRef.current < DOUBLE_PRESS_DELAY) {
      if (clickTimeoutRef.current) {
        clearTimeout(clickTimeoutRef.current);
        clickTimeoutRef.current = null;
      }
      handleDoublePress(isRightSide);
      lastClickTimeRef.current = 0;
    } else {
      lastClickTimeRef.current = now;
      if (clickTimeoutRef.current) clearTimeout(clickTimeoutRef.current);
      clickTimeoutRef.current = setTimeout(() => {
        togglePlay();
        showControlsTemporarily();
        clickTimeoutRef.current = null;
      }, DOUBLE_PRESS_DELAY);
    }
  };

  const handleDoublePress = (isRightSide: boolean) => {
    const video = videoRef.current;
    if (!video || isLive) return;

    const dur = video.duration;
    if (!dur || !isFinite(dur)) return;

    const delta = 10;
    if (isRightSide) {
      video.currentTime = Math.min(dur, video.currentTime + delta);
      setShowDoubleTapFeedback('right');
    } else {
      video.currentTime = Math.max(0, video.currentTime - delta);
      setShowDoubleTapFeedback('left');
    }

    setTimeout(() => {
      setShowDoubleTapFeedback(null);
    }, 800);
  };

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
      const volumeChange = -dy / 200;
      let newVol = Math.max(0, Math.min(1, start.vol + volumeChange));
      video.volume = newVol;
      setVolume(newVol);
      if (newVol > 0 && video.muted) {
        onToggleMute();
      }
      setHudVolume(Math.round(newVol * 100));
      setHudSeekDelta(null);
    } else if (gestureTypeRef.current === 'seek') {
      if (e.cancelable) e.preventDefault();
      
      if (isLive) {
        setHudSeekDelta(dx > 0 ? 1 : -1);
        setHudSeekTarget('LIVE');
        setHudVolume(null);
      } else {
        const dur = video.duration;
        if (dur && isFinite(dur)) {
          const seekChange = (dx / 300) * 90;
          let targetTime = Math.max(0, Math.min(dur, start.time + seekChange));
          const delta = Math.round(targetTime - start.time);
          
          setHudSeekDelta(delta);
          setHudSeekTarget(formatTime(targetTime));
          setHudVolume(null);
        }
      }
    }
  };

  const handleTouchEnd = (e: React.TouchEvent<HTMLDivElement>) => {
    const video = videoRef.current;
    const start = touchStartRef.current;
    
    if (video && start) {
      if (gestureTypeRef.current === 'seek' && !isLive) {
        const dur = video.duration;
        if (dur && isFinite(dur) && hudSeekDelta !== null) {
          video.currentTime = Math.max(0, Math.min(dur, start.time + hudSeekDelta));
        }
      } else if (gestureTypeRef.current === 'volume') {
        localStorage.setItem('amadeus_player_volume', video.volume.toString());
        localStorage.setItem('amadeus_player_muted', video.muted ? 'true' : 'false');
      }
    }

    touchStartRef.current = null;
    gestureTypeRef.current = null;

    setTimeout(() => {
      setHudVolume(null);
      setHudSeekDelta(null);
      setHudSeekTarget(null);
    }, 600);
  };

  const showControls = controlsVisible || !isPlaying;

  return (
    <div 
      ref={containerRef}
      className="player-container"
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
      onMouseMove={handleMouseMove}
    >
      <video
        ref={videoRef}
        className="player-video"
        playsInline
        autoPlay
        muted={muted}
        loop={false}
        preload="none"
        onTimeUpdate={handleTimeUpdate}
        onDurationChange={handleDurationChange}
        onProgress={handleProgress}
      />

      {/* Transparent Click Overlay */}
      {isActive && !errorMsg && !loading && (
        <div 
          className="player-click-overlay" 
          onClick={handleVideoClick}
        />
      )}

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
        <div className="player-overlay-center player-error-container">
          <div className="error-icon">⚠️</div>
          <p className="error-text">{errorMsg}</p>
          {autoSwitch ? (
            <p className="error-subtext">Автопереключение через 3 сек...</p>
          ) : (
            <div className="player-error-actions">
              <button 
                onClick={(e) => { e.stopPropagation(); onRetry(); }} 
                className="player-error-btn"
                title="Попробовать загрузить канал еще раз"
              >
                🔄 Повторить
              </button>
              <button 
                onClick={(e) => { e.stopPropagation(); onNextChannel(); }} 
                className="player-error-btn"
                title="Перейти к следующему каналу"
              >
                ⏭️ Следующий
              </button>
            </div>
          )}
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

      {/* Double tap ripple feedback */}
      {showDoubleTapFeedback && (
        <div className={`double-tap-feedback ${showDoubleTapFeedback}`}>
          <div className="double-tap-arrow-wrapper">
            <span className="double-tap-arrow"></span>
            <span className="double-tap-arrow"></span>
            <span className="double-tap-arrow"></span>
          </div>
          <div className="double-tap-text">10 сек</div>
        </div>
      )}

      {/* Center Play/Pause Indicator (toggles opacity momentarily) */}
      {isActive && !errorMsg && !loading && !buffering && !isPlaying && (
        <div className="player-center-play-btn-wrap" onClick={togglePlay}>
          <button 
            className="player-center-play-btn paused" 
            aria-label="Play"
          >
            ▶
          </button>
        </div>
      )}

      {/* Cinematic Control Bar */}
      {isActive && !errorMsg && !loading && (
        <div 
          className={`player-control-bar ${showControls ? 'visible' : ''}`}
          onClick={(e) => e.stopPropagation()}
          onTouchStart={(e) => e.stopPropagation()}
          onTouchEnd={(e) => e.stopPropagation()}
        >
          {/* Timeline / Progress Bar (Seek Bar) */}
          <div className="player-timeline-container" onClick={(e) => e.stopPropagation()}>
            {!isLive && duration > 0 ? (
              <div className="player-timeline-slider-wrapper" onClick={(e) => e.stopPropagation()}>
                <input
                  ref={timelineSliderRef}
                  type="range"
                  min={0}
                  max={duration}
                  step={0.1}
                  defaultValue={0}
                  onChange={handleSeekChange}
                  onClick={(e) => e.stopPropagation()}
                  onTouchStart={(e) => e.stopPropagation()}
                  onTouchEnd={(e) => e.stopPropagation()}
                  className="player-timeline-slider"
                />
              </div>
            ) : (
              <div className="player-timeline-live-placeholder">
                <span className="live-indicator-dot" />
                <span className="live-indicator-text">ПРЯМОЙ ЭФИР</span>
              </div>
            )}
          </div>

          {/* Bottom row of controls */}
          <div className="player-controls-row" onClick={(e) => e.stopPropagation()}>
            {/* Left side: Play, Volume, Time */}
            <div className="player-controls-left">
              <button
                onClick={(e) => { e.stopPropagation(); togglePlay(); }}
                onTouchStart={(e) => e.stopPropagation()}
                onTouchEnd={(e) => e.stopPropagation()}
                className="control-btn-bar"
                title={isPlaying ? 'Пауза' : 'Воспроизвести'}
              >
                {isPlaying ? (
                  <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/></svg>
                ) : (
                  <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>
                )}
              </button>

              <div className="player-volume-control" onClick={(e) => e.stopPropagation()}>
                <button
                  onClick={(e) => { e.stopPropagation(); onToggleMute(); }}
                  onTouchStart={(e) => e.stopPropagation()}
                  onTouchEnd={(e) => e.stopPropagation()}
                  className="control-btn-bar"
                  title={muted ? 'Включить звук' : 'Выключить звук'}
                >
                  {muted || volume === 0 ? (
                    <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M16.5 12c0-1.77-1.02-3.29-2.5-4.03v2.21l2.45 2.45c.03-.21.05-.42.05-.63zm2.5 0c0 .94-.2 1.82-.54 2.64l1.51 1.51C20.63 14.91 21 13.5 21 12c0-4.28-2.99-7.86-7-8.77v2.06c2.89.86 5 3.54 5 6.71zM4.27 3L3 4.27 7.73 9H3v6h4l5 5v-6.73l4.25 4.25c-.67.52-1.42.93-2.25 1.18v2.06c1.38-.31 2.63-.95 3.69-1.81L19.73 21 21 19.73l-9-9L4.27 3zM12 4L9.91 6.09 12 8.18V4z"/></svg>
                  ) : (
                    <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z"/></svg>
                  )}
                </button>
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.01}
                  value={muted ? 0 : volume}
                  onChange={handleVolumeChange}
                  onClick={(e) => e.stopPropagation()}
                  onTouchStart={(e) => e.stopPropagation()}
                  onTouchEnd={(e) => e.stopPropagation()}
                  className="player-volume-slider"
                />
              </div>

              {!isLive && duration > 0 && (
                <div className="player-time-display">
                  <span ref={timeCurrentRef} className="time-current">00:00</span>
                  <span className="time-separator">/</span>
                  <span className="time-duration">{formatTime(duration)}</span>
                </div>
              )}
            </div>

            {/* Right side: Quality, Fullscreen */}
            <div className="player-controls-right">
              {/* Quality Selector */}
              {levels.length > 0 && (
                <div className="player-quality-selector-wrap" onClick={(e) => e.stopPropagation()}>
                  <button
                    onClick={(e) => { e.stopPropagation(); setQualityMenuOpen(!qualityMenuOpen); }}
                    onTouchStart={(e) => e.stopPropagation()}
                    onTouchEnd={(e) => e.stopPropagation()}
                    className={`control-btn-bar ${qualityMenuOpen ? 'btn-active' : ''}`}
                    title="Выбор качества"
                  >
                    <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M19.14 12.94c.04-.3.06-.61.06-.94 0-.32-.02-.64-.07-.94l2.03-1.58c.18-.14.23-.41.12-.61l-1.92-3.32c-.12-.22-.37-.29-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54c-.04-.24-.24-.41-.48-.41h-3.84c-.24 0-.43.17-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96c-.22-.08-.47 0-.59.22L2.74 8.87c-.12.21-.08.47.12.61l2.03 1.58c-.05.3-.09.63-.09.94s.02.64.07.94l-2.03 1.58c-.18.14-.23.41-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.22.07-.47-.12-.61l-2.01-1.58zM12 15.6c-1.98 0-3.6-1.62-3.6-3.6s1.62-3.6 3.6-3.6 3.6 1.62 3.6 3.6-1.62 3.6-3.6 3.6z"/></svg>
                    <span style={{ fontSize: '0.75rem', marginLeft: '4px', fontWeight: 'bold' }}>
                      {currentLevel === -1 ? 'Авто' : levels.find(l => l.index === currentLevel)?.name || ''}
                    </span>
                  </button>
                  {qualityMenuOpen && (
                    <div className="player-quality-menu" onClick={(e) => e.stopPropagation()}>
                      {levels.map((lvl) => {
                        const isSelected = lvl.index === currentLevel;
                        return (
                          <button
                            key={lvl.index}
                            onClick={(e) => {
                              e.stopPropagation();
                              if (hlsRef.current) {
                                hlsRef.current.currentLevel = lvl.index;
                                setCurrentLevel(lvl.index);
                              }
                              setQualityMenuOpen(false);
                            }}
                            onTouchStart={(e) => e.stopPropagation()}
                            onTouchEnd={(e) => e.stopPropagation()}
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
                onClick={(e) => { e.stopPropagation(); handleFullscreen(); }}
                onTouchStart={(e) => e.stopPropagation()}
                onTouchEnd={(e) => e.stopPropagation()}
                className="control-btn-bar"
                title="Во весь экран"
              >
                <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor">
                  <path d="M7 14H5v5h5v-2H7v-3zm-2-4h2V7h3V5H5v5zm12 7h-3v2h5v-5h-2v3zM14 5v2h3v3h2V5h-5z"/>
                </svg>
              </button>
            </div>
          </div>
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

