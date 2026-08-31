import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth';
import { getDb } from '@/lib/db';
import { getEncryptionKey } from '@/lib/crypto-key';
import { loadCompanyProfile } from '@/lib/company-profile';
import { CompanyProfileForm } from '@/components/company-profile-form';

/**
 * Perfil da empresa: área CENTRAL de contexto (nome, porte, segmento, região,
 * notas) compartilhada por TODOS os 9 conselheiros — diferente de
 * /counselors/[id], que é conhecimento por especialidade.
 */
export default async function CompanyPage() {
  const user = await getCurrentUser();
  if (!user) redirect('/login');

  const db = await getDb();
  const profile = await loadCompanyProfile(db, getEncryptionKey());

  return (
    <main className="mx-auto min-h-screen max-w-2xl p-8">
      <header className="flex items-center justify-between border-b border-ink/10 pb-5">
        <div>
          <h1 className="font-display text-2xl font-semibold tracking-tight text-ink">
            Perfil da empresa
          </h1>
          <p className="text-sm text-ink-muted">
            Contexto compartilhado por todos os 9 conselheiros — sem precisar repetir em cada um.
          </p>
        </div>
        <Link
          href="/"
          className="rounded-[var(--radius)] border border-ink/15 px-3.5 py-1.5 text-sm text-ink transition-colors hover:bg-surface-muted"
        >
          ← Voltar
        </Link>
      </header>

      <section className="mt-8">
        <CompanyProfileForm profile={profile} />
      </section>
    </main>
  );
}
