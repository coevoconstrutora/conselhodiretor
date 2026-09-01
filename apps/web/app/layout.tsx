import type { CSSProperties } from 'react';
import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { IBM_Plex_Mono, Inter } from 'next/font/google';
import { AppChrome } from '@/components/app-chrome';
import { getCurrentUser } from '@/lib/auth';
import { getDb } from '@/lib/db';
import { getEncryptionKey } from '@/lib/crypto-key';
import { loadCompanyProfile } from '@/lib/company-profile';
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

/**
 * Tema visual da empresa ATIVA na sessão (cor de texto/título, fundo) — lido
 * uma vez no layout raiz (toda rota passa por aqui, incluindo /login sem
 * sessão). Best-effort: qualquer falha (sem sessão, chave rotacionada, banco
 * fora) degrada pro padrão do produto, nunca derruba a página.
 */
async function loadRootTheme(): Promise<{
  textColor: string | null;
  titleColor: string | null;
  background: 'grid' | 'plain' | null;
} | null> {
  try {
    const user = await getCurrentUser();
    if (!user) return null;
    const db = await getDb();
    const profile = await loadCompanyProfile(db, user.companyId, getEncryptionKey());
    return {
      textColor: profile.themeTextColor ?? null,
      titleColor: profile.themeTitleColor ?? null,
      background: profile.themeBackground ?? null,
    };
  } catch {
    return null;
  }
}

export default async function RootLayout({ children }: { children: ReactNode }) {
  const theme = await loadRootTheme();
  const htmlStyle: CSSProperties = {
    ...(theme?.textColor ? { '--company-text': theme.textColor } : {}),
    ...(theme?.titleColor ? { '--company-title': theme.titleColor } : {}),
  } as CSSProperties;

  return (
    <html
      lang="pt-BR"
      className={`${fontDisplay.variable} ${fontBody.variable} ${fontMono.variable}`}
      style={htmlStyle}
    >
      <body className={theme?.background === 'plain' ? 'theme-plain' : undefined}>
        <AppChrome>{children}</AppChrome>
      </body>
    </html>
  );
}
