import { notFound } from 'next/navigation';
import { requireCurrentUser, canWrite } from '@/lib/auth';
import { getDb } from '@/lib/db';
import { getParticipant } from '@/lib/participants';
import { getParticipantVoiceStatus } from '@/lib/voice-profile';
import { getActiveConsent } from '@/lib/biometric-consent';
import { listParticipantMeetingHistory } from '@/lib/meeting-speakers';
import { formatDateBR } from '@/lib/format';
import { ParticipantProfileForm } from '@/components/participant-admin';
import { ParticipantVoiceSection } from '@/components/participant-voice-wizard';
import { DashboardShell } from '@/components/dashboard-shell';

const STATUS_LABEL: Record<string, string> = {
  identified: 'Identificado',
  probable: 'Provável',
  confirmation_required: 'Confirmação necessária',
  unknown: 'Não identificado',
  manually_confirmed: 'Confirmado manualmente',
};

export default async function ParticipantProfilePage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireCurrentUser();
  if (!canWrite(user)) notFound();
  const { id } = await params;

  const db = await getDb();
  const participant = await getParticipant(db, user.companyId, id);
  if (!participant) notFound();

  const voiceStatus = await getParticipantVoiceStatus(db, user.companyId, id);
  const consent = await getActiveConsent(db, id);
  const history = await listParticipantMeetingHistory(db, user.companyId, id);

  return (
    <DashboardShell pageTitle={participant.name}>
      <section aria-label="Dados do participante" className="card-premium mt-8 p-6">
        <h2 className="font-display text-base font-semibold text-ink">
          <span className="blueprint-index mr-2 text-brand/70">01/</span>
          Dados do participante
        </h2>
        <p className="mb-4 text-xs text-ink-muted">
          {participant.appUserId
            ? `Conta vinculada: ${participant.appUserEmail}`
            : 'Sem acesso ao sistema — não temos (e não criamos) login para esta pessoa automaticamente.'}
        </p>
        <ParticipantProfileForm participant={participant} />
      </section>

      <section aria-label="Biometria de voz" className="card-premium mt-6 p-6">
        <h2 className="font-display text-base font-semibold text-ink">
          <span className="blueprint-index mr-2 text-brand/70">02/</span>
          Biometria de voz
        </h2>
        <ParticipantVoiceSection
          participantId={participant.id}
          participantName={participant.name}
          participantArea={participant.department}
          status={voiceStatus}
          consentGranted={consent?.status === 'granted'}
        />
      </section>

      <section aria-label="Histórico de reuniões" className="card-premium mt-6 p-6">
        <h2 className="font-display text-base font-semibold text-ink">
          <span className="blueprint-index mr-2 text-brand/70">03/</span>
          Histórico de reuniões <span className="text-sm font-normal text-ink-muted">· {history.length}</span>
        </h2>
        {history.length === 0 ? (
          <p className="mt-3 text-sm text-ink-muted">Nenhuma participação identificada ainda.</p>
        ) : (
          <ul className="mt-3 divide-y divide-ink/10">
            {history.map((h) => (
              <li key={h.meetingId} className="flex items-center justify-between gap-3 py-2.5 text-sm">
                <div className="min-w-0">
                  <p className="truncate font-medium text-ink">{h.meetingTitle}</p>
                  <p className="text-[11px] text-ink-muted">
                    {h.closedAt ? formatDateBR(h.closedAt) : '—'}
                    {h.speakingTurns !== null ? ` · ${h.speakingTurns} intervenções` : ''}
                    {h.speechShare !== null ? ` · ${Math.round(h.speechShare * 100)}% da fala identificada` : ''}
                  </p>
                </div>
                <span className="shrink-0 rounded-full bg-surface-muted px-2 py-0.5 text-[11px] text-ink-muted">
                  {STATUS_LABEL[h.identificationStatus] ?? h.identificationStatus}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </DashboardShell>
  );
}
