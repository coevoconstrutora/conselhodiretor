import { describe, it, expect } from 'vitest';
import type { AgentId, ContributionSeverity } from '@conselho/providers';
import { TriggerDetector, LEGAL_TRIGGERS, CFO_TRIGGERS, ENGENHARIA_TRIGGERS } from './triggers';
import {
  scoreMatch,
  RelevanceGate,
  AgentRateLimiter,
  PriorityQueue,
  Deduplicator,
  PauseGate,
  BoardGatekeeper,
  type Candidate,
} from './gate';

function candidate(over: Partial<Candidate> = {}): Candidate {
  return {
    id: over.id ?? 'c1',
    agentId: over.agentId ?? 'cfo',
    agentIds: over.agentIds ?? [over.agentId ?? 'cfo'],
    triggerId: over.triggerId ?? 'cfo-viabilidade',
    topicKey: over.topicKey ?? 'viabilidade',
    type: over.type ?? 'atencao',
    severity: over.severity ?? 'normal',
    score: over.score ?? 0.8,
    segmentText: over.segmentText ?? 'texto',
    at: over.at ?? 0,
  };
}

describe('TriggerDetector — catálogos do domínio imobiliário (sem LLM)', () => {
  const detector = new TriggerDetector();

  it('riscos graves disparam como critical (fura fila)', () => {
    for (const [text, agent] of [
      ['a obra foi embargada pela prefeitura, embargo total', 'engenharia'],
      ['recebemos uma ação judicial do condomínio vizinho', 'legal'],
      ['o projeto está com estouro de caixa previsto para março', 'cfo'],
      ['inadimplência alta na carteira do empreendimento', 'cfo'],
    ] as const) {
      const matches = detector.detect(text, 0).filter((m) => m.trigger.agentId === agent);
      expect(matches.length, text).toBeGreaterThan(0);
      expect(
        matches.some((m) => m.trigger.severityHint === 'critical'),
        text,
      ).toBe(true);
    }
  });

  it('temas de cada especialidade disparam o agente certo', () => {
    for (const [text, agent] of [
      ['o cronograma da obra atrasou duas semanas', 'engenharia'],
      ['a velocidade de vendas caiu, VSO abaixo da meta', 'vendas'],
      ['o preço por m² dos concorrentes está 10% abaixo', 'mercado'],
      ['falta a aprovação do projeto na prefeitura', 'arquitetura'],
      ['precisamos assinar o contrato de permuta do terreno', 'legal'],
      ['a vistoria de entrega das chaves começa em maio', 'cs'],
      ['o enquadramento no MCMV faixa 2 depende do subsídio', 'cfo'],
      ['tendências de construção industrializada no longo prazo', 'futurista'],
    ] as const) {
      const matches = detector.detect(text, 0);
      expect(
        matches.some((m) => m.trigger.agentId === agent),
        `${text} → ${agent}`,
      ).toBe(true);
    }
  });

  it('texto neutro não dispara nada', () => {
    expect(detector.detect('Bom dia, tudo bem com vocês?', 0)).toHaveLength(0);
  });

  it('um segmento pode disparar vários agentes (insumo da consolidação)', () => {
    const matches = detector.detect(
      'o distrato aumentou e isso pressiona o fluxo de caixa do empreendimento',
      0,
    );
    const agents = new Set(matches.map((m) => m.trigger.agentId));
    expect(agents.has('cfo')).toBe(true);
    // "distrato" pertence a vendas (velocidade) e legal (contratos)
    expect(agents.has('vendas') || agents.has('legal')).toBe(true);
  });

  it('o presidente NÃO tem triggers próprios', () => {
    const withPresident = detector
      .detect('viabilidade contrato obra vendas mercado projeto entrega tendências', 0)
      .filter((m) => m.trigger.agentId === 'presidente');
    expect(withPresident).toHaveLength(0);
  });
});

describe('Scorer + RelevanceGate', () => {
  it('score combina peso do gatilho e densidade; limitado a [0,1]', () => {
    const detector = new TriggerDetector(CFO_TRIGGERS);
    const curto = detector.detect('qual o VGV do projeto?', 0)[0]!;
    const longo = detector.detect(
      'então assim, conversamos bastante sobre vários assuntos da empresa e em algum momento alguém mencionou o VGV entre muitos outros temas administrativos e comerciais do dia a dia',
      0,
    )[0]!;
    expect(scoreMatch(curto)).toBeGreaterThan(scoreMatch(longo));
    expect(scoreMatch(curto)).toBeLessThanOrEqual(1);
  });

  it('gate respeita limiar configurável; crítico tem limiar menor', () => {
    const gate = new RelevanceGate({ threshold: 0.6, criticalThreshold: 0.3 });
    expect(gate.passes(0.59, 'normal')).toBe(false);
    expect(gate.passes(0.6, 'normal')).toBe(true);
    expect(gate.passes(0.35, 'critical')).toBe(true); // recall p/ críticos
    expect(gate.passes(0.2, 'critical')).toBe(false);
  });
});

