'use client';

interface LanguageFilterProps {
  languages: { code: string; name: string; count: number }[];
  activeLanguage: string;
  onSelect: (code: string) => void;
}

export default function LanguageFilter({ languages, activeLanguage, onSelect }: LanguageFilterProps) {
  if (languages.length <= 1) return null;

  return (
    <div className="language-filter">
      <button
        className={`lang-chip ${activeLanguage === 'all' ? 'lang-chip-active' : ''}`}
        onClick={() => onSelect('all')}
      >
        Все языки
      </button>
      {languages.slice(0, 8).map((lang) => (
        <button
          key={lang.code}
          className={`lang-chip ${activeLanguage === lang.code ? 'lang-chip-active' : ''}`}
          onClick={() => onSelect(lang.code)}
        >
          {lang.name}
          <span className="lang-count">{lang.count}</span>
        </button>
      ))}
    </div>
  );
}
