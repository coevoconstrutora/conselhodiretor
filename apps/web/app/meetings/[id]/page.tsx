import Link from 'next/link';
import { cookies } from 'next/headers';
import { redirect, notFound } from 'next/navigation';
import { getMeeting } from '@conselho/meetings';
import { listSyntheses, listTranscriptFinals, loadTranscriptReview } from '@conselho/meeting-report';
import { getAgentProfiles } from '@conselho/kb';
import { getCurrentUser, canWrite, SESSION_COOKIE } from '@/lib/auth';
import { getDb } from '@/lib/db';
import { getEncryptionKey } from '@/lib/crypto-key';
import { confirmRecordingAction, revokeRecordingAction } from '@/lib/meeting-actions';
import { startDemoBoardAction, requestSynthesisAction } from '@/lib/board-actions';
import { saveTranscriptReviewAction } from '@/lib/transcript-actions';
import { saveAgentReportAction, loadReports } from '@/lib/report-actions';
import { getCompanyKnowledgeStore, getTelemetryReport, BOARD_WS_PORT } from '@/lib/board-runtime';
import { formatMeetingDuration } from '@/lib/format';
import { MeetingRoom } from '@/components/meeting-room';
import { EndMeetingButton } from '@/components/end-meeting-button';
import { ReportsGeneratorForm } from '@/components/reports-generator-form';
import { ReportExportBar } from '@/components/report-export-bar';
import { DiagnosticsPanel } from '@/components/diagnostics-panel';
import { TelemetryReport } from '@/components/telemetry-report';

/** Sala de reunião: gate de gravação, board dos 9 conselheiros ao vivo,
 * revisão do transcript e relatórios finais por agente. */
