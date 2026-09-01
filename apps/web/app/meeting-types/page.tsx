import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getAgentProfiles } from '@conselho/kb';
import { PRESIDENT_AGENT_ID } from '@conselho/providers';
import { requireCurrentUser, canWrite } from '@/lib/auth';
import { getDb } from '@/lib/db';
import { listMeetingTypes } from '@/lib/meeting-type-actions';
import { loadAndApplyProfileOverrides } from '@/lib/kb-sources';
import { CreateMeetingTypeForm, MeetingTypesList } from '@/components/meeting-types-admin';

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
    <main className="mx-auto min-h-screen max-w-4xl p-6 sm:p-8">
      <header className="flex flex-wrap items-center justify-between gap-4 border-b border-ink/10 pb-5">
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
