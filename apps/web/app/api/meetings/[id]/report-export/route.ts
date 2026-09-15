import { NextResponse } from 'next/server';
import { meetingBelongsToCompany, getMeeting } from '@conselho/meetings';
import { getAgentProfiles } from '@conselho/kb';
import { PRESIDENT_AGENT_ID, SECRETARY_AGENT_ID } from '@conselho/providers';
import { getDb } from '@/lib/db';
import { getCurrentUser } from '@/lib/auth';
import { getEncryptionKey } from '@/lib/crypto-key';
import { loadReports } from '@/lib/report-actions';
import { loadMeetingDecisions, loadMeetingActionItems } from '@/lib/meeting-history';
import { loadAndApplyProfileOverrides } from '@/lib/kb-sources';
import { buildReportsPdf, buildReportsDocx, buildReportsPptx } from '@/lib/report-export';

const CONTENT_TYPE: Record<'pdf' | 'docx' | 'pptx', string> = {
  pdf: 'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
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

  const formatParam = new URL(request.url).searchParams.get('format');
  const format = formatParam === 'docx' ? 'docx' : formatParam === 'pptx' ? 'pptx' : 'pdf';

  let buffer: Buffer;
  if (format === 'docx') {
    buffer = await buildReportsDocx(meeting.title, items);
  } else if (format === 'pptx') {
    // PPTX é "o conselho completo" em slides — só faz sentido com todos os
    // conselheiros + síntese do Presidente prontos (mesma checagem de
    // `generatePresidentSynthesisAction`), senão vira um deck incompleto.
    const counselorAgentIds = new Set(
      Object.keys(profiles).filter((id) => id !== PRESIDENT_AGENT_ID && id !== SECRETARY_AGENT_ID),
    );
    const presidentReport = items.find((r) => r.agentId === PRESIDENT_AGENT_ID) ?? null;
    const secretaryReport = items.find((r) => r.agentId === SECRETARY_AGENT_ID) ?? null;
    const counselorReports = items.filter((r) => counselorAgentIds.has(r.agentId));
    const missingReports = counselorReports.length < counselorAgentIds.size || !presidentReport;
    if (missingReports) {
      return NextResponse.json({ error: 'incomplete_reports' }, { status: 409 });
    }
    const [decisions, actionItems] = await Promise.all([
      loadMeetingDecisions(meetingId),
      loadMeetingActionItems(meetingId),
    ]);
    buffer = await buildReportsPptx({
      meetingTitle: meeting.title,
      presidentReport,
      counselorReports,
      secretaryReport,
      decisions,
      actionItems,
    });
  } else {
    buffer = await buildReportsPdf(meeting.title, items);
  }
  const safeTitle = meeting.title.replace(/[^a-z0-9]+/gi, '-').toLowerCase().slice(0, 60) || 'reuniao';

  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      'content-type': CONTENT_TYPE[format],
      'content-disposition': `attachment; filename="relatorios-${safeTitle}.${format}"`,
    },
  });
}
