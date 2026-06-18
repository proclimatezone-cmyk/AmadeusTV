import { Channel } from './types';

/**
 * Parses raw M3U / M3U8 string content into standardized Channel objects.
 */
export function parseM3U(content: string): Channel[] {
  const channels: Channel[] = [];
  const lines = content.split('\n');
  
  let currentMetadata: {
    name: string;
    logo?: string;
    group: string;
    language?: string;
    country?: string;
  } | null = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();

    if (!line) continue;

    if (line.startsWith('#EXTINF:')) {
      // Parse logo: tvg-logo="url" or logo="url"
      const logoMatch = line.match(/(?:tvg-logo|logo)="([^"]+)"/i);
      const logo = logoMatch ? logoMatch[1] : undefined;

      // Parse group title: group-title="category"
      const groupMatch = line.match(/group-title="([^"]+)"/i);
      const group = groupMatch ? groupMatch[1] : 'other';

      // Parse language: tvg-language="lang" or language="lang"
      const langMatch = line.match(/(?:tvg-language|language)="([^"]+)"/i);
      const language = langMatch ? langMatch[1] : undefined;

      // Parse country: tvg-country="country" or country="country"
      const countryMatch = line.match(/(?:tvg-country|country)="([^"]+)"/i);
      const country = countryMatch ? countryMatch[1] : undefined;

      // Parse channel name: name is after the last comma
      const lastCommaIdx = line.lastIndexOf(',');
      let name = 'Unknown Channel';
      if (lastCommaIdx !== -1) {
        name = line.substring(lastCommaIdx + 1).trim();
      }

      currentMetadata = {
        name,
        logo,
        group,
        language,
        country,
      };
    } else if (line.startsWith('http://') || line.startsWith('https://') || line.startsWith('rtmp://') || line.startsWith('rtsp://')) {
      if (currentMetadata) {
        // Generate a deterministic or random unique ID
        const id = `custom-${Math.random().toString(36).substring(2, 11)}-${Date.now()}`;
        channels.push({
          id,
          name: currentMetadata.name,
          url: line,
          logo: currentMetadata.logo,
          group: currentMetadata.group,
          language: currentMetadata.language,
          country: currentMetadata.country,
          langCode: currentMetadata.language ? currentMetadata.language.substring(0, 2).toLowerCase() : undefined,
        });
        currentMetadata = null;
      }
    }
  }

  return channels;
}
