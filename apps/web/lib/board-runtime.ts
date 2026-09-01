import 'server-only';
import { BoardGateway } from '@conselho/board-gateway';
import {
  FullBoardOrchestrator,
  DEFAULT_SEMANTIC_DEDUP_THRESHOLD,
  type FullBoardEvent,
  type FullBoardConfig,
} from '@conselho/board';
import { startMeetingSession, type MeetingSession } from '@conselho/session';
import { NamespacedKnowledgeStore, getCompanyProfile } from '@conselho/kb';
import { analyzeMeetingForImprovements, saveMeetingImprovement } from '@conselho/meeting-report';
import { DeepgramSttProvider } from '@conselho/stt-deepgram';
import { BUSINESS_VOCABULARY, COUNSELOR_AGENT_IDS, type AgentId, type ISttProvider, type SttSession, type TranscriptSegment, type ILlmProvider } from '@conselho/providers';
import { TelemetryRegistry, type GateDecisionKind, type UiEventKind, type CaseReviewOutcome } from '@conselho/telemetry';
import {
  saveSynthesis,
  saveTranscriptSegment,
  listTranscriptFinals,
  countTranscriptFinals,
  listSyntheses,
  auditTranscriptPersistStart,
  loadTranscriptReview,
  listRecentPresidentSyntheses,
  buildPriorMeetingsBlock,
} from '@conselho/meeting-report';
import type { SqlExecutor } from '@conselho/db';
import { getDb } from './db';
import { getEncryptionKey } from './crypto-key';
import { createLlm } from './llm';
import { loadAndApplyProfileOverrides, rebuildAllKnowledge } from './kb-sources';
import { loadAndApplyCompanyProfile } from './company-profile';
import { createSpeakerNameTracker } from './speaker-names';
import { buildKeywordTrigger, type AgentTriggerDef } from '@conselho/engines';

/**
 * Runtime do board no processo do Next (demo do walking skeleton — E3).
 *
 * O gateway WS (3.2) vive no MESMO processo do Next porque o PGlite de dev é
 * single-process. Em produção (DATABASE_URL/pg) o gateway pode ser processo
 * próprio — decisão formal de runtime é a Story 3.5/ADR-010.
 *
 * Demo: o STT é um provider ROTEIRIZADO (reunião simulada PT-BR com gatilho
 * CV) — o resto do caminho é 100% real: orchestrator (3.1) → Claude Haiku
 * (se ANTHROPIC_API_KEY) → auditoria (1.5) → WS (3.2) → feed (3.3).
 * O STT real (Deepgram/OpenAI — 2.1) entra no fluxo de microfone quando o
 * transporte de áudio navegador→servidor for ligado (POC 2.5 / E3 completo).
 */

interface BoardRuntime {
  gateway: BoardGateway;
  /** Um índice RAG POR EMPRESA — nunca compartilhado (isolamento multi-tenant). */
  kbByCompany: Map<string, NamespacedKnowledgeStore>;
  telemetry: TelemetryRegistry;
  active: Map<
    string,
    {
      session: MeetingSession;
      orchestrator: FullBoardOrchestrator;
      events: FullBoardEvent[];
      /** Drena a fila de persistência do transcript (A4) — aguardar antes de reiniciar/ler. */
      flushTranscript: () => Promise<void>;
    }
  >;
  /** Último final por reunião (diagnóstico A5 — "recebendo há Xs"). */
  lastFinalAt: Map<string, number>;
}

const globalForBoard = globalThis as unknown as {
  __conselhoBoard?: Promise<BoardRuntime>;
  /** A6: handshake com o server.mjs (fora do bundle) — roteia upgrades /board e /audio. */
  __conselhoBoardUpgrade?: (request: unknown, socket: unknown, head: unknown) => void;
};

export const BOARD_WS_PORT = Number(process.env.BOARD_WS_PORT ?? 3001);
/** A6: 'attached' = WS na MESMA porta do HTTP (custom server, 443 no Fly);
 *  'port' (default) = listener próprio na 3001 (dev local com `next dev`). */
const BOARD_WS_MODE = process.env.BOARD_WS_MODE === 'attached' ? 'attached' : 'port';

