'use server';

import { revalidatePath } from 'next/cache';
import { encryptField } from '@conselho/crypto';
import { meetingBelongsToCompany } from '@conselho/meetings';
import { getCurrentUser, canWrite } from './auth';
import { getDb } from './db';
import { getEncryptionKey } from './crypto-key';
import { siteOrigin } from './site-origin';
import { toActionResult, type ActionResult } from './action-result';

/**
 * Bot do Recall.ai (Etapa "Ver participantes/tela compartilhada do Meet") —
 * janela de VISUALIZAÇÃO de uma reunião externa (Google Meet/Zoom/Teams),
 * separada do pipeline de transcrição/board (que continua vindo do
 * microfone/áudio da aba, sem nenhuma mudança). O bot nunca fala, nunca
 * grava — só entrega participantes + vídeo ao vivo via webhook/websocket
 * pros quais o Recall.ai conecta (ver apps/web/app/api/recall-webhook e
 * o path /recall-media do board-gateway).
 */
const RECALL_API_BASE = (process.env.RECALL_API_BASE_URL || 'https://us-west-2.recall.ai').replace(/\/$/, '');

function recallHeaders(): HeadersInit {
  const apiKey = process.env.RECALL_API_KEY;
  if (!apiKey) throw new Error('RECALL_API_KEY ausente — configure a chave do Recall.ai no ambiente.');
  return { authorization: apiKey, 'content-type': 'application/json', accept: 'application/json' };
}

/** Cria o bot e manda entrar no link externo — idempotente: se já há um bot ativo, não cria outro. */
export async function startRecallBotAction(meetingId: string, meetingUrl: string): Promise<ActionResult> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, code: 'unauthenticated' };
  if (!canWrite(user)) return { ok: false, code: 'unauthenticated', detail: 'Convidados não podem chamar o bot.' };
  if (!meetingId || !meetingUrl?.trim()) return { ok: false, code: 'invalid-input' };
  if (!process.env.RECALL_API_KEY) {
    return { ok: false, code: 'internal', detail: 'RECALL_API_KEY não configurada no servidor.' };
  }
  try {
    const db = await getDb();
    if (!(await meetingBelongsToCompany(db, meetingId, user.companyId))) {
      return { ok: false, code: 'invalid-input' };
    }
    const existing = await db.query<{ status: string }>(
      'SELECT status FROM recall_bot WHERE meeting_id = $1',
      [meetingId],
    );
    if (existing.rows[0] && ['joining', 'in_call'].includes(existing.rows[0].status)) {
      return { ok: true }; // já tem um bot ativo — não duplica
    }

    const origin = await siteOrigin();
    const wsOrigin = origin.replace(/^http/, 'ws'); // http→ws, https→wss

    const res = await fetch(`${RECALL_API_BASE}/api/v1/bot/`, {
      method: 'POST',
      headers: recallHeaders(),
      body: JSON.stringify({
        meeting_url: meetingUrl.trim(),
        bot_name: 'Conselho',
        // video_separate_h264 exige bot de 4 núcleos ou GPU — o bot padrão (1 core) é recusado (400).
        variant: { google_meet: 'web_4_core' },
        recording_config: {
          video_mixed_layout: 'gallery_view_v2',
          video_separate_h264: {},
          realtime_endpoints: [
            {
              type: 'webhook',
              url: `${origin}/api/recall-webhook`,
              events: [
                'participant_events.join',
                'participant_events.leave',
                'participant_events.webcam_on',
                'participant_events.webcam_off',
                'participant_events.screenshare_on',
                'participant_events.screenshare_off',
              ],
            },
            {
              // só vídeo aqui — eventos de participante já vêm pelo webhook acima,
              // sem duplicar a mesma informação em 2 canais diferentes.
              type: 'websocket',
              url: `${wsOrigin}/recall-media?meetingId=${encodeURIComponent(meetingId)}`,
              events: ['video_separate_h264.data'],
            },
          ],
        },
      }),
    });
    const data = (await res.json().catch(() => ({}))) as { id?: string; message?: string };
    if (!res.ok || !data.id) {
      console.error('[recall] criar bot falhou:', res.status, data);
      return {
        ok: false,
        code: 'internal',
        detail: `Recall.ai recusou (${res.status}): ${data.message ?? JSON.stringify(data).slice(0, 200)}`,
      };
    }

    const key = getEncryptionKey();
    await db.query(
      `INSERT INTO recall_bot (meeting_id, bot_id, meeting_url_enc, status)
       VALUES ($1, $2, $3, 'joining')
       ON CONFLICT (meeting_id) DO UPDATE
         SET bot_id = EXCLUDED.bot_id, meeting_url_enc = EXCLUDED.meeting_url_enc,
             status = 'joining', ended_at = NULL`,
      [meetingId, data.id, encryptField(meetingUrl.trim(), key)],
    );
    revalidatePath(`/meetings/${meetingId}`);
    return { ok: true };
  } catch (err) {
    console.error('[recall] iniciar bot falhou:', err);
    return toActionResult(err);
  }
}

/** Remove o bot da chamada (irreversível do lado do Recall.ai) — nunca lança. */
export async function stopRecallBotAction(meetingId: string): Promise<ActionResult> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, code: 'unauthenticated' };
  try {
    const db = await getDb();
    if (!(await meetingBelongsToCompany(db, meetingId, user.companyId))) {
      return { ok: false, code: 'invalid-input' };
    }
    const res = await db.query<{ bot_id: string }>(
      'SELECT bot_id FROM recall_bot WHERE meeting_id = $1',
      [meetingId],
    );
    const botId = res.rows[0]?.bot_id;
    if (botId && process.env.RECALL_API_KEY) {
      await fetch(`${RECALL_API_BASE}/api/v1/bot/${botId}/leave_call/`, {
        method: 'POST',
        headers: recallHeaders(),
      }).catch((error) => console.error('[recall] leave_call falhou:', error));
    }
    await db.query(
      `UPDATE recall_bot SET status = 'call_ended', ended_at = now() WHERE meeting_id = $1`,
      [meetingId],
    );
    revalidatePath(`/meetings/${meetingId}`);
    return { ok: true };
  } catch (err) {
    console.error('[recall] parar bot falhou:', err);
    return toActionResult(err);
  }
}
