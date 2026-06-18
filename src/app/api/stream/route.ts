import { NextRequest, NextResponse } from 'next/server';
import { getProxyHeaders, CORS_HEADERS, STRIP_HEADERS } from '@/lib/proxy-headers';

export const runtime = 'edge';

/**
 * Stream proxy — emulates VLC player behavior.
 * Proxies ONLY .m3u8 manifests (~5-50KB), NOT .ts video segments.
 * Converts relative segment URLs to absolute so browser fetches .ts directly from CDN.
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const encodedUrl = searchParams.get('url');

  if (!encodedUrl) {
    return NextResponse.json(
      { error: 'Missing url parameter' },
      { status: 400, headers: CORS_HEADERS }
    );
  }

  let targetUrl: string;
  try {
    targetUrl = atob(encodedUrl);
  } catch {
    return NextResponse.json(
      { error: 'Invalid base64 url' },
      { status: 400, headers: CORS_HEADERS }
    );
  }

  // Validate URL
  let parsed: URL;
  try {
    parsed = new URL(targetUrl);
  } catch {
    return NextResponse.json(
      { error: 'Invalid URL' },
      { status: 400, headers: CORS_HEADERS }
    );
  }

  // Block internal/localhost URLs
  const blockedHosts = ['localhost', '127.0.0.1', '0.0.0.0', '::1', '10.', '192.168.', '172.16.'];
  if (blockedHosts.some(h => parsed.hostname.startsWith(h) || parsed.hostname === h)) {
    return NextResponse.json(
      { error: 'Blocked host' },
      { status: 403, headers: CORS_HEADERS }
    );
  }

  try {
    // Build headers — emulate VLC, strip browser fingerprints
    const proxyHeaders = getProxyHeaders(targetUrl);

    // Strip browser-specific headers from the original request
    const cleanHeaders = new Headers();
    for (const [key, value] of Object.entries(proxyHeaders)) {
      cleanHeaders.set(key, value);
    }

    // Fetch from broadcaster
    const upstream = await fetch(targetUrl, {
      headers: cleanHeaders,
      redirect: 'follow',
    });

    if (!upstream.ok) {
      return NextResponse.json(
        { error: `Upstream error: ${upstream.status}` },
        { status: upstream.status, headers: CORS_HEADERS }
      );
    }

    const contentType = upstream.headers.get('content-type') || '';
    const body = await upstream.text();

    // If this is an HLS manifest, rewrite relative URLs to absolute
    let processedBody = body;
    if (
      contentType.includes('mpegurl') ||
      contentType.includes('apple') ||
      targetUrl.endsWith('.m3u8') ||
      targetUrl.endsWith('.m3u')
    ) {
      processedBody = rewriteManifest(body, targetUrl, request.url);
    }

    // Return with CORS headers
    const responseHeaders = new Headers(CORS_HEADERS);
    responseHeaders.set('Content-Type', contentType || 'application/vnd.apple.mpegurl');
    responseHeaders.set('Cache-Control', 'no-cache, no-store, must-revalidate');

    return new NextResponse(processedBody, {
      status: 200,
      headers: responseHeaders,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown proxy error';
    return NextResponse.json(
      { error: message },
      { status: 502, headers: CORS_HEADERS }
    );
  }
}

/**
 * Handle CORS preflight.
 */
export async function OPTIONS() {
  return new NextResponse(null, {
    status: 200,
    headers: CORS_HEADERS,
  });
}

/**
 * Rewrite relative URLs in HLS manifests to absolute.
 * Sub-manifests (variant playlists) are routed through our proxy.
 * .ts segments go directly to the broadcaster's CDN.
 */
function rewriteManifest(manifest: string, baseUrl: string, proxyBaseUrl: string): string {
  const baseUrlObj = new URL(baseUrl);
  const basePath = baseUrlObj.href.substring(0, baseUrlObj.href.lastIndexOf('/') + 1);

  // Extract our proxy endpoint base
  const proxyUrl = new URL(proxyBaseUrl);
  const proxyBase = `${proxyUrl.origin}${proxyUrl.pathname}`;

  const lines = manifest.split('\n');
  const rewritten: string[] = [];

  for (const line of lines) {
    const trimmed = line.trim();

    // Skip empty lines and comments (pass through)
    if (!trimmed || trimmed.startsWith('#')) {
      // But check for URI= attributes in #EXT-X-MAP, #EXT-X-KEY etc
      if (trimmed.includes('URI="')) {
        const rewrittenLine = trimmed.replace(/URI="([^"]+)"/g, (match, uri) => {
          if (uri.startsWith('http://') || uri.startsWith('https://')) {
            // Already absolute — proxy sub-manifests, direct for segments
            if (uri.endsWith('.m3u8') || uri.endsWith('.m3u')) {
              return `URI="${proxyBase}?url=${btoa(uri)}"`;
            }
            return `URI="${uri}"`;
          }
          // Relative → absolute
          const absoluteUri = new URL(uri, basePath).href;
          if (absoluteUri.endsWith('.m3u8') || absoluteUri.endsWith('.m3u')) {
            return `URI="${proxyBase}?url=${btoa(absoluteUri)}"`;
          }
          return `URI="${absoluteUri}"`;
        });
        rewritten.push(rewrittenLine);
      } else {
        rewritten.push(line);
      }
      continue;
    }

    // URL line (not a tag)
    if (!trimmed.startsWith('#')) {
      if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
        // Already absolute
        if (trimmed.endsWith('.m3u8') || trimmed.endsWith('.m3u')) {
          // Sub-manifest → proxy
          rewritten.push(`${proxyBase}?url=${btoa(trimmed)}`);
        } else {
          // .ts segment → direct
          rewritten.push(trimmed);
        }
      } else {
        // Relative URL → make absolute
        const absoluteUrl = new URL(trimmed, basePath).href;
        if (trimmed.endsWith('.m3u8') || trimmed.endsWith('.m3u')) {
          rewritten.push(`${proxyBase}?url=${btoa(absoluteUrl)}`);
        } else {
          // .ts or .aac etc → direct to CDN
          rewritten.push(absoluteUrl);
        }
      }
      continue;
    }

    rewritten.push(line);
  }

  return rewritten.join('\n');
}