async function init(): Promise<BoardRuntime> {
  const db = await getDb();
  let gateway: BoardGateway;
  if (BOARD_WS_MODE === 'attached') {
    gateway = new BoardGateway(db, { detached: true });
    const g = gateway;
    globalForBoard.__conselhoBoardUpgrade = (request, socket, head) =>
      g.handleUpgrade(
        request as Parameters<BoardGateway['handleUpgrade']>[0],
        socket as Parameters<BoardGateway['handleUpgrade']>[1],
        head as Parameters<BoardGateway['handleUpgrade']>[2],
      );
    // TRANSIÇÃO: a URL antiga (wss://...:3001) continua funcionando por 1-2
    // deploys — clientes com a página aberta não quebram. Remover depois.
    const { createServer } = await import('node:http');
    const legacy = createServer((_req, res) => {
      res.writeHead(426, { 'content-type': 'text/plain' });
      res.end('upgrade required');
    });
    legacy.on('upgrade', (request, socket, head) => g.handleUpgrade(request, socket, head));
    legacy.on('error', (error) => console.error('[board] listener legado 3001:', error));
    legacy.listen(BOARD_WS_PORT, '0.0.0.0');
  } else {
    gateway = new BoardGateway(db, { port: BOARD_WS_PORT });
  }
  return {
    gateway,
    kbByCompany: new Map(),
    telemetry: new TelemetryRegistry(),
    active: new Map(),
    lastFinalAt: new Map(),
  };
}

export function getBoardRuntime(): Promise<BoardRuntime> {
  if (!globalForBoard.__conselhoBoard) {
    // rejeição NÃO fica cacheada: um Neon transiente no boot envenenaria o
    // singleton para sempre — WS morto atrás de healthcheck verde. A próxima
    // chamada (lazy-start das actions/rotas) re-tenta o init do zero.
    globalForBoard.__conselhoBoard = init().catch((error) => {
      globalForBoard.__conselhoBoard = undefined;
      throw error;
    });
  }
  return globalForBoard.__conselhoBoard;
}

/**
 * Índice RAG (+ perfis + perfil da empresa) DE UMA EMPRESA — construído sob
 * demanda no 1º acesso (não no boot: empresas são criadas em runtime) e
 * cacheado no processo. Conhecimento por conselheiro: SEED do repositório +
 * fontes do dono no banco (kb_source) + perfis personalizados (agent_profile).
 * O mesmo rebuild roda ao vivo quando o dono edita em /counselors/[id].
 */
export async function getCompanyKnowledgeStore(companyId: string): Promise<NamespacedKnowledgeStore> {
  const runtime = await getBoardRuntime();
  const existing = runtime.kbByCompany.get(companyId);
  if (existing) return existing;

  const db = await getDb();
  const kb = new NamespacedKnowledgeStore();
  await loadAndApplyProfileOverrides(db, companyId);
  await loadAndApplyCompanyProfile(db, companyId, getEncryptionKey());
  await rebuildAllKnowledge(kb, db, companyId, getEncryptionKey(), COUNSELOR_AGENT_IDS);
  runtime.kbByCompany.set(companyId, kb);
  return kb;
}

type DemoScriptStep = { segment: TranscriptSegment; delayMs: number };

/** Roteiros da reunião simulada (PT-BR) — cada um dispara vários conselheiros
 * (CFO, Legal crítico, Engenharia, Mercado) e deixa pausa p/ a síntese do
 * Presidente. Vários cenários (não um só) pra que empresas diferentes não
 * vejam sempre a MESMA demo; o nome/região da empresa entra no roteiro. */
