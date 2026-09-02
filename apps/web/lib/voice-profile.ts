import 'server-only';
import type { SqlExecutor } from '@conselho/db';
import { auditedClinicalWrite } from '@conselho/audit';
import { encryptField, decryptField } from '@conselho/crypto';
import { cosineSimilarity } from './voice-similarity';
import { assessSampleQuality, averageEmbeddings } from './voice-quality';

export { assessSampleQuality } from './voice-quality';
export type { SampleQuality, SampleQualityReport } from './voice-quality';

/**
 * Biometria de voz (Etapa "Participantes e biometria de voz") — 1 linha
 * ATIVA por Participant (`participant_id`), o embedding (256 floats do
 * Resemblyzer, via `conselho-voice-embed`) cifrado com o MESMO padrão
 * simples AES-256-GCM do resto do produto (`@conselho/crypto`) — decisão
 * explícita do dono: sem KMS/envelope encryption (nenhuma infra de KMS
 * existe neste deploy). Reenrollment NUNCA sobrescreve: a linha antiga vira
 * 'superseded' e uma nova é inserida — histórico de versões preservado como
 * múltiplas linhas.
 *
 * Compatibilidade: `name`/`area` (colunas da migration 0020, quando o
 * perfil ainda era só "nome solto" por empresa) continuam preenchidas a
 * partir do Participant nas novas linhas — evita quebrar leituras antigas.
 */

export type VoiceEnrollmentStatus =
  | 'not_enrolled'
  | 'pending'
  | 'enrolled'
  | 'requires_update'
  | 'consent_revoked';

export interface VoiceProfileStatus {
  readonly status: VoiceEnrollmentStatus;
  readonly enrolledAt: Date | null;
  readonly lastUpdatedAt: Date | null;
  readonly sampleCount: number | null;
  readonly modelProvider: string | null;
  readonly modelVersion: string | null;
  readonly qualityScore: number | null;
  readonly lastUsedAt: Date | null;
}

/** Amostra de gravação enviada pelo assistente "Cadastrar voz" — SEM segredo/frase repetida (Seção 7). */
export interface VoiceSample {
  readonly audio: Buffer;
  readonly mimeType: string;
  readonly durationMs: number;
}

/** Acima disso, dois embeddings são considerados a MESMA pessoa. Calibrável por env. */
const DEFAULT_MATCH_THRESHOLD = Number(process.env.VOICE_MATCH_THRESHOLD ?? '0.75');
/** Entre os dois: sugere e pede confirmação em vez de identificar direto (Seção 17). */
const DEFAULT_PROBABLE_THRESHOLD = Number(process.env.VOICE_PROBABLE_THRESHOLD ?? '0.55');

/** Chama o serviço isolado de embeddings (`services/voice-embed`) — nunca guarda o áudio em si. */
export async function embedAudioClip(audio: Buffer, mimeType: string): Promise<number[]> {
  const url = process.env.VOICE_EMBED_URL;
  const token = process.env.VOICE_EMBED_TOKEN;
  if (!url || !token) {
    throw new Error('VOICE_EMBED_URL/VOICE_EMBED_TOKEN não configurados — reconhecimento de voz indisponível.');
  }
  const form = new FormData();
  form.append('file', new Blob([Uint8Array.from(audio)], { type: mimeType }), 'clip');
  const res = await fetch(`${url.replace(/\/$/, '')}/embed`, {
    method: 'POST',
    headers: { 'x-internal-token': token },
    body: form,
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`Serviço de embedding de voz falhou (${res.status}): ${detail.slice(0, 200)}`);
  }
  const data = (await res.json()) as { embedding: number[] };
  return data.embedding;
}

/**
 * Cadastro EXPLÍCITO (assistente "Cadastrar voz", Seção 7) — recebe as
 * amostras JÁ com consentimento verificado pelo chamador (`grantBiometricConsent`
 * antes desta função, nunca depois). Nunca sobrescreve uma linha ativa:
 * marca a anterior 'superseded' e insere uma nova (Seção 12 — preservar
 * histórico). O áudio bruto passa só por memória — nunca é persistido
 * (Seção 9); a única saída desta função é o embedding cifrado.
 */
export async function enrollParticipantVoice(
  db: SqlExecutor,
  companyId: string,
  participantId: string,
  participantName: string,
  participantArea: string | null,
  samples: readonly VoiceSample[],
  key: Buffer,
): Promise<{ qualityScore: number }> {
  if (samples.length === 0) throw new Error('Nenhuma amostra de voz recebida.');
  const embeddings: number[][] = [];
  let totalQuality = 0;
  for (const sample of samples) {
    const quality = assessSampleQuality(sample.durationMs);
    if (quality.quality === 'insufficient') {
      throw new Error(quality.reason ?? 'Amostra de voz insuficiente — grave novamente falando um pouco mais.');
    }
    totalQuality += quality.quality === 'good' ? 1 : 0.7;
    embeddings.push(await embedAudioClip(sample.audio, sample.mimeType));
  }
  const embedding = averageEmbeddings(embeddings);
  const qualityScore = Math.min(1, totalQuality / samples.length);
  const embeddingEnc = encryptField(JSON.stringify(embedding), key);

  await auditedClinicalWrite(
    db,
    { triggeredBy: 'voice-enrollment-completed', kbSources: [], modelVersion: 'resemblyzer-v1' },
    async (tx) => {
      // reenrollment: a linha ativa anterior vira histórico, nunca é sobrescrita (Seção 12)
      await tx.query(
        `UPDATE voice_profile SET status = 'superseded', revoked_at = now(), updated_at = now()
         WHERE company_id = $1 AND participant_id = $2 AND status = 'active'`,
        [companyId, participantId],
      );
      await tx.query(
        `INSERT INTO voice_profile
           (company_id, participant_id, name, area, embedding_enc, sample_count, quality_score,
            model_provider, model_name, model_version, status)
         VALUES ($1, $2, $3, $4, $5, $6, $7, 'resemblyzer', 'resemblyzer', 'v1', 'active')`,
        [
          companyId,
          participantId,
          participantName.trim().slice(0, 160),
          participantArea?.trim().slice(0, 160) || null,
          embeddingEnc,
          samples.length,
          qualityScore,
        ],
      );
      return null;
    },
  );
  return { qualityScore };
}

