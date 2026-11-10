import Link from 'next/link';
import { getAgentProfiles } from '@conselho/kb';
import { requireCurrentUser, canWrite } from '@/lib/auth';
import { getDb } from '@/lib/db';
import { getEncryptionKey } from '@/lib/crypto-key';
import { listMeetings } from '@conselho/meetings';
import { loadAndApplyProfileOverrides } from '@/lib/kb-sources';
import { formatMeetingDuration, formatDateTimeBR, formatTimeBR } from '@/lib/format';
import { buildAgentRoster } from '@/lib/agent-display';
import { MeetingsBrowser, type MeetingListItem } from '@/components/meetings-browser';
import { CounselorsGrid } from '@/components/counselors-grid';
import { DashboardShell } from '@/components/dashboard-shell';

/** Home: reuniões do empresário + gestão dos conselheiros (NotebookLM por agente). */
export default async function DashboardPage() {
  const user = await requireCurrentUser();

  const db = await getDb();
  const key = getEncryptionKey();
  const meetings = await listMeetings(db, user.companyId, key, user.id);
  await loadAndApplyProfileOverrides(db, user.companyId); // nomes personalizados no grid
  const profiles = getAgentProfiles(user.companyId);
  // rótulos de data/estado formatados aqui (servidor) — o componente de lista só filtra e exibe
  const listItems: MeetingListItem[] = meetings.map((m) => {
    const closed = m.status === 'closed';
    const listState: MeetingListItem['state'] = closed ? 'closed' : m.recordingConfirmed ? 'live' : 'pending';
    const stateLabel = closed
      ? `🔒 encerrada${m.closedAt ? ` às ${formatTimeBR(m.closedAt)}` : ''}`
      : m.recordingConfirmed
        ? '🟢 gravação confirmada'
        : '🔒 gravação pendente';
    return {
      id: m.id,
      title: m.title,
      createdAtIso: m.createdAt.toISOString(),
      dateLabel: formatDateTimeBR(m.createdAt),
      state: listState,
      stateLabel,
      durationLabel: formatMeetingDuration(m.confirmedAt ?? m.createdAt, m.closedAt) || null,
      creatorId: m.creatorId,
      creatorName: m.creatorName,
      confidential: m.confidential,
      typeName: m.meetingTypeName,
      attendees: m.attendees,
      participantCount: m.participantCount,
      sharedCount: m.sharedCount,
    };
  });
  const specialistCount = Object.keys(profiles).filter((id) => id !== 'presidente').length;

  return (
    <DashboardShell
      subtitle={`Seu conselho de ${specialistCount} especialista${specialistCount === 1 ? '' : 's'} em cada reunião`}
    >
      <section className="mt-10 flex items-end justify-between gap-4">
        <div className="space-y-1">
          <h2 className="font-display text-xl font-semibold text-ink">
            Bem-vindo, {user.displayName}
          </h2>
          <p className="text-sm text-ink-muted">
            {meetings.length > 0
              ? `${meetings.length} ${meetings.length === 1 ? 'reunião registrada' : 'reuniões registradas'}.`
              : 'Nenhuma reunião ainda.'}
          </p>
        </div>
        {canWrite(user) ? (
          <Link
            href="/meetings/new"
            className="shrink-0 rounded-[var(--radius)] bg-brand px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition-opacity hover:opacity-90"
          >
            + Nova reunião
          </Link>
        ) : null}
      </section>

      {meetings.length === 0 ? (
        <section className="card-premium gold-hairline mt-8 p-10 text-center">
          <p className="text-sm text-ink-muted">
            Crie sua primeira reunião: o conselho transcreve ao vivo, intervém com análises e gera
            um relatório por especialista ao final.
          </p>
        </section>
      ) : (
        <MeetingsBrowser meetings={listItems} viewerId={user.id} />
      )}

      {/* Conselheiros — o "NotebookLM" de cada agente */}
      <section aria-label="Conselheiros" className="mt-12">
        <div className="border-b border-ink/10 pb-3">
          <h2 className="font-display text-xl font-semibold text-ink">Conselheiros</h2>
          <p className="text-sm text-ink-muted">
            Clique num conselheiro para editar o perfil e alimentar a base de conhecimento dele
            (textos, links e arquivos) — aplicado ao vivo, sem reiniciar.
          </p>
        </div>
        {/* Padrão + CUSTOM desta empresa — o Presidente sempre por último. */}
        <CounselorsGrid agents={buildAgentRoster(profiles)} />
      </section>
    </DashboardShell>
  );
}
