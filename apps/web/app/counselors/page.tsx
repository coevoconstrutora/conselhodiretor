import { redirect } from 'next/navigation';
import { getAgentProfiles, DEFAULT_AGENT_PROFILES } from '@conselho/kb';
import { PRESIDENT_AGENT_ID } from '@conselho/providers';
import { requireCurrentUser, canWrite } from '@/lib/auth';
import { getDb } from '@/lib/db';
import { loadAndApplyProfileOverrides } from '@/lib/kb-sources';
import { CreateCounselorForm, CounselorsList, type CounselorSummary } from '@/components/counselors-admin';
import { DashboardShell } from '@/components/dashboard-shell';

/** Gestão de membros do conselho: os padrão do produto + os CUSTOM desta empresa. */
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
    <DashboardShell
      pageTitle="Conselheiros"
      subtitle={
        <>
          Os conselheiros padrão do produto nunca podem ser removidos. Conselheiros custom
          precisam de palavras-chave para reagir na reunião — edite nome, escopo e alimente a base
          de cada um em <code className="rounded bg-surface-muted px-1">/counselors/[id]</code>.
        </>
      }
    >
      <section className="mt-8">
        <CreateCounselorForm />
      </section>

      <section className="mt-8">
        <h2 className="font-display text-lg font-semibold text-ink">
          {counselors.length} conselheiro{counselors.length === 1 ? '' : 's'}
        </h2>
        <CounselorsList counselors={counselors} />
      </section>
    </DashboardShell>
  );
}
