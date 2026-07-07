import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { IBM_Plex_Mono, Inter } from 'next/font/google';
import { AppChrome } from '@/components/app-chrome';
import './globals.css';

/* Tipografia corporativa: uma única família sans (Inter) para título e corpo,
   diferenciada só por peso — o padrão de dashboards B2B (sem serifada
   editorial). Plex Mono para dados/telemetria. next/font, self-hosted, zero FOUT. */
const fontDisplay = Inter({
  subsets: ['latin'],
  weight: ['600', '700'],
  variable: '--font-display',
});
const fontBody = Inter({ subsets: ['latin'], variable: '--font-body' });
const fontMono = IBM_Plex_Mono({
  subsets: ['latin'],
  weight: ['400', '500'],
  variable: '--font-mono-data',
});

export const metadata: Metadata = {
  title: 'Conselho',
  description: 'Conselho de 9 especialistas de IA para reuniões — a IA assiste, você decide.',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html
      lang="pt-BR"
      className={`${fontDisplay.variable} ${fontBody.variable} ${fontMono.variable}`}
    >
      <body>
        <AppChrome>{children}</AppChrome>
      </body>
    </html>
  );
}
