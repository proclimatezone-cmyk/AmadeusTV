import { NextRequest, NextResponse } from 'next/server';
import { getChannels, getCategories, getLanguagesForCategory, getF1Channels, getCountriesForCategory } from '@/lib/channels-store';
import { CORS_HEADERS } from '@/lib/proxy-headers';

/**
 * Channels API — serves cached channel data with filtering.
 * Revalidates every hour via ISR.
 */
export const revalidate = 3600;

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const action = searchParams.get('action') || 'list';

  const responseHeaders = new Headers(CORS_HEADERS);
  responseHeaders.set('Cache-Control', 'public, max-age=600, s-maxage=3600');

  try {
    switch (action) {
      case 'categories': {
        const categories = getCategories();
        return NextResponse.json({ categories }, { headers: responseHeaders });
      }

      case 'languages': {
        const category = searchParams.get('category') || undefined;
        const languages = getLanguagesForCategory(category);
        return NextResponse.json({ languages }, { headers: responseHeaders });
      }

      case 'countries': {
        const category = searchParams.get('category') || undefined;
        const countries = getCountriesForCategory(category);
        return NextResponse.json({ countries }, { headers: responseHeaders });
      }

      case 'f1': {
        const language = searchParams.get('language') || undefined;
        const channels = getF1Channels(language);
        return NextResponse.json({ channels, total: channels.length }, { headers: responseHeaders });
      }

      case 'list':
      default: {
        const category = searchParams.get('category') || undefined;
        const language = searchParams.get('language') || undefined;
        const country = searchParams.get('country') || undefined;
        const search = searchParams.get('search') || undefined;
        const page = parseInt(searchParams.get('page') || '1', 10);
        const limit = parseInt(searchParams.get('limit') || '20', 10);

        const result = getChannels({ category, language, country, search, page, limit });
        return NextResponse.json(result, { headers: responseHeaders });
      }
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Internal error';
    return NextResponse.json(
      { error: message },
      { status: 500, headers: responseHeaders }
    );
  }
}
