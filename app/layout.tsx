import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  metadataBase: new URL('https://artemefik888-dev.github.io/sber-smart-home-configurator/'),
  title: 'Конфигуратор Умный дом Sber',
  description: 'Расчёт оборудования Умного дома Sber по типовым квартирам, помещениям и категориям.',
  applicationName: 'Конфигуратор Умный дом Sber',
  icons: { icon: '/favicon.svg' },
  alternates: { canonical: '/' },
  openGraph: {
    type: 'website',
    locale: 'ru_RU',
    title: 'Конфигуратор Умный дом Sber',
    description: 'Расчёт оборудования по помещениям, категориям и в ручном режиме.',
    url: '/',
    images: [{ url: 'https://artemefik888-dev.github.io/sber-smart-home-configurator/sber-configurator-og.png', width: 1200, height: 630, alt: 'Конфигуратор Умный дом Sber' }],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Конфигуратор Умный дом Sber',
    description: 'Расчёт оборудования по помещениям, категориям и в ручном режиме.',
    images: ['https://artemefik888-dev.github.io/sber-smart-home-configurator/sber-configurator-og.png'],
  },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ru">
      <body>{children}</body>
    </html>
  );
}
