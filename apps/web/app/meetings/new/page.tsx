import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth';
import { startMeetingAction } from '@/lib/meeting-actions';
import { listMeetingTypes } from '@/lib/meeting-type-actions';

/** Nova reunião: título + tipo (escopa quais conselheiros participam). */
export default async function NewMeetingPage() {
  const user = await getCurrentUser();
  if (!user) redirect('/login');

  const types = await listMeetingTypes(user.companyId);
  const defaultType = types.find((t) => t.isDefault) ?? types[0];

  return (
    <main className="mx-auto min-h-screen max-w-md p-8">
      <header className="border-b border-ink/10 pb-5">
        <h1 className="font-display text-2xl font-semibold tracking-tight text-ink">
          Nova reunião
        </h1>
        <p className="text-sm text-ink-muted">
          O conselho assiste ao vivo e gera os relatórios ao final.
        </p>
      </header>

      <form action={startMeetingAction} className="card-premium mt-8 space-y-4 p-6">
        <label className="block">
          <span className="text-sm font-medium text-ink">Título da reunião</span>
          <input
            name="title"
            required
            placeholder="Ex.: Diretoria — aprovação do terreno da zona norte"
            className="mt-1.5 w-full rounded-[var(--radius)] border border-ink/15 bg-white px-3.5 py-2.5 text-sm text-ink transition-colors focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20"
          />
        </label>
        <label className="block">
          <span className="text-sm font-medium text-ink">Tipo de reunião</span>
          <select
            name="meetingTypeId"
            defaultValue={defaultType?.id}
            className="mt-1.5 w-full rounded-[var(--radius)] border border-ink/15 bg-white px-3.5 py-2.5 text-sm text-ink transition-colors focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20"
          >
            {types.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
          <span className="mt-1 block text-xs text-ink-muted">
            Define quais conselheiros participam —{' '}
            <Link href="/meeting-types" className="underline hover:text-ink">
              gerenciar tipos
            </Link>
            .
          </span>
        </label>
        <p className="text-xs text-ink-muted">
          O título é cifrado em repouso. A gravação só liga depois que você confirmar que os
          participantes estão de acordo.
        </p>
        <div className="flex items-center justify-between pt-2">
          <Link href="/" className="text-sm text-ink-muted hover:text-ink hover:underline">
            ← Voltar
          </Link>
          <button
            type="submit"
            className="rounded-[var(--radius)] bg-brand px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition-opacity hover:opacity-90"
          >
            Criar e abrir a sala
          </button>
        </div>
      </form>
    </main>
  );
}
