'use client';

import { useState, useCallback, useEffect, useRef } from 'react';
import { Channel, ChannelCategory } from '@/lib/types';
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
  
  // Lists loaded from API
  const [languages, setLanguages] = useState<{ code: string; name: string; count: number }[]>([]);
  const [countries, setCountries] = useState<{ code: string; name: string; count: number }[]>([]);
  
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

  const overlayTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pageRef = useRef(1);
  const hasMoreRef = useRef(true);

  // Sync favorites & history on mount
  useEffect(() => {
    const savedFavs = localStorage.getItem('amadeus_favorites');
    const savedHist = localStorage.getItem('amadeus_history');
    if (savedFavs) setFavorites(JSON.parse(savedFavs));
    if (savedHist) setHistory(JSON.parse(savedHist));
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

  // Initial load: F1 category meta
  useEffect(() => {
    fetchMeta('f1');
  }, [fetchMeta]);

  // Handle category/language/country updates
  const handleCategoryChange = (slug: string) => {
    setActiveCategory(slug);
    setActiveLanguage('all');
    setActiveCountry('all');
    pageRef.current = 1;
    fetchChannels(slug, 'all', 'all', searchQuery, 1);
    fetchMeta(slug);
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
    if (activeTab === 'all') {
      fetchChannels(activeCategory, activeLanguage, activeCountry, query, 1);
    }
  };

  const handleResetFilters = () => {
    setActiveCategory('all');
    setActiveLanguage('all');
    setActiveCountry('all');
    setSearchQuery('');
    pageRef.current = 1;
    fetchChannels('all', 'all', 'all', '', 1);
    fetchMeta('all');
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

  // Auto-switch to next channel on error
  const handleChannelError = useCallback((failedChannel: Channel) => {
    console.log(`Channel "${failedChannel.name}" failed, auto-switching...`);
    setTimeout(() => {
      const activeList = getActiveList();
      if (activeIndex < activeList.length - 1) {
        handleSelectChannel(activeList[activeIndex + 1], activeIndex + 1);
      }
    }, 1500);
  }, [activeIndex, favorites, history, channels, activeTab]);

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
    return channels;
  };

  const activeList = getActiveList();
  const currentChannel = activeList[activeIndex];
  const isCurrentFavorite = currentChannel ? favorites.some(c => c.id === currentChannel.id) : false;

  return (
    <div className="wide-player-layout">
      {/* 1. Main player area */}
      <div className="main-player-section">
        {currentChannel ? (
          <div className="player-wrapper" onClick={showOverlay}>
            <ChannelPlayer
              channel={currentChannel}
              isActive={true}
              onError={handleChannelError}
              onReady={() => showOverlay()}
              muted={muted}
              onToggleMute={() => setMuted(!muted)}
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
              className={`action-btn-circle ${searchOpen ? 'btn-active' : ''}`}
              onClick={() => setSearchOpen(!searchOpen)}
              title="Поиск"
            >
              🔍
            </button>
            <button
              className={`action-btn-circle ${filterOpen ? 'btn-active' : ''}`}
              onClick={() => setFilterOpen(true)}
              title="Фильтры"
            >
              🎛️
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
            📡 Каналы
          </button>
          <button
            className={`tab-item ${activeTab === 'favorites' ? 'tab-active' : ''}`}
            onClick={() => {
              setActiveTab('favorites');
              setActiveIndex(0);
            }}
          >
            ⭐️ Избранное ({favorites.length})
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
              <p className="empty-state-subtext">Попробуйте изменить параметры поиска или фильтров</p>
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
      />
    </div>
  );
}
