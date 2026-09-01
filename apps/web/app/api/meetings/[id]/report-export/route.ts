import { NextResponse } from 'next/server';
import { meetingBelongsToCompany, getMeeting } from '@conselho/meetings';
import { getAgentProfiles } from '@conselho/kb';
import { getDb } from '@/lib/db';
import { getCurrentUser } from '@/lib/auth';
import { getEncryptionKey } from '@/lib/crypto-key';
import { loadReports } from '@/lib/report-actions';
import { loadAndApplyProfileOverrides } from '@/lib/kb-sources';
import { buildReportsPdf, buildReportsDocx } from '@/lib/report-export';

const CONTENT_TYPE: Record<'pdf' | 'docx', string> = {
  pdf: 'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
};

/** Exporta os relatórios finais da reunião (?format=pdf|docx, default pdf). */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });

  const { id: meetingId } = await params;
  const db = await getDb();
  if (!(await meetingBelongsToCompany(db, meetingId, user.companyId))) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }

  const key = getEncryptionKey();
  const meeting = await getMeeting(db, meetingId, user.companyId, key);
  const reports = await loadReports(meetingId);
  if (!meeting || reports.length === 0) {
    return NextResponse.json({ error: 'no_reports' }, { status: 404 });
  }

  await loadAndApplyProfileOverrides(db, user.companyId);
  const profiles = getAgentProfiles(user.companyId);
  const items = reports.map((r) => ({
    agentId: r.agentId,
    displayName: profiles[r.agentId]?.displayName ?? r.agentId,
    content: r.content,
    updatedAt: r.updatedAt,
  }));

  const format = new URL(request.url).searchParams.get('format') === 'docx' ? 'docx' : 'pdf';
  const buffer = format === 'docx' ? await buildReportsDocx(meeting.title, items) : await buildReportsPdf(meeting.title, items);
  const safeTitle = meeting.title.replace(/[^a-z0-9]+/gi, '-').toLowerCase().slice(0, 60) || 'reuniao';

  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      'content-type': CONTENT_TYPE[format],
      'content-disposition': `attachment; filename="relatorios-${safeTitle}.${format}"`,
    },
  });
}
