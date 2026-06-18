'use client';

import { useState, useCallback, useEffect, useRef } from 'react';
import { Channel, ChannelCategory } from '@/lib/types';
import ChannelPlayer from './ChannelPlayer';
import ChannelOverlay from './ChannelOverlay';
import FilterSheet from './FilterSheet';
import { parseM3U } from '@/lib/m3u-parser';

interface ChannelFeedProps {
  initialChannels: Channel[];
  categories: ChannelCategory[];
}

type TabType = 'all' | 'favorites' | 'history' | 'custom';

export default function ChannelFeed({ initialChannels, categories }: ChannelFeedProps) {
  const [channels, setChannels] = useState<Channel[]>(initialChannels);
  const [activeIndex, setActiveIndex] = useState(0);
  const [activeTab, setActiveTab] = useState<TabType>('all');
  
  // Advanced Filter states
  const [activeCategory, setActiveCategory] = useState('f1');
  const [activeLanguage, setActiveLanguage] = useState('all');
  const [activeCountry, setActiveCountry] = useState('all');
  const [searchQuery, setSearchQuery] = useState('');
  
  // Lists loaded from API
  const [languages, setLanguages] = useState<{ code: string; name: string; count: number }[]>([]);
  const [countries, setCountries] = useState<{ code: string; name: string; count: number }[]>([]);
  
  // LocalStorage lists
  const [favorites, setFavorites] = useState<Channel[]>([]);
  const [history, setHistory] = useState<Channel[]>([]);
  const [customChannels, setCustomChannels] = useState<Channel[]>([]);

  // UI state
  const [muted, setMuted] = useState(true);
  const [overlayVisible, setOverlayVisible] = useState(true);
  const [loading, setLoading] = useState(false);
  const [totalChannels, setTotalChannels] = useState(initialChannels.length);
  const [filterOpen, setFilterOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  
  // Iteration 3 & 4 states
  const [autoSwitch, setAutoSwitch] = useState(false);
  const [forceProxy, setForceProxy] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [m3uModalOpen, setM3uModalOpen] = useState(false);
  const [m3uUrl, setM3uUrl] = useState('');
  const [m3uError, setM3uError] = useState<string | null>(null);
  const [m3uFileLoading, setM3uFileLoading] = useState(false);
  const [sidebarHidden, setSidebarHidden] = useState(false);

  const overlayTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const searchTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pageRef = useRef(1);
  const hasMoreRef = useRef(true);

  // Sync favorites, history, custom channels & options on mount
  useEffect(() => {
    const savedFavs = localStorage.getItem('amadeus_favorites');
    const savedHist = localStorage.getItem('amadeus_history');
    const savedCustom = localStorage.getItem('amadeus_custom_channels');
    const savedAutoSwitch = localStorage.getItem('amadeus_autoswitch');
    const savedForceProxy = localStorage.getItem('amadeus_forceproxy');
    
    if (savedFavs) setFavorites(JSON.parse(savedFavs));
    if (savedHist) setHistory(JSON.parse(savedHist));
    if (savedCustom) setCustomChannels(JSON.parse(savedCustom));
    if (savedAutoSwitch) setAutoSwitch(savedAutoSwitch === 'true');
    if (savedForceProxy) setForceProxy(savedForceProxy === 'true');
  }, []);

  // Fetch channels from API
  const fetchChannels = useCallback(async (
    category: string,
    language: string,
    country: string,
    search: string,
    page: number,
    append: boolean = false
  ) => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      params.set('action', 'list');
      if (category !== 'all') params.set('category', category);
      if (language !== 'all') params.set('language', language);
      if (country !== 'all') params.set('country', country);
      if (search) params.set('search', search);
      params.set('page', String(page));
      params.set('limit', '40');

      const res = await fetch(`/api/channels?${params}`);
      const data = await res.json();

      setTotalChannels(data.total || data.channels.length);
      if (append) {
        setChannels(prev => [...prev, ...data.channels]);
      } else {
        setChannels(data.channels);
        setActiveIndex(0);
      }
      hasMoreRef.current = data.hasMore;
    } catch (err) {
      console.error('Failed to fetch channels:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  // Fetch meta options (languages and countries)
  const fetchMeta = useCallback(async (category: string) => {
    try {
      const langParams = new URLSearchParams({ action: 'languages' });
      if (category !== 'all') langParams.set('category', category);
      const langRes = await fetch(`/api/channels?${langParams}`);
      const langData = await langRes.json();
      setLanguages(langData.languages || []);

      const countryParams = new URLSearchParams({ action: 'countries' });
      if (category !== 'all') countryParams.set('category', category);
      const countryRes = await fetch(`/api/channels?${countryParams}`);
      const countryData = await countryRes.json();
      setCountries(countryData.countries || []);
    } catch (err) {
      console.error('Failed to fetch meta parameters:', err);
    }
  }, []);

  // Initial load: fetch global meta
  useEffect(() => {
    fetchMeta('all');
  }, [fetchMeta]);

  // Handle category/language/country updates
  const handleCategoryChange = (slug: string) => {
    setActiveCategory(slug);
    setActiveLanguage('all');
    setActiveCountry('all');
    pageRef.current = 1;
    fetchChannels(slug, 'all', 'all', searchQuery, 1);
  };

  const handleLanguageChange = (code: string) => {
    setActiveLanguage(code);
    pageRef.current = 1;
    fetchChannels(activeCategory, code, activeCountry, searchQuery, 1);
  };

  const handleCountryChange = (code: string) => {
    setActiveCountry(code);
    pageRef.current = 1;
    fetchChannels(activeCategory, activeLanguage, code, searchQuery, 1);
  };

  const handleSearchChange = (query: string) => {
    setSearchQuery(query);
    pageRef.current = 1;
    
    if (searchTimeoutRef.current) {
      clearTimeout(searchTimeoutRef.current);
    }
    
    if (activeTab === 'all') {
      searchTimeoutRef.current = setTimeout(() => {
        fetchChannels(activeCategory, activeLanguage, activeCountry, query, 1);
      }, 400);
    }
  };

  const handleResetFilters = () => {
    setActiveCategory('all');
    setActiveLanguage('all');
    setActiveCountry('all');
    setSearchQuery('');
    pageRef.current = 1;
    fetchChannels('all', 'all', 'all', '', 1);
  };

  const handleLoadMore = () => {
    if (hasMoreRef.current && !loading) {
      pageRef.current++;
      fetchChannels(activeCategory, activeLanguage, activeCountry, searchQuery, pageRef.current, true);
    }
  };

  // Switch channels
  const handleSelectChannel = (channel: Channel, index: number) => {
    setActiveIndex(index);
    showOverlay();

    // Add to history
    setHistory(prev => {
      const filtered = prev.filter(c => c.id !== channel.id);
      const updated = [channel, ...filtered].slice(0, 50); // limit to 50
      localStorage.setItem('amadeus_history', JSON.stringify(updated));
      return updated;
    });
  };

  const handleNextChannel = () => {
    const activeList = getActiveList();
    if (activeIndex < activeList.length - 1) {
      handleSelectChannel(activeList[activeIndex + 1], activeIndex + 1);
    }
  };

  const handleRetryChannel = () => {
    setReloadKey(prev => prev + 1);
  };

  const handleToggleAutoSwitch = () => {
    const nextVal = !autoSwitch;
    setAutoSwitch(nextVal);
    localStorage.setItem('amadeus_autoswitch', nextVal ? 'true' : 'false');
  };

  const handleToggleForceProxy = () => {
    const nextVal = !forceProxy;
    setForceProxy(nextVal);
    localStorage.setItem('amadeus_forceproxy', nextVal ? 'true' : 'false');
  };

  const handleImportM3U = async (text: string) => {
    setM3uFileLoading(true);
    setM3uError(null);
    try {
      const parsed = parseM3U(text);
      if (parsed.length === 0) {
        throw new Error('В плейлисте не найдено корректных каналов. Проверьте формат.');
      }
      setCustomChannels(parsed);
      localStorage.setItem('amadeus_custom_channels', JSON.stringify(parsed));
      setActiveTab('custom');
      setActiveIndex(0);
      setM3uModalOpen(false);
      setM3uUrl('');
    } catch (err) {
      setM3uError(err instanceof Error ? err.message : 'Ошибка при импорте');
    } finally {
      setM3uFileLoading(false);
    }
  };

  const handleImportM3UFromUrl = async () => {
    if (!m3uUrl) return;
    setM3uFileLoading(true);
    setM3uError(null);
    try {
      const encoded = encodeURIComponent(m3uUrl);
      const res = await fetch(`/api/stream?url=${encoded}`);
      if (!res.ok) {
        throw new Error(`Ошибка скачивания плейлиста: ${res.status}`);
      }
      const text = await res.text();
      await handleImportM3U(text);
    } catch (err) {
      setM3uError(err instanceof Error ? err.message : 'Ошибка при скачивании плейлиста');
    } finally {
      setM3uFileLoading(false);
    }
  };

  const handleImportM3UFromFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async (event) => {
      const text = event.target?.result as string;
      if (text) {
        await handleImportM3U(text);
      }
    };
    reader.readAsText(file);
  };

  const handleClearCustomChannels = () => {
    setCustomChannels([]);
    localStorage.removeItem('amadeus_custom_channels');
    if (activeTab === 'custom') {
      setActiveTab('all');
      setActiveIndex(0);
    }
  };

  // Auto-switch to next channel on error (only if autoSwitch is enabled)
  const handleChannelError = useCallback((failedChannel: Channel) => {
    console.log(`Channel "${failedChannel.name}" failed.`);
    if (autoSwitch) {
      setTimeout(() => {
        const activeList = getActiveList();
        if (activeIndex < activeList.length - 1) {
          handleSelectChannel(activeList[activeIndex + 1], activeIndex + 1);
        }
      }, 3000);
    }
  }, [activeIndex, favorites, history, channels, activeTab, autoSwitch]);

  const toggleFavorite = (channel: Channel) => {
    setFavorites(prev => {
      const exists = prev.some(c => c.id === channel.id);
      let updated;
      if (exists) {
        updated = prev.filter(c => c.id !== channel.id);
      } else {
        updated = [...prev, channel];
      }
      localStorage.setItem('amadeus_favorites', JSON.stringify(updated));
      return updated;
    });
  };

  const showOverlay = useCallback(() => {
    setOverlayVisible(true);
    if (overlayTimerRef.current) clearTimeout(overlayTimerRef.current);
    overlayTimerRef.current = setTimeout(() => setOverlayVisible(false), 4000);
  }, []);

  useEffect(() => {
    return () => {
      if (overlayTimerRef.current) clearTimeout(overlayTimerRef.current);
      if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current);
    };
  }, []);

  const getActiveList = (): Channel[] => {
    if (activeTab === 'favorites') {
      return searchQuery 
        ? favorites.filter(c => c.name.toLowerCase().includes(searchQuery.toLowerCase())) 
        : favorites;
    }
    if (activeTab === 'history') {
      return searchQuery 
        ? history.filter(c => c.name.toLowerCase().includes(searchQuery.toLowerCase())) 
        : history;
    }
    if (activeTab === 'custom') {
      return searchQuery 
        ? customChannels.filter(c => c.name.toLowerCase().includes(searchQuery.toLowerCase())) 
        : customChannels;
    }
    return channels;
  };

  const activeList = getActiveList();
  const currentChannel = activeList[activeIndex];
  const isCurrentFavorite = currentChannel ? favorites.some(c => c.id === currentChannel.id) : false;

  return (
    <div className={`wide-player-layout ${sidebarHidden ? 'sidebar-hidden' : ''}`}>
      {/* Ambient background glow */}
      <div className="ambient-glow-bg" />
      {/* 1. Main player area */}
      <div className="main-player-section">
        {sidebarHidden && (
          <button 
            className="restore-sidebar-btn"
            onClick={() => setSidebarHidden(false)}
            title="Показать список каналов"
          >
            📑 Список каналов
          </button>
        )}
        {currentChannel ? (
          <div className="player-wrapper" onClick={showOverlay}>
            <ChannelPlayer
              key={`${currentChannel.id}-${reloadKey}`}
              channel={currentChannel}
              isActive={true}
              onError={handleChannelError}
              onReady={() => showOverlay()}
              muted={muted}
              onToggleMute={() => setMuted(!muted)}
              onNextChannel={handleNextChannel}
              onRetry={handleRetryChannel}
              autoSwitch={autoSwitch}
              forceProxy={forceProxy}
            />
            <ChannelOverlay
              channel={currentChannel}
              visible={overlayVisible}
            />
            {/* Action Overlay: Favorite Toggle and Back to List buttons */}
            {overlayVisible && (
              <div className="player-actions-overlay">
                <button
                  className={`fav-btn-toggle ${isCurrentFavorite ? 'fav-active' : ''}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    toggleFavorite(currentChannel);
                  }}
                  title={isCurrentFavorite ? 'Убрать из избранного' : 'Добавить в избранное'}
                >
                  {isCurrentFavorite ? '★' : '☆'}
                </button>
              </div>
            )}
          </div>
        ) : (
          <div className="empty-player-placeholder">
            <div className="empty-icon">📺</div>
            <p>Выберите канал для начала просмотра</p>
          </div>
        )}
      </div>

      {/* 2. Channels & search sidebar */}
      <div className="sidebar-section">
        <div className="sidebar-header">
          <div className="brand-title">
            <span className="logo-amadeus">Amadeus</span>
            <span className="logo-tv">TV</span>
            <span className="logo-mn">by MN</span>
          </div>
          <div className="sidebar-actions">
            <button
              className={`action-btn-circle ${m3uModalOpen ? 'btn-active' : ''}`}
              onClick={() => setM3uModalOpen(true)}
              title="Импортировать M3U плейлист"
            >
              📁
            </button>
            <button
              className={`action-btn-circle ${searchOpen ? 'btn-active' : ''}`}
              onClick={() => setSearchOpen(!searchOpen)}
              title="Поиск"
            >
              🔍
            </button>
            <button
              className={`action-btn-circle ${filterOpen ? 'btn-active' : ''}`}
              onClick={() => setFilterOpen(true)}
              title="Фильтры и Настройки"
            >
              🎛️
            </button>
            <button
              className="action-btn-circle"
              onClick={() => setSidebarHidden(true)}
              title="Скрыть список каналов"
            >
              ✕
            </button>
          </div>
        </div>

        {/* Search Input */}
        {searchOpen && (
          <div className="sidebar-search-box">
            <input
              type="text"
              placeholder="Поиск по названию..."
              value={searchQuery}
              onChange={(e) => handleSearchChange(e.target.value)}
              className="search-input-field"
              autoFocus
            />
            {searchQuery && (
              <button className="search-clear-btn" onClick={() => handleSearchChange('')}>
                ✕
              </button>
            )}
          </div>
        )}

        {/* Tab Selection */}
        <div className="sidebar-tabs">
          <button
            className={`tab-item ${activeTab === 'all' ? 'tab-active' : ''}`}
            onClick={() => {
              setActiveTab('all');
              setActiveIndex(0);
            }}
          >
            📡 База
          </button>
          {customChannels.length > 0 && (
            <button
              className={`tab-item ${activeTab === 'custom' ? 'tab-active' : ''}`}
              onClick={() => {
                setActiveTab('custom');
                setActiveIndex(0);
              }}
            >
              📂 Мой M3U ({customChannels.length})
            </button>
          )}
          <button
            className={`tab-item ${activeTab === 'favorites' ? 'tab-active' : ''}`}
            onClick={() => {
              setActiveTab('favorites');
              setActiveIndex(0);
            }}
          >
            ★ Избранное ({favorites.length})
          </button>
          <button
            className={`tab-item ${activeTab === 'history' ? 'tab-active' : ''}`}
            onClick={() => {
              setActiveTab('history');
              setActiveIndex(0);
            }}
          >
            🕒 История
          </button>
        </div>

        {/* Quick Category scroll if on "All" tab */}
        {activeTab === 'all' && (
          <div className="sidebar-categories">
            <button
              className={`category-tag ${activeCategory === 'all' ? 'cat-active' : ''}`}
              onClick={() => handleCategoryChange('all')}
            >
              Все
            </button>
            {categories.map(cat => (
              <button
                key={cat.slug}
                className={`category-tag ${activeCategory === cat.slug ? 'cat-active' : ''}`}
                onClick={() => handleCategoryChange(cat.slug)}
              >
                {cat.icon} {cat.nameRu}
              </button>
            ))}
          </div>
        )}

        {/* Channel List Container */}
        <div className="channel-list-container">
          {activeTab === 'custom' && customChannels.length > 0 && (
            <div className="custom-playlist-actions">
              <button onClick={handleClearCustomChannels} className="clear-playlist-btn">
                🗑️ Очистить плейлист
              </button>
            </div>
          )}

          {loading && activeList.length === 0 ? (
            <div className="sidebar-status-container">
              <div className="loading-spinner" />
              <p>Загрузка каналов...</p>
            </div>
          ) : activeList.length > 0 ? (
            <>
              <div className="list-items-wrapper">
                {activeList.map((ch, idx) => {
                  const isFav = favorites.some(fav => fav.id === ch.id);
                  const isSelected = currentChannel && ch.id === currentChannel.id;
                  return (
                    <div
                      key={`${ch.id}-${idx}`}
                      className={`channel-item-card ${isSelected ? 'item-selected' : ''}`}
                      onClick={() => handleSelectChannel(ch, idx)}
                    >
                      {ch.logo ? (
                        <img src={ch.logo} alt="" className="channel-item-logo" loading="lazy" />
                      ) : (
                        <div className="channel-item-logo-placeholder">📡</div>
                      )}
                      <div className="channel-item-details">
                        <div className="channel-item-name">{ch.name}</div>
                        <div className="channel-item-meta">
                          {ch.group && (
                            <span className="meta-badge badge-category">
                              {categories.find(c => c.slug === ch.group)?.nameRu || ch.group}
                            </span>
                          )}
                          {ch.country && (
                            <span className="meta-badge badge-country">
                              {ch.country.toUpperCase()}
                            </span>
                          )}
                        </div>
                      </div>
                      <button
                        className={`item-fav-toggle-btn ${isFav ? 'item-fav-active' : ''}`}
                        onClick={(e) => {
                          e.stopPropagation();
                          toggleFavorite(ch);
                        }}
                      >
                        {isFav ? '★' : '☆'}
                      </button>
                    </div>
                  );
                })}
              </div>

              {/* Load More Button */}
              {activeTab === 'all' && hasMoreRef.current && (
                <button
                  onClick={handleLoadMore}
                  disabled={loading}
                  className="load-more-button"
                >
                  {loading ? 'Загрузка...' : 'Показать еще каналы'}
                </button>
              )}
            </>
          ) : (
            <div className="sidebar-status-container">
              <div className="empty-state-icon">📡</div>
              <p>Каналы не найдены</p>
              <p className="empty-state-subtext">Попробуйте изменить параметры поиска или импортировать плейлист</p>
            </div>
          )}
        </div>
      </div>

      {/* Advanced Filter Modal */}
      <FilterSheet
        isOpen={filterOpen}
        onClose={() => setFilterOpen(false)}
        categories={categories}
        activeCategory={activeCategory}
        onCategoryChange={handleCategoryChange}
        languages={languages}
        activeLanguage={activeLanguage}
        onLanguageChange={handleLanguageChange}
        countries={countries}
        activeCountry={activeCountry}
        onCountryChange={handleCountryChange}
        onReset={handleResetFilters}
        autoSwitch={autoSwitch}
        onToggleAutoSwitch={handleToggleAutoSwitch}
        forceProxy={forceProxy}
        onToggleForceProxy={handleToggleForceProxy}
      />

      {/* M3U Playlist Import Modal */}
      {m3uModalOpen && (
        <div className="m3u-modal-overlay" onClick={() => setM3uModalOpen(false)}>
          <div className="m3u-modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="m3u-modal-header">
              <h3>📁 Импорт своего M3U плейлиста</h3>
              <button onClick={() => setM3uModalOpen(false)} className="m3u-modal-close">✕</button>
            </div>
            <div className="m3u-modal-body">
              <p className="m3u-modal-desc">
                Вы можете загрузить локальный файл плейлиста `.m3u` / `.m3u8` или указать прямую ссылку на него. Все данные обрабатываются на вашем устройстве.
              </p>
              
              <div className="m3u-modal-field">
                <label className="m3u-field-label">Прямой URL плейлиста</label>
                <div className="m3u-url-input-wrap">
                  <input
                    type="text"
                    placeholder="https://example.com/playlist.m3u"
                    value={m3uUrl}
                    onChange={(e) => setM3uUrl(e.target.value)}
                    disabled={m3uFileLoading}
                    className="m3u-input-text"
                  />
                  <button
                    onClick={handleImportM3UFromUrl}
                    disabled={m3uFileLoading || !m3uUrl}
                    className="m3u-btn-import-url"
                  >
                    {m3uFileLoading ? 'Загрузка...' : 'Скачать'}
                  </button>
                </div>
              </div>

              <div className="m3u-modal-divider"><span>или</span></div>

              <div className="m3u-modal-field">
                <label className="m3u-field-label">Выбрать локальный файл M3U</label>
                <input
                  type="file"
                  accept=".m3u,.m3u8"
                  onChange={handleImportM3UFromFile}
                  disabled={m3uFileLoading}
                  className="m3u-input-file"
                />
              </div>

              {m3uError && <p className="m3u-modal-error">⚠️ {m3uError}</p>}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