const DEMO_TEMPLATES: ReadonlyArray<(company: string, region: string) => DemoScriptStep[]> = [
  (company) => [
    { segment: { text: `Bom dia a todos, vamos começar a reunião de diretoria da ${company}.`, isFinal: true }, delayMs: 1500 },
    {
      segment: {
        text: 'O cronograma da obra da fase dois atrasou três semanas e o orçamento de obra já consumiu metade da contingência.',
        isFinal: true,
      },
      delayMs: 4000,
    },
    {
      segment: {
        text: 'Recebemos uma ação judicial do condomínio vizinho sobre o muro de divisa, e isso pode travar o registro de incorporação.',
        isFinal: true,
      },
      delayMs: 8000,
    },
    {
      segment: {
        text: 'A velocidade de vendas caiu e o preço por metro quadrado dos concorrentes do bairro está dez por cento abaixo do nosso.',
        isFinal: true,
      },
      delayMs: 11_000,
    },
    {
      segment: {
        text: 'Precisamos decidir o enquadramento MCMV da próxima torre e revisar o fluxo de caixa do trimestre antes de aprovar o terreno novo.',
        isFinal: true,
      },
      delayMs: 14_000,
    },
  ],
  (company, region) => [
    { segment: { text: `Bom dia, vamos abrir a reunião de diretoria da ${company}.`, isFinal: true }, delayMs: 1500 },
    {
      segment: {
        text: `Fechamos o terreno em ${region} e agora precisamos definir o mix de unidades antes de protocolar o projeto.`,
        isFinal: true,
      },
      delayMs: 4000,
    },
    {
      segment: {
        text: 'O banco sinalizou que o funding do próximo lançamento depende de atingirmos 30% de VSO ainda na pré-venda.',
        isFinal: true,
      },
      delayMs: 8000,
    },
    {
      segment: {
        text: 'A construtora parceira pediu reajuste de 12% no contrato por conta do aço e do cimento — isso muda a margem do projeto.',
        isFinal: true,
      },
      delayMs: 11_000,
    },
    {
      segment: {
        text: 'Também chegou uma reclamação recorrente de pós-venda sobre infiltração em um empreendimento entregue há um ano.',
        isFinal: true,
      },
      delayMs: 14_000,
    },
  ],
  (company, region) => [
    { segment: { text: `Bom dia, começando a reunião de diretoria da ${company}.`, isFinal: true }, delayMs: 1500 },
    {
      segment: {
        text: `A prefeitura de ${region} publicou uma revisão no plano diretor que pode reduzir o gabarito permitido no nosso terreno.`,
        isFinal: true,
      },
      delayMs: 4000,
    },
    {
      segment: {
        text: 'Um corretor parceiro trouxe uma proposta de permuta por terreno maior, mas com matrícula ainda em inventário.',
        isFinal: true,
      },
      delayMs: 8000,
    },
    {
      segment: {
        text: 'O caixa do trimestre ficou apertado porque distratos subiram acima do previsto nas duas últimas torres entregues.',
        isFinal: true,
      },
      delayMs: 11_000,
    },
    {
      segment: {
        text: 'Também estamos avaliando trocar o sistema construtivo por um modular, pra reduzir prazo de obra nos próximos lançamentos.',
        isFinal: true,
      },
      delayMs: 14_000,
    },
  ],
];

/** Escolha determinística (mesma empresa sempre cai no mesmo roteiro — troca só entre empresas diferentes). */
function pickDemoTemplate(companyId: string): (typeof DEMO_TEMPLATES)[number] {
  let hash = 0;
  for (let i = 0; i < companyId.length; i++) {
    hash = (hash * 31 + companyId.charCodeAt(i)) >>> 0;
  }
  return DEMO_TEMPLATES[hash % DEMO_TEMPLATES.length]!;
}

function buildDemoScript(companyId: string): DemoScriptStep[] {
  const profile = getCompanyProfile(companyId);
  const company = profile.name?.trim() || 'nossa incorporadora';
  const region = profile.region?.[0]?.trim() || 'nossa região de atuação';
  return pickDemoTemplate(companyId)(company, region);
}

/** STT roteirizado: emite o script com timing realista (demo sem microfone). */
class ScriptedDemoStt implements ISttProvider {
  constructor(private readonly script: DemoScriptStep[]) {}

  openStream(): SttSession {
    let closed = false;
    const script = this.script;
    return {
      async *[Symbol.asyncIterator](): AsyncIterator<TranscriptSegment> {
        const start = Date.now();
        for (const { segment, delayMs } of script) {
          const wait = start + delayMs - Date.now();
          if (wait > 0) await new Promise((r) => setTimeout(r, wait));
          if (closed) return;
          yield { ...segment, receivedAtMs: Date.now() };
        }
      },
      async close(): Promise<void> {
        closed = true;
      },
    };
  }
}

function makeLlm(onUsage?: (u: { inputTokens: number; outputTokens: number }) => void): {
  llm: ILlmProvider;
  label: string;
} {
  // Factory única (lib/llm.ts): Gemini > Anthropic > fake, trocável por env.
  return createLlm(onUsage ? { onUsage } : {});
}

/**
 * Persistência do histórico do board: toda SÍNTESE do Presidente é gravada
 * (cifrada + auditada) no momento em que sai — sobrevive a restart/fim da
 * consulta. Fire-and-forget com log: falha de persistência não derruba o board.
 */
function persistSynthesisEvents(db: SqlExecutor, meetingId: string, event: FullBoardEvent): void {
  if (event.contribution.type !== 'sintese') return;
  saveSynthesis(db, meetingId, event.contribution.text, getEncryptionKey(), event.contribution.modelVersion).catch(
    (error) => console.error('[board] falha ao salvar síntese:', error),
  );
}

/**
 * Wiring comum sessão→gateway (A3): transcript ao vivo + STATUS do pipeline
 * (live/degraded/ended) visível ao cliente — degradação silenciosa do STT foi
 * uma das causas do incidente de produção. Rastreia lastFinalAt por reunião.
 */