describe('Rate-limit por agente + teto global + fila', () => {
  it('teto por agente respeitado na janela; outro agente tem cota própria', () => {
    const limiter = new AgentRateLimiter({
      maxPerMinutePerAgent: 2,
      maxPerMinuteGlobal: 100,
      windowMs: 60_000,
    });
    expect(limiter.allow('cfo', 'normal', 0)).toBe(true);
    expect(limiter.allow('cfo', 'normal', 1000)).toBe(true);
    expect(limiter.allow('cfo', 'normal', 2000)).toBe(false); // estourou
    expect(limiter.allow('legal', 'normal', 2000)).toBe(true); // cota própria
    expect(limiter.allow('cfo', 'normal', 61_001)).toBe(true); // janela girou
  });

  it('teto GLOBAL limita o board inteiro mesmo com cotas individuais livres', () => {
    const limiter = new AgentRateLimiter({
      maxPerMinutePerAgent: 10,
      maxPerMinuteGlobal: 2,
      windowMs: 60_000,
    });
    expect(limiter.allow('cfo', 'normal', 0)).toBe(true);
    expect(limiter.allow('legal', 'normal', 1)).toBe(true);
    expect(limiter.allow('vendas', 'normal', 2)).toBe(false); // teto global
    expect(limiter.allow('vendas', 'normal', 61_000)).toBe(true); // janela girou
  });

  it('crítico fura a fila e NÃO consome cota', () => {
    const limiter = new AgentRateLimiter({ maxPerMinutePerAgent: 1, maxPerMinuteGlobal: 1 });
    expect(limiter.allow('legal', 'critical', 0)).toBe(true);
    expect(limiter.allow('legal', 'critical', 1)).toBe(true);
    expect(limiter.allow('legal', 'normal', 2)).toBe(true); // cota intacta
  });

  it('fila ordena por severidade > score > chegada e descarta redundância', () => {
    const queue = new PriorityQueue();
    queue.enqueue(candidate({ id: 'a', topicKey: 't1', score: 0.7, at: 1 }));
    queue.enqueue(candidate({ id: 'b', topicKey: 't2', score: 0.9, at: 2 }));
    queue.enqueue(candidate({ id: 'c', topicKey: 't3', severity: 'critical', score: 0.4, at: 3 }));
    queue.enqueue(candidate({ id: 'dup', topicKey: 't1', score: 0.99, at: 4 })); // redundante
    expect(queue.size).toBe(3);
    expect(queue.dequeue()!.id).toBe('c'); // crítico primeiro
    expect(queue.dequeue()!.id).toBe('b'); // maior score
    expect(queue.dequeue()!.id).toBe('a');
  });
});

describe('Deduplicação / consolidação', () => {
  it('2 agentes no mesmo tópico na janela → 1 consolidado com ambos', () => {
    const dedup = new Deduplicator({ windowMs: 60_000 });
    expect(
      dedup.submit(candidate({ agentId: 'cfo', agentIds: ['cfo'], topicKey: 'distrato', at: 0 }))
        .kind,
    ).toBe('fresh');
    const result = dedup.submit(
      candidate({ agentId: 'legal', agentIds: ['legal'], topicKey: 'distrato', at: 5000 }),
    );
    expect(result.kind).toBe('consolidated');
    if (result.kind === 'consolidated') {
      expect(result.candidate.agentIds).toEqual(['cfo', 'legal']);
    }
  });

  it('mesmo agente repetindo o tópico na janela → descartado', () => {
    const dedup = new Deduplicator();
    dedup.submit(candidate({ agentId: 'cfo', topicKey: 'distrato', at: 0 }));
    expect(dedup.submit(candidate({ agentId: 'cfo', topicKey: 'distrato', at: 5000 })).kind).toBe(
      'duplicate',
    );
  });

  it('tópicos distintos ou fora da janela não consolidam', () => {
    const dedup = new Deduplicator({ windowMs: 1000 });
    dedup.submit(candidate({ topicKey: 'distrato', at: 0 }));
    expect(
      dedup.submit(candidate({ agentId: 'legal', topicKey: 'zoneamento', at: 100 })).kind,
    ).toBe('fresh');
    expect(dedup.submit(candidate({ agentId: 'legal', topicKey: 'distrato', at: 5000 })).kind).toBe(
      'fresh',
    );
  });

  it('consolidação herda a maior severidade (crítico vence)', () => {
    const dedup = new Deduplicator();
    dedup.submit(candidate({ agentId: 'cfo', severity: 'critical', topicKey: 'caixa', at: 0 }));
    const result = dedup.submit(
      candidate({ agentId: 'legal', severity: 'normal', topicKey: 'caixa', at: 1 }),
    );
    if (result.kind === 'consolidated') expect(result.candidate.severity).toBe('critical');
    else expect.fail('esperava consolidação');
  });
});

