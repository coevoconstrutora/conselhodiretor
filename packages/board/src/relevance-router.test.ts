import { describe, it, expect } from 'vitest';
import { RelevanceRouter, type CounselorRelevanceInput } from './relevance-router';

const COUNSELORS: CounselorRelevanceInput[] = [
  { agentId: 'cfo', displayName: 'CFO', scope: 'fluxo de caixa, funding, viabilidade' },
  { agentId: 'engenharia', displayName: 'Engenharia', scope: 'cronograma, custo de obra, método construtivo' },
  { agentId: 'legal', displayName: 'Legal', scope: 'contratos, riscos jurídicos, compliance' },
];

/** Fake LLM mínimo — só o completeText importa aqui (mesmo padrão de agent-briefing.test.ts). */
function fakeLlm(response: string | (() => string)) {
  return {
    complete: async () => {
      throw new Error('RelevanceRouter nunca deveria chamar complete() — só completeText().');
    },
    completeText: async () => ({ text: typeof response === 'function' ? response() : response }),
  };
}

describe('RelevanceRouter — seleção por relevância (Etapa "Orquestração")', () => {
  it('score ≥ highThreshold sempre entra', async () => {
    const router = new RelevanceRouter(
      fakeLlm(JSON.stringify([{ agentId: 'cfo', relevance: 0.9 }, { agentId: 'engenharia', relevance: 0.2 }])),
    );
    const result = await router.route('O orçamento de obra estourou.', COUNSELORS);
    expect(result.map((r) => r.agentId)).toEqual(['cfo']);
  });

  it('score < lowThreshold nunca entra', async () => {
    const router = new RelevanceRouter(fakeLlm(JSON.stringify([{ agentId: 'legal', relevance: 0.1 }])));
    const result = await router.route('Vamos revisar o cronograma.', COUNSELORS);
    expect(result).toEqual([]);
  });

  it('faixa intermediária (0.40–0.64) só entra se houver sinal de risco/decisão/pergunta', async () => {
    const router = new RelevanceRouter(fakeLlm(JSON.stringify([{ agentId: 'legal', relevance: 0.5 }])));
    expect(await router.route('Vamos revisar o cronograma da obra.', COUNSELORS)).toEqual([]);
    const withQuestion = await router.route('Isso pode gerar algum risco contratual?', COUNSELORS);
    expect(withQuestion.map((r) => r.agentId)).toEqual(['legal']);
  });

  it('limita a 3 conselheiros por tópico, priorizando maior score', async () => {
    const many: CounselorRelevanceInput[] = [
      ...COUNSELORS,
      { agentId: 'mercado', displayName: 'Mercado', scope: 'concorrência, demanda' },
      { agentId: 'vendas', displayName: 'Vendas', scope: 'funil comercial, VSO' },
    ];
    const router = new RelevanceRouter(
      fakeLlm(
        JSON.stringify([
          { agentId: 'cfo', relevance: 0.95 },
          { agentId: 'engenharia', relevance: 0.9 },
          { agentId: 'legal', relevance: 0.85 },
          // abaixo de strategicOverrideThreshold (0.75) — só 3 acima, não dispara a exceção multidisciplinar
          { agentId: 'mercado', relevance: 0.7 },
          { agentId: 'vendas', relevance: 0.68 },
        ]),
      ),
    );
    const result = await router.route('Discussão estratégica ampla.', many);
    expect(result).toHaveLength(3);
    expect(result.map((r) => r.agentId)).toEqual(['cfo', 'engenharia', 'legal']);
  });

  it('exceção multidisciplinar: 4+ conselheiros com score ≥ strategicOverrideThreshold passam do limite de 3', async () => {
    const many: CounselorRelevanceInput[] = [
      ...COUNSELORS,
      { agentId: 'mercado', displayName: 'Mercado', scope: 'concorrência, demanda' },
    ];
    const router = new RelevanceRouter(
      fakeLlm(
        JSON.stringify([
          { agentId: 'cfo', relevance: 0.9 },
          { agentId: 'engenharia', relevance: 0.85 },
          { agentId: 'legal', relevance: 0.8 },
          { agentId: 'mercado', relevance: 0.78 },
        ]),
      ),
    );
    const result = await router.route('Decisão estratégica multidisciplinar.', many);
    expect(result).toHaveLength(4);
  });

  it('relevance fora de [0,1] é clampado', async () => {
    const router = new RelevanceRouter(fakeLlm(JSON.stringify([{ agentId: 'cfo', relevance: 1.4 }])));
    const result = await router.route('Fala qualquer.', COUNSELORS);
    expect(result[0]!.relevance).toBe(1);
  });

  it('agentId desconhecido (inventado pelo modelo) é descartado', async () => {
    const router = new RelevanceRouter(fakeLlm(JSON.stringify([{ agentId: 'dr-house', relevance: 0.9 }])));
    expect(await router.route('Fala qualquer.', COUNSELORS)).toEqual([]);
  });

  it('JSON inválido do modelo nunca derruba a reunião — devolve []', async () => {
    const router = new RelevanceRouter(fakeLlm('isso não é JSON'));
    expect(await router.route('Fala qualquer.', COUNSELORS)).toEqual([]);
  });

  it('completeText lançando erro (rede/API) nunca derruba a reunião — devolve []', async () => {
    const router = new RelevanceRouter({
      complete: async () => {
        throw new Error('não usar');
      },
      completeText: async () => {
        throw new Error('falha de rede');
      },
    });
    expect(await router.route('Fala qualquer.', COUNSELORS)).toEqual([]);
  });

  it('provider sem completeText (fake antigo) degrada graciosamente — devolve []', async () => {
    const router = new RelevanceRouter({
      complete: async () => {
        throw new Error('não usar');
      },
    });
    expect(await router.route('Fala qualquer.', COUNSELORS)).toEqual([]);
  });

  it('lista de conselheiros vazia devolve [] sem chamar o LLM', async () => {
    let called = false;
    const router = new RelevanceRouter({
      complete: async () => {
        throw new Error('não usar');
      },
      completeText: async () => {
        called = true;
        return { text: '[]' };
      },
    });
    expect(await router.route('Fala qualquer.', [])).toEqual([]);
    expect(called).toBe(false);
  });
});
