import type { Metadata, Viewport } from 'next';
import { Inter } from 'next/font/google';
import './globals.css';

const inter = Inter({
  subsets: ['latin', 'cyrillic'],
  variable: '--font-inter',
});

export const metadata: Metadata = {
  title: 'amadeusTV.vercel.app — IPTV Streaming',
  description: 'Мобильный IPTV плеер с доступом к тысячам каналов. Формула 1, спорт, кино и новости — всё в одном месте.',
  keywords: 'iptv, streaming, formula 1, f1, tv, amadeus tv, live tv',
  openGraph: {
    title: 'amadeusTV.vercel.app',
    description: 'Смотри ТВ каналы откуда угодно. F1, спорт, кино — бесплатно.',
    type: 'website',
  },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  themeColor: '#0a0a0f',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="ru" className={inter.variable}>
      <body>{children}</body>
    </html>
  );
}
