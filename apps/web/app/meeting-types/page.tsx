import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getAgentProfiles } from '@conselho/kb';
import { COUNSELOR_AGENT_IDS } from '@conselho/providers';
import { getCurrentUser, canWrite } from '@/lib/auth';
import { getDb } from '@/lib/db';
import { listMeetingTypes } from '@/lib/meeting-type-actions';
import { loadAndApplyProfileOverrides } from '@/lib/kb-sources';
import { CreateMeetingTypeForm, MeetingTypesList } from '@/components/meeting-types-admin';

/** Tipos de reunião ("Comitê Geral", "Comitê de Engenharia", ...) — escopam
 * quais conselheiros participam. "Comitê Geral" é o padrão, não pode ser removido. */
export default async function MeetingTypesPage() {
  const user = await getCurrentUser();
  if (!user) redirect('/login');
  if (!canWrite(user)) redirect('/');

  const db = await getDb();
  await loadAndApplyProfileOverrides(db, user.companyId);
  const profiles = getAgentProfiles(user.companyId);
  const agentOptions = COUNSELOR_AGENT_IDS.map((id) => ({ id, displayName: profiles[id].displayName }));
  const types = await listMeetingTypes(user.companyId);

  return (
    <main className="mx-auto min-h-screen max-w-3xl p-8">
      <header className="flex items-center justify-between border-b border-ink/10 pb-5">
        <div>
          <h1 className="font-display text-2xl font-semibold tracking-tight text-ink">Tipos de reunião</h1>
          <p className="text-sm text-ink-muted">
            Escolha quais conselheiros participam de cada tipo — o Presidente sintetiza sempre, não precisa marcar.
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
        <CreateMeetingTypeForm agentOptions={agentOptions} />
      </section>

      <section className="mt-8">
        <h2 className="font-display text-lg font-semibold text-ink">
          {types.length} tipo{types.length === 1 ? '' : 's'}
        </h2>
        <MeetingTypesList types={types} agentOptions={agentOptions} />
      </section>
    </main>
  );
}
