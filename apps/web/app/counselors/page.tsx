import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getAgentProfiles, DEFAULT_AGENT_PROFILES } from '@conselho/kb';
import { PRESIDENT_AGENT_ID } from '@conselho/providers';
import { requireCurrentUser, canWrite } from '@/lib/auth';
import { getDb } from '@/lib/db';
import { loadAndApplyProfileOverrides } from '@/lib/kb-sources';
import { CreateCounselorForm, CounselorsList, type CounselorSummary } from '@/components/counselors-admin';

/** Gestão de membros do conselho: os 9 padrão + os CUSTOM desta empresa. */
export default async function CounselorsPage() {
  const user = await requireCurrentUser();
  if (!canWrite(user)) redirect('/');

  const db = await getDb();
  await loadAndApplyProfileOverrides(db, user.companyId);
  const profiles = getAgentProfiles(user.companyId);
  const counselors: CounselorSummary[] = Object.values(profiles)
    .filter((p) => p.agentId !== PRESIDENT_AGENT_ID)
    .map((p) => ({
      agentId: p.agentId,
      displayName: p.displayName,
      scope: p.scope,
      isDefault: p.agentId in DEFAULT_AGENT_PROFILES,
      iconKey: p.iconKey ?? null,
      iconColor: p.iconColor ?? null,
    }));

  return (
    <main className="mx-auto min-h-screen max-w-4xl p-6 sm:p-8">
      <header className="flex flex-wrap items-center justify-between gap-4 border-b border-ink/10 pb-5">
        <div>
          <h1 className="font-display text-2xl font-semibold tracking-tight text-ink">Conselheiros</h1>
          <p className="text-sm text-ink-muted">
            Os 9 padrão nunca podem ser removidos. Conselheiros custom precisam de palavras-chave
            para reagir na reunião — edite nome, escopo e alimente a base de cada um em{' '}
            <code className="rounded bg-surface-muted px-1">/counselors/[id]</code>.
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
        <CreateCounselorForm />
      </section>

      <section className="mt-8">
        <h2 className="font-display text-lg font-semibold text-ink">
          {counselors.length} conselheiro{counselors.length === 1 ? '' : 's'}
        </h2>
        <CounselorsList counselors={counselors} />
      </section>
    </main>
  );
}
