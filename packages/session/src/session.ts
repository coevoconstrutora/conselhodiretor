import type { SqlExecutor } from '@conselho/db';
import { assertRecordingConfirmed } from '@conselho/meetings';
import type {
  ISttProvider,
  SttOpenOptions,
  SttSession,
  TranscriptSegment,
} from '@conselho/providers';

/**
 * Consultation Session Service (Story 2.3) — estado canônico da transcrição
 * por sessão de consulta, em memória (ADR-005; runtime validado na POC E3).
 *
 * Consome o `SttSession` (AsyncIterable) do provider e acumula:
 * - segmentos FINAIS: imutáveis, acrescentados em ordem, sem duplicação;
 * - segmento PARCIAL corrente: provisório, substituído a cada emissão e
 *   descartado quando o final correspondente chega.
 *
 * UI (2.4) e motores (E3/E4) consomem via {@link MeetingSession.subscribe}
 * e {@link MeetingSession.getSnapshot} — nunca falam com o STT direto.
 *
 * Compliance: a sessão só inicia após o gate de consentimento do servidor
 * (Story 1.4) autorizar. O conteúdo do transcript é dado de saúde: este módulo
 * NÃO o loga nem persiste (persistência clínica é E9).
 */

export type SessionStatus = 'live' | 'degraded' | 'ended';

export interface SessionSnapshot {
  readonly meetingId: string;
  readonly status: SessionStatus;
  /** Segmentos finais acumulados, em ordem de chegada. */
  readonly finalSegments: readonly TranscriptSegment[];
  /** Parcial corrente (ponta provisória) ou null. */
  readonly partial: TranscriptSegment | null;
  /** Erro que levou a sessão a `degraded`, se houver. */
  readonly error: Error | null;
}

export type SessionEvent =
  | { type: 'segment'; segment: TranscriptSegment }
  | { type: 'status'; status: SessionStatus; error?: Error };

export type SessionListener = (event: SessionEvent) => void;

/** Opções de resiliência (Story 2.6) — retry limitado com backoff exponencial. */
export interface SessionRetryOptions {
  /** Reaberturas do stream após falha (default 3). */
  readonly maxRetries?: number;
  /** Base do backoff exponencial em ms (default 500: 500/1000/2000). */
  readonly backoffBaseMs?: number;
  /** Delay injetável (testes usam delay zero). */
  readonly delay?: (ms: number) => Promise<void>;
}

const defaultDelay = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export class MeetingSession {
  private status: SessionStatus = 'live';
  private readonly finals: TranscriptSegment[] = [];
  private partial: TranscriptSegment | null = null;
  private error: Error | null = null;
  private readonly listeners = new Set<SessionListener>();
  private readonly consumeLoop: Promise<void>;
  private stream: SttSession;
  private stopped = false;
  private readonly maxRetries: number;
  private readonly backoffBaseMs: number;
  private readonly delay: (ms: number) => Promise<void>;

  constructor(
    readonly meetingId: string,
    initialStream: SttSession,
    private readonly reopen: () => SttSession,
    retry: SessionRetryOptions = {},
  ) {
    this.stream = initialStream;
    this.maxRetries = retry.maxRetries ?? 3;
    this.backoffBaseMs = retry.backoffBaseMs ?? 500;
    this.delay = retry.delay ?? defaultDelay;
    this.consumeLoop = this.consume();
  }

  /** Assina eventos da sessão. Retorna função de unsubscribe (sem vazar listeners — AC5). */
  subscribe(listener: SessionListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** Leitura imutável do estado corrente (AC3). */
  getSnapshot(): SessionSnapshot {
    return {
      meetingId: this.meetingId,
      status: this.status,
      finalSegments: [...this.finals],
      partial: this.partial,
      error: this.error,
    };
  }

  /**
   * Encerra a sessão: fecha o stream do provider, finaliza o loop consumidor e
   * preserva o acumulado em memória (AC5).
   */
  async stop(): Promise<void> {
    if (this.status === 'ended') return;
    this.stopped = true;
    await this.stream.close();
    await this.consumeLoop;
    this.setStatus('ended');
    this.listeners.clear();
  }

  /**
   * Loop consumidor com recuperação (Story 2.6): erro do STT degrada (AC6 da
   * 2.3), tenta reabrir o stream com backoff exponencial limitado; ao voltar a
   * receber segmentos, retorna a `live` SEM duplicar finais (o acumulado nunca
   * é descartado). Esgotadas as tentativas, permanece `degraded` — a consulta
   * não trava (frontend-spec §3.1).
   */
  private async consume(): Promise<void> {
    let attempt = 0;
    for (;;) {
      try {
        for await (const segment of this.stream) {
          attempt = 0; // stream saudável zera o orçamento de retries
          if (this.status === 'degraded') this.setStatus('live'); // recuperou
          if (segment.isFinal) {
            // final consolida a ponta: acrescenta e limpa o parcial (AC2)
            this.finals.push(segment);
            this.partial = null;
          } else {
            this.partial = segment;
          }
          this.emit({ type: 'segment', segment });
        }
        return; // fim natural (ex.: close()) — status final é decidido por stop()
      } catch (err) {
        this.error = err instanceof Error ? err : new Error(String(err));
        this.setStatus('degraded', this.error);
        if (this.stopped || attempt >= this.maxRetries) return;
        attempt += 1;
        await this.delay(this.backoffBaseMs * 2 ** (attempt - 1));
        if (this.stopped) return;
        try {
          this.stream = this.reopen();
        } catch (reopenErr) {
          this.error = reopenErr instanceof Error ? reopenErr : new Error(String(reopenErr));
          return; // reabertura falhou de vez — permanece degraded
        }
      }
    }
  }

  private setStatus(status: SessionStatus, error?: Error): void {
    if (this.status === status) return;
    this.status = status;
    this.emit({ type: 'status', status, error });
  }

  private emit(event: SessionEvent): void {
    for (const listener of this.listeners) listener(event);
  }
}

/**
 * Inicia uma sessão de consulta: verifica o GATE de consentimento no servidor
 * (Story 1.4 — lança `ConsentRequiredError` se não autorizado) e só então abre
 * o stream PT-BR do provider (AC4).
 */
export interface StartSessionOptions extends SessionRetryOptions {
  /** Fonte de áudio do navegador (Story 2.2). */
  readonly audio?: SttOpenOptions['audio'];
  /** Termos clínicos a reforçar no STT (Story 2.6 / T4). */
  readonly vocabularyBoost?: SttOpenOptions['vocabularyBoost'];
}

export async function startMeetingSession(
  db: SqlExecutor,
  meetingId: string,
  companyId: string,
  stt: ISttProvider,
  opts: StartSessionOptions = {},
): Promise<MeetingSession> {
  await assertRecordingConfirmed(db, meetingId, companyId);
  const open = () =>
    stt.openStream({ lang: 'pt-BR', audio: opts.audio, vocabularyBoost: opts.vocabularyBoost });
  return new MeetingSession(meetingId, open(), open, opts);
}
