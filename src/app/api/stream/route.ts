import { NextRequest, NextResponse } from 'next/server';
import { getProxyHeaders, CORS_HEADERS } from '@/lib/proxy-headers';

export const runtime = 'edge';

/**
 * Checks if the URL or content-type is an HLS manifest.
 */
function isManifest(url: string, contentType: string): boolean {
  const cleanPath = url.split('?')[0].split('#')[0].toLowerCase();
  const type = contentType.toLowerCase();
  return (
    cleanPath.endsWith('.m3u8') ||
    cleanPath.endsWith('.m3u') ||
    type.includes('mpegurl') ||
    type.includes('apple')
  );
}

/**
 * Stream proxy — emulates VLC player behavior.
 * Proxies .m3u8 manifests and pipes binary media streams directly.
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const rawUrl = searchParams.get('url');

  if (!rawUrl) {
    return NextResponse.json(
      { error: 'Missing url parameter' },
      { status: 400, headers: CORS_HEADERS }
    );
  }

  let targetUrl: string;
  try {
    targetUrl = decodeURIComponent(rawUrl);
  } catch {
    return NextResponse.json(
      { error: 'Invalid URL encoding' },
      { status: 400, headers: CORS_HEADERS }
    );
  }

  // Validate URL structure
  let parsed: URL;
  try {
    parsed = new URL(targetUrl);
  } catch {
    return NextResponse.json(
      { error: 'Invalid URL format' },
      { status: 400, headers: CORS_HEADERS }
    );
  }

  // Block internal/localhost IPs to prevent SSRF
  const blockedHosts = ['localhost', '127.0.0.1', '0.0.0.0', '::1', '10.', '192.168.', '172.16.'];
  if (blockedHosts.some(h => parsed.hostname.startsWith(h) || parsed.hostname === h)) {
    return NextResponse.json(
      { error: 'Forbidden host' },
      { status: 403, headers: CORS_HEADERS }
    );
  }

  try {
    // Emulate VLC / SmartTV headers
    const proxyHeaders = getProxyHeaders(targetUrl);
    const cleanHeaders = new Headers();
    for (const [key, value] of Object.entries(proxyHeaders)) {
      cleanHeaders.set(key, value);
    }

    let currentUrl = targetUrl;
    let redirectCount = 0;
    const MAX_REDIRECTS = 10;
    let upstream: Response | null = null;

    while (redirectCount < MAX_REDIRECTS) {
      const proxyHeaders = getProxyHeaders(currentUrl);
      const cleanHeaders = new Headers();
      for (const [key, value] of Object.entries(proxyHeaders)) {
        cleanHeaders.set(key, value);
      }

      const res = await fetch(currentUrl, {
        headers: cleanHeaders,
        redirect: 'manual',
      });

      if (res.status >= 300 && res.status < 400) {
        const location = res.headers.get('location');
        if (!location) {
          upstream = res;
          break;
        }
        const absoluteLocation = new URL(location, currentUrl).href;
        currentUrl = absoluteLocation;
        redirectCount++;
      } else {
        upstream = res;
        break;
      }
    }

    if (!upstream) {
      return NextResponse.json(
        { error: 'Too many redirects' },
        { status: 508, headers: CORS_HEADERS }
      );
    }

    if (!upstream.ok) {
      return NextResponse.json(
        { error: `Upstream error: ${upstream.status}` },
        { status: upstream.status, headers: CORS_HEADERS }
      );
    }

    const contentType = upstream.headers.get('content-type') || '';
    
    // Check if manifest or binary video/stream
    if (isManifest(targetUrl, contentType)) {
      const body = await upstream.text();
      const processedBody = rewriteManifest(body, targetUrl, request.url);

      const responseHeaders = new Headers(CORS_HEADERS);
      responseHeaders.set('Content-Type', contentType || 'application/vnd.apple.mpegurl');
      responseHeaders.set('Cache-Control', 'no-cache, no-store, must-revalidate');

      return new NextResponse(processedBody, {
        status: 200,
        headers: responseHeaders,
      });
    } else {
      // Pipe binary stream directly (avoids hanging and buffer limit errors)
      const responseHeaders = new Headers(CORS_HEADERS);
      responseHeaders.set('Content-Type', contentType || 'application/octet-stream');
      
      const contentLength = upstream.headers.get('content-length');
      if (contentLength) {
        responseHeaders.set('Content-Length', contentLength);
      }
      responseHeaders.set('Cache-Control', 'no-cache, no-store, must-revalidate');

      return new NextResponse(upstream.body, {
        status: 200,
        headers: responseHeaders,
      });
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown stream proxy error';
    return NextResponse.json(
      { error: message },
      { status: 502, headers: CORS_HEADERS }
    );
  }
}

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 200,
    headers: CORS_HEADERS,
  });
}

/**
 * Rewrite relative URLs in HLS manifests to absolute.
 * Sub-manifests (variant playlists) are routed through our proxy using URL-encoding.
 * .ts segments go directly to the broadcaster's CDN.
 */
function rewriteManifest(manifest: string, baseUrl: string, proxyBaseUrl: string): string {
  const baseUrlObj = new URL(baseUrl);
  const basePath = baseUrlObj.href.substring(0, baseUrlObj.href.lastIndexOf('/') + 1);

  const proxyUrl = new URL(proxyBaseUrl);
  const proxyBase = `${proxyUrl.origin}${proxyUrl.pathname}`;

  const lines = manifest.split('\n');
  const rewritten: string[] = [];

  const isManifestLink = (link: string) => {
    const clean = link.split('?')[0].split('#')[0].toLowerCase();
    return clean.endsWith('.m3u8') || clean.endsWith('.m3u');
  };

  for (const line of lines) {
    const trimmed = line.trim();

    if (!trimmed || trimmed.startsWith('#')) {
      // Handle URI tags like EXT-X-KEY, EXT-X-MAP, etc.
      if (trimmed.includes('URI="')) {
        const rewrittenLine = trimmed.replace(/URI="([^"]+)"/g, (match, uri) => {
          if (uri.startsWith('http://') || uri.startsWith('https://')) {
            if (isManifestLink(uri)) {
              return `URI="${proxyBase}?url=${encodeURIComponent(uri)}"`;
            }
            return `URI="${uri}"`;
          }
          const absoluteUri = new URL(uri, basePath).href;
          if (isManifestLink(absoluteUri)) {
            return `URI="${proxyBase}?url=${encodeURIComponent(absoluteUri)}"`;
          }
          return `URI="${absoluteUri}"`;
        });
        rewritten.push(rewrittenLine);
      } else {
        rewritten.push(line);
      }
      continue;
    }

    // Rewrite HLS links
    if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
      if (isManifestLink(trimmed)) {
        rewritten.push(`${proxyBase}?url=${encodeURIComponent(trimmed)}`);
      } else {
        rewritten.push(trimmed);
      }
    } else {
      const absoluteUrl = new URL(trimmed, basePath).href;
      if (isManifestLink(trimmed)) {
        rewritten.push(`${proxyBase}?url=${encodeURIComponent(absoluteUrl)}`);
      } else {
        rewritten.push(absoluteUrl);
      }
    }
  }

  return rewritten.join('\n');
}
