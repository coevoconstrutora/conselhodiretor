import { redirect } from 'next/navigation';
import { listMeetingImprovements, type MeetingImprovement } from '@conselho/meeting-report';
import { getAgentProfiles } from '@conselho/kb';
import { requireCurrentUser, canWrite } from '@/lib/auth';
import { getDb } from '@/lib/db';
import { getEncryptionKey } from '@/lib/crypto-key';
import { DashboardShell } from '@/components/dashboard-shell';
import { ImprovementsTabs } from '@/components/improvements-tabs';

/**
 * "Aprendizado do Conselho" (Etapa "Auto-análise e melhoria contínua") — o
 * que a avaliação ESTRUTURADA pós-reunião aponta sobre o PRÓPRIO Conselho
 * (nunca sobre o negócio da empresa): score geral, força/problemas por
 * dimensão, desempenho por conselheiro, custo. Só LEITURA: nada aqui é
 * aplicado sozinho no sistema.
 */
export default async function ImprovementsPage() {
  const user = await requireCurrentUser();
  if (!canWrite(user)) redirect('/');

  const db = await getDb();
  const improvements = await listMeetingImprovements(db, user.companyId, getEncryptionKey());
  const profiles = getAgentProfiles(user.companyId);

  return (
    <DashboardShell
      pageTitle="🧠 Aprendizado do Conselho"
      subtitle="A cada reunião, uma avaliação estruturada aponta o que daria pra melhorar no Conselho em si — nunca conselho de negócio. Isto é só um registro para aprendizado: nada aqui é aplicado sozinho no sistema."
    >
      {improvements.length === 0 ? (
        <p className="mt-8 rounded-[var(--radius)] border border-dashed border-ink/15 p-6 text-sm text-ink-muted">
          Nenhuma análise ainda — gere os relatórios de uma reunião encerrada para produzir a primeira.
        </p>
      ) : (
        <ImprovementsTabs improvements={improvements as MeetingImprovement[]} profiles={profiles} />
      )}
    </DashboardShell>
  );
}
