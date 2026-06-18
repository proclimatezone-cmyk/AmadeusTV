export interface Channel {
  id: string;
  name: string;
  url: string;
  logo?: string;
  group: string;
  language?: string;
  country?: string;
  isF1?: boolean;       // detected as F1/motorsport channel
  langCode?: string;    // normalized 2-letter language code
}

export interface ChannelCategory {
  slug: string;
  name: string;
  nameRu: string;
  icon: string;
  count: number;
}

export interface ChannelsResponse {
  channels: Channel[];
  total: number;
  page: number;
  limit: number;
  hasMore: boolean;
}

/** Keywords to detect F1/motorsport channels by name */
export const F1_KEYWORDS = [
  'f1', 'formula 1', 'formula one', 'формула 1', 'формула1',
  'motorsport', 'motosport', 'автоспорт',
  'sky sport f1', 'sky sports f1', 'viaplay sport',
  'матч тв', 'match tv', 'match!',
  'sport 1', 'sport1', 'eurosport',
  'sky sport', 'dazn', 'espn',
  'моторспорт', 'motor sport',
];

/** Language display names and their codes for filtering */
export const LANGUAGE_MAP: Record<string, string> = {
  russian: 'Русский',
  rus: 'Русский',
  ru: 'Русский',
  english: 'English',
  eng: 'English',
  en: 'English',
  spanish: 'Español',
  spa: 'Español',
  es: 'Español',
  german: 'Deutsch',
  ger: 'Deutsch',
  de: 'Deutsch',
  french: 'Français',
  fre: 'Français',
  fr: 'Français',
  portuguese: 'Português',
  por: 'Português',
  pt: 'Português',
  italian: 'Italiano',
  ita: 'Italiano',
  it: 'Italiano',
  arabic: 'العربية',
  ara: 'العربية',
  ar: 'العربية',
  turkish: 'Türkçe',
  tur: 'Türkçe',
  tr: 'Türkçe',
};

/** Normalize language string to a display name */
export function normalizeLanguage(lang?: string): string {
  if (!lang) return 'Другой';
  // Handle multi-language like "English;Spanish"
  const first = lang.split(/[;,]/)[0].trim().toLowerCase();
  return LANGUAGE_MAP[first] || lang;
}

/** Get 2-letter lang code */
export function getLangCode(lang?: string): string {
  if (!lang) return 'xx';
  const first = lang.split(/[;,]/)[0].trim().toLowerCase();
  const codeMap: Record<string, string> = {
    russian: 'ru', rus: 'ru', ru: 'ru',
    english: 'en', eng: 'en', en: 'en',
    spanish: 'es', spa: 'es', es: 'es',
    german: 'de', ger: 'de', de: 'de',
    french: 'fr', fre: 'fr', fr: 'fr',
    portuguese: 'pt', por: 'pt', pt: 'pt',
    italian: 'it', ita: 'it', it: 'it',
    arabic: 'ar', ara: 'ar', ar: 'ar',
    turkish: 'tr', tur: 'tr', tr: 'tr',
  };
  return codeMap[first] || 'xx';
}

export const CATEGORY_MAP: Record<string, { nameRu: string; icon: string }> = {
  f1: { nameRu: 'Формула 1', icon: '🏎️' },
  sports: { nameRu: 'Спорт', icon: '⚽' },
  general: { nameRu: 'Общие', icon: '📺' },
  news: { nameRu: 'Новости', icon: '📰' },
  entertainment: { nameRu: 'Развлечения', icon: '🎭' },
  movies: { nameRu: 'Кино', icon: '🎬' },
  music: { nameRu: 'Музыка', icon: '🎵' },
  kids: { nameRu: 'Детям', icon: '🧸' },
  education: { nameRu: 'Образование', icon: '📚' },
  lifestyle: { nameRu: 'Стиль жизни', icon: '🌿' },
  travel: { nameRu: 'Путешествия', icon: '✈️' },
  food: { nameRu: 'Еда', icon: '🍳' },
  science: { nameRu: 'Наука', icon: '🔬' },
  documentary: { nameRu: 'Документальные', icon: '🎞️' },
  religious: { nameRu: 'Религия', icon: '🕊️' },
  comedy: { nameRu: 'Комедия', icon: '😂' },
  drama: { nameRu: 'Драма', icon: '🎭' },
  animation: { nameRu: 'Анимация', icon: '🖌️' },
  classic: { nameRu: 'Классика', icon: '📼' },
  culture: { nameRu: 'Культура', icon: '🏛️' },
  business: { nameRu: 'Бизнес', icon: '💼' },
  weather: { nameRu: 'Погода', icon: '🌤️' },
  auto: { nameRu: 'Авто', icon: '🚗' },
  outdoor: { nameRu: 'На воздухе', icon: '🏕️' },
  shop: { nameRu: 'Шоппинг', icon: '🛍️' },
  xxx: { nameRu: 'Взрослые', icon: '🔞' },
  legislative: { nameRu: 'Парламент', icon: '🏛️' },
  other: { nameRu: 'Другое', icon: '📡' },
};

export function normalizeCategory(groupTitle: string): string {
  if (!groupTitle) return 'other';
  const lower = groupTitle.toLowerCase().trim();

  // Direct match
  if (CATEGORY_MAP[lower]) return lower;

  // Fuzzy mapping
  const fuzzyMap: Record<string, string> = {
    sport: 'sports',
    deportes: 'sports',
    movie: 'movies',
    film: 'movies',
    cinema: 'movies',
    cine: 'movies',
    peliculas: 'movies',
    noticias: 'news',
    informacion: 'news',
    musica: 'music',
    musical: 'music',
    infantil: 'kids',
    children: 'kids',
    cartoon: 'kids',
    educacion: 'education',
    educational: 'education',
    viajes: 'travel',
    cooking: 'food',
    cocina: 'food',
    ciencia: 'science',
    documental: 'documentary',
    religion: 'religious',
    comedia: 'comedy',
    entretenimiento: 'entertainment',
    cultura: 'culture',
    negocios: 'business',
    clima: 'weather',
    legislativo: 'legislative',
    general: 'general',
    undefined: 'other',
    '': 'other',
  };

  for (const [key, val] of Object.entries(fuzzyMap)) {
    if (lower.includes(key)) return val;
  }

  return 'other';
}
