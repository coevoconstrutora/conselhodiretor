import Link from 'next/link';
import { getDb } from '@/lib/db';
import { formatDateBR, formatTimeBR, startOfTodayBR } from '@/lib/format';
import { agendaConfigFromEnv, listCouncilMeetings, type AgendaMeeting } from '@/lib/agenda-client';

const WINDOW_DAYS = 30;
const MAX_ITEMS = 8;

/**
 * A integração com a Agenda é da empresa "casa" do token (a Coevo). Em app
 * multiempresa, outra empresa nunca deve ver a agenda alheia — por isso só
 * aparece quando o slug da empresa ativa bate com AGENDA_COMPANY_SLUG.
 */
async function companyOwnsAgenda(companyId: string): Promise<boolean> {
  const slug = (process.env.AGENDA_COMPANY_SLUG ?? 'coevo').trim();
  const db = await getDb();
  const res = await db.query<{ slug: string }>('SELECT slug FROM company WHERE id = $1', [companyId]);
  return res.rows[0]?.slug === slug;
}

function newMeetingHref(m: AgendaMeeting): string {
  const params = new URLSearchParams({ title: m.title });
  if (m.meetingUrl) params.set('meetingUrl', m.meetingUrl);
  return `/meetings/new?${params.toString()}`;
}

function whenLabel(m: AgendaMeeting): string {
  const hm = { hour: '2-digit', minute: '2-digit' } as const;
  return `${formatDateBR(m.startAt)} · ${formatTimeBR(m.startAt, hm)}–${formatTimeBR(m.endAt, hm)}`;
}

/** "Próximas reuniões da Agenda" — consulta só leitura, aguardada em Suspense (nunca trava a home). */
export async function AgendaUpcoming({ companyId, isAdmin }: { companyId: string; isAdmin: boolean }) {
  if (!(await companyOwnsAgenda(companyId))) return null;

  const config = agendaConfigFromEnv();
  if (!config) {
    return isAdmin ? (
      <p className="mt-8 text-xs text-ink-muted">
        📅 Integração com a Agenda desligada — defina <code className="rounded bg-surface-muted px-1">AGENDA_API_TOKEN</code>{' '}
        no servidor para listar aqui as reuniões marcadas com "Enviar ao comitê".
      </p>
    ) : null;
  }

  const now = new Date();
  const result = await listCouncilMeetings(config, {
    // desde o INÍCIO de hoje: a API só devolve reuniões que terminam depois de `from`,
    // então com `from = agora` a reunião da manhã sumia assim que acabava.
    from: startOfTodayBR(now),
    to: new Date(now.getTime() + WINDOW_DAYS * 24 * 60 * 60 * 1000),
  });

  return (
    <section aria-label="Agenda do comitê" className="mt-8">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="font-display text-lg font-semibold text-ink">📅 Agenda do comitê</h2>
        <span className="text-xs text-ink-muted">hoje e próximos {WINDOW_DAYS} dias · marcadas com "Enviar ao comitê"</span>
      </div>

      {result.status === 'error' ? (
        <p className="card-premium mt-3 p-4 text-sm text-ink-muted">⚠ {result.message}</p>
      ) : result.status === 'ok' && result.meetings.length === 0 ? (
        <p className="card-premium mt-3 p-4 text-sm text-ink-muted">Nenhuma reunião do comitê hoje nem nos próximos {WINDOW_DAYS} dias. Confira na Agenda se o evento foi salvo, está aprovado e marcado com "Enviar ao comitê".</p>
      ) : result.status === 'ok' ? (
        <ul className="mt-3 space-y-2">
          {result.meetings.slice(0, MAX_ITEMS).map((m) => {
            const ended = m.endAt.getTime() < now.getTime();
            const accepted = m.participants.filter((p) => p.response === 'accepted').length;
            return (
              <li
                key={m.id}
                className={`card-premium flex flex-wrap items-center justify-between gap-3 p-4 ${ended ? 'opacity-70' : ''}`}
              >
                <div className="min-w-0 space-y-0.5">
                  <p className="font-medium text-ink">
                    {m.title}
                    {ended ? (
                      <span className="ml-2 rounded-full bg-surface-muted px-2 py-0.5 text-[11px] font-medium text-ink-muted">
                        já aconteceu hoje
                      </span>
                    ) : null}
                  </p>
                  <p className="text-xs text-ink-muted">
                    {whenLabel(m)}
                    {m.roomName ? ` · ${m.roomName}` : ''}
                    {m.organizer ? ` · organizada por ${m.organizer.name}` : ''}
                    {m.participants.length > 0 ? ` · 👥 ${accepted}/${m.participants.length} confirmaram` : ''}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  {m.meetingUrl ? (
                    <a
                      href={m.meetingUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="rounded-[var(--radius)] border border-ink/15 px-3 py-1.5 text-xs font-semibold text-ink transition-colors hover:bg-surface-muted"
                    >
                      Abrir link
                    </a>
                  ) : null}
                  <Link
                    href={newMeetingHref(m)}
                    className="rounded-[var(--radius)] bg-brand px-3 py-1.5 text-xs font-semibold text-white shadow-sm transition-opacity hover:opacity-90"
                  >
                    Criar reunião
                  </Link>
                </div>
              </li>
            );
          })}
        </ul>
      ) : null}
      {result.status === 'ok' && result.meetings.length > MAX_ITEMS ? (
        <p className="mt-2 text-xs text-ink-muted">+ {result.meetings.length - MAX_ITEMS} reunião(ões) além das {MAX_ITEMS} primeiras.</p>
      ) : null}
    </section>
  );
}
