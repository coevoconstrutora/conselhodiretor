import { requireCurrentUser } from '@/lib/auth';
import { getDb } from '@/lib/db';
import { getEncryptionKey } from '@/lib/crypto-key';
import { loadCompanyProfile } from '@/lib/company-profile';
import { findParticipantByAppUser } from '@/lib/participants';
import { getParticipantVoiceStatus } from '@/lib/voice-profile';
import { getActiveConsent } from '@/lib/biometric-consent';
import { DashboardShell } from '@/components/dashboard-shell';
import { ProfileForm, PasswordForm, EnableOwnParticipant } from '@/components/profile-forms';
import { ParticipantVoiceSection } from '@/components/participant-voice-wizard';

const ROLE_LABEL = { admin: 'Administrador', gestor: 'Gestor', convidado: 'Convidado' } as const;

/** "Meu perfil" — qualquer usuário autenticado (inclusive convidado) edita a PRÓPRIA conta. */
export default async function ProfilePage() {
  const user = await requireCurrentUser();
  const db = await getDb();
  const companyProfile = await loadCompanyProfile(db, user.companyId, getEncryptionKey());
  const participant = await findParticipantByAppUser(db, user.companyId, user.id);
  const voiceStatus = participant ? await getParticipantVoiceStatus(db, user.companyId, participant.id) : null;
  const consent = participant ? await getActiveConsent(db, participant.id) : null;

  return (
    <DashboardShell
      pageTitle="Meu perfil"
      subtitle={`${user.email} · ${ROLE_LABEL[user.role]}${companyProfile.name ? ` em ${companyProfile.name}` : ''}`}
    >
      <section aria-label="Dados pessoais" className="card-premium mt-8 p-6">
        <h2 className="font-display text-base font-semibold text-ink">
          <span className="blueprint-index mr-2 text-brand/70">01/</span>
          Dados pessoais
        </h2>
        <p className="mb-4 text-xs text-ink-muted">
          O nome aparece nas reuniões e na transcrição. Cargo e área são usados na identificação por voz e na ata
          desta empresa. Para trocar o e-mail de login, fale com um administrador.
        </p>
        <ProfileForm
          email={user.email}
          displayName={user.displayName}
          jobTitle={participant?.jobTitle ?? null}
          department={participant?.department ?? null}
        />
      </section>

      <section aria-label="Senha" className="card-premium mt-6 p-6">
        <h2 className="font-display text-base font-semibold text-ink">
          <span className="blueprint-index mr-2 text-brand/70">02/</span>
          Senha
        </h2>
        <div className="mt-3">
          <PasswordForm />
        </div>
      </section>

      <section aria-label="Minha voz" className="card-premium mt-6 p-6">
        <h2 className="font-display text-base font-semibold text-ink">
          <span className="blueprint-index mr-2 text-brand/70">03/</span>
          Minha voz
        </h2>
        <p className="mb-4 mt-1 text-xs text-ink-muted">
          Grave amostras da sua voz para o Conselho reconhecer você nas reuniões. A biometria não é usada para login
          e você pode revogá-la ou excluí-la quando quiser.
          {companyProfile.voiceRecognitionEnabled
            ? ''
            : ' O reconhecimento de voz está desligado nesta empresa — o cadastro fica guardado, mas só passa a valer quando um administrador ligar o recurso.'}
        </p>
        {participant && voiceStatus ? (
          <ParticipantVoiceSection
            participantId={participant.id}
            participantName={participant.name}
            participantArea={participant.department}
            status={voiceStatus}
            consentGranted={consent?.status === 'granted'}
          />
        ) : (
          <EnableOwnParticipant />
        )}
      </section>
    </DashboardShell>
  );
}
