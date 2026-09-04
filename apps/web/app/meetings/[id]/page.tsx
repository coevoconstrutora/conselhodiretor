import Link from 'next/link';
import { cookies } from 'next/headers';
import { notFound } from 'next/navigation';
import { getMeeting, getMeetingGuidance } from '@conselho/meetings';
import { listSyntheses, listTranscriptFinals, loadTranscriptReview } from '@conselho/meeting-report';
import { getAgentProfiles } from '@conselho/kb';
import { loadCompanyProfile } from '@/lib/company-profile';
import { requireCurrentUser, canWrite, SESSION_COOKIE } from '@/lib/auth';
import { getDb } from '@/lib/db';
import { getEncryptionKey } from '@/lib/crypto-key';
import { confirmRecordingAction, revokeRecordingAction } from '@/lib/meeting-actions';
import { startDemoBoardAction, requestSynthesisAction } from '@/lib/board-actions';
import { saveTranscriptReviewAction } from '@/lib/transcript-actions';
import { saveAgentReportAction, loadReports } from '@/lib/report-actions';
import {
  loadMeetingContributions,
  loadMeetingContributionCounts,
  loadMeetingDecisions,
  loadMeetingActionItems,
  loadMeetingAnalysis,
} from '@/lib/meeting-history';
import {
  getCompanyKnowledgeStore,
  getTelemetryReport,
  getMeetingActiveAgentIds,
  BOARD_WS_PORT,
} from '@/lib/board-runtime';
import { formatMeetingDuration, formatDateTimeBR } from '@/lib/format';
import { buildAgentRoster } from '@/lib/agent-display';
import { MeetingRoom } from '@/components/meeting-room';
import { EndMeetingButton } from '@/components/end-meeting-button';
import { ReportsGeneratorForm } from '@/components/reports-generator-form';
import { PresidentSynthesisButton } from '@/components/president-synthesis-button';
import { ReportExportBar } from '@/components/report-export-bar';
import { DiagnosticsPanel } from '@/components/diagnostics-panel';
import { TelemetryReport } from '@/components/telemetry-report';
import { HistoricalMeetingTabs } from '@/components/historical-meeting-tabs';
import { ContributionsPanel, DecisionsPanel, ActionsPanel, AnalysisSummaryCard } from '@/components/meeting-history-panels';

/** Sala de reunião: gate de gravação, board dos 9 conselheiros ao vivo,
 * revisão do transcript e relatórios finais por agente. */
