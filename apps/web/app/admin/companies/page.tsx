import { redirect } from 'next/navigation';
import { requireCurrentUser } from '@/lib/auth';
import { listCompanies } from '@/lib/company-actions';
import { listSuperAdminCandidates } from '@/lib/super-admin-actions';
import { CreateCompanyForm } from '@/components/create-company-form';
import { RenameCompanyForm } from '@/components/rename-company-form';
import { ResetCompanyHistoryForm } from '@/components/reset-counselors-form';
import { SuperAdminManager } from '@/components/super-admin-manager';
import { DashboardShell } from '@/components/dashboard-shell';
import { formatDateBR } from '@/lib/format';

/** Gestão de empresas — só super-admin. Toda empresa nasce isolada: só os 9
 * papéis genéricos do produto, zero conselheiro custom, zero conhecimento —
 * nunca clona nada de outra empresa. */
export default async function CompaniesAdminPage() {
  const user = await requireCurrentUser();
  if (!user.isSuperAdmin) redirect('/');

  const [companies, superAdminCandidates] = await Promise.all([
    listCompanies(),
    listSuperAdminCandidates(),
  ]);

  return (
    <DashboardShell
      pageTitle="Empresas"
      subtitle="Cada empresa tem seus próprios conselheiros, usuários e reuniões — isolados."
    >
      <section className="mt-8">
        <CreateCompanyForm />
      </section>

      <section className="mt-8">
        <h2 className="font-display text-lg font-semibold text-ink">
          {companies.length} empresa{companies.length === 1 ? '' : 's'}
        </h2>
        <ul className="mt-3 space-y-2">
          {companies.map((c) => (
            <li key={c.id} className="card-premium flex items-center justify-between p-4">
              <div>
                <p className="text-sm font-medium text-ink">{c.name}</p>
                <p className="text-xs text-ink-muted">
                  {c.slug} · criada em {formatDateBR(c.createdAt)}
                </p>
              </div>
              <div className="flex items-center gap-3">
                <ResetCompanyHistoryForm companyId={c.id} />
                <RenameCompanyForm companyId={c.id} name={c.name} />
              </div>
            </li>
          ))}
        </ul>
      </section>

      <section className="mt-8">
        <h2 className="font-display text-lg font-semibold text-ink">Super-admins</h2>
        <p className="text-sm text-ink-muted">
          Acesso a TODAS as empresas. Promover/remover pela tela — nunca é preciso mexer no banco.
        </p>
        <SuperAdminManager candidates={superAdminCandidates} />
      </section>
    </DashboardShell>
  );
}