function wireSessionBroadcast(
  runtime: BoardRuntime,
  meetingId: string,
  session: MeetingSession,
  db: SqlExecutor,
  opts: { persistTranscript: boolean },
): { flushTranscript: () => Promise<void> } {
  let lastFinalAt: number | null = null;
  // Nomeia quem fala por autoapresentação ("sou a Marina") — troca "Locutor N"
  // pelo nome dali em diante, só nesta sessão ao vivo (não é biometria).
  const speakerNames = createSpeakerNameTracker();
  // A4: cada final REAL é persistido cifrado no ato (fila encadeada preserva a
  // ordem) — a transcrição sobrevive a deploy/restart no meio da reunião
  // (incidente 23:52). A DEMO NÃO persiste (persistTranscript=false): o script
  // roteirizado contaminaria os relatórios da reunião real.
  let nextSeq: Promise<number> = opts.persistTranscript
    ? db
        .query<{ max: number | null }>(
          'SELECT MAX(seq) AS max FROM transcript_segment WHERE meeting_id = $1',
          [meetingId],
        )
        .then((r) => (r.rows[0]?.max ?? -1) + 1)
        .catch(() => 0)
    : Promise.resolve(0);
  const persistFinal = (text: string) => {
    nextSeq = nextSeq.then(async (seq) => {
      try {
        await saveTranscriptSegment(db, meetingId, seq, text, getEncryptionKey());
      } catch (error) {
        console.error('[board] falha ao persistir segmento:', error);
      }
      return seq + 1;
    });
  };
  if (opts.persistTranscript) {
    auditTranscriptPersistStart(db, meetingId).catch((error) =>
      console.error('[board] falha ao auditar início da persistência:', error),
    );
  }
  session.subscribe((event) => {
    if (event.type === 'segment') {
      const text = speakerNames.apply(event.segment.text);
      if (event.segment.isFinal) {
        lastFinalAt = Date.now();
        runtime.lastFinalAt.set(meetingId, lastFinalAt);
        runtime.telemetry.sttSegment(meetingId);
        if (opts.persistTranscript) persistFinal(text);
      }
      runtime.gateway.broadcastTranscript(meetingId, text, event.segment.isFinal);
      return;
    }
    if (event.type === 'status') {
      runtime.gateway.broadcastStatus(meetingId, event.status, lastFinalAt);
    }
  });
  // prime: quem abrir o /board já sabe que o pipeline está vivo (replay no gateway)
  runtime.gateway.broadcastStatus(meetingId, 'live', null);
  // drena a fila de persistência: reinício da MESMA consulta aguarda os INSERTs
  // em voo antes de ler MAX(seq) — sem colisão de seq (ON CONFLICT descartaria fala)
  return { flushTranscript: async () => { await nextSeq.catch(() => {}); } };
}

/** Lê um número de env var (ou default) — tolerante a vazio/NaN. */
function envNumber(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === '') return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

/**
 * Knobs de calibração do board por env — ajustáveis entre consultas via
 * `fly secrets set` + restart, sem novo deploy. Antes eram números mágicos no
 * call site (dívida do code review). Defaults = valores do piloto.
 */
function boardTuningFromEnv(): Pick<FullBoardConfig, 'caseReviewMs' | 'semanticDedupThreshold'> {
  return {
    caseReviewMs: envNumber('BOARD_CASE_REVIEW_MS', 90_000),
    semanticDedupThreshold: envNumber('BOARD_SEMANTIC_DEDUP_THRESHOLD', DEFAULT_SEMANTIC_DEDUP_THRESHOLD),
  };
}

/** Wiring comum de telemetria por reunião. */
function telemetryHooks(runtime: BoardRuntime, meetingId: string) {
  const t = runtime.telemetry;
  return {
    onUsage: (u: { inputTokens: number; outputTokens: number }) =>
      t.llmUsage(meetingId, u.inputTokens, u.outputTokens),
    onDecision: (kind: string) => t.gateDecision(meetingId, kind as GateDecisionKind),
    onContributionLatency: (ms: number) => t.contributionLatency(meetingId, ms),
    onCaseStateUpdate: () => t.caseStateUpdate(meetingId), // B3/B5
    onCaseReview: (outcome: CaseReviewOutcome) => t.caseReview(meetingId, outcome), // B4/B5
  };
}

/** Inicia a demo do BOARD COMPLETO (E6) — gate de gravação incluso. */
/**
 * Memória entre reuniões: síntese do Presidente das últimas reuniões
 * ENCERRADAS, pronta para `priorMeetingsContext` do orchestrator. Nunca
 * lança — sem histórico (ou erro ao buscar), a reunião só começa "em branco"
 * como hoje, não trava o início.
 */
