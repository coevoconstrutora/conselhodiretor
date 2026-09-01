import Link from 'next/link';
import { redirect } from 'next/navigation';
import { requireCurrentUser } from '@/lib/auth';
import { listCompanies } from '@/lib/company-actions';
import { listSuperAdminCandidates } from '@/lib/super-admin-actions';
import { CreateCompanyForm } from '@/components/create-company-form';
import { RenameCompanyForm } from '@/components/rename-company-form';
import { SuperAdminManager } from '@/components/super-admin-manager';

/** Gestão de empresas — só super-admin. Clona a estrutura dos 9 conselheiros
 * da Coevo (nome/escopo) para toda empresa nova; conhecimento nunca é copiado. */
export default async function CompaniesAdminPage() {
  const user = await requireCurrentUser();
  if (!user.isSuperAdmin) redirect('/');

  const [companies, superAdminCandidates] = await Promise.all([
    listCompanies(),
    listSuperAdminCandidates(),
  ]);

  return (
    <main className="mx-auto min-h-screen max-w-2xl p-8">
      <header className="flex items-center justify-between border-b border-ink/10 pb-5">
        <div>
          <h1 className="font-display text-2xl font-semibold tracking-tight text-ink">Empresas</h1>
          <p className="text-sm text-ink-muted">
            Cada empresa tem seus próprios conselheiros, usuários e reuniões — isolados.
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
                  {c.slug} · criada em {c.createdAt.toLocaleDateString('pt-BR')}
                </p>
              </div>
              <RenameCompanyForm companyId={c.id} name={c.name} />
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
    </main>
  );
}
