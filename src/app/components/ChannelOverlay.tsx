'use client';

import { Channel, CATEGORY_MAP, normalizeLanguage } from '@/lib/types';

interface ChannelOverlayProps {
  channel: Channel;
  visible: boolean;
}

export default function ChannelOverlay({ channel, visible }: ChannelOverlayProps) {
  const categoryMeta = CATEGORY_MAP[channel.group] || CATEGORY_MAP['other'];

  return (
    <div className={`channel-overlay ${visible ? 'overlay-visible' : 'overlay-hidden'}`}>
      {/* Channel logo */}
      {channel.logo && (
        <div className="overlay-logo-wrap">
          <img
            src={channel.logo}
            alt={channel.name}
            className="overlay-logo"
            onError={(e) => {
              (e.target as HTMLImageElement).style.display = 'none';
            }}
          />
        </div>
      )}

      {/* Channel info */}
      <div className="overlay-info">
        <h2 className="overlay-title">{channel.name}</h2>
        <div className="overlay-tags">
          <span className="overlay-tag overlay-tag-category">
            {categoryMeta.icon} {categoryMeta.nameRu}
          </span>
          {channel.language && (
            <span className="overlay-tag overlay-tag-lang">
              🌐 {normalizeLanguage(channel.language)}
            </span>
          )}
          {channel.country && (
            <span className="overlay-tag overlay-tag-country">
              📍 {channel.country}
            </span>
          )}
          {channel.isF1 && (
            <span className="overlay-tag overlay-tag-f1">
              🏎️ F1
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
