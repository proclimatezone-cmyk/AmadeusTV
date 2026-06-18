import { Channel, ChannelCategory, CATEGORY_MAP, normalizeLanguage, normalizeCountry } from './types';
import channelsData from '../../data/channels.json';

// In-memory channel store loaded from pre-built JSON
const allChannels: Channel[] = channelsData as Channel[];

/**
 * Get channels with filtering and pagination.
 * Russian-language channels are sorted first within each category.
 */
export function getChannels(options: {
  category?: string;
  language?: string;
  country?: string;
  search?: string;
  page?: number;
  limit?: number;
}): { channels: Channel[]; total: number; hasMore: boolean } {
  const { category, language, country, search, page = 1, limit = 20 } = options;

  let filtered = allChannels;

  // Filter by category
  if (category && category !== 'all') {
    filtered = filtered.filter(ch => ch.group === category);
  }

  // Filter by language
  if (language && language !== 'all') {
    filtered = filtered.filter(ch => ch.langCode === language);
  }

  // Filter by country
  if (country && country !== 'all') {
    filtered = filtered.filter(ch => ch.country?.toLowerCase() === country.toLowerCase());
  }

  // Search by name
  if (search) {
    const q = search.toLowerCase();
    filtered = filtered.filter(ch => ch.name.toLowerCase().includes(q));
  }

  // Sort: Russian first, then by name
  filtered.sort((a, b) => {
    // Russian channels first
    const aRu = a.langCode === 'ru' ? 0 : 1;
    const bRu = b.langCode === 'ru' ? 0 : 1;
    if (aRu !== bRu) return aRu - bRu;
    return a.name.localeCompare(b.name);
  });

  const total = filtered.length;
  const start = (page - 1) * limit;
  const end = start + limit;
  const channels = filtered.slice(start, end);

  return {
    channels,
    total,
    hasMore: end < total,
  };
}

/**
 * Get all available categories with counts.
 * F1 is always first.
 */
export function getCategories(): ChannelCategory[] {
  const counts = new Map<string, number>();

  for (const ch of allChannels) {
    const group = ch.group || 'other';
    counts.set(group, (counts.get(group) || 0) + 1);
  }

  const categories: ChannelCategory[] = [];

  // F1 first, then ordered by CATEGORY_MAP keys
  for (const [slug, meta] of Object.entries(CATEGORY_MAP)) {
    const count = counts.get(slug) || 0;
    if (count > 0) {
      categories.push({
        slug,
        name: slug,
        nameRu: meta.nameRu,
        icon: meta.icon,
        count,
      });
    }
  }

  return categories;
}

/**
 * Get available languages for a given category.
 */
export function getLanguagesForCategory(category?: string): { code: string; name: string; count: number }[] {
  let filtered = allChannels;
  if (category && category !== 'all') {
    filtered = filtered.filter(ch => ch.group === category);
  }

  const langCounts = new Map<string, number>();
  for (const ch of filtered) {
    const code = ch.langCode || 'xx';
    langCounts.set(code, (langCounts.get(code) || 0) + 1);
  }

  const languages = Array.from(langCounts.entries())
    .map(([code, count]) => ({
      code,
      name: normalizeLanguage(code),
      count,
    }))
    .sort((a, b) => {
      // Russian first
      if (a.code === 'ru') return -1;
      if (b.code === 'ru') return 1;
      // Then English
      if (a.code === 'en') return -1;
      if (b.code === 'en') return 1;
      return b.count - a.count;
    });

  return languages;
}

/**
 * Get F1 channels, sorted by language (Russian first).
 */
export function getF1Channels(language?: string): Channel[] {
  let f1 = allChannels.filter(ch => ch.isF1 || ch.group === 'f1');

  if (language && language !== 'all') {
    f1 = f1.filter(ch => ch.langCode === language);
  }

  // Russian first
  f1.sort((a, b) => {
    const aRu = a.langCode === 'ru' ? 0 : 1;
    const bRu = b.langCode === 'ru' ? 0 : 1;
    if (aRu !== bRu) return aRu - bRu;
    return a.name.localeCompare(b.name);
  });

  return f1;
}

/**
 * Get available countries for a given category.
 */
export function getCountriesForCategory(category?: string): { code: string; name: string; count: number }[] {
  let filtered = allChannels;
  if (category && category !== 'all') {
    filtered = filtered.filter(ch => ch.group === category);
  }

  const countryCounts = new Map<string, number>();
  for (const ch of filtered) {
    const code = ch.country?.toLowerCase() || '';
    if (!code) continue; // Skip channels with no country
    countryCounts.set(code, (countryCounts.get(code) || 0) + 1);
  }

  const countries = Array.from(countryCounts.entries())
    .map(([code, count]) => ({
      code,
      name: normalizeCountry(code),
      count,
    }))
    .sort((a, b) => {
      // Russia first
      if (a.code === 'ru') return -1;
      if (b.code === 'ru') return 1;
      // Then US
      if (a.code === 'us') return -1;
      if (b.code === 'us') return 1;
      // Then UK
      if (a.code === 'gb') return -1;
      if (b.code === 'gb') return 1;
      return b.count - a.count;
    });

  return countries;
}

