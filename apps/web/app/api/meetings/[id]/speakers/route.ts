import { NextResponse } from 'next/server';
import { meetingBelongsToCompany } from '@conselho/meetings';
import { getDb } from '@/lib/db';
import { getCurrentUser } from '@/lib/auth';
import { listKnownSpeakers } from '@/lib/board-runtime';

/**
 * Locutores já identificados na sessão AO VIVO da reunião (nome + área, se
 * souber) — por autoapresentação ou correção manual (Tier 1/2). Sem
 * biometria: reseta a cada reunião nova, igual à diarização em si.
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

  return NextResponse.json({ speakers: await listKnownSpeakers(meetingId) });
}
