import { getChannels, getCategories } from '@/lib/channels-store';
import ChannelFeed from './components/ChannelFeed';

export const revalidate = 3600; // ISR: revalidate every hour

export default function HomePage() {
  // Server-side: load initial F1 channels (Russian first)
  const { channels: initialChannels } = getChannels({
    category: 'f1',
    page: 1,
    limit: 30,
  });

  const categories = getCategories();

  // If no F1 channels, fall back to sports
  const fallbackChannels = initialChannels.length > 0
    ? initialChannels
    : getChannels({ category: 'sports', page: 1, limit: 30 }).channels;

  return (
    <main className="main-container">
      <ChannelFeed
        initialChannels={fallbackChannels}
        categories={categories}
      />
    </main>
  );
}
