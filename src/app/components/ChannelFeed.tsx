'use client';

import { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import { Channel, ChannelCategory, normalizeLanguage, normalizeCountry } from '@/lib/types';
import ChannelPlayer from './ChannelPlayer';
import ChannelOverlay from './ChannelOverlay';
import FilterSheet from './FilterSheet';

interface ChannelFeedProps {
  initialChannels: Channel[];
  categories: ChannelCategory[];
}

type TabType = 'all' | 'favorites' | 'history';

export default function ChannelFeed({ initialChannels, categories }: ChannelFeedProps) {
  const [channels, setChannels] = useState<Channel[]>(initialChannels);
  const [activeIndex, setActiveIndex] = useState(0);
  const [activeTab, setActiveTab] = useState<TabType>('all');
  
  // Advanced Filter states
  const [activeCategory, setActiveCategory] = useState('f1');
  const [activeLanguage, setActiveLanguage] = useState('all');
  const [activeCountry, setActiveCountry] = useState('all');
  const [searchQuery, setSearchQuery] = useState('');
  
  // Client-side caching database for 0ms lag
  const [allChannels, setAllChannels] = useState<Channel[]>([]);
  const [isLoaded, setIsLoaded] = useState(false);
  const [clientPage, setClientPage] = useState(1);

  // Lists loaded from API as fallback
  const [languagesState, setLanguagesState] = useState<{ code: string; name: string; count: number }[]>([]);
  const [countriesState, setCountriesState] = useState<{ code: string; name: string; count: number }[]>([]);
  
  // LocalStorage lists
  const [favorites, setFavorites] = useState<Channel[]>([]);
  const [history, setHistory] = useState<Channel[]>([]);

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
  const [sidebarHidden, setSidebarHidden] = useState(false);

  const overlayTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const searchTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pageRef = useRef(1);
  const hasMoreRef = useRef(true);

  // Compute languages and countries locally if the database is loaded
  const languages = useMemo(() => {
    if (!isLoaded || allChannels.length === 0) {
      return languagesState;
    }
    let filtered = allChannels;
    if (activeCategory !== 'all') {
      filtered = filtered.filter(ch => ch.group === activeCategory);
    }
    const langCounts = new Map<string, number>();
    for (const ch of filtered) {
      const code = ch.langCode || 'xx';
      langCounts.set(code, (langCounts.get(code) || 0) + 1);
    }
    return Array.from(langCounts.entries())
      .map(([code, count]) => ({
        code,
        name: normalizeLanguage(code),
        count,
      }))
      .sort((a, b) => {
        if (a.code === 'ru') return -1;
        if (b.code === 'ru') return 1;
        if (a.code === 'en') return -1;
        if (b.code === 'en') return 1;
        return b.count - a.count;
      });
  }, [isLoaded, allChannels, activeCategory, languagesState]);

  const countries = useMemo(() => {
    if (!isLoaded || allChannels.length === 0) {
      return countriesState;
    }
    let filtered = allChannels;
    if (activeCategory !== 'all') {
      filtered = filtered.filter(ch => ch.group === activeCategory);
    }
    const countryCounts = new Map<string, number>();
    for (const ch of filtered) {
      const code = ch.country?.toLowerCase() || '';
      if (!code) continue;
      countryCounts.set(code, (countryCounts.get(code) || 0) + 1);
    }
    return Array.from(countryCounts.entries())
      .map(([code, count]) => ({
        code,
        name: normalizeCountry(code),
        count,
      }))
      .sort((a, b) => {
        if (a.code === 'ru') return -1;
        if (b.code === 'ru') return 1;
        if (a.code === 'us') return -1;
        if (b.code === 'us') return 1;
        if (a.code === 'gb') return -1;
        if (b.code === 'gb') return 1;
        return b.count - a.count;
      });
  }, [isLoaded, allChannels, activeCategory, countriesState]);

  // Locally filtered channels
  const clientFilteredChannels = useMemo(() => {
    if (!isLoaded || allChannels.length === 0) return [];
    let filtered = allChannels;

    if (activeCategory !== 'all') {
      filtered = filtered.filter(ch => ch.group === activeCategory);
    }
    if (activeLanguage !== 'all') {
      filtered = filtered.filter(ch => ch.langCode === activeLanguage);
    }
    if (activeCountry !== 'all') {
      filtered = filtered.filter(ch => ch.country?.toLowerCase() === activeCountry.toLowerCase());
    }
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      filtered = filtered.filter(ch => ch.name.toLowerCase().includes(q));
    }

    // Sort Russian first, then by name
    return [...filtered].sort((a, b) => {
      const aRu = a.langCode === 'ru' ? 0 : 1;
      const bRu = b.langCode === 'ru' ? 0 : 1;
      if (aRu !== bRu) return aRu - bRu;
      return a.name.localeCompare(b.name);
    });
  }, [isLoaded, allChannels, activeCategory, activeLanguage, activeCountry, searchQuery]);

  // Displayed channels under Tab 'all'
  const displayedAllChannels = useMemo(() => {
    if (!isLoaded) {
      return channels;
    }
    return clientFilteredChannels.slice(0, clientPage * 40);
  }, [isLoaded, channels, clientFilteredChannels, clientPage]);

  // Pagination flag
  const hasMore = isLoaded 
    ? (clientPage * 40) < clientFilteredChannels.length 
    : hasMoreRef.current;

  // Sync favorites, history, custom channels & options on mount
  useEffect(() => {
    const savedFavs = localStorage.getItem('amadeus_favorites');
    const savedHist = localStorage.getItem('amadeus_history');
    const savedAutoSwitch = localStorage.getItem('amadeus_autoswitch');
    const savedForceProxy = localStorage.getItem('amadeus_forceproxy');
    
    if (savedFavs) setFavorites(JSON.parse(savedFavs));
    if (savedHist) setHistory(JSON.parse(savedHist));
    if (savedAutoSwitch) setAutoSwitch(savedAutoSwitch === 'true');
    if (savedForceProxy) setForceProxy(savedForceProxy === 'true');
  }, []);

  // Load entire channel database in background for offline instant filtering
  useEffect(() => {
    async function loadAllChannels() {
      try {
        const res = await fetch('/api/channels?action=all');
        if (!res.ok) throw new Error(`HTTP error! status: ${res.status}`);
        const data = await res.json();
        if (data.channels && Array.isArray(data.channels)) {
          setAllChannels(data.channels);
          setIsLoaded(true);
        }
      } catch (err) {
        console.error('Failed to load all channels in background:', err);
      }
    }
    loadAllChannels();
  }, []);

  // Fetch channels from API (fallback before background cache is loaded)
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

  // Fetch meta options (languages and countries) (fallback)
  const fetchMeta = useCallback(async (category: string) => {
    try {
      const langParams = new URLSearchParams({ action: 'languages' });
      if (category !== 'all') langParams.set('category', category);
      const langRes = await fetch(`/api/channels?${langParams}`);
      const langData = await langRes.json();
      setLanguagesState(langData.languages || []);

      const countryParams = new URLSearchParams({ action: 'countries' });
      if (category !== 'all') countryParams.set('category', category);
      const countryRes = await fetch(`/api/channels?${countryParams}`);
      const countryData = await countryRes.json();
      setCountriesState(countryData.countries || []);
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
    
    if (isLoaded) {
      setClientPage(1);
      setActiveIndex(0);
    } else {
      pageRef.current = 1;
      fetchChannels(slug, 'all', 'all', searchQuery, 1);
    }
  };

  const handleLanguageChange = (code: string) => {
    setActiveLanguage(code);
    
    if (isLoaded) {
      setClientPage(1);
      setActiveIndex(0);
    } else {
      pageRef.current = 1;
      fetchChannels(activeCategory, code, activeCountry, searchQuery, 1);
    }
  };

  const handleCountryChange = (code: string) => {
    setActiveCountry(code);
    
    if (isLoaded) {
      setClientPage(1);
      setActiveIndex(0);
    } else {
      pageRef.current = 1;
      fetchChannels(activeCategory, activeLanguage, code, searchQuery, 1);
    }
  };

  const handleSearchChange = (query: string) => {
    setSearchQuery(query);
    
    if (isLoaded) {
      setClientPage(1);
      setActiveIndex(0);
    } else {
      pageRef.current = 1;
      
      if (searchTimeoutRef.current) {
        clearTimeout(searchTimeoutRef.current);
      }
      
      if (activeTab === 'all') {
        searchTimeoutRef.current = setTimeout(() => {
          fetchChannels(activeCategory, activeLanguage, activeCountry, query, 1);
        }, 400);
      }
    }
  };

  const handleResetFilters = () => {
    setActiveCategory('all');
    setActiveLanguage('all');
    setActiveCountry('all');
    setSearchQuery('');
    
    if (isLoaded) {
      setClientPage(1);
      setActiveIndex(0);
    } else {
      pageRef.current = 1;
      fetchChannels('all', 'all', 'all', '', 1);
    }
  };

  const handleLoadMore = () => {
    if (isLoaded) {
      setClientPage(prev => prev + 1);
    } else {
      if (hasMoreRef.current && !loading) {
        pageRef.current++;
        fetchChannels(activeCategory, activeLanguage, activeCountry, searchQuery, pageRef.current, true);
      }
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
  }, [activeIndex, favorites, history, activeTab, autoSwitch]);

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
    return displayedAllChannels;
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
            <span className="logo-amadeus">Amadeus TV</span>
            <span className="logo-tv"> by MN</span>
          </div>
          <div className="sidebar-actions">
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
              {activeTab === 'all' && hasMore && (
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
    </div>
  );
}
