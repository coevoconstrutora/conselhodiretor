import { redirect } from 'next/navigation';
import { getAgentProfiles } from '@conselho/kb';
import { PRESIDENT_AGENT_ID } from '@conselho/providers';
import { requireCurrentUser, canWrite } from '@/lib/auth';
import { getDb } from '@/lib/db';
import { listMeetingTypes } from '@/lib/meeting-type-actions';
import { loadAndApplyProfileOverrides } from '@/lib/kb-sources';
import { CreateMeetingTypeForm, MeetingTypesList } from '@/components/meeting-types-admin';
import { DashboardShell } from '@/components/dashboard-shell';

/** Tipos de reunião ("Comitê Geral", "Comitê de Engenharia", ...) — escopam
 * quais conselheiros participam. "Comitê Geral" é o padrão, não pode ser removido. */
export default async function MeetingTypesPage() {
  const user = await requireCurrentUser();
  if (!canWrite(user)) redirect('/');

  const db = await getDb();
  await loadAndApplyProfileOverrides(db, user.companyId);
  const profiles = getAgentProfiles(user.companyId);
  // Todo conselheiro DESTA empresa — padrão + custom — exceto o Presidente
  // (ele nunca "participa" no sentido de tipo de reunião, só sintetiza).
  const agentOptions = Object.values(profiles)
    .filter((p) => p.agentId !== PRESIDENT_AGENT_ID)
    .map((p) => ({ id: p.agentId, displayName: p.displayName }));
  const types = await listMeetingTypes(user.companyId);

  return (
    <DashboardShell
      pageTitle="Tipos de reunião"
      subtitle="Escolha quais conselheiros participam de cada tipo — o Presidente sintetiza sempre, não precisa marcar."
    >
      <section className="mt-8">
        <CreateMeetingTypeForm agentOptions={agentOptions} />
      </section>

      <section className="mt-8">
        <h2 className="font-display text-lg font-semibold text-ink">
          {types.length} tipo{types.length === 1 ? '' : 's'}
        </h2>
        <MeetingTypesList types={types} agentOptions={agentOptions} />
      </section>
    </DashboardShell>
  );
}