export default async function MeetingPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireCurrentUser();

  const { id } = await params;
  const db = await getDb();
  const meeting = await getMeeting(db, id, user.companyId, getEncryptionKey());
  if (!meeting) notFound();
  const companyProfile = await loadCompanyProfile(db, user.companyId, getEncryptionKey());

  const authorized = meeting.recordingConfirmed;
  const closed = meeting.status === 'closed';
  // "Encerrar reunião" dispara a geração dos relatórios automaticamente em
  // background (board-actions.ts) — janela generosa (~10 chamadas de LLM em
  // série) antes de assumir que falhou e voltar a mostrar o botão manual.
  const AUTO_REPORTS_WINDOW_MS = 5 * 60 * 1000;
  const autoReportsPending = Boolean(
    closed && meeting.closedAt && Date.now() - meeting.closedAt.getTime() < AUTO_REPORTS_WINDOW_MS,
  );
  const meetingDurationLabel = formatMeetingDuration(
    meeting.confirmedAt ?? meeting.createdAt,
    meeting.closedAt,
  );
  const profiles = getAgentProfiles(user.companyId);
  const activeAgentIds = await getMeetingActiveAgentIds(db, id);
  const roomAgents = buildAgentRoster(profiles).filter(
    (a) => a.id === 'presidente' || !activeAgentIds || activeAgentIds.includes(a.id),
  );

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
  const guidance = await getMeetingGuidance(db, id, user.companyId, getEncryptionKey());
  const syntheses = authorized ? await listSyntheses(db, id, getEncryptionKey()) : [];
  const reports = authorized ? await loadReports(id).catch(() => []) : [];
  const telemetry = authorized ? await getTelemetryReport(id) : null;

  // Histórico de verdade (Etapa "Histórico de reuniões") — só faz sentido
  // buscar depois de encerrada (reunião ao vivo não tem nada aqui ainda).
  const contributions = closed && authorized ? await loadMeetingContributions(id) : [];
  const contributionCounts = closed && authorized ? await loadMeetingContributionCounts(id) : new Map<string, number>();
  const decisions = closed && authorized ? await loadMeetingDecisions(id) : [];
  const actionItems = closed && authorized ? await loadMeetingActionItems(id) : [];
  const meetingAnalysis = closed && authorized ? await loadMeetingAnalysis(id) : null;
  const presidentReport = reports.find((r) => r.agentId === 'presidente') ?? null;
  const counselorReports = reports.filter((r) => r.agentId !== 'presidente');
  const historicalCounts = closed
    ? new Map<string, number>([
        ...contributionCounts,
        ['presidente', syntheses.length > 0 || presidentReport ? 1 : 0],
      ])
    : undefined;

  /** 1 relatório editável — reusado nas abas Ata/Síntese (histórico) e no layout ao vivo. */
  function renderReportDetails(report: (typeof reports)[number]) {
    return (
      <details
        key={report.agentId}
        className="rounded-[var(--radius)] border border-ink/10 bg-surface"
        open={report.agentId === 'presidente'}
      >
        <summary className="cursor-pointer px-4 py-3 text-sm font-semibold text-ink">
          {report.agentId === 'presidente' ? '⭐ ' : ''}
          {profiles[report.agentId]?.displayName ?? report.agentId}
          <span className="ml-2 text-[11px] font-normal text-ink-muted">
            atualizado {formatDateTimeBR(report.updatedAt)}
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
    );
  }

  return (
    <main className="min-h-screen">
      <header className="surface-deep-gradient sticky top-0 z-10 border-b border-white/10">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3 px-4 py-4 sm:px-6">
          <div className="flex flex-wrap items-center gap-3 sm:gap-4">
            {companyProfile.logoDataUrl ? (
              <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-[var(--radius)] bg-white p-1.5">
                <img
                  src={companyProfile.logoDataUrl}
                  alt={companyProfile.name ?? 'Logo da empresa'}
                  className="h-full w-full object-contain"
                />
              </span>
            ) : null}
            <h1 className="font-display flex items-baseline gap-3 text-xl font-semibold tracking-tight text-white sm:gap-4 sm:text-2xl">
              Conselho
              <span className="text-sm font-normal text-white/50">· {meeting.title}</span>
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
            <Link
              href="/"
              className="rounded-[var(--radius)] border border-white/25 px-3 py-1.5 text-sm text-white/80 transition-colors hover:bg-white/10 hover:text-white"
            >
              🏠 Home
            </Link>
          </div>
        </div>
        <div className="gold-hairline absolute inset-x-0 bottom-0" />
      </header>

      <div className="mx-auto max-w-7xl p-4 sm:p-6">
        {!authorized ? (
          <section className="card-premium gold-hairline mx-auto mt-14 max-w-md p-7">
            <h2 className="font-display text-lg font-semibold text-ink">
              🔒 Confirmação de gravação
            </h2>
            <p className="mt-2 text-sm leading-relaxed text-ink-muted">
              Sem a confirmação, nenhum áudio é capturado, transmitido ou persistido. Confirme que
              os participantes da reunião estão cientes e de acordo com a gravação.
            </p>
            {companyProfile.voiceRecognitionEnabled ? (
              <p className="mt-2 text-sm leading-relaxed text-attn-critical">
                🎙️ Esta empresa também usa reconhecimento de voz entre reuniões (dado biométrico) —
                avise os participantes antes de confirmar.
              </p>
            ) : null}
            <form action={confirmRecordingAction} className="mt-4 space-y-3">
              <input type="hidden" name="meetingId" value={id} />
              <label className="block space-y-1.5 text-left">
                <span className="text-sm font-medium text-ink">
                  Quantas pessoas estão presentes?{' '}
                  <span className="font-normal text-ink-muted">(opcional)</span>
                </span>
                <input
                  name="participantCount"
                  type="number"
                  min={1}
                  max={100}
                  placeholder="deixe em branco se preferir não informar"
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
              agents={roomAgents}
              historicalCounts={historicalCounts}
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

            {/* Pauta/roteiro anexado na criação (Etapa "guia de reunião") — só
                referência para quem conduz a reunião; os conselheiros já a
                recebem como contexto extra (board-runtime). */}
            {guidance ? (
              <details className="card-premium mt-6 p-6" open>
                <summary className="cursor-pointer font-display text-base font-semibold text-ink">
                  📋 Pauta/roteiro da reunião{' '}
                  <span className="text-xs font-normal text-ink-muted">· {guidance.filename}</span>
                </summary>
                <p className="mt-3 whitespace-pre-wrap text-sm leading-relaxed text-ink-muted">
                  {guidance.content}
                </p>
              </details>
            ) : null}

            {closed ? <AnalysisSummaryCard analysis={meetingAnalysis} /> : null}

            {closed ? (
              <HistoricalMeetingTabs
                transcricao={
                  hasTranscript ? (
                    <div>
                      <p className="mb-3 text-xs text-ink-muted">
                        Revise e corrija o que a transcrição automática captou. Os relatórios dos
                        conselheiros são gerados a partir desta versão. Cifrada em repouso e auditada.
                      </p>
                      <form action={saveTranscriptReviewAction} className="space-y-3">
                        <input type="hidden" name="meetingId" value={id} />
                        <textarea
                          key={transcriptReview?.updatedAt.getTime() ?? 'raw'}
                          name="content"
                          defaultValue={transcriptText}
                          rows={16}
                          aria-label="Transcrição da reunião"
                          className="w-full rounded-[var(--radius)] border border-ink/15 bg-white p-4 text-sm leading-relaxed text-ink transition-colors focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20"
                        />
                        <div className="flex items-center justify-between gap-3">
                          <p className="text-xs text-ink-muted">
                            {transcriptReview
                              ? `Revisada em ${formatDateTimeBR(transcriptReview.updatedAt)} — regenere os relatórios para refletir as correções.`
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
                    </div>
                  ) : (
                    <p className="text-sm text-ink-muted">Não há transcrição armazenada para esta reunião.</p>
                  )
                }
                contribuicoes={<ContributionsPanel contributions={contributions} profiles={profiles} />}
                decisoes={<DecisionsPanel decisions={decisions} />}
                acoes={<ActionsPanel actionItems={actionItems} />}
                ata={
                  <div>
                    <div className="mb-4 flex items-center justify-between">
                      <div>
                        <h3 className="font-display text-sm font-semibold text-ink">
                          📊 Relatórios dos conselheiros
                        </h3>
                        <p className="text-xs text-ink-muted">
                          A visão de cada conselheiro sobre a reunião. Rascunhos editáveis, cifrados e auditados.
                        </p>
                      </div>
                      <ReportsGeneratorForm
                        meetingId={id}
                        hasReports={reports.length > 0}
                        autoPending={autoReportsPending}
                      />
                    </div>
                    {counselorReports.length === 0 ? (
                      <p className="rounded-[var(--radius)] border border-dashed border-ink/15 p-4 text-sm text-ink-muted">
                        {autoReportsPending ? (
                          'Encerrada agora — os relatórios estão sendo gerados automaticamente.'
                        ) : (
                          <>
                            Nenhum relatório ainda — revise a transcrição e clique em &ldquo;Gerar relatórios do
                            conselho&rdquo;.
                          </>
                        )}
                      </p>
                    ) : (
                      <div className="space-y-4">{counselorReports.map((report) => renderReportDetails(report))}</div>
                    )}
                    {reports.length > 0 ? <ReportExportBar meetingId={id} /> : null}
                  </div>
                }
                sintese={
                  <div className="space-y-4">
                    {presidentReport ? (
                      renderReportDetails(presidentReport)
                    ) : counselorReports.length > 0 ? (
                      <div className="rounded-[var(--radius)] border border-dashed border-ink/15 p-4">
                        <p className="text-sm text-ink-muted">
                          Síntese do Presidente ainda não gerada — pode ter falhado durante a geração
                          automática dos relatórios.
                        </p>
                        <PresidentSynthesisButton meetingId={id} />
                      </div>
                    ) : (
                      <p className="text-sm text-ink-muted">Síntese não disponível.</p>
                    )}
                    {syntheses.length > 0 ? (
                      <div>
                        <h3 className="font-display text-sm font-semibold text-ink">
                          Sínteses do Presidente <span className="font-normal text-ink-muted">· histórico ao vivo</span>
                        </h3>
                        <ul className="mt-3 space-y-3">
                          {[...syntheses].reverse().map((s) => (
                            <li key={s.id} className="rounded-[var(--radius)] border border-ink/10 bg-surface p-4">
                              <p className="text-sm leading-relaxed text-ink">{s.content}</p>
                              <p className="mt-2 text-[11px] text-ink-muted">
                                {formatDateTimeBR(s.createdAt)}
                                {s.modelVersion ? ` · ${s.modelVersion}` : ''}
                              </p>
                            </li>
                          ))}
                        </ul>
                      </div>
                    ) : null}
                  </div>
                }
              />
            ) : (
              <>
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
                            ? `Revisada em ${formatDateTimeBR(transcriptReview.updatedAt)} — regenere os relatórios para refletir as correções.`
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
                    <div className="mt-4 space-y-4">{reports.map((report) => renderReportDetails(report))}</div>
                  )}
                  {counselorReports.length > 0 && !presidentReport ? (
                    <div className="mt-4 rounded-[var(--radius)] border border-dashed border-ink/15 p-4">
                      <p className="text-sm text-ink-muted">
                        Síntese do Presidente ainda não gerada — pode ter falhado durante a geração
                        automática dos relatórios.
                      </p>
                      <PresidentSynthesisButton meetingId={id} />
                    </div>
                  ) : null}
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
                            {formatDateTimeBR(s.createdAt)}
                            {s.modelVersion ? ` · ${s.modelVersion}` : ''}
                          </p>
                        </li>
                      ))}
                    </ul>
                  </section>
                )}
              </>
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
