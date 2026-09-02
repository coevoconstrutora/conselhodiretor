import 'server-only';
import type { SqlExecutor } from '@conselho/db';
import { auditedClinicalWrite } from '@conselho/audit';

/**
 * Consentimento de biometria de voz (Seção 6) — HISTÓRICO auditável, nunca
 * sobrescrito: conceder/revogar sempre INSERE um registro novo. O estado
 * "atual" é o registro mais recente por participante.
 */

export type ConsentStatus = 'granted' | 'revoked';

export interface BiometricConsent {
  readonly id: string;
  readonly participantId: string;
  readonly consentType: string;
  readonly status: ConsentStatus;
  readonly version: string;
  readonly grantedAt: Date;
  readonly revokedAt: Date | null;
  readonly grantedBy: string | null;
  readonly source: string;
}

const CONSENT_VERSION = 'v1';

function mapRow(r: {
  id: string;
  participant_id: string;
  consent_type: string;
  status: string;
  version: string;
  granted_at: Date | string;
  revoked_at: Date | string | null;
  granted_by: string | null;
  source: string;
}): BiometricConsent {
  return {
    id: r.id,
    participantId: r.participant_id,
    consentType: r.consent_type,
    status: r.status as ConsentStatus,
    version: r.version,
    grantedAt: new Date(r.granted_at),
    revokedAt: r.revoked_at ? new Date(r.revoked_at) : null,
    grantedBy: r.granted_by,
    source: r.source,
  };
}

/** Registra o consentimento EXPLÍCITO (checkbox nunca pré-marcado) antes do cadastro de voz. */
export async function grantBiometricConsent(
  db: SqlExecutor,
  participantId: string,
  grantedByUserId: string,
  source = 'admin_enrollment',
): Promise<void> {
  await auditedClinicalWrite(
    db,
    { triggeredBy: 'voice-consent-granted', kbSources: [], modelVersion: 'human-edit' },
    async (tx) => {
      await tx.query(
        `INSERT INTO participant_biometric_consent (participant_id, consent_type, status, version, granted_by, source)
         VALUES ($1, 'voice_biometrics', 'granted', $2, $3, $4)`,
        [participantId, CONSENT_VERSION, grantedByUserId, source],
      );
      return null;
    },
  );
}

/** Revoga o consentimento — desativa o matching IMEDIATAMENTE (Seção 30), não espera a próxima reunião. */
export async function revokeBiometricConsent(
  db: SqlExecutor,
  participantId: string,
  revokedByUserId: string,
): Promise<void> {
  await auditedClinicalWrite(
    db,
    { triggeredBy: 'voice-consent-revoked', kbSources: [], modelVersion: 'human-edit' },
    async (tx) => {
      await tx.query(
        `INSERT INTO participant_biometric_consent (participant_id, consent_type, status, version, revoked_at, granted_by, source)
         VALUES ($1, 'voice_biometrics', 'revoked', $2, now(), $3, 'admin_revocation')`,
        [participantId, CONSENT_VERSION, revokedByUserId],
      );
      return null;
    },
  );
}

/** Estado ATUAL do consentimento (registro mais recente) — `null` se nunca concedido. */
export async function getActiveConsent(db: SqlExecutor, participantId: string): Promise<BiometricConsent | null> {
  const res = await db.query(
    `SELECT id, participant_id, consent_type, status, version, granted_at, revoked_at, granted_by, source
     FROM participant_biometric_consent
     WHERE participant_id = $1 AND consent_type = 'voice_biometrics'
     ORDER BY created_at DESC LIMIT 1`,
    [participantId],
  );
  const row = res.rows[0] as Parameters<typeof mapRow>[0] | undefined;
  return row ? mapRow(row) : null;
}

export async function hasActiveConsent(db: SqlExecutor, participantId: string): Promise<boolean> {
  const consent = await getActiveConsent(db, participantId);
  return consent?.status === 'granted';
}

/** Histórico completo — nunca perdido, mesmo após múltiplas concessões/revogações. */
export async function listConsentHistory(db: SqlExecutor, participantId: string): Promise<BiometricConsent[]> {
  const res = await db.query(
    `SELECT id, participant_id, consent_type, status, version, granted_at, revoked_at, granted_by, source
     FROM participant_biometric_consent
     WHERE participant_id = $1 ORDER BY created_at DESC`,
    [participantId],
  );
  return (res.rows as Array<Parameters<typeof mapRow>[0]>).map(mapRow);
}
