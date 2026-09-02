import { redirect } from 'next/navigation';
import Link from 'next/link';
import { requireCurrentUser, canWrite } from '@/lib/auth';
import { getDb } from '@/lib/db';
import { listParticipants, listParticipantDepartments, type ParticipantStatus } from '@/lib/participants';
import { formatDateBR } from '@/lib/format';
import { CreateParticipantForm } from '@/components/participant-admin';
import { DashboardShell } from '@/components/dashboard-shell';

const STATUS_LABEL: Record<ParticipantStatus, string> = { active: 'Ativo', inactive: 'Inativo' };

/** Gestão de participantes REAIS de reunião (Etapa "Participantes") — distintos de usuários do sistema. */
export default async function ParticipantsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; status?: string; department?: string }>;
}) {
  const user = await requireCurrentUser();
  if (!canWrite(user)) redirect('/');

  const { q, status, department } = await searchParams;
  const db = await getDb();
  const participants = await listParticipants(db, user.companyId, {
    q,
    status: status === 'active' || status === 'inactive' ? status : undefined,
    department: department || undefined,
  });
  const departments = await listParticipantDepartments(db, user.companyId);

  return (
    <DashboardShell
      pageTitle="Participantes"
      subtitle="Pessoas reais das reuniões — com ou sem conta no sistema. Biometria de voz é opt-in e revogável a qualquer momento."
    >
      <section className="mt-8">
        <CreateParticipantForm />
      </section>

      <section className="mt-8">
        <form className="flex flex-wrap items-center gap-2" method="get">
          <input
            name="q"
            defaultValue={q ?? ''}
            placeholder="Buscar por nome, e-mail ou cargo…"
            className="w-full max-w-xs rounded-[var(--radius)] border border-ink/15 bg-white px-3 py-2 text-sm text-ink focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20"
          />
          <select
            name="status"
            defaultValue={status ?? ''}
            className="rounded-[var(--radius)] border border-ink/15 bg-white px-3 py-2 text-sm text-ink"
          >
            <option value="">Todos os status</option>
            <option value="active">Ativo</option>
            <option value="inactive">Inativo</option>
          </select>
          {departments.length > 0 ? (
            <select
              name="department"
              defaultValue={department ?? ''}
              className="rounded-[var(--radius)] border border-ink/15 bg-white px-3 py-2 text-sm text-ink"
            >
              <option value="">Todos os departamentos</option>
              {departments.map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </select>
          ) : null}
          <button
            type="submit"
            className="rounded-[var(--radius)] border border-ink/15 px-3 py-2 text-xs font-semibold text-ink transition-colors hover:bg-surface-muted"
          >
            Filtrar
          </button>
        </form>
      </section>

      <section className="mt-4">
        <h2 className="font-display text-lg font-semibold text-ink">
          {participants.length} participante{participants.length === 1 ? '' : 's'}
        </h2>
        <div className="mt-3 overflow-x-auto rounded-[var(--radius)] border border-ink/10">
          <table className="w-full min-w-[720px] text-left text-sm">
            <thead className="bg-surface-muted/60 text-xs font-semibold uppercase tracking-wide text-ink-muted">
              <tr>
                <th className="px-3 py-2">Nome</th>
                <th className="px-3 py-2">E-mail</th>
                <th className="px-3 py-2">Cargo</th>
                <th className="px-3 py-2">Departamento</th>
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2">Última participação</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-ink/10">
              {participants.map((p) => (
                <tr key={p.id} className="hover:bg-surface-muted/40">
                  <td className="px-3 py-2">
                    <Link href={`/participants/${p.id}`} className="font-medium text-ink underline-offset-2 hover:underline">
                      {p.name}
                    </Link>
                  </td>
                  <td className="px-3 py-2 text-ink-muted">{p.email ?? '—'}</td>
                  <td className="px-3 py-2 text-ink-muted">{p.jobTitle ?? '—'}</td>
                  <td className="px-3 py-2 text-ink-muted">{p.department ?? '—'}</td>
                  <td className="px-3 py-2">
                    <span
                      className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${
                        p.status === 'active' ? 'bg-success/10 text-success' : 'bg-ink/10 text-ink-muted'
                      }`}
                    >
                      {STATUS_LABEL[p.status]}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-ink-muted">
                    {p.lastMeetingAt ? formatDateBR(p.lastMeetingAt) : 'nunca'}
                  </td>
                </tr>
              ))}
              {participants.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-3 py-6 text-center text-sm text-ink-muted">
                    Nenhum participante encontrado.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>
    </DashboardShell>
  );
}
