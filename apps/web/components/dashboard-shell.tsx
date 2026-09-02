import type { ReactNode } from 'react';
import Link from 'next/link';
import { requireCurrentUser, canWrite, isAdmin } from '@/lib/auth';
import { logoutAction } from '@/lib/auth-actions';
import { getDb } from '@/lib/db';
import { getEncryptionKey } from '@/lib/crypto-key';
import { loadCompanyProfile } from '@/lib/company-profile';
import { CompanySwitcher } from './company-switcher';
import { ConfigMenu, type ConfigMenuItem } from './config-menu';

/**
 * Casca comum de TODA página autenticada (exceto a sala de reunião, que tem
 * chrome próprio de propósito — imersiva/escura, não "tela de gestão"): MESMA
 * barra do topo (logo, empresa ativa, menu de configuração, sair) e MESMA
 * largura de container em todas — antes cada página tinha seu próprio
 * `max-w-Nxl` solto, então navegar entre elas dava um "pulo" de largura.
 */
export async function DashboardShell({
  pageTitle,
  subtitle,
  children,
}: {
  /** Omitido na home — lá "Conselho" já é o título. Nas demais, vira "Conselho · {pageTitle}". */
  pageTitle?: string;
  subtitle?: ReactNode;
  children: ReactNode;
}) {
  const user = await requireCurrentUser();
  const db = await getDb();
  const companyProfile = await loadCompanyProfile(db, user.companyId, getEncryptionKey());

  const items: ConfigMenuItem[] = [
    { href: '/company', label: 'Empresa' },
    ...(canWrite(user) ? [{ href: '/counselors', label: 'Conselheiros' }] : []),
    ...(canWrite(user) ? [{ href: '/meeting-types', label: 'Tipos de reunião' }] : []),
    ...(canWrite(user) ? [{ href: '/improvements', label: '🧠 Melhorias' }] : []),
    ...(isAdmin(user) ? [{ href: '/users', label: 'Usuários' }] : []),
    ...(user.isSuperAdmin ? [{ href: '/admin/companies', label: 'Empresas' }] : []),
  ];

  return (
    <main className="mx-auto min-h-screen max-w-6xl p-6 sm:p-8">
      <header className="flex flex-wrap items-center justify-between gap-4 border-b border-ink/10 pb-5">
        <div className="flex items-center gap-3">
          {companyProfile.logoDataUrl ? (
            <img
              src={companyProfile.logoDataUrl}
              alt={companyProfile.name ?? 'Logo da empresa'}
              className="h-20 w-20 shrink-0 object-contain mix-blend-multiply"
            />
          ) : null}
          <div>
            <h1 className="font-display text-2xl font-semibold tracking-tight text-ink">
              <Link href="/" className="hover:underline">
                Conselho
              </Link>
              {pageTitle ? (
                <span className="ml-2 text-lg font-normal text-ink-muted">· {pageTitle}</span>
              ) : null}
            </h1>
            {subtitle ? <p className="text-sm text-ink-muted">{subtitle}</p> : null}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {pageTitle ? (
            <Link
              href="/"
              className="rounded-[var(--radius)] border border-ink/15 px-3.5 py-1.5 text-sm text-ink transition-colors hover:bg-surface-muted"
            >
              🏠 Home
            </Link>
          ) : null}
          <CompanySwitcher userId={user.id} isSuperAdmin={user.isSuperAdmin} currentCompanyId={user.companyId} />
          <ConfigMenu items={items} />
          <form action={logoutAction}>
            <button
              type="submit"
              className="rounded-[var(--radius)] border border-ink/15 px-3.5 py-1.5 text-sm text-ink transition-colors hover:bg-surface-muted"
            >
              Sair
            </button>
          </form>
        </div>
      </header>
      {children}
    </main>
  );
}
