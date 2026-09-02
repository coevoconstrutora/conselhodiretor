import { requireCurrentUser } from '@/lib/auth';
import { listMeetingTypes } from '@/lib/meeting-type-actions';
import { NewMeetingForm } from '@/components/new-meeting-form';

/** Nova reunião: título + tipo (escopa quais conselheiros participam) + pauta opcional. */
export default async function NewMeetingPage() {
  const user = await requireCurrentUser();

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

      <NewMeetingForm types={types} defaultTypeId={defaultType?.id} />
    </main>
  );
}
