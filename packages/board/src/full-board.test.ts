import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomBytes } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { runMigrations, type SqlExecutor, pgliteExecutor } from '@conselho/db';
import { createMeeting, confirmRecording } from '@conselho/meetings';
import { getAuditTrail } from '@conselho/audit';
import type {
  ISttProvider,
  SttSession,
  TranscriptSegment,
  LlmCompletionRequest,
  TextCompletionRequest,
  AgentContribution,
  AgentId,
} from '@conselho/providers';
import { FakeTextCompleter } from '@conselho/providers';
import { startMeetingSession } from '@conselho/session';
import { NamespacedKnowledgeStore, ingest } from '@conselho/kb';
import { FullBoardOrchestrator, type FullBoardEvent } from './full-board';

class PushSttProvider implements ISttProvider {
  private queue: Array<TranscriptSegment | null> = [];
  private wake: (() => void) | null = null;
  push(text: string): void {
    this.queue.push({ text, isFinal: true });
    this.wake?.();
  }
  openStream(): SttSession {
    const queue = this.queue;
    const setWake = (fn: (() => void) | null): void => {
      this.wake = fn;
    };
    const callWake = (): void => this.wake?.();
    let closed = false;
    return {
      async *[Symbol.asyncIterator](): AsyncIterator<TranscriptSegment> {
        for (;;) {
          if (closed) return;
          const item = queue.shift();
          if (item === undefined) {
            await new Promise<void>((r) => {
              setWake(r);
            });
            continue;
          }
          if (item === null) return;
          yield item;
        }
      },
      async close(): Promise<void> {
        closed = true;
        callWake();
      },
    };
  }
}

class EchoLlm {
  calls: LlmCompletionRequest[] = [];
  /** Simula o modelo declarando "nada novo". */
  skipIf: ((req: LlmCompletionRequest) => boolean) | null = null;
  /** completeText opcional (CaseState) — atribuído por teste quando necessário. */
  completeText?: (req: TextCompletionRequest) => Promise<{ text: string; modelVersion?: string }>;
  async complete(req: LlmCompletionRequest): Promise<AgentContribution> {
    this.calls.push(req);
    if (req.allowSkip && this.skipIf?.(req)) {
      return { agentId: 'presidente', type: 'sugestao', severity: 'normal', text: '', skip: true };
    }
    return {
      agentId: 'presidente',
      type: 'sugestao',
      severity: 'normal',
      // eco do chunk de KB do agente: agentes distintos produzem textos
      // distintos (como o LLM real) — o dedup semântico não os confunde
      text: `eco: ${req.context[0]?.text ?? req.transcript.slice(0, 60)}`,
      kbSources: req.context.map((c) => c.id),
      modelVersion: 'echo-v1',
    };
  }
}

function makeStore() {
  const store = new NamespacedKnowledgeStore();
  ingest(
    store,
    [
      {
        agentId: 'legal',
        source: 'seed#legal',
        content:
          'Ação judicial liminar multa passivo: mapear o risco jurídico, provisionar e definir estratégia processual.',
      },
      {
        agentId: 'cfo',
        source: 'seed#cfo',
        content:
          'Fluxo de caixa exposição viabilidade VGV margem: revisar a projeção de caixa e o funding do empreendimento.',
      },
      {
        agentId: 'mercado',
        source: 'seed#mercado',
        content:
          'Preço por metro quadrado precificação ticket concorrência: comparar com lançamentos concorrentes ponderando tipologia.',
      },
    ],
    'test-v1',
  );
  return store;
}

const flush = () => new Promise((r) => setTimeout(r, 0));

