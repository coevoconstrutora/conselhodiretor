import Link from 'next/link';
import { requireCurrentUser } from '@/lib/auth';
import { getDb } from '@/lib/db';
import { getEncryptionKey } from '@/lib/crypto-key';
import { loadCompanyProfile, listCompanySources } from '@/lib/company-profile';
import { CompanyProfileForm } from '@/components/company-profile-form';
import {
  CompanySourcesList,
  AddCompanyTextForm,
  AddCompanyUrlForm,
  AddCompanyFileForm,
} from '@/components/company-sources';

/**
 * Perfil da empresa: área CENTRAL de contexto (nome, porte, segmento, região,
 * notas) compartilhada por TODOS os 9 conselheiros — diferente de
 * /counselors/[id], que é conhecimento por especialidade.
 */
export default async function CompanyPage() {
  const user = await requireCurrentUser();

  const db = await getDb();
  const key = getEncryptionKey();
  const profile = await loadCompanyProfile(db, user.companyId, key);
  const sources = await listCompanySources(db, user.companyId, key);

  return (
    <main className="mx-auto min-h-screen max-w-5xl p-6 sm:p-8">
      <header className="flex flex-wrap items-center justify-between gap-4 border-b border-ink/10 pb-5">
        <div>
          <h1 className="font-display text-2xl font-semibold tracking-tight text-ink">
            Perfil da empresa
          </h1>
          <p className="text-sm text-ink-muted">
            Contexto compartilhado por todos os conselheiros — sem precisar repetir em cada um.
          </p>
        </div>
        <Link
          href="/"
          className="rounded-[var(--radius)] border border-ink/15 px-3.5 py-1.5 text-sm text-ink transition-colors hover:bg-surface-muted"
        >
          ← Voltar
        </Link>
      </header>

      <section className="mt-8 max-w-2xl">
        <CompanyProfileForm profile={profile} />
      </section>

      {/* Documentos: mesmo padrão do "NotebookLM por conselheiro", mas
          compartilhado por TODOS os 9 (não é por especialidade). */}
      <section className="card-premium mt-6 p-6">
        <h2 className="font-display text-base font-semibold text-ink">
          Documentos <span className="text-sm font-normal text-ink-muted">· {sources.length}</span>
        </h2>
        <p className="mt-1 text-xs text-ink-muted">
          Cifrado em repouso e auditado. Entra no contexto de TODOS os conselheiros — por isso o
          texto injetado tem um teto de tamanho (documentos muito longos são cortados).
        </p>
        <CompanySourcesList sources={sources} />
      </section>

      <section className="card-premium mt-6 p-6">
        <h2 className="font-display text-base font-semibold text-ink">Adicionar documento</h2>
        <div className="mt-4 grid gap-6 md:grid-cols-3">
          <div className="rounded-[var(--radius)] border border-ink/10 p-4">
            <AddCompanyTextForm />
          </div>
          <div className="rounded-[var(--radius)] border border-ink/10 p-4">
            <AddCompanyUrlForm />
          </div>
          <div className="rounded-[var(--radius)] border border-ink/10 p-4">
            <AddCompanyFileForm />
          </div>
        </div>
      </section>
    </main>
  );
}
