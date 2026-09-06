import { NextRequest, NextResponse } from 'next/server';
import { verifyRecallRequest, RECALL_PARTICIPANT_EVENTS } from '@conselho/board-gateway';
import { getBoardRuntime } from '@/lib/board-runtime';
import { getDb } from '@/lib/db';

/**
 * Webhook do bot do Recall.ai (Etapa "Ver participantes/tela compartilhada
 * do Meet") — eventos de participante (entrou/saiu/câmera/tela
 * compartilhada). Rota PÚBLICA (sem sessão de usuário — é o Recall.ai
 * chamando de fora): autenticada por HMAC (mesmo esquema do WS
 * `/recall-media`, `packages/board-gateway`). Janela de visualização
 * separada — NUNCA toca o pipeline de transcrição/board dos conselheiros.
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  const rawBody = await req.text();
  const secret = process.env.RECALL_WEBHOOK_SECRET;
  const verified =
    !!secret &&
    verifyRecallRequest(
      secret,
      {
        id: req.headers.get('webhook-id'),
        timestamp: req.headers.get('webhook-timestamp'),
        signature: req.headers.get('webhook-signature'),
      },
      rawBody,
    );
  if (!verified) {
    return NextResponse.json({ error: 'assinatura inválida' }, { status: 401 });
  }

  let payload: { event?: string; data?: { data?: Record<string, unknown>; bot?: { id?: string } } };
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: 'JSON inválido' }, { status: 400 });
  }

  const eventType = payload.event;
  const mapped = eventType ? RECALL_PARTICIPANT_EVENTS[eventType] : undefined;
  const botId = payload.data?.bot?.id;
  const participant = payload.data?.data?.participant as { id?: number; name?: string | null } | undefined;
  if (!mapped || !botId || typeof participant?.id !== 'number') {
    // evento que não reconhecemos (ou sem os campos esperados) — nunca é erro nosso, só ignora
    return NextResponse.json({ ok: true });
  }

  try {
    const db = await getDb();
    const res = await db.query<{ meeting_id: string }>(
      'SELECT meeting_id FROM recall_bot WHERE bot_id = $1',
      [botId],
    );
    const meetingId = res.rows[0]?.meeting_id;
    if (!meetingId) return NextResponse.json({ ok: true }); // bot desconhecido/já removido — ignora

    const runtime = await getBoardRuntime();
    runtime.gateway.broadcastRecallParticipantEvent(meetingId, participant.id, participant.name ?? null, mapped);
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error('[recall] processar webhook falhou:', error);
    // 200 mesmo em erro interno — Recall.ai reenviaria em loop num 5xx, e um evento de
    // participante perdido não é crítico o bastante pra justificar isso (best-effort).
    return NextResponse.json({ ok: true });
  }
}
