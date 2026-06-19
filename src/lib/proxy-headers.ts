/**
 * VLC/SmartTV header presets for stream proxy requests.
 * These headers emulate desktop media players to bypass broadcaster restrictions.
 */
export const VLC_HEADERS: Record<string, string> = {
  'User-Agent': 'VLC/3.0.21 LibVLC/3.0.21',
  'Accept': '*/*',
  'Accept-Language': 'en-US,en;q=0.9',
  'Connection': 'keep-alive',
  'Icy-MetaData': '1',
};

export const SMART_TV_HEADERS: Record<string, string> = {
  'User-Agent': 'Mozilla/5.0 (SMART-TV; LINUX; Tizen 7.0) AppleWebKit/537.36 (KHTML, like Gecko) Version/7.0 TV Safari/537.36',
  'Accept': '*/*',
  'Accept-Language': 'en-US,en;q=0.9',
  'Connection': 'keep-alive',
};

/**
 * CORS headers injected into proxy responses for browser compatibility.
 */
export const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Range',
  'Access-Control-Expose-Headers': 'Content-Length, Content-Range, Content-Type',
  'Access-Control-Max-Age': '86400',
};

/**
 * Headers to strip from outgoing proxy requests.
 */
export const STRIP_HEADERS = ['origin', 'referer', 'sec-fetch-dest', 'sec-fetch-mode', 'sec-fetch-site'];

/**
 * Get proxy request headers for a given URL.
 * Emulates Smart TV headers by default to bypass most CDN and broadcaster blocks (like Fastly, Cloudfront).
 */
export function getProxyHeaders(targetUrl?: string): Record<string, string> {
  return { ...SMART_TV_HEADERS };
}
