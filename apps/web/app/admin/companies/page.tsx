import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth';
import { listCompanies } from '@/lib/company-actions';
import { CreateCompanyForm } from '@/components/create-company-form';

/** Gestão de empresas — só super-admin. Clona a estrutura dos 9 conselheiros
 * da Coevo (nome/escopo) para toda empresa nova; conhecimento nunca é copiado. */
export default async function CompaniesAdminPage() {
  const user = await getCurrentUser();
  if (!user) redirect('/login');
  if (!user.isSuperAdmin) redirect('/');

  const companies = await listCompanies();

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
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}
