import 'server-only';
import type { SqlExecutor } from '@conselho/db';
import { encryptField, decryptField } from '@conselho/crypto';
import { cosineSimilarity } from './voice-similarity';

/**
 * Reconhecimento de voz ENTRE reuniões (Tier 3 — dado biométrico, LGPD Art.
 * 5º II). Opt-in por empresa (`company_profile.voiceRecognitionEnabled`).
 * 1 linha por PESSOA (não por reunião) — o embedding (256 floats do
 * Resemblyzer, via `conselho-voice-embed`) fica cifrado como qualquer outro
 * dado sensível deste produto.
 *
 * A integração com a reunião AO VIVO (capturar áudio, decidir quando
 * cadastrar/comparar) é uma etapa separada — aqui só o alicerce: chamar o
 * serviço de embedding, persistir/listar/apagar perfis, e comparar por
 * similaridade de cosseno.
 */

export interface VoiceProfileSummary {
  readonly id: string;
  readonly name: string;
  readonly area: string | null;
  readonly sampleCount: number;
  readonly createdAt: Date;
}

export interface VoiceProfileMatch {
  readonly id: string;
  readonly name: string;
  readonly area: string | null;
  readonly similarity: number;
}

/** Acima disso, dois embeddings são considerados a MESMA pessoa. Calibrável por env. */
const DEFAULT_MATCH_THRESHOLD = Number(process.env.VOICE_MATCH_THRESHOLD ?? '0.75');

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

/** Cadastra (ou acrescenta amostra a) um perfil de voz — chamado no 1º "sou a Marina" de alguém. */
export async function saveVoiceProfile(
  db: SqlExecutor,
  companyId: string,
  key: Buffer,
  input: { name: string; area?: string | null; embedding: readonly number[] },
): Promise<void> {
  const embeddingEnc = encryptField(JSON.stringify(input.embedding), key);
  await db.query(
    `INSERT INTO voice_profile (company_id, name, area, embedding_enc)
     VALUES ($1, $2, $3, $4)`,
    [companyId, input.name.trim().slice(0, 160), input.area?.trim().slice(0, 160) || null, embeddingEnc],
  );
}

/** Perfis de voz da empresa (metadados — nunca decifra o embedding aqui). */
export async function listVoiceProfiles(db: SqlExecutor, companyId: string): Promise<VoiceProfileSummary[]> {
  const res = await db.query<{
    id: string;
    name: string;
    area: string | null;
    sample_count: number;
    created_at: Date | string;
  }>(
    'SELECT id, name, area, sample_count, created_at FROM voice_profile WHERE company_id = $1 ORDER BY name ASC',
    [companyId],
  );
  return res.rows.map((r) => ({
    id: r.id,
    name: r.name,
    area: r.area,
    sampleCount: r.sample_count,
    createdAt: new Date(r.created_at),
  }));
}

/** Direito de exclusão do titular (LGPD Art. 18) — apaga o perfil de voz de uma pessoa. */
export async function deleteVoiceProfile(db: SqlExecutor, companyId: string, profileId: string): Promise<void> {
  await db.query('DELETE FROM voice_profile WHERE id = $1 AND company_id = $2', [profileId, companyId]);
}

/**
 * Compara um embedding novo contra TODOS os perfis da empresa — poucas
 * dezenas de linhas, decifrar+comparar em JS puro é instantâneo (sem
 * pgvector). `null` se nada bateu acima do limiar.
 */
export async function findMatchingVoiceProfile(
  db: SqlExecutor,
  companyId: string,
  key: Buffer,
  embedding: readonly number[],
  threshold = DEFAULT_MATCH_THRESHOLD,
): Promise<VoiceProfileMatch | null> {
  const res = await db.query<{ id: string; name: string; area: string | null; embedding_enc: string }>(
    'SELECT id, name, area, embedding_enc FROM voice_profile WHERE company_id = $1',
    [companyId],
  );
  let best: VoiceProfileMatch | null = null;
  for (const row of res.rows) {
    let stored: number[];
    try {
      stored = JSON.parse(decryptField(row.embedding_enc, key)) as number[];
    } catch {
      continue; // linha corrompida/chave rotacionada — pula, não derruba a comparação
    }
    const similarity = cosineSimilarity(embedding, stored);
    if (similarity >= threshold && (!best || similarity > best.similarity)) {
      best = { id: row.id, name: row.name, area: row.area, similarity };
    }
  }
  return best;
}
