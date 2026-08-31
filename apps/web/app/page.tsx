import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getAgentProfiles } from '@conselho/kb';
import { ALL_AGENT_IDS } from '@conselho/providers';
import { getCurrentUser, canWrite, isAdmin } from '@/lib/auth';
import { logoutAction } from '@/lib/auth-actions';
import { getDb } from '@/lib/db';
import { getEncryptionKey } from '@/lib/crypto-key';
import { listMeetings } from '@conselho/meetings';
import { countKbSourcesByAgent, loadAndApplyProfileOverrides } from '@/lib/kb-sources';
import { formatMeetingDuration } from '@/lib/format';
import { CompanySwitcher } from '@/components/company-switcher';

const AGENT_EMOJI: Record<string, string> = {
  engenharia: '🏗️',
  vendas: '📣',
  mercado: '📊',
  arquitetura: '📐',
  legal: '⚖️',
  cs: '🤝',
  cfo: '💰',
  futurista: '🔭',
  presidente: '⭐',
};

/** Home: reuniões do empresário + gestão dos conselheiros (NotebookLM por agente). */
export default async function DashboardPage() {
  const user = await getCurrentUser();
  if (!user) {
    redirect('/login');
  }

  const db = await getDb();
  const meetings = await listMeetings(db, user.companyId, getEncryptionKey());
  await loadAndApplyProfileOverrides(db, user.companyId); // nomes personalizados no grid
  const sourceCounts = await countKbSourcesByAgent(db, user.companyId);
  const profiles = getAgentProfiles(user.companyId);

  return (
    <main className="mx-auto min-h-screen max-w-3xl p-8">
      <header className="flex items-center justify-between border-b border-ink/10 pb-5">
        <div>
          <h1 className="font-display text-2xl font-semibold tracking-tight text-ink">Conselho</h1>
          <p className="text-sm text-ink-muted">Seu conselho de 9 especialistas em cada reunião</p>
        </div>
        <div className="flex items-center gap-2">
          <CompanySwitcher userId={user.id} isSuperAdmin={user.isSuperAdmin} currentCompanyId={user.companyId} />
          {user.isSuperAdmin ? (
            <Link
              href="/admin/companies"
              className="rounded-[var(--radius)] border border-ink/15 px-3.5 py-1.5 text-sm text-ink transition-colors hover:bg-surface-muted"
            >
              Empresas
            </Link>
          ) : null}
          <Link
            href="/company"
            className="rounded-[var(--radius)] border border-ink/15 px-3.5 py-1.5 text-sm text-ink transition-colors hover:bg-surface-muted"
          >
            Empresa
          </Link>
          {isAdmin(user) ? (
            <Link
              href="/users"
              className="rounded-[var(--radius)] border border-ink/15 px-3.5 py-1.5 text-sm text-ink transition-colors hover:bg-surface-muted"
            >
              Usuários
            </Link>
          ) : null}
          <form action={logoutAction}>
            <button
              type="submit"
              className="rounded-[var(--radius)] border border-ink/15 px-3.5 py-1.5 text-sm text-ink transition-colors hover:bg-surface-muted"
            >
              Sair
            </button>
          </form>
        </div>
      </header>

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
        <ul className="mt-8 space-y-3">
          {meetings.map((m) => {
            const closed = m.status === 'closed';
            const duration = formatMeetingDuration(m.confirmedAt ?? m.createdAt, m.closedAt);
            return (
              <li key={m.id}>
                <Link
                  href={`/meetings/${m.id}`}
                  className="card-premium flex items-center justify-between p-5 transition-shadow hover:shadow-md"
                >
                  <div>
                    <p className="font-medium text-ink">{m.title}</p>
                    <p className="text-xs text-ink-muted">
                      {m.createdAt.toLocaleString('pt-BR')} ·{' '}
                      {closed
                        ? '🔒 encerrada'
                        : m.recordingConfirmed
                          ? '🟢 gravação confirmada'
                          : '🔒 gravação pendente'}
                      {closed && m.closedAt ? ` às ${m.closedAt.toLocaleTimeString('pt-BR')}` : ''}
                      {duration ? ` · ⏱ ${duration}` : ''}
                      {m.participantCount ? ` · 👥 ${m.participantCount}` : ''}
                    </p>
                  </div>
                  <span className="text-sm text-ink-muted">abrir →</span>
                </Link>
              </li>
            );
          })}
        </ul>
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
        <ul className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {ALL_AGENT_IDS.map((agentId) => {
            const profile = profiles[agentId];
            const count = sourceCounts.get(agentId) ?? 0;
            const isPresident = agentId === 'presidente';
            return (
              <li key={agentId}>
                <Link
                  href={`/counselors/${agentId}`}
                  className="card-premium flex h-full items-start gap-3 p-4 transition-shadow hover:shadow-md"
                >
                  <span aria-hidden="true" className="text-2xl leading-none">
                    {AGENT_EMOJI[agentId]}
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-semibold text-ink">
                      {profile.displayName}
                    </span>
                    <span className="mt-0.5 line-clamp-2 block text-xs leading-snug text-ink-muted">
                      {profile.scope}
                    </span>
                    <span className="blueprint-index mt-1.5 block text-brand/70">
                      {isPresident
                        ? 'sintetizador — sem base própria'
                        : `${count} fonte(s) própria(s) + base padrão`}
                    </span>
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      </section>
    </main>
  );
}
