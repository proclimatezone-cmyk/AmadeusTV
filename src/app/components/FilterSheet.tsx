'use client';

import { ChannelCategory } from '@/lib/types';

interface FilterSheetProps {
  isOpen: boolean;
  onClose: () => void;
  categories: ChannelCategory[];
  activeCategory: string;
  onCategoryChange: (slug: string) => void;
  languages: { code: string; name: string; count: number }[];
  activeLanguage: string;
  onLanguageChange: (code: string) => void;
  countries: { code: string; name: string; count: number }[];
  activeCountry: string;
  onCountryChange: (code: string) => void;
  onReset: () => void;
  autoSwitch: boolean;
  onToggleAutoSwitch: () => void;
}

export default function FilterSheet({
  isOpen,
  onClose,
  categories,
  activeCategory,
  onCategoryChange,
  languages,
  activeLanguage,
  onLanguageChange,
  countries,
  activeCountry,
  onCountryChange,
  onReset,
  autoSwitch,
  onToggleAutoSwitch,
}: FilterSheetProps) {
  if (!isOpen) return null;

  return (
    <div className="filter-sheet-overlay" onClick={onClose}>
      <div className="filter-sheet-content" onClick={(e) => e.stopPropagation()}>
        <div className="filter-sheet-header">
          <h3 className="filter-sheet-title">🎛️ Настройки и поиск</h3>
          <button className="filter-sheet-close" onClick={onClose} aria-label="Закрыть">
            ✕
          </button>
        </div>

        <div className="filter-sheet-body">
          {/* Category Filter */}
          <div className="filter-group">
            <label className="filter-label">Категория</label>
            <select
              value={activeCategory}
              onChange={(e) => onCategoryChange(e.target.value)}
              className="filter-select"
            >
              <option value="all">Все категории</option>
              {categories.map((cat) => (
                <option key={cat.slug} value={cat.slug}>
                  {cat.icon} {cat.nameRu} ({cat.count})
                </option>
              ))}
            </select>
          </div>

          {/* Language Filter */}
          <div className="filter-group">
            <label className="filter-label">Язык вещания</label>
            <select
              value={activeLanguage}
              onChange={(e) => onLanguageChange(e.target.value)}
              className="filter-select"
            >
              <option value="all">Все языки</option>
              {languages.map((lang) => (
                <option key={lang.code} value={lang.code}>
                  {lang.name} ({lang.count})
                </option>
              ))}
            </select>
          </div>

          {/* Country Filter */}
          <div className="filter-group">
            <label className="filter-label">Страна</label>
            <select
              value={activeCountry}
              onChange={(e) => onCountryChange(e.target.value)}
              className="filter-select"
            >
              <option value="all">Все страны</option>
              {countries.map((c) => (
                <option key={c.code} value={c.code}>
                  {c.name} ({c.count})
                </option>
              ))}
            </select>
          </div>

          {/* Auto Switch Settings */}
          <div 
            className="filter-group" 
            style={{ 
              flexDirection: 'row', 
              alignItems: 'center', 
              gap: '10px', 
              cursor: 'pointer', 
              marginTop: '16px',
              background: 'rgba(255, 255, 255, 0.02)',
              padding: '12px',
              borderRadius: 'var(--radius-sm)',
              border: '1px solid var(--border-glass)'
            }} 
            onClick={onToggleAutoSwitch}
          >
            <input
              type="checkbox"
              id="auto-switch-checkbox"
              checked={autoSwitch}
              onChange={() => {}} // Handled by onClick
              style={{ width: '18px', height: '18px', accentColor: 'var(--accent-primary)', cursor: 'pointer' }}
            />
            <label htmlFor="auto-switch-checkbox" style={{ fontSize: '0.85rem', color: 'var(--text-primary)', cursor: 'pointer', fontWeight: 600 }}>
              Автопереключение при ошибках
            </label>
          </div>
        </div>

        <div className="filter-sheet-footer">
          <button className="filter-btn-reset" onClick={onReset}>
            Сбросить все
          </button>
          <button className="filter-btn-apply" onClick={onClose}>
            Применить
          </button>
        </div>
      </div>
    </div>
  );
}
