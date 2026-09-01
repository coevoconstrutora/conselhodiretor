import { requireCurrentUser } from '@/lib/auth';
import { getDb } from '@/lib/db';
import { getEncryptionKey } from '@/lib/crypto-key';
import { loadCompanyProfile, listCompanySources, rescanDueCompanySources } from '@/lib/company-profile';
import { CompanyProfileForm } from '@/components/company-profile-form';
import { CompanyAppearanceForm } from '@/components/company-appearance-form';
import { DashboardShell } from '@/components/dashboard-shell';
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

  // revisão automática de links vencidos — best-effort, nunca bloqueia o render
  void rescanDueCompanySources(db, user.companyId, key).catch((error) => {
    console.error('[empresa] revisão automática falhou:', error);
  });

  return (
    <DashboardShell
      pageTitle="Perfil da empresa"
      subtitle="Contexto compartilhado por todos os conselheiros — sem precisar repetir em cada um."
    >
      <section className="mt-8">
        <CompanyProfileForm profile={profile} />
      </section>

      {/* Aparência: logo + tema visual — separado do perfil de negócio de propósito. */}
      <section className="mt-6">
        <h2 className="font-display text-base font-semibold text-ink">Aparência</h2>
        <p className="mt-1 text-xs text-ink-muted">
          Logo e cores aparecem só na tela — nunca entram no contexto dos conselheiros.
        </p>
        <div className="mt-3">
          <CompanyAppearanceForm profile={profile} />
        </div>
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
    </DashboardShell>
  );
}