async function loadPriorMeetingsContext(
  db: SqlExecutor,
  companyId: string,
  meetingId: string,
): Promise<string | undefined> {
  try {
    const syntheses = await listRecentPresidentSyntheses(db, getEncryptionKey(), companyId, meetingId);
    return buildPriorMeetingsBlock(syntheses) || undefined;
  } catch (error) {
    console.error('[board] carregar histórico de reuniões anteriores falhou:', error);
    return undefined;
  }
}

/** Empresa DONA da reunião — nunca confiar em companyId vindo só do cliente. */
async function getMeetingCompanyId(db: SqlExecutor, meetingId: string): Promise<string> {
  const res = await db.query<{ company_id: string }>('SELECT company_id FROM meeting WHERE id = $1', [
    meetingId,
  ]);
  const companyId = res.rows[0]?.company_id;
  if (!companyId) throw new Error(`Reunião ${meetingId} não encontrada.`);
  return companyId;
}

/**
 * Conselheiros que participam desta reunião, pelo tipo escolhido na criação
 * (Etapa "Tipos de reunião") — `undefined` ⇒ reunião sem tipo (compat), todos
 * participam. Presidente nunca entra aqui, ele só sintetiza.
 */
export async function getMeetingActiveAgentIds(
  db: SqlExecutor,
  meetingId: string,
): Promise<readonly AgentId[] | undefined> {
  const res = await db.query<{ agent_ids: string[] | null }>(
    `SELECT mt.agent_ids FROM meeting m
     LEFT JOIN meeting_type mt ON mt.id = m.meeting_type_id
     WHERE m.id = $1`,
    [meetingId],
  );
  const agentIds = res.rows[0]?.agent_ids;
  return agentIds ? (agentIds as AgentId[]) : undefined;
}

/** Gatilhos dos conselheiros CUSTOM desta empresa (só eles têm trigger_keywords). */
async function getCompanyExtraTriggers(db: SqlExecutor, companyId: string): Promise<AgentTriggerDef[]> {
  const res = await db.query<{ agent_id: string; trigger_keywords: string[] | null }>(
    'SELECT agent_id, trigger_keywords FROM agent_profile WHERE company_id = $1 AND trigger_keywords IS NOT NULL',
    [companyId],
  );
  return res.rows
    .map((r) => buildKeywordTrigger(r.agent_id as AgentId, r.trigger_keywords ?? []))
    .filter((t): t is AgentTriggerDef => t !== null);
}

export async function startDemoBoard(meetingId: string): Promise<{ llmLabel: string }> {
  const db = await getDb();
  const runtime = await getBoardRuntime();
  const companyId = await getMeetingCompanyId(db, meetingId);
  const kb = await getCompanyKnowledgeStore(companyId);

  // reinício idempotente: encerra a demo anterior da mesma reunião
  const previous = runtime.active.get(meetingId);
  if (previous) {
    previous.orchestrator.stop();
    await previous.session.stop();
    await previous.flushTranscript().catch(() => {});
  }

  const session = await startMeetingSession(
    db,
    meetingId,
    companyId,
    new ScriptedDemoStt(buildDemoScript(companyId)),
    { vocabularyBoost: BUSINESS_VOCABULARY },
  );
  const hooks = telemetryHooks(runtime, meetingId);
  runtime.telemetry.sessionStarted(meetingId);
  const { llm, label } = makeLlm(hooks.onUsage);
  const priorMeetingsContext = await loadPriorMeetingsContext(db, companyId, meetingId);
  const activeAgentIds = await getMeetingActiveAgentIds(db, meetingId);
  const extraTriggers = await getCompanyExtraTriggers(db, companyId);
  const orchestrator = new FullBoardOrchestrator(companyId, db, session, llm, kb, {
    // "quiet board": segurar não-críticos até uma pausa natural de verdade —
    // 2.5s cortava no meio de frases com respiração natural (ADR-008/FR12).
    pauseMs: envNumber('BOARD_PAUSE_MS', 4000),
    tickMs: 1000,
    synthesisQuietMs: 10_000,
    synthesisMinPersonas: 3,
    maxPerMinutePerAgent: envNumber('BOARD_MAX_PER_MINUTE_PER_AGENT', 1),
    maxPerMinuteGlobal: envNumber('BOARD_MAX_PER_MINUTE_GLOBAL', 4),
    onDecision: hooks.onDecision,
    onContributionLatency: hooks.onContributionLatency,
    onCaseStateUpdate: hooks.onCaseStateUpdate, // B5
    onCaseReview: hooks.onCaseReview,
    priorMeetingsContext,
    activeAgentIds,
    extraTriggers,
  });
  runtime.gateway.bind(meetingId, orchestrator);
  // transcrição ao vivo p/ o painel (texto via WS — áudio nunca passa aqui, §7).
  // DEMO NÃO persiste transcript: o script fictício contaminaria a nota clínica.
  const wired = wireSessionBroadcast(runtime, meetingId, session, db, { persistTranscript: false });
  // histórico de contribuições da sessão (insumo dos relatórios)
  const events: FullBoardEvent[] = [];
  orchestrator.subscribe((event) => {
    events.push(event);
    persistSynthesisEvents(db, meetingId, event); // histórico salvo (cifrado+auditado)
  });
  orchestrator.start();
  runtime.active.set(meetingId, { session, orchestrator, events, flushTranscript: wired.flushTranscript });
  return { llmLabel: label };
}

