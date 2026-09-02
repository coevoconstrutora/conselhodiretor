import { requireCurrentUser } from '@/lib/auth';
import { getDb } from '@/lib/db';
import { getEncryptionKey } from '@/lib/crypto-key';
import { listMeetingTypes } from '@/lib/meeting-type-actions';
import { findLatestClosedMeetingOfType } from '@conselho/meeting-report';
import { NewMeetingForm } from '@/components/new-meeting-form';

/** Nova reunião: título + tipo (escopa quais conselheiros participam) + pauta opcional. */
export default async function NewMeetingPage() {
  const user = await requireCurrentUser();

  const types = await listMeetingTypes(user.companyId);
  const defaultType = types.find((t) => t.isDefault) ?? types[0];

  // Contexto da reunião anterior (Etapa "Histórico de reuniões", Seção 10) —
  // 1 preview por tipo, calculado uma vez aqui (a troca de tipo no formulário
  // só escolhe entre os já carregados, sem round-trip ao servidor).
  const db = await getDb();
  const key = getEncryptionKey();
  const previousByType: Record<
    string,
    {
      meetingId: string;
      title: string;
      closedAt: string;
      decisionsCount: number;
      pendingDecisionsCount: number;
      actionItemsCount: number;
    } | null
  > = {};
  for (const t of types) {
    const preview = await findLatestClosedMeetingOfType(db, user.companyId, t.id, key).catch(() => null);
    previousByType[t.id] = preview
      ? {
          meetingId: preview.meetingId,
          title: preview.title,
          closedAt: preview.closedAt.toISOString(),
          decisionsCount: preview.decisionsCount,
          pendingDecisionsCount: preview.pendingDecisionsCount,
          actionItemsCount: preview.actionItemsCount,
        }
      : null;
  }

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

      <NewMeetingForm types={types} defaultTypeId={defaultType?.id} previousByType={previousByType} />
    </main>
  );
}
