import { NextResponse } from 'next/server';
import { meetingBelongsToCompany } from '@conselho/meetings';
import { getDb } from '@/lib/db';
import { getCurrentUser } from '@/lib/auth';
import { getPipelineStatus } from '@/lib/board-runtime';

/**
 * Modo diagnóstico (A5): snapshot da saúde do pipeline de transcrição para o
 * médico/suporte triarem uma falha em 30s. Retorna SÓ booleanos/contadores —
 * nunca valores de secrets nem conteúdo clínico.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  }

  const { id: meetingId } = await params;
  const db = await getDb();
  // a reunião precisa pertencer à empresa do usuário autenticado
  if (!(await meetingBelongsToCompany(db, meetingId, user.companyId))) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }

  return NextResponse.json(await getPipelineStatus(meetingId));
}
