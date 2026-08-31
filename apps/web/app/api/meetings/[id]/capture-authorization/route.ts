import { NextResponse } from 'next/server';
import { isRecordingConfirmed, meetingBelongsToCompany } from '@conselho/meetings';
import { getDb } from '@/lib/db';
import { getCurrentUser } from '@/lib/auth';

/**
 * Gate de servidor da captura de áudio .
 *
 * Este é o ponto único de autorização que o pipeline de captura do E2 DEVE
 * consultar antes de ligar qualquer microfone/stream. O cliente nunca decide:
 * - 401 se não autenticado;
 * - 403 se a gravação não estiver confirmada pelos participantes → captura proibida;
 * - 200 `{ authorized: true }` apenas com gravação confirmada.
 *
 * A captura real (streaming/STT) é do E2; aqui garantimos que ela só pode
 * ligar atrás deste veredito.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ authorized: false, reason: 'unauthenticated' }, { status: 401 });
  }

  const { id: meetingId } = await params;
  const db = await getDb();
  if (!(await meetingBelongsToCompany(db, meetingId, user.companyId))) {
    return NextResponse.json({ authorized: false, reason: 'recording_required' }, { status: 403 });
  }
  const authorized = await isRecordingConfirmed(db, meetingId);

  if (!authorized) {
    return NextResponse.json(
      { authorized: false, reason: 'recording_required' },
      { status: 403 },
    );
  }

  return NextResponse.json({ authorized: true });
}