/** Síntese sob demanda (FR18). */
export async function requestSynthesis(meetingId: string): Promise<void> {
  const runtime = await getBoardRuntime();
  await runtime.active.get(meetingId)?.orchestrator.synthesizeNow();
}

/**
 * Insumos dos relatórios finais: transcript acumulado + contribuições do board.
 * A4: o banco é a fonte durável — sessão ativa usa o superset (banco pode
 * conter fala de ANTES de um reinício da mesma reunião); sem sessão ativa
 * (pós-restart/deploy — o incidente das 23:52), cai integralmente no banco.
 */
export async function getNoteInputs(meetingId: string): Promise<{
  finals: string[];
  contributions: FullBoardEvent['contribution'][];
} | null> {
  const runtime = await getBoardRuntime();
  const db = await getDb();
  const key = getEncryptionKey();
  const active = runtime.active.get(meetingId);
  // drena a fila de persistência antes de ler o banco (nada em voo escapa dos relatórios)
  await active?.flushTranscript().catch(() => {});
  // leitura durável NUNCA derruba os relatórios: chave rotacionada/linha corrompida
  // degrada para a memória da sessão (quando houver) em vez de falhar tudo
  let dbFinals: string[] = [];
  try {
    dbFinals = await listTranscriptFinals(db, meetingId, key);
  } catch (error) {
    console.error('[relatorio] falha ao ler transcript persistido — usando memória:', error);
  }
  const dbSyntheses = await listSyntheses(db, meetingId, key).catch((error) => {
    console.error('[relatorio] falha ao ler sínteses persistidas:', error);
    return [];
  });
  const synthesesAsContributions = dbSyntheses.map((s) => ({
    agentId: 'presidente' as const,
    type: 'sintese' as const,
    severity: 'normal' as const,
    text: s.content,
    modelVersion: s.modelVersion ?? undefined,
  }));

  // Transcrição Confiável: se o empresário revisou o transcript, a versão CORRIGIDA
  // é a fonte dos documentos — precede tanto o banco cru quanto a memória da sessão
  // (é a decisão humana sobre o que de fato foi dito).
  let reviewedFinals: string[] | null = null;
  try {
    const review = await loadTranscriptReview(db, meetingId, key);
    if (review) {
      const lines = review.content.split(/\r?\n+/).map((l) => l.trim()).filter(Boolean);
      reviewedFinals = lines.length > 0 ? lines : [review.content.trim()];
    }
  } catch (error) {
    console.error('[relatorio] falha ao ler transcrição revisada — usando transcript cru:', error);
  }

  if (active) {
    const memFinals = active.session.getSnapshot().finalSegments.map((s) => s.text);
    const memContributions = active.events.map((e) => e.contribution);
    return {
      finals: reviewedFinals ?? (dbFinals.length >= memFinals.length ? dbFinals : memFinals),
      // pós-restart+reinício: a memória nova pode estar vazia enquanto as
      // sínteses pré-restart vivem no banco — usa o conjunto mais completo
      contributions: memContributions.length >= synthesesAsContributions.length
        ? memContributions
        : synthesesAsContributions,
    };
  }

  // pós-restart sem sessão ativa: tudo do banco
  if (!reviewedFinals && dbFinals.length === 0 && synthesesAsContributions.length === 0) return null;
  return { finals: reviewedFinals ?? dbFinals, contributions: synthesesAsContributions };
}

/**
 * Aprendizado do PRODUTO: roda uma análise (LLM) do que dava pra melhorar no
 * PRÓPRIO Conselho nesta reunião — nunca do negócio da empresa — e guarda só
 * pra leitura (tela /melhorias). Best-effort: chamado fire-and-forget ao
 * encerrar a reunião; falha aqui NUNCA derruba o "Encerrar reunião".
 */
