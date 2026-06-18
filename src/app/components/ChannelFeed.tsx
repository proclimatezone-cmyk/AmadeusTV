'use client';

import { useState, useCallback, useEffect, useRef } from 'react';
import { Swiper, SwiperSlide } from 'swiper/react';
import { Virtual, Mousewheel } from 'swiper/modules';
import type { Swiper as SwiperType } from 'swiper';
import 'swiper/css';

import { Channel, ChannelCategory } from '@/lib/types';
import ChannelPlayer from './ChannelPlayer';
import ChannelOverlay from './ChannelOverlay';
import CategoryBar from './CategoryBar';
import LanguageFilter from './LanguageFilter';

interface ChannelFeedProps {
  initialChannels: Channel[];
  categories: ChannelCategory[];
}

export default function ChannelFeed({ initialChannels, categories }: ChannelFeedProps) {
  const [channels, setChannels] = useState<Channel[]>(initialChannels);
  const [activeIndex, setActiveIndex] = useState(0);
  const [activeCategory, setActiveCategory] = useState('f1');
  const [activeLanguage, setActiveLanguage] = useState('all');
  const [languages, setLanguages] = useState<{ code: string; name: string; count: number }[]>([]);
  const [muted, setMuted] = useState(true);
  const [overlayVisible, setOverlayVisible] = useState(true);
  const [loading, setLoading] = useState(false);
  const [totalChannels, setTotalChannels] = useState(initialChannels.length);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);

  const swiperRef = useRef<SwiperType | null>(null);
  const overlayTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pageRef = useRef(1);
  const hasMoreRef = useRef(true);

  // Fetch channels from API
  const fetchChannels = useCallback(async (
    category: string,
    language: string,
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
      if (search) params.set('search', search);
      params.set('page', String(page));
      params.set('limit', '50');

      const res = await fetch(`/api/channels?${params}`);
      const data = await res.json();

      setTotalChannels(data.total || data.channels.length);
      if (append) {
        setChannels(prev => [...prev, ...data.channels]);
      } else {
        setChannels(data.channels);
        setActiveIndex(0);
        if (swiperRef.current) {
          swiperRef.current.slideTo(0, 0);
        }
      }
      hasMoreRef.current = data.hasMore;
    } catch (err) {
      console.error('Failed to fetch channels:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  // Fetch languages for category
  const fetchLanguages = useCallback(async (category: string) => {
    try {
      const params = new URLSearchParams({ action: 'languages' });
      if (category !== 'all') params.set('category', category);
      const res = await fetch(`/api/channels?${params}`);
      const data = await res.json();
      setLanguages(data.languages || []);
    } catch {
      setLanguages([]);
    }
  }, []);

  // Category change
  const handleCategoryChange = useCallback((slug: string) => {
    setActiveCategory(slug);
    setActiveLanguage('all');
    pageRef.current = 1;
    fetchChannels(slug, 'all', searchQuery, 1);
    fetchLanguages(slug);
  }, [fetchChannels, fetchLanguages, searchQuery]);

  // Language change
  const handleLanguageChange = useCallback((code: string) => {
    setActiveLanguage(code);
    pageRef.current = 1;
    fetchChannels(activeCategory, code, searchQuery, 1);
  }, [activeCategory, fetchChannels, searchQuery]);

  // Search
  const handleSearch = useCallback((query: string) => {
    setSearchQuery(query);
    pageRef.current = 1;
    fetchChannels(activeCategory, activeLanguage, query, 1);
  }, [activeCategory, activeLanguage, fetchChannels]);

  // Load more on reaching end
  const handleReachEnd = useCallback(() => {
    if (hasMoreRef.current && !loading) {
      pageRef.current++;
      fetchChannels(activeCategory, activeLanguage, searchQuery, pageRef.current, true);
    }
  }, [activeCategory, activeLanguage, searchQuery, loading, fetchChannels]);

  // Auto-switch on error
  const handleChannelError = useCallback((failedChannel: Channel) => {
    console.log(`Channel "${failedChannel.name}" failed, switching...`);
    setTimeout(() => {
      if (swiperRef.current && activeIndex < channels.length - 1) {
        swiperRef.current.slideNext(300);
      }
    }, 800);
  }, [activeIndex, channels.length]);

  // Show overlay on tap, auto-hide after 4s
  const showOverlay = useCallback(() => {
    setOverlayVisible(true);
    if (overlayTimerRef.current) clearTimeout(overlayTimerRef.current);
    overlayTimerRef.current = setTimeout(() => setOverlayVisible(false), 4000);
  }, []);

  // Initial load: F1 category + languages
  useEffect(() => {
    fetchLanguages('f1');
  }, [fetchLanguages]);

  // Cleanup overlay timer
  useEffect(() => {
    return () => {
      if (overlayTimerRef.current) clearTimeout(overlayTimerRef.current);
    };
  }, []);

  const currentChannel = channels[activeIndex];

  return (
    <div className="feed-container">
      {/* Top bar */}
      <div className="feed-header">
        <div className="feed-header-top">
          <h1 className="feed-logo">
            <span className="logo-amadeus">Amadeus</span>
            <span className="logo-tv">TV</span>
            <span className="logo-mn">by MN</span>
          </h1>
          <div className="feed-header-actions">
            <button
              className="search-toggle"
              onClick={() => setSearchOpen(!searchOpen)}
              aria-label="Search"
            >
              🔍
            </button>
          </div>
        </div>

        {/* Search bar */}
        {searchOpen && (
          <div className="search-bar">
            <input
              type="text"
              placeholder="Поиск каналов..."
              value={searchQuery}
              onChange={(e) => handleSearch(e.target.value)}
              className="search-input"
              autoFocus
            />
            {searchQuery && (
              <button
                className="search-clear"
                onClick={() => handleSearch('')}
              >
                ✕
              </button>
            )}
          </div>
        )}

        {/* Categories */}
        <CategoryBar
          categories={categories}
          activeCategory={activeCategory}
          onSelect={handleCategoryChange}
        />

        {/* Language filter */}
        <LanguageFilter
          languages={languages}
          activeLanguage={activeLanguage}
          onSelect={handleLanguageChange}
        />
      </div>

      {/* Channel counter */}
      <div className="channel-counter">
        {channels.length > 0 ? `${activeIndex + 1} / ${totalChannels}` : 'Нет каналов'}
      </div>

      {/* Swiper feed */}
      {channels.length > 0 ? (
        <Swiper
          modules={[Virtual, Mousewheel]}
          direction="vertical"
          slidesPerView={1}
          virtual
          mousewheel
          onSwiper={(swiper) => { swiperRef.current = swiper; }}
          onSlideChange={(swiper) => {
            setActiveIndex(swiper.activeIndex);
            showOverlay();
          }}
          onReachEnd={handleReachEnd}
          onClick={showOverlay}
          className="feed-swiper"
        >
          {channels.map((channel, index) => (
            <SwiperSlide key={channel.id} virtualIndex={index}>
              <div className="slide-container">
                <ChannelPlayer
                  channel={channel}
                  isActive={index === activeIndex}
                  onError={handleChannelError}
                  onReady={() => showOverlay()}
                  muted={muted}
                  onToggleMute={() => setMuted(!muted)}
                />
                <ChannelOverlay
                  channel={channel}
                  visible={overlayVisible && index === activeIndex}
                />
              </div>
            </SwiperSlide>
          ))}
        </Swiper>
      ) : (
        <div className="empty-state">
          {loading ? (
            <>
              <div className="loading-spinner" />
              <p>Загрузка каналов...</p>
            </>
          ) : (
            <>
              <div className="empty-icon">📡</div>
              <p>Каналы не найдены</p>
              <p className="empty-subtext">Попробуйте другую категорию или язык</p>
            </>
          )}
        </div>
      )}

      {/* Swipe hint */}
      {channels.length > 1 && activeIndex === 0 && (
        <div className="swipe-hint">
          <div className="swipe-arrow">↑</div>
          <span>Свайп для переключения</span>
        </div>
      )}
    </div>
  );
}
