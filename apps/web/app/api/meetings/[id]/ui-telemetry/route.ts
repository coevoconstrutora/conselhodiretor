import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { recordUiEvent } from '@/lib/board-runtime';
import type { UiEventKind } from '@conselho/telemetry';

/**
 * Telemetria de UI (E10 — R3/PRD §9): silenciar, Modo Foco, dispensar, fixar.
 * Só contadores — nenhum conteúdo clínico trafega aqui (NFR9).
 */

const VALID: ReadonlySet<string> = new Set([
  'focus-on',
  'focus-off',
  'silence',
  'unsilence',
  'dismiss',
  'pin',
  'undo-dismiss',
]);

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  const { id } = await context.params;
  const body = (await request.json().catch(() => ({}))) as { kind?: string };
  if (!body.kind || !VALID.has(body.kind)) {
    return NextResponse.json({ error: 'kind inválido' }, { status: 400 });
  }
  await recordUiEvent(id, body.kind as UiEventKind);
  return NextResponse.json({ ok: true });
}