describe('FullBoardOrchestrator — conselho completo', () => {
  let db: PGlite;
  let exec: SqlExecutor;
  let meetingId: string;
  let companyId: string;

  beforeAll(async () => {
    db = new PGlite();
    exec = pgliteExecutor(db);
    await runMigrations(exec);
    const company = await exec.query<{ id: string }>("SELECT id FROM company WHERE slug = 'coevo'");
    companyId = company.rows[0]!.id;
    const res = await exec.query<{ id: string }>(
      'INSERT INTO app_user (email, display_name, password_hash, company_id) VALUES ($1, $2, $3, $4) RETURNING id',
      ['ceo@conselho.test', 'Empresário Demo', 'x', companyId],
    );
    const userId = res.rows[0]!.id;
    meetingId = await createMeeting(exec, userId, companyId, 'Reunião de diretoria', randomBytes(32));
    await confirmRecording(exec, meetingId, companyId);
  });

  afterAll(async () => {
    await db.close();
  });

  async function setup(
    opts: {
      now?: () => number;
      pauseMs?: number;
      onDecision?: (kind: string) => void;
      caseStateEveryNFinals?: number;
      textScript?: readonly string[];
      caseReviewMs?: number;
      onCaseReview?: (outcome: 'skip' | 'contribution' | 'discarded') => void;
      activeAgentIds?: readonly AgentId[];
      meetingGuidance?: string;
    } = {},
  ) {
    const stt = new PushSttProvider();
    const session = await startMeetingSession(exec, meetingId, companyId, stt);
    const llm = new EchoLlm();
    if (opts.textScript) {
      const completer = new FakeTextCompleter(opts.textScript);
      llm.completeText = (req) => completer.completeText(req);
    }
    const board = new FullBoardOrchestrator('test-company', exec, session, llm, makeStore(), {
      pauseMs: opts.pauseMs ?? 0, // pausa imediata por default (testes determinísticos)
      tickMs: 100000, // tick manual via flush — sem timer interferindo
      maxPerMinutePerAgent: 2,
      maxPerMinuteGlobal: 100, // testes exercitam o teto global separadamente (engines)
      now: opts.now,
      onDecision: opts.onDecision,
      caseStateEveryNFinals: opts.caseStateEveryNFinals,
      caseReviewMs: opts.caseReviewMs,
      onCaseReview: opts.onCaseReview,
      activeAgentIds: opts.activeAgentIds,
      meetingGuidance: opts.meetingGuidance,
    });
    const events: FullBoardEvent[] = [];
    board.subscribe((e) => events.push(e));
    board.start();
    return { stt, session, llm, board, events };
  }

  it('um segmento dispara MÚLTIPLOS agentes pelo pipeline completo, com KB escopada', async () => {
    let t = 0;
    const { stt, session, board, events, llm } = await setup({ now: () => (t += 3000) });

    stt.push('A ação judicial do terreno pressiona o fluxo de caixa do empreendimento.');
    await flush();
    await board.flush();

    const agents = new Set(events.map((e) => e.contribution.agentId));
    expect(agents.has('legal')).toBe(true);
    // KB escopada: cada chamada do reasoner recebeu só chunks do próprio agente
    for (const call of llm.calls) {
      const namespaces = new Set(call.context.map((c) => c.agentId));
      expect(namespaces.size).toBeLessThanOrEqual(1);
    }
    board.stop();
    await session.stop();
  });

  it('Tipo de reunião — activeAgentIds restringe quem reage, mesmo com gatilho batendo', async () => {
    let t = 0;
    // mesma fala do teste acima (dispara 'legal' e outros) — mas o tipo desta
    // reunião só inclui 'cfo': 'legal' NUNCA deve aparecer nos eventos.
    const { stt, session, board, events } = await setup({
      now: () => (t += 3000),
      activeAgentIds: ['cfo'],
    });

    stt.push('A ação judicial do terreno pressiona o fluxo de caixa do empreendimento.');
    await flush();
    await board.flush();

    const agents = new Set(events.map((e) => e.contribution.agentId));
    expect(agents.has('legal')).toBe(false);
    expect(agents.has('cfo')).toBe(true);
    board.stop();
    await session.stop();
  });

  it('toda contribuição publicada é auditada com proveniência de KB', async () => {
    let t = 0;
    const { stt, session, board, events } = await setup({ now: () => (t += 3000) });
    stt.push('Recebemos uma ação judicial do condomínio vizinho.');
    await flush();
    await board.flush();

    expect(events.length).toBeGreaterThan(0);
    const trail = await getAuditTrail(exec, events[0]!.id);
    expect(trail).toHaveLength(1);
    expect(trail[0]!.modelVersion).toBe('echo-v1');
    expect((trail[0]!.kbSources as string[]).length).toBeGreaterThan(0);
    board.stop();
    await session.stop();
  });

  it('síntese SOB DEMANDA integra a rodada como Presidente, audita e fecha a rodada', async () => {
    let t = 0;
    const { stt, session, board, events, llm } = await setup({ now: () => (t += 3000) });
    stt.push('Recebemos uma ação judicial sobre o terreno.');
    stt.push('O preço por m² dos concorrentes está abaixo do nosso.');
    await flush();
    await board.flush();
    const before = events.length;
    expect(before).toBeGreaterThanOrEqual(2);

    await board.synthesizeNow();
    const synthesis = events[events.length - 1]!;
    expect(synthesis.contribution.type).toBe('sintese');
    expect(synthesis.contribution.agentId).toBe('presidente');
    expect(synthesis.triggeredBy).toBe('sintese-on-demand');

    // prompt da síntese: papel de síntese + decisão do empresário + contribuições da rodada
    const synthCall = llm.calls[llm.calls.length - 1]!;
    expect(synthCall.system).toContain('SÍNTESE');
    expect(synthCall.system).toContain('devolvendo a decisão ao empresário');
    expect(synthCall.transcript).toContain('Contribuições do conselho');

    const trail = await getAuditTrail(exec, synthesis.id);
    expect(trail[0]!.triggeredBy).toBe('sintese-on-demand');

    // rodada fechou: nova síntese sob demanda sem novas contribuições = no-op
    const count = events.length;
    await board.synthesizeNow();
    expect(events.length).toBe(count);
    board.stop();
    await session.stop();
  });

  it('tópicos distintos de agentes distintos NÃO marcam divergência', async () => {
    let t = 0;
    const { stt, session, board, events } = await setup({ now: () => (t += 3000) });
    stt.push('O distrato aumentou no trimestre.'); // vendas-velocidade e legal-contratos: tópicos distintos
    await flush();
    await board.flush();
    expect(events.every((e) => e.divergent === false)).toBe(true);
    board.stop();
    await session.stop();
  });

  it('a 2ª chamada do LLM recebe o histórico com a 1ª contribuição (anti-repetição)', async () => {
    let t = 0;
    const { stt, session, board, llm, events } = await setup({ now: () => (t += 3000) });

    stt.push('Recebemos uma ação judicial do vizinho.');
    await flush();
    await board.flush();
    const firstText = events[0]!.contribution.text;
    // 1ª chamada: reunião ainda sem histórico
    expect(llm.calls[0]!.priorContributions ?? []).toHaveLength(0);
    expect(llm.calls[0]!.allowSkip).toBe(true);

    stt.push('O preço por m² da concorrência caiu bastante.');
    await flush();
    await board.flush();

    const laterCall = llm.calls[llm.calls.length - 1]!;
    expect(laterCall.priorContributions!.length).toBeGreaterThan(0);
    expect(laterCall.priorContributions!.some((p) => p.includes(firstText))).toBe(true);
    board.stop();
    await session.stop();
  });

  it('{"skip":true} do modelo: nada emitido, nada auditado, decisão llm-skip', async () => {
    let t = 0;
    const decisions: string[] = [];
    const { stt, session, board, llm, events } = await setup({
      now: () => (t += 3000),
      onDecision: (kind) => decisions.push(kind),
    });
    llm.skipIf = () => true;

    const auditBefore = await exec.query<{ n: string }>('SELECT COUNT(*) AS n FROM audit_log');
    stt.push('Recebemos uma ação judicial do vizinho.');
    await flush();
    await board.flush();

    expect(events).toHaveLength(0);
    expect(decisions).toContain('llm-skip');
    const auditAfter = await exec.query<{ n: string }>('SELECT COUNT(*) AS n FROM audit_log');
    expect(Number(auditAfter.rows[0]!.n)).toBe(Number(auditBefore.rows[0]!.n)); // sem trilha fantasma
    board.stop();
    await session.stop();
  });

  it('a síntese do Presidente recebe o histórico da reunião inteira', async () => {
    let t = 0;
    const { stt, session, board, llm } = await setup({ now: () => (t += 3000) });
    stt.push('Recebemos uma ação judicial sobre o terreno.');
    stt.push('O preço por m² dos concorrentes caiu.');
    await flush();
    await board.flush();

    await board.synthesizeNow();
    const synthCall = llm.calls[llm.calls.length - 1]!;
    expect(synthCall.system).toContain('SÍNTESE');
    expect(synthCall.priorContributions!.length).toBeGreaterThanOrEqual(2);
    board.stop();
    await session.stop();
  });

  it('mesmo tópico repetido MUITO depois (fora dos 60s do gate): corte pré-LLM sem nova chamada', async () => {
    let t = 1000;
    const decisions: string[] = [];
    const { stt, session, board, llm, events } = await setup({
      now: () => t,
      onDecision: (kind) => decisions.push(kind),
    });

    stt.push('O ticket médio precisa de precificação nova.'); // mercado-precificacao (normal)
    await flush();
    await board.flush();
    const emitted = events.length;
    expect(emitted).toBeGreaterThan(0);
    const callsAfterFirst = llm.calls.length;

    t = 300_000; // 5min depois — o Deduplicator de 60s do gate já esqueceu o tópico
    stt.push('O ticket médio precisa de precificação nova.'); // mesma fala, zero vocabulário novo
    await flush();
    await board.flush();

    expect(decisions).toContain('semantic-duplicate');
    expect(llm.calls.length).toBe(callsAfterFirst); // economia: LLM NÃO foi chamado
    expect(events.length).toBe(emitted); // nada repetido no feed
    board.stop();
    await session.stop();
  });

  it('critical NUNCA é cortado pré-LLM (recall de risco); pós-LLM pega texto igual', async () => {
    let t = 1000;
    const decisions: string[] = [];
    const { stt, session, board, llm, events } = await setup({
      now: () => t,
      onDecision: (kind) => decisions.push(kind),
    });

    stt.push('Recebemos uma ação judicial do condomínio.'); // legal-risco-grave (critical)
    await flush();
    await board.flush();
    const callsAfterFirst = llm.calls.length;
    const emitted = events.length;

    t = 300_000;
    stt.push('Recebemos uma ação judicial do condomínio.'); // mesma fala crítica
    await flush();
    await board.flush();

    expect(llm.calls.length).toBeGreaterThan(callsAfterFirst); // critical SEMPRE reanalisa
    expect(events.length).toBe(emitted); // mas texto idêntico não repete no feed
    expect(decisions).toContain('semantic-duplicate');
    board.stop();
    await session.stop();
  });

  it('CaseState entra no prompt dos agentes e da síntese', async () => {
    let t = 0;
    const STATE =
      '{"hypotheses":["terreno da zona norte é a prioridade"],"investigated":["viabilidade preliminar"],"meetingPoints":["caixa apertado no Q3"],"pending":{}}';
    const { stt, session, board, llm } = await setup({
      now: () => (t += 3000),
      caseStateEveryNFinals: 1, // update a cada final (determinístico no teste)
      textScript: [STATE],
    });

    stt.push('Bom dia, vamos começar a reunião de hoje.'); // neutro — só alimenta o CaseState
    await flush();
    await board.flush();
    await flush(); // update fire-and-forget do tracker resolve

    stt.push('O preço por m² dos concorrentes caiu e preocupa.'); // dispara Mercado
    await flush();
    await board.flush();

    const contributionCall = llm.calls.find((c) => !c.system.includes('SÍNTESE'));
    expect(contributionCall!.transcript).toContain('ESTADO DO CASO');
    expect(contributionCall!.transcript).toContain('terreno da zona norte');

    await board.synthesizeNow();
    const synthCall = llm.calls[llm.calls.length - 1]!;
    expect(synthCall.transcript).toContain('ESTADO DO CASO');
    board.stop();
    await session.stop();
  });

  it('provider sem completeText: conselho funciona igual (degradação graciosa)', async () => {
    let t = 0;
    const { stt, session, board, events } = await setup({ now: () => (t += 3000) }); // sem textScript
    stt.push('Recebemos uma ação judicial do vizinho.');
    await flush();
    await board.flush();
    expect(events.length).toBeGreaterThan(0); // pipeline intacto, sem CaseState
    board.stop();
    await session.stop();
  });

  it('case review em pausa: contribuição roteada é emitida com triggeredBy case-review e auditada', async () => {
    let t = 1000;
    const outcomes: string[] = [];
    const { stt, session, board, events } = await setup({
      now: () => t,
      caseReviewMs: 90_000,
      textScript: [
        '{"agentId":"mercado","type":"hipotese","severity":"normal","text":"Considere validar a demanda da tipologia compacta antes de travar o mix do produto."}',
      ],
      onCaseReview: (o) => outcomes.push(o),
    });

    stt.push('Estamos pensando em unidades menores no próximo projeto.'); // sem palavra-gatilho
    await flush();
    await board.flush();
    expect(events).toHaveLength(0); // regex não pegou — é o gap que o review cobre

    t = 200_000; // pausa longa + intervalo de review vencido
    await board.tickNow();

    expect(outcomes).toEqual(['contribution']);
    expect(events).toHaveLength(1);
    expect(events[0]!.triggeredBy).toBe('case-review');
    expect(events[0]!.contribution.agentId).toBe('mercado');
    const trail = await getAuditTrail(exec, events[0]!.id);
    expect(trail[0]!.triggeredBy).toBe('case-review');
    board.stop();
    await session.stop();
  });

  it('review alimenta seenTopics: 2º review no MESMO tópico é cortado pelo dedup', async () => {
    let t = 1000;
    const outcomes: string[] = [];
    const review =
      '{"agentId":"mercado","type":"hipotese","severity":"normal","text":"Considere validar a demanda da tipologia compacta."}';
    const { stt, session, board, events } = await setup({
      now: () => t,
      caseReviewMs: 1,
      textScript: [review, review], // mesmo texto/agente 2×
      onCaseReview: (o) => outcomes.push(o),
    });
    stt.push('Estamos avaliando unidades menores no próximo projeto.');
    await flush();
    await board.flush();

    t = 50_000;
    await board.tickNow();
    t = 100_000;
    await board.tickNow();

    // 1ª review emite; 2ª é descartada (pós-LLM contra o já exibido)
    expect(outcomes.filter((o) => o === 'contribution')).toHaveLength(1);
    expect(events.filter((e) => e.triggeredBy === 'case-review')).toHaveLength(1);
    board.stop();
    await session.stop();
  });

  it('review com skip: nada emitido; respeita o intervalo mínimo entre reviews', async () => {
    let t = 1000;
    const outcomes: string[] = [];
    const { stt, session, board, events, llm } = await setup({
      now: () => t,
      caseReviewMs: 90_000,
      textScript: ['{"skip":true}', '{"skip":true}'],
      onCaseReview: (o) => outcomes.push(o),
    });
    stt.push('Conversa neutra sem gatilhos.');
    await flush();
    await board.flush();

    t = 100_000;
    await board.tickNow();
    expect(outcomes).toEqual(['skip']);
    expect(events).toHaveLength(0);

    t = 110_000; // só 10s depois — intervalo de 90s NÃO venceu
    await board.tickNow();
    expect(outcomes).toEqual(['skip']); // nenhum review novo
    expect(llm.calls).toHaveLength(0); // e nenhum LLM de contribuição rodou
    board.stop();
    await session.stop();
  });

  it('review NÃO roda fora de pausa natural', async () => {
    let t = 1000;
    const outcomes: string[] = [];
    const { stt, session, board } = await setup({
      now: () => t,
      pauseMs: 5000,
      caseReviewMs: 90_000,
      textScript: ['{"skip":true}'],
      onCaseReview: (o) => outcomes.push(o),
    });
    stt.push('Fala recente.'); // lastSpeechAt = t
    await flush();
    await board.flush();

    t += 2000; // ainda DENTRO da conversa (pauseMs 5000)
    await board.tickNow();
    expect(outcomes).toHaveLength(0); // não interrompe a reunião
    board.stop();
    await session.stop();
  });

  it('texto do review similar ao já exibido é DESCARTADO (dedup pós)', async () => {
    let t = 0;
    const outcomes: string[] = [];
    const { stt, session, board, events } = await setup({
      now: () => (t += 3000),
      caseReviewMs: 1, // intervalo mínimo — o teste controla via pausa
      textScript: [
        // parafraseia o chunk do Mercado que o EchoLlm ecoa na 1ª contribuição
        '{"agentId":"mercado","type":"sugestao","severity":"normal","text":"Preço por metro quadrado precificação: comparar com lançamentos concorrentes ponderando tipologia."}',
      ],
      onCaseReview: (o) => outcomes.push(o),
    });
    stt.push('O ticket médio precisa de precificação nova.'); // Mercado contribui via trigger
    await flush();
    await board.flush();
    const emitted = events.length;
    expect(emitted).toBeGreaterThan(0);

    await board.tickNow(); // review devolve paráfrase do que o Mercado já disse
    expect(outcomes).toEqual(['discarded']);
    expect(events).toHaveLength(emitted);
    board.stop();
    await session.stop();
  });

  it('segmento neutro: nenhuma chamada de LLM', async () => {
    let t = 0;
    const { stt, session, board, llm, events } = await setup({ now: () => (t += 3000) });
    stt.push('Bom dia, como vai a família?');
    await flush();
    await board.flush();
    expect(llm.calls).toHaveLength(0);
    expect(events).toHaveLength(0);
    board.stop();
    await session.stop();
  });

  it('modo silencioso: grava/atualiza o CaseState, mas não gera contribuição ao vivo', async () => {
    let t = 0;
    const { stt, session, board, llm, events } = await setup({
      now: () => (t += 3000),
      caseStateEveryNFinals: 1,
    });
    let completeTextCalls = 0;
    llm.completeText = async () => {
      completeTextCalls += 1;
      return { text: '{"hypotheses":[],"investigated":[],"meetingPoints":["reunião tumultuada"],"pending":{}}' };
    };
    board.setSilentMode(true);
    expect(board.isSilentMode()).toBe(true);

    stt.push('O preço por m² dos concorrentes caiu e preocupa.'); // dispararia Mercado se não fosse silencioso
    await flush();
    await board.flush();
    await flush(); // update fire-and-forget do CaseState resolve

    expect(events).toHaveLength(0); // nada AO VIVO — sem card, sem áudio
    expect(completeTextCalls).toBeGreaterThan(0); // mas o CaseState seguiu vivo (insumo dos relatórios finais)
    board.stop();
    await session.stop();
  });

  it('modo silencioso: desligar retoma a produção normal para novos segmentos', async () => {
    let t = 0;
    const { stt, session, board, events } = await setup({ now: () => (t += 3000) });
    board.setSilentMode(true);
    stt.push('O preço por m² dos concorrentes caiu e preocupa.');
    await flush();
    await board.flush();
    expect(events).toHaveLength(0);

    board.setSilentMode(false);
    stt.push('A ação judicial do terreno pressiona o fluxo de caixa do empreendimento.');
    await flush();
    await board.flush();
    expect(events.length).toBeGreaterThan(0);
    board.stop();
    await session.stop();
  });

  it('modo silencioso NÃO bloqueia a síntese sob demanda (ação explícita do empresário)', async () => {
    let t = 0;
    const { stt, session, board, events } = await setup({ now: () => (t += 3000) });
    stt.push('A ação judicial do terreno pressiona o fluxo de caixa do empreendimento.');
    await flush();
    await board.flush();
    expect(events.length).toBeGreaterThan(0);

    board.setSilentMode(true);
    await board.synthesizeNow();
    const synthesis = events.find((e) => e.contribution.agentId === 'presidente');
    expect(synthesis).toBeDefined();
    board.stop();
    await session.stop();
  });

  it('pauta da reunião (meetingGuidance) entra no prompt dos agentes', async () => {
    let t = 0;
    const { stt, session, board, llm } = await setup({
      now: () => (t += 3000),
      meetingGuidance: 'PAUTA DESTA REUNIÃO: 1) terreno da zona norte 2) fluxo de caixa do Q3',
    });
    stt.push('A ação judicial do terreno pressiona o fluxo de caixa do empreendimento.');
    await flush();
    await board.flush();
    const contributionCall = llm.calls.find((c) => !c.system.includes('SÍNTESE'));
    expect(contributionCall!.transcript).toContain('PAUTA DESTA REUNIÃO');
    board.stop();
    await session.stop();
  });
});