describe('PauseGate', () => {
  it('não-crítico é retido durante a fala e liberado na pausa ≥2,5s', () => {
    const gate = new PauseGate({ pauseMs: 2500 });
    gate.onSpeech(1000);
    expect(gate.submit(candidate({ severity: 'normal' }), 2000)).toBeNull(); // falando
    expect(gate.heldCount).toBe(1);
    expect(gate.flushIfPaused(3000)).toHaveLength(0); // só 2s de silêncio
    const released = gate.flushIfPaused(3501); // 2,5s+
    expect(released).toHaveLength(1);
  });

  it('crítico entrega imediatamente mesmo durante a fala', () => {
    const gate = new PauseGate();
    gate.onSpeech(1000);
    const out = gate.submit(candidate({ severity: 'critical' }), 1100);
    expect(out).not.toBeNull();
  });

  it('flush libera em ordem de prioridade', () => {
    const gate = new PauseGate({ pauseMs: 100 });
    gate.onSpeech(0);
    gate.submit(candidate({ id: 'low', score: 0.6, at: 1 }), 10);
    gate.submit(candidate({ id: 'high', score: 0.9, at: 2 }), 20);
    const released = gate.flushIfPaused(200);
    expect(released.map((c) => c.id)).toEqual(['high', 'low']);
  });
});

describe('BoardGatekeeper — pipeline composto', () => {
  function gk() {
    return new BoardGatekeeper({
      threshold: 0.6,
      criticalThreshold: 0.3,
      maxPerMinutePerAgent: 1,
      maxPerMinuteGlobal: 4,
      pauseMs: 2500,
    });
  }

  it('crítico forte em pausa → deliver direto', () => {
    const gate = gk();
    const decision = gate.submit(candidate({ severity: 'critical', score: 0.9 }), 10_000);
    expect(decision.kind).toBe('deliver');
  });

  it('score baixo → rejected-score (LLM nunca roda)', () => {
    expect(gk().submit(candidate({ score: 0.2 }), 10_000).kind).toBe('rejected-score');
  });

  it('não-crítico durante a fala → held; pausa → release entrega', () => {
    const gate = gk();
    gate.pauseGate.onSpeech(10_000);
    expect(gate.submit(candidate({ score: 0.8 }), 10_500).kind).toBe('held-for-pause');
    expect(gate.release(11_000)).toHaveLength(0); // ainda falando
    const released = gate.release(13_000); // pausa de 2,5s+
    expect(released).toHaveLength(1);
  });

  it('estouro do teto → rate-limited + fila; janela girando, release drena', () => {
    const gate = gk();
    expect(gate.submit(candidate({ id: 'a', topicKey: 't1', score: 0.8, at: 0 }), 10_000).kind).toBe(
      'deliver',
    );
    expect(
      gate.submit(candidate({ id: 'b', topicKey: 't2', score: 0.8, at: 1 }), 10_500).kind,
    ).toBe('rate-limited');
    expect(gate.release(80_000).map((c) => c.id)).toEqual(['b']); // janela girou
  });

  it('consolidação flui pelo pipeline fim-a-fim', () => {
    const gate = gk();
    expect(
      gate.submit(
        candidate({
          agentId: 'cfo',
          agentIds: ['cfo'],
          topicKey: 'caixa',
          score: 0.8,
          severity: 'critical',
        }),
        10_000,
      ).kind,
    ).toBe('deliver');
    const second = gate.submit(
      candidate({
        id: 'c2',
        agentId: 'legal',
        agentIds: ['legal'],
        topicKey: 'caixa',
        score: 0.7,
        severity: 'critical',
        at: 1000,
      }),
      11_000,
    );
    expect(second.kind).toBe('deliver');
    if (second.kind === 'deliver') expect(second.candidate.agentIds).toEqual(['cfo', 'legal']);
  });
});

// sanity: catálogos cobrem os 8 conselheiros com severidades coerentes
describe('Catálogos', () => {
  it('cada catálogo pertence a um único agente; riscos graves são critical', () => {
    const agents = (defs: ReadonlyArray<{ agentId: AgentId; severityHint: ContributionSeverity }>) =>
      new Set(defs.map((d) => d.agentId));
    expect(agents(LEGAL_TRIGGERS)).toEqual(new Set(['legal']));
    expect(agents(CFO_TRIGGERS)).toEqual(new Set(['cfo']));
    expect(agents(ENGENHARIA_TRIGGERS)).toEqual(new Set(['engenharia']));
    expect(LEGAL_TRIGGERS.filter((t) => t.severityHint === 'critical').length).toBeGreaterThanOrEqual(1);
    expect(CFO_TRIGGERS.filter((t) => t.severityHint === 'critical').length).toBeGreaterThanOrEqual(1);
  });
});