export async function runMeetingImprovementAnalysis(meetingId: string, companyId: string): Promise<void> {
  try {
    const inputs = await getNoteInputs(meetingId);
    if (!inputs) return;
    const { llm, label } = createLlm({ maxTokens: 1200 });
    const content = await analyzeMeetingForImprovements(llm, inputs.finals, inputs.contributions);
    if (!content) return;
    const db = await getDb();
    await saveMeetingImprovement(db, meetingId, companyId, content, getEncryptionKey(), label);
  } catch (error) {
    console.error('[melhorias] análise pós-reunião falhou:', error);
  }
}

/** Snapshot do pipeline para o modo diagnóstico (A5). Só booleanos/contadores
 * — NUNCA valores de secrets nem conteúdo clínico. */
export interface PipelineStatusReport {
  readonly active: boolean;
  readonly sttStatus: 'idle' | 'live' | 'degraded' | 'ended';
  readonly finalsCount: number;
  readonly lastFinalAgoMs: number | null;
  readonly audioSinkRegistered: boolean;
  readonly boardClients: number;
  readonly deepgramConfigured: boolean;
  readonly anthropicConfigured: boolean;
  readonly persistedFinals: number;
}

export async function getPipelineStatus(meetingId: string): Promise<PipelineStatusReport> {
  const runtime = await getBoardRuntime();
  const db = await getDb();
  const active = runtime.active.get(meetingId);
  const lastFinalAt = runtime.lastFinalAt.get(meetingId) ?? null;
  // COUNT sem decifrar (poll de 3s do painel) — o schema é do clinical-notes
  const persistedFinals = await countTranscriptFinals(db, meetingId);
  const sttStatus = active ? active.session.getSnapshot().status : 'idle';
  return {
    // reunião encerrada permanece em `active` (insumo dos relatórios, com TTL), mas o
    // diagnóstico não pode reportá-la como ativa (retrato ambíguo)
    active: Boolean(active) && sttStatus !== 'ended',
    sttStatus,
    finalsCount: active ? active.session.getSnapshot().finalSegments.length : 0,
    lastFinalAgoMs: lastFinalAt ? Date.now() - lastFinalAt : null,
    audioSinkRegistered: runtime.gateway.hasAudioSink(meetingId),
    boardClients: runtime.gateway.clientCount(meetingId),
    deepgramConfigured: Boolean(process.env.DEEPGRAM_API_KEY),
    anthropicConfigured: Boolean(
      process.env.OPENAI_API_KEY || process.env.GEMINI_API_KEY || process.env.ANTHROPIC_API_KEY,
    ),
    persistedFinals,
  };
}

/** Fila de áudio: o WS /audio empurra; o adapter STT consome (AsyncIterable). */
function createAudioQueue() {
  const queue: Array<Uint8Array | null> = [];
  let wake: (() => void) | null = null;
  const push = (item: Uint8Array | null) => {
    queue.push(item);
    wake?.();
    wake = null;
  };
  const iterable: AsyncIterable<Uint8Array> = {
    async *[Symbol.asyncIterator]() {
      for (;;) {
        const item = queue.shift();
        if (item === undefined) {
          await new Promise<void>((resolve) => {
            wake = resolve;
          });
          continue;
        }
        if (item === null) return;
        yield item;
      }
    },
  };
  return {
    iterable,
    sink: { push: (chunk: Uint8Array) => push(chunk), end: () => push(null) },
  };
}

/**
 * REUNIÃO AO VIVO (mic real): áudio do navegador chega pelo WS /audio do
 * gateway → fila → DeepgramSttProvider (streaming PT-BR + boost de vocabulário de negócio) →
 * sessão (2.3) → board completo (E6). A key do vendor NUNCA vai ao browser.
 */
