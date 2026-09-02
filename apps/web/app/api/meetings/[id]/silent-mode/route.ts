import { NextResponse } from 'next/server';
import { meetingBelongsToCompany } from '@conselho/meetings';
import { getDb } from '@/lib/db';
import { getCurrentUser } from '@/lib/auth';
import { isSilentMode } from '@/lib/board-runtime';

/**
 * Estado atual do modo silencioso (Etapa "board silencioso") — polling
 * simples pra refletir na sala quem já ligou/desligou, inclusive noutra aba.
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
  if (!(await meetingBelongsToCompany(db, meetingId, user.companyId))) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }

  return NextResponse.json({ silentMode: await isSilentMode(meetingId) });
}