/** Resumo NÃO sensível (Seção 5) — nunca embedding/chave/vetor bruto. */
export async function getParticipantVoiceStatus(
  db: SqlExecutor,
  companyId: string,
  participantId: string,
): Promise<VoiceProfileStatus> {
  const res = await db.query<{
    created_at: Date | string;
    updated_at: Date | string;
    sample_count: number;
    model_provider: string | null;
    model_version: string | null;
    quality_score: number | null;
    last_used_at: Date | string | null;
  }>(
    `SELECT created_at, updated_at, sample_count, model_provider, model_version, quality_score, last_used_at
     FROM voice_profile WHERE company_id = $1 AND participant_id = $2 AND status = 'active'
     ORDER BY created_at DESC LIMIT 1`,
    [companyId, participantId],
  );
  const row = res.rows[0];
  if (!row) return { status: 'not_enrolled', enrolledAt: null, lastUpdatedAt: null, sampleCount: null, modelProvider: null, modelVersion: null, qualityScore: null, lastUsedAt: null };
  return {
    status: 'enrolled',
    enrolledAt: new Date(row.created_at),
    lastUpdatedAt: new Date(row.updated_at),
    sampleCount: row.sample_count,
    modelProvider: row.model_provider,
    modelVersion: row.model_version,
    qualityScore: row.quality_score,
    lastUsedAt: row.last_used_at ? new Date(row.last_used_at) : null,
  };
}

/** Revogação (Seção 28): impede matching futuro, preserva o registro de auditoria. */
export async function revokeParticipantVoice(db: SqlExecutor, companyId: string, participantId: string): Promise<void> {
  await auditedClinicalWrite(
    db,
    { triggeredBy: 'voice-profile-revoked', kbSources: [], modelVersion: 'human-edit' },
    async (tx) => {
      await tx.query(
        `UPDATE voice_profile SET status = 'revoked', revoked_at = now(), updated_at = now()
         WHERE company_id = $1 AND participant_id = $2 AND status = 'active'`,
        [companyId, participantId],
      );
      return null;
    },
  );
}

/** Exclusão (Seção 29, LGPD Art. 18): remove os templates — histórico de reuniões permanece. */
export async function deleteParticipantVoice(db: SqlExecutor, companyId: string, participantId: string): Promise<void> {
  await auditedClinicalWrite(
    db,
    { triggeredBy: 'voice-profile-deleted', kbSources: [], modelVersion: 'human-edit' },
    async (tx) => {
      await tx.query('DELETE FROM voice_profile WHERE company_id = $1 AND participant_id = $2', [
        companyId,
        participantId,
      ]);
      return null;
    },
  );
}

export interface VoiceProfileMatch {
  readonly participantId: string;
  readonly name: string;
  readonly similarity: number;
  /** Acima do limiar alto ⇒ 'identified'; entre os dois ⇒ 'probable' (Seção 17). */
  readonly band: 'identified' | 'probable';
}

/**
 * Compara um embedding novo contra os perfis ATIVOS da empresa — poucas
 * dezenas de linhas, decifrar+comparar em JS puro é instantâneo (sem
 * pgvector). `null` se nada bateu acima do limiar de probable.
 */
export async function findMatchingVoiceProfile(
  db: SqlExecutor,
  companyId: string,
  key: Buffer,
  embedding: readonly number[],
  identifyThreshold = DEFAULT_MATCH_THRESHOLD,
  probableThreshold = DEFAULT_PROBABLE_THRESHOLD,
): Promise<VoiceProfileMatch | null> {
  const res = await db.query<{ participant_id: string; name: string; embedding_enc: string }>(
    `SELECT participant_id, name, embedding_enc FROM voice_profile
     WHERE company_id = $1 AND status = 'active' AND participant_id IS NOT NULL`,
    [companyId],
  );
  let best: { participantId: string; name: string; similarity: number } | null = null;
  for (const row of res.rows) {
    let stored: number[];
    try {
      stored = JSON.parse(decryptField(row.embedding_enc, key)) as number[];
    } catch {
      continue; // linha corrompida/chave rotacionada — pula, não derruba a comparação
    }
    const similarity = cosineSimilarity(embedding, stored);
    if (similarity >= probableThreshold && (!best || similarity > best.similarity)) {
      best = { participantId: row.participant_id, name: row.name, similarity };
    }
  }
  if (!best) return null;
  return { ...best, band: best.similarity >= identifyThreshold ? 'identified' : 'probable' };
}

/** Registro de uso (Seção 5 — "última data de reconhecimento") — chamado após uma comparação bem-sucedida. */
export async function touchVoiceProfileLastUsed(db: SqlExecutor, companyId: string, participantId: string): Promise<void> {
  await db.query(
    `UPDATE voice_profile SET last_used_at = now() WHERE company_id = $1 AND participant_id = $2 AND status = 'active'`,
    [companyId, participantId],
  );
}