export async function startLiveBoard(meetingId: string): Promise<void> {
  if (!process.env.DEEPGRAM_API_KEY) {
    throw new Error('DEEPGRAM_API_KEY ausente — configure o STT para a reunião ao vivo.');
  }
  const db = await getDb();
  const runtime = await getBoardRuntime();
  const companyId = await getMeetingCompanyId(db, meetingId);
  const kb = await getCompanyKnowledgeStore(companyId);

  const previous = runtime.active.get(meetingId);
  if (previous) {
    previous.orchestrator.stop();
    await previous.session.stop();
    await previous.flushTranscript().catch(() => {});
    runtime.gateway.unregisterAudioSink(meetingId);
  }

  const audio = createAudioQueue();
  let session: MeetingSession | undefined;
  let orchestrator: FullBoardOrchestrator | undefined;
  try {
    // O gate de gravação roda AQUI — antes de qualquer sink existir.
    // O client só conecta o WS /audio depois que esta action retorna, então
    // registrar o sink após a sessão não perde áudio e elimina o sink órfão.
    const stt = new DeepgramSttProvider({ apiKey: process.env.DEEPGRAM_API_KEY });
    session = await startMeetingSession(db, meetingId, companyId, stt, {
      audio: audio.iterable,
      vocabularyBoost: BUSINESS_VOCABULARY,
    });
    runtime.gateway.registerAudioSink(meetingId, audio.sink);
    const hooks = telemetryHooks(runtime, meetingId);
    runtime.telemetry.sessionStarted(meetingId);
    const { llm } = makeLlm(hooks.onUsage);
    const priorMeetingsContext = await loadPriorMeetingsContext(db, companyId, meetingId);
    const activeAgentIds = await getMeetingActiveAgentIds(db, meetingId);
    const extraTriggers = await getCompanyExtraTriggers(db, companyId);
    orchestrator = new FullBoardOrchestrator(companyId, db, session, llm, kb, {
      // "quiet board": segurar não-críticos até uma pausa natural de verdade —
    // 2.5s cortava no meio de frases com respiração natural (ADR-008/FR12).
    pauseMs: envNumber('BOARD_PAUSE_MS', 4000),
      tickMs: 1000,
      synthesisQuietMs: 20_000,
      synthesisMinPersonas: 3,
      maxPerMinutePerAgent: envNumber('BOARD_MAX_PER_MINUTE_PER_AGENT', 1),
      maxPerMinuteGlobal: envNumber('BOARD_MAX_PER_MINUTE_GLOBAL', 4),
      onDecision: hooks.onDecision,
      onContributionLatency: hooks.onContributionLatency,
      ...boardTuningFromEnv(), // B4: caseReviewMs + threshold do dedup por env (calibração do piloto)
      onCaseStateUpdate: hooks.onCaseStateUpdate,
      onCaseReview: hooks.onCaseReview,
      activeAgentIds,
      extraTriggers,
      priorMeetingsContext,
    });
    runtime.gateway.bind(meetingId, orchestrator);
    const wired = wireSessionBroadcast(runtime, meetingId, session, db, { persistTranscript: true });
    const events: FullBoardEvent[] = [];
    orchestrator.subscribe((event) => {
      events.push(event);
      persistSynthesisEvents(db, meetingId, event); // histórico salvo (cifrado+auditado)
    });
    orchestrator.start();
    runtime.active.set(meetingId, { session, orchestrator, events, flushTranscript: wired.flushTranscript });
  } catch (error) {
    // rollback completo: nada fica órfão (sink, sessão STT ou orchestrator)
    runtime.gateway.unregisterAudioSink(meetingId);
    orchestrator?.stop();
    await session?.stop().catch(() => {});
    throw error;
  }
}

/** Retenção da sessão encerrada em memória (insumo dos relatórios até o TTL;
 * o banco é a fonte durável depois). Correção do vazamento herdado do NutriMed:
 * `active` nunca era limpo e o RSS crescia sem bound. */
const ACTIVE_RETENTION_MS = Number(process.env.BOARD_ACTIVE_RETENTION_MS ?? 2 * 60 * 60 * 1000);

/** Encerra a reunião ao vivo (para STT e board; preserva transcript p/ os relatórios). */
export async function stopLiveBoard(meetingId: string): Promise<void> {
  const runtime = await getBoardRuntime();
  runtime.gateway.unregisterAudioSink(meetingId);
  const active = runtime.active.get(meetingId);
  if (active) {
    active.orchestrator.stop();
    await active.session.stop();
  }
  runtime.telemetry.sessionEnded(meetingId);
  // TTL: a entrada sai da memória depois da retenção (o transcript persistido
  // cobre getNoteInputs dali em diante). unref: não segura o processo vivo.
  const timer = setTimeout(() => {
    const current = runtime.active.get(meetingId);
    if (current && current.session.getSnapshot().status === 'ended') {
      runtime.active.delete(meetingId);
      runtime.lastFinalAt.delete(meetingId);
    }
    runtime.telemetry.purgeExpired();
  }, ACTIVE_RETENTION_MS);
  timer.unref?.();
}

/** Relatório de telemetria da reunião + sumário da instância (E10). */
export async function getTelemetryReport(meetingId: string) {
  const runtime = await getBoardRuntime();
  return { report: runtime.telemetry.report(meetingId), summary: runtime.telemetry.summary() };
}

export async function recordUiEvent(meetingId: string, kind: UiEventKind): Promise<void> {
  const runtime = await getBoardRuntime();
  runtime.telemetry.uiEvent(meetingId, kind);
}
