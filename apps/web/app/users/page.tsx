import { redirect } from 'next/navigation';
import { requireCurrentUser, isAdmin } from '@/lib/auth';
import { listUsers } from '@/lib/user-actions';
import { CreateUserForm, UsersTable } from '@/components/users-admin';
import { DashboardShell } from '@/components/dashboard-shell';

/** Gestão de acessos — só admin. Papéis: admin / gestor / convidado (leitura). */
export default async function UsersPage() {
  const user = await requireCurrentUser();
  if (!isAdmin(user)) redirect('/');

  const users = await listUsers();
  const knownDomains = [...new Set(users.map((u) => u.email.split('@')[1]).filter((d): d is string => !!d))];

  return (
    <DashboardShell pageTitle="Usuários" subtitle="Quem acessa o Conselho e com qual papel.">
      <section className="mt-8">
        <CreateUserForm knownDomains={knownDomains} />
      </section>

      <section className="mt-8">
        <h2 className="font-display text-lg font-semibold text-ink">
          {users.length} usuário{users.length === 1 ? '' : 's'}
        </h2>
        <UsersTable users={users} currentUserId={user.id} />
      </section>
    </DashboardShell>
  );
}
