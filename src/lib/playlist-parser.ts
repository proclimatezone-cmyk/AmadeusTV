import { Channel, normalizeCategory, F1_KEYWORDS, getLangCode } from './types';

/**
 * Parse an M3U playlist string into an array of Channel objects.
 * Handles #EXTINF tags with tvg-name, tvg-logo, group-title, tvg-language, tvg-country.
 * Detects F1/motorsport channels by keyword matching.
 */
export function parseM3U(content: string): Channel[] {
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

      // Fallback: channel name is after the last comma
      const commaIdx = line.lastIndexOf(',');
      const fallbackName = commaIdx !== -1 ? line.substring(commaIdx + 1).trim() : '';

      const name = nameMatch?.[1] || fallbackName || 'Unknown Channel';
      const groupRaw = groupMatch?.[1] || '';
      const language = langMatch?.[1] || undefined;

      // Detect F1/motorsport channels
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
          currentChannel.langCode = 'ru';
          currentChannel.language = 'Russian';
        }
      }
    } else if (line && !line.startsWith('#') && currentChannel) {
      const url = line.trim();

      if (url && (url.startsWith('http://') || url.startsWith('https://')) && !seenUrls.has(url)) {
        seenUrls.add(url);
        const id = generateId(url);

        channels.push({
          id,
          name: currentChannel.name || 'Unknown',
          url,
          logo: currentChannel.logo,
          group: currentChannel.group || 'other',
          language: currentChannel.language,
          country: currentChannel.country,
          isF1: currentChannel.isF1,
          langCode: currentChannel.langCode,
        });
      }

      currentChannel = null;
    }
  }

  return channels;
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

/**
 * Group channels by category and return category metadata.
 */
export function groupByCategory(channels: Channel[]): Map<string, Channel[]> {
  const groups = new Map<string, Channel[]>();

  for (const channel of channels) {
    const group = channel.group || 'other';
    if (!groups.has(group)) {
      groups.set(group, []);
    }
    groups.get(group)!.push(channel);
  }

  return groups;
}
