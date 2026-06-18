/**
 * Prebuild script: fetches the iptv-org master playlist,
 * parses it, and writes structured JSON to data/channels.json.
 *
 * Run: npx tsx scripts/fetch-playlist.ts
 */
import * as fs from 'fs';
import * as path from 'path';

const PLAYLIST_URL = 'https://iptv-org.github.io/iptv/index.m3u';
const OUTPUT_PATH = path.join(process.cwd(), 'data', 'channels.json');

// Inline minimal parser to avoid import issues in script context
const F1_KEYWORDS = [
  'f1', 'formula 1', 'formula one', 'формула 1', 'формула1',
  'motorsport', 'motosport', 'автоспорт',
  'sky sport f1', 'sky sports f1', 'viaplay sport',
  'матч тв', 'match tv', 'match!',
  'sport 1', 'sport1', 'eurosport',
  'sky sport', 'dazn', 'espn',
  'моторспорт', 'motor sport',
];

const CATEGORY_FUZZY: Record<string, string> = {
  sport: 'sports', deportes: 'sports',
  movie: 'movies', film: 'movies', cinema: 'movies', cine: 'movies', peliculas: 'movies',
  noticias: 'news', informacion: 'news',
  musica: 'music', musical: 'music',
  infantil: 'kids', children: 'kids', cartoon: 'kids',
  educacion: 'education', educational: 'education',
  viajes: 'travel',
  cooking: 'food', cocina: 'food',
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
};

const VALID_CATEGORIES = new Set([
  'f1','sports','general','news','entertainment','movies','music','kids',
  'education','lifestyle','travel','food','science','documentary','religious',
  'comedy','drama','animation','classic','culture','business','weather',
  'auto','outdoor','shop','xxx','legislative','other',
]);

function normalizeCategory(groupTitle: string): string {
  if (!groupTitle) return 'other';
  const lower = groupTitle.toLowerCase().trim();
  if (VALID_CATEGORIES.has(lower)) return lower;
  for (const [key, val] of Object.entries(CATEGORY_FUZZY)) {
    if (lower.includes(key)) return val;
  }
  return 'other';
}

function getLangCode(lang?: string): string {
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

function generateId(url: string): string {
  let hash = 0;
  for (let i = 0; i < url.length; i++) {
    const char = url.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return Math.abs(hash).toString(36);
}

interface Channel {
  id: string;
  name: string;
  url: string;
  logo?: string;
  group: string;
  language?: string;
  country?: string;
  isF1?: boolean;
  langCode?: string;
}

async function main() {
  console.log('📡 Fetching playlist from iptv-org...');
  const response = await fetch(PLAYLIST_URL, {
    headers: { 'User-Agent': 'Mozilla/5.0' },
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch playlist: ${response.status} ${response.statusText}`);
  }

  const content = await response.text();
  console.log(`📄 Received ${(content.length / 1024 / 1024).toFixed(1)} MB`);

  const lines = content.split('\n');
  const channels: Channel[] = [];
  const seenUrls = new Set<string>();
  let currentChannel: Partial<Channel> | null = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();

    if (line.startsWith('#EXTINF:')) {
      currentChannel = {};
      const nameMatch = line.match(/tvg-name="([^"]*)"/);
      const logoMatch = line.match(/tvg-logo="([^"]*)"/);
      const groupMatch = line.match(/group-title="([^"]*)"/);
      const langMatch = line.match(/tvg-language="([^"]*)"/);
      const countryMatch = line.match(/tvg-country="([^"]*)"/);

      const commaIdx = line.lastIndexOf(',');
      const fallbackName = commaIdx !== -1 ? line.substring(commaIdx + 1).trim() : '';

      const name = nameMatch?.[1] || fallbackName || 'Unknown Channel';
      const groupRaw = groupMatch?.[1] || '';
      const language = langMatch?.[1] || undefined;
      const nameLower = name.toLowerCase();
      const groupLower = groupRaw.toLowerCase();
      const isF1 = F1_KEYWORDS.some(kw => nameLower.includes(kw) || groupLower.includes(kw));

      currentChannel.name = name;
      currentChannel.logo = logoMatch?.[1] || undefined;
      currentChannel.group = isF1 ? 'f1' : normalizeCategory(groupRaw);
      currentChannel.language = language;
      currentChannel.country = countryMatch?.[1] || undefined;
      currentChannel.isF1 = isF1;
      currentChannel.langCode = getLangCode(language);

      // Fallback: detect Russian by country or Cyrillic in name
      const country = countryMatch?.[1] || '';
      if (currentChannel.langCode === 'xx') {
        if (country.toUpperCase() === 'RU' || country.toLowerCase() === 'russia') {
          currentChannel.langCode = 'ru';
          currentChannel.language = 'Russian';
        } else if (/[\u0400-\u04FF]/.test(name)) {
          // Cyrillic characters in name → likely Russian
          currentChannel.langCode = 'ru';
          currentChannel.language = 'Russian';
        }
      }
    } else if (line && !line.startsWith('#') && currentChannel) {
      const url = line.trim();
      if (url && (url.startsWith('http://') || url.startsWith('https://')) && !seenUrls.has(url)) {
        seenUrls.add(url);
        channels.push({
          id: generateId(url),
          name: currentChannel.name || 'Unknown',
          url,
          logo: currentChannel.logo,
          group: currentChannel.group || 'other',
          language: currentChannel.language,
          country: currentChannel.country,
          isF1: currentChannel.isF1 || false,
          langCode: currentChannel.langCode || 'xx',
        });
      }
      currentChannel = null;
    }
  }

  // Sort: F1 first, then by category, Russian channels first within each
  channels.sort((a, b) => {
    if (a.group === 'f1' && b.group !== 'f1') return -1;
    if (a.group !== 'f1' && b.group === 'f1') return 1;
    if (a.group !== b.group) return a.group.localeCompare(b.group);
    const aRu = a.langCode === 'ru' ? 0 : 1;
    const bRu = b.langCode === 'ru' ? 0 : 1;
    if (aRu !== bRu) return aRu - bRu;
    return a.name.localeCompare(b.name);
  });

  // Ensure output directory exists
  const dir = path.dirname(OUTPUT_PATH);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(channels, null, 0));

  // Stats
  const f1Count = channels.filter(c => c.isF1 || c.group === 'f1').length;
  const ruCount = channels.filter(c => c.langCode === 'ru').length;
  const categories = new Set(channels.map(c => c.group));

  console.log(`\n✅ Parsed ${channels.length} channels`);
  console.log(`🏎️  F1/Motorsport: ${f1Count}`);
  console.log(`🇷🇺 Russian: ${ruCount}`);
  console.log(`📂 Categories: ${categories.size}`);
  console.log(`💾 Saved to ${OUTPUT_PATH} (${(fs.statSync(OUTPUT_PATH).size / 1024 / 1024).toFixed(1)} MB)`);
}

main().catch(err => {
  console.error('❌ Failed:', err);
  process.exit(1);
});
