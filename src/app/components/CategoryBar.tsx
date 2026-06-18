'use client';

import { ChannelCategory } from '@/lib/types';
import { useRef, useEffect } from 'react';

interface CategoryBarProps {
  categories: ChannelCategory[];
  activeCategory: string;
  onSelect: (slug: string) => void;
}

export default function CategoryBar({ categories, activeCategory, onSelect }: CategoryBarProps) {
  const scrollRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to active category
  useEffect(() => {
    if (scrollRef.current) {
      const activeEl = scrollRef.current.querySelector(`[data-slug="${activeCategory}"]`);
      if (activeEl) {
        activeEl.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
      }
    }
  }, [activeCategory]);

  return (
    <div className="category-bar" ref={scrollRef}>
      <button
        className={`category-chip ${activeCategory === 'all' ? 'category-chip-active' : ''}`}
        onClick={() => onSelect('all')}
        data-slug="all"
      >
        <span className="category-icon">📺</span>
        <span>Все</span>
      </button>
      {categories.map((cat) => (
        <button
          key={cat.slug}
          className={`category-chip ${activeCategory === cat.slug ? 'category-chip-active' : ''}`}
          onClick={() => onSelect(cat.slug)}
          data-slug={cat.slug}
        >
          <span className="category-icon">{cat.icon}</span>
          <span>{cat.nameRu}</span>
          <span className="category-count">{cat.count}</span>
        </button>
      ))}
    </div>
  );
}
