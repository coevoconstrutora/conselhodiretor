import Link from 'next/link';
import { redirect } from 'next/navigation';
import { requireCurrentUser, isAdmin } from '@/lib/auth';
import { listUsers } from '@/lib/user-actions';
import { CreateUserForm, UsersTable } from '@/components/users-admin';

/** Gestão de acessos — só admin. Papéis: admin / gestor / convidado (leitura). */
export default async function UsersPage() {
  const user = await requireCurrentUser();
  if (!isAdmin(user)) redirect('/');

  const users = await listUsers();
  const knownDomains = [...new Set(users.map((u) => u.email.split('@')[1]).filter((d): d is string => !!d))];

  return (
    <main className="mx-auto min-h-screen max-w-4xl p-6 sm:p-8">
      <header className="flex flex-wrap items-center justify-between gap-4 border-b border-ink/10 pb-5">
        <div>
          <h1 className="font-display text-2xl font-semibold tracking-tight text-ink">Usuários</h1>
          <p className="text-sm text-ink-muted">Quem acessa o Conselho e com qual papel.</p>
        </div>
        <Link
          href="/"
          className="rounded-[var(--radius)] border border-ink/15 px-3.5 py-1.5 text-sm text-ink transition-colors hover:bg-surface-muted"
        >
          ← Voltar
        </Link>
      </header>

      <section className="mt-8 max-w-2xl">
        <CreateUserForm knownDomains={knownDomains} />
      </section>

      <section className="mt-8">
        <h2 className="font-display text-lg font-semibold text-ink">
          {users.length} usuário{users.length === 1 ? '' : 's'}
        </h2>
        <UsersTable users={users} currentUserId={user.id} />
      </section>
    </main>
  );
}