export default async function MeetingPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) redirect('/login');

  const { id } = await params;
  const db = await getDb();
  const meeting = await getMeeting(db, id, user.companyId, getEncryptionKey());
  if (!meeting) notFound();

  const authorized = meeting.recordingConfirmed;
  const closed = meeting.status === 'closed';
  const meetingDurationLabel = formatMeetingDuration(
    meeting.confirmedAt ?? meeting.createdAt,
    meeting.closedAt,
  );
  const profiles = getAgentProfiles(user.companyId);

  await getCompanyKnowledgeStore(user.companyId);
  const sessionToken = (await cookies()).get(SESSION_COOKIE)?.value ?? '';
  const wsBaseUrl =
    process.env.BOARD_WS_MODE === 'attached'
      ? (process.env.NEXT_PUBLIC_BOARD_WS_URL ?? '')
      : (process.env.NEXT_PUBLIC_BOARD_WS_URL ?? `ws://localhost:${BOARD_WS_PORT}`);

  // Leitura durável NUNCA derruba a página: falha degrada para "sem transcrição".
  let transcriptFinals: string[] = [];
  let transcriptReview: Awaited<ReturnType<typeof loadTranscriptReview>> = null;
  if (authorized) {
    try {
      transcriptReview = await loadTranscriptReview(db, id, getEncryptionKey());
      transcriptFinals = await listTranscriptFinals(db, id, getEncryptionKey());
    } catch (error) {
      console.error('[reuniao] falha ao ler transcrição — seção oculta:', error);
    }
  }
  const transcriptText = transcriptReview?.content ?? transcriptFinals.join('\n');
  const hasTranscript = transcriptText.trim().length > 0;
  const syntheses = authorized ? await listSyntheses(db, id, getEncryptionKey()) : [];
  const reports = authorized ? await loadReports(id).catch(() => []) : [];
  const telemetry = authorized ? await getTelemetryReport(id) : null;

  return (
    <main className="min-h-screen">
      <header className="surface-deep-gradient sticky top-0 z-10 border-b border-white/10">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-4">
          <div className="flex items-baseline gap-4">
            <h1 className="font-display text-2xl font-semibold tracking-tight text-white">
              Conselho
              <span className="ml-2 text-sm font-normal text-white/50">· {meeting.title}</span>
            </h1>
            <span
              className={`rounded-[var(--radius)] border px-3 py-1 text-[11px] font-medium tracking-wide ${
                authorized
                  ? 'border-emerald-300/30 bg-emerald-400/10 text-emerald-200'
                  : 'border-white/20 bg-white/5 text-white/60'
              }`}
            >
              {authorized ? '🟢 gravação confirmada' : '🔒 gravação bloqueada'}
            </span>
          </div>
          <div className="flex items-center gap-4">
            {authorized ? (
              <form action={revokeRecordingAction}>
                <input type="hidden" name="meetingId" value={id} />
                <button
                  type="submit"
                  className="text-xs text-red-300/90 hover:text-red-200 hover:underline"
                >
                  Revogar confirmação
                </button>
              </form>
            ) : null}
            <Link href="/" className="text-sm text-white/60 transition-colors hover:text-white">
              ← Painel
            </Link>
          </div>
        </div>
        <div className="gold-hairline absolute inset-x-0 bottom-0" />
      </header>

      <div className="mx-auto max-w-7xl p-6">
        {!authorized ? (
          <section className="card-premium gold-hairline mx-auto mt-14 max-w-md p-7">
            <h2 className="font-display text-lg font-semibold text-ink">
              🔒 Confirmação de gravação
            </h2>
            <p className="mt-2 text-sm leading-relaxed text-ink-muted">
              Sem a confirmação, nenhum áudio é capturado, transmitido ou persistido. Confirme que
              os participantes da reunião estão cientes e de acordo com a gravação.
            </p>
            <form action={confirmRecordingAction} className="mt-4 space-y-3">
              <input type="hidden" name="meetingId" value={id} />
              <label className="block space-y-1.5 text-left">
                <span className="text-sm font-medium text-ink">Quantas pessoas estão presentes?</span>
                <input
                  name="participantCount"
                  type="number"
                  min={1}
                  max={100}
                  placeholder="ex.: 5"
                  className="w-full rounded-[var(--radius)] border border-ink/15 bg-white px-3.5 py-2.5 text-sm text-ink transition-colors focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20"
                />
              </label>
              <button
                type="submit"
                className="w-full rounded-[var(--radius)] bg-brand px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition-opacity hover:opacity-90"
              >
                Confirmar: participantes autorizaram a gravação
              </button>
            </form>
          </section>
        ) : (
          <div className="mt-4">
            {closed ? (
              <section
                aria-label="Resumo da reunião"
                className="card-premium mb-4 flex flex-wrap items-center gap-x-6 gap-y-2 p-5"
              >
                <span className="text-sm font-semibold text-ink">🔒 Reunião encerrada</span>
                {meetingDurationLabel ? (
                  <span className="text-sm text-ink-muted">⏱ Duração: {meetingDurationLabel}</span>
                ) : null}
                {meeting.participantCount ? (
                  <span className="text-sm text-ink-muted">
                    👥 {meeting.participantCount} participante{meeting.participantCount === 1 ? '' : 's'}
                  </span>
                ) : null}
              </section>
            ) : null}
            <MeetingRoom
              meetingId={id}
              token={sessionToken}
              wsBaseUrl={wsBaseUrl}
              closed={closed}
              endMeetingButton={!closed && canWrite(user) ? <EndMeetingButton meetingId={id} /> : null}
              startForm={
                <form action={startDemoBoardAction}>
                  <input type="hidden" name="meetingId" value={id} />
                  <button
                    type="submit"
                    className="rounded-[var(--radius)] bg-white px-3 py-2 text-xs font-semibold text-surface-deep shadow-sm transition-colors hover:bg-white/90"
                  >
                    ▶ Reunião simulada
                  </button>
                </form>
              }
              synthesisForm={
                <form action={requestSynthesisAction}>
                  <input type="hidden" name="meetingId" value={id} />
                  <button
                    type="submit"
                    className="rounded-[var(--radius)] border border-white/25 px-3 py-2 text-xs font-semibold text-white transition-colors hover:bg-white/10"
                  >
                    📋 Síntese do Presidente
                  </button>
                </form>
              }
            />

            {/* Revisão do transcript: o empresário corrige o que o STT ouviu ANTES
                de gerar os relatórios — a versão revisada vira a fonte. */}
            {hasTranscript && (
              <section aria-label="Transcrição da reunião" className="card-premium mt-6 p-6">
                <div>
                  <h2 className="font-display text-base font-semibold text-ink">
                    <span className="blueprint-index mr-2 text-brand/70">02/</span>
                    📝 Transcrição da reunião
                  </h2>
                  <p className="text-xs text-ink-muted">
                    Revise e corrija o que a transcrição automática captou. Os relatórios dos
                    conselheiros são gerados a partir desta versão. Cifrada em repouso e auditada.
                  </p>
                </div>
                <form action={saveTranscriptReviewAction} className="mt-4 space-y-3">
                  <input type="hidden" name="meetingId" value={id} />
                  <textarea
                    key={transcriptReview?.updatedAt.getTime() ?? 'raw'}
                    name="content"
                    defaultValue={transcriptText}
                    rows={12}
                    aria-label="Transcrição da reunião"
                    className="w-full rounded-[var(--radius)] border border-ink/15 bg-white p-4 text-sm leading-relaxed text-ink transition-colors focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20"
                  />
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-xs text-ink-muted">
                      {transcriptReview
                        ? `Revisada em ${transcriptReview.updatedAt.toLocaleString('pt-BR')} — regenere os relatórios para refletir as correções.`
                        : 'Ainda mostra a transcrição automática. Corrija nomes, números e termos antes de gerar os relatórios.'}
                    </p>
                    <button
                      type="submit"
                      className="shrink-0 rounded-[var(--radius)] bg-brand px-4 py-2 text-xs font-semibold text-white shadow-sm transition-opacity hover:opacity-90"
                    >
                      💾 Salvar transcrição corrigida
                    </button>
                  </div>
                </form>
              </section>
            )}

            {/* Relatórios finais: 1 por conselheiro + síntese do Presidente */}
            <section aria-label="Relatórios do conselho" className="card-premium mt-6 p-6">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="font-display text-base font-semibold text-ink">
                    <span className="blueprint-index mr-2 text-brand/70">03/</span>
                    📊 Relatórios do conselho
                  </h2>
                  <p className="text-xs text-ink-muted">
                    A visão de cada conselheiro sobre a reunião + a síntese executiva do
                    Presidente. Rascunhos editáveis, cifrados e auditados.
                  </p>
                </div>
                <ReportsGeneratorForm meetingId={id} hasReports={reports.length > 0} />
              </div>

              {reports.length === 0 ? (
                <p className="mt-4 rounded-[var(--radius)] border border-dashed border-ink/15 p-4 text-sm text-ink-muted">
                  Nenhum relatório ainda — encerre a reunião, revise a transcrição e clique em
                  &ldquo;Gerar relatórios do conselho&rdquo;.
                </p>
              ) : (
                <div className="mt-4 space-y-4">
                  {reports.map((report) => (
                    <details
                      key={report.agentId}
                      className="rounded-[var(--radius)] border border-ink/10 bg-surface"
                      open={report.agentId === 'presidente'}
                    >
                      <summary className="cursor-pointer px-4 py-3 text-sm font-semibold text-ink">
                        {report.agentId === 'presidente' ? '⭐ ' : ''}
                        {profiles[report.agentId]?.displayName ?? report.agentId}
                        <span className="ml-2 text-[11px] font-normal text-ink-muted">
                          atualizado {report.updatedAt.toLocaleString('pt-BR')}
                        </span>
                      </summary>
                      <form action={saveAgentReportAction} className="space-y-3 px-4 pb-4">
                        <input type="hidden" name="meetingId" value={id} />
                        <input type="hidden" name="agentId" value={report.agentId} />
                        <textarea
                          key={report.updatedAt.getTime()}
                          name="content"
                          defaultValue={report.content}
                          rows={12}
                          aria-label={`Relatório — ${profiles[report.agentId]?.displayName ?? report.agentId}`}
                          className="font-mono-data w-full rounded-[var(--radius)] border border-ink/15 bg-white p-4 text-sm leading-relaxed text-ink transition-colors focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20"
                        />
                        <div className="flex justify-end">
                          <button
                            type="submit"
                            className="rounded-[var(--radius)] bg-brand px-4 py-2 text-xs font-semibold text-white shadow-sm transition-opacity hover:opacity-90"
                          >
                            💾 Salvar edição
                          </button>
                        </div>
                      </form>
                    </details>
                  ))}
                </div>
              )}
              {reports.length > 0 ? <ReportExportBar meetingId={id} /> : null}
            </section>

            {/* Histórico de sínteses do Presidente durante a reunião */}
            {syntheses.length > 0 && (
              <section aria-label="Sínteses do Presidente" className="card-premium mt-6 p-6">
                <h2 className="font-display text-base font-semibold text-ink">
                  Sínteses do Presidente{' '}
                  <span className="text-sm font-normal text-ink-muted">· histórico salvo</span>
                </h2>
                <ul className="mt-4 space-y-3">
                  {[...syntheses].reverse().map((s) => (
                    <li key={s.id} className="rounded-[var(--radius)] border border-ink/10 bg-surface p-4">
                      <p className="text-sm leading-relaxed text-ink">{s.content}</p>
                      <p className="mt-2 text-[11px] text-ink-muted">
                        {s.createdAt.toLocaleString('pt-BR')}
                        {s.modelVersion ? ` · ${s.modelVersion}` : ''}
                      </p>
                    </li>
                  ))}
                </ul>
              </section>
            )}

            {telemetry ? (
              <TelemetryReport report={telemetry.report} summary={telemetry.summary} />
            ) : null}

            <DiagnosticsPanel meetingId={id} />
          </div>
        )}
      </div>
    </main>
  );
}
