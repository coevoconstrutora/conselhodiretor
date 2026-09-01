import { describe, it, expect } from 'vitest';
import type { KbChunk, LlmCompletionRequest, AgentContribution } from '@conselho/providers';
import { NamespacedKnowledgeStore } from './store';
import { ingest, chunkContent, seedSources } from './ingest';
import { AgentReasoner, buildAgentSystem, DEFAULT_AGENT_PROFILES } from './reasoner';

const TEST_COMPANY = 'test-company';

const SEED = `# Base seed

## cfo — Funding, Caixa e MCMV

**Escopo:** fluxo de caixa, funding, viabilidade, MCMV.

- Exposição máxima de caixa define o funding necessário do empreendimento
- Financiamento à produção exige percentual mínimo de vendas e obra para enquadramento
- Enquadramento MCMV depende de teto de preço por município e renda do comprador

## legal — Legal e Compliance

**Escopo:** contratos, registro de incorporação, riscos jurídicos.

- Registro de incorporação é pré-condição para comercializar unidades na planta
- Patrimônio de afetação protege o empreendimento e habilita o regime especial tributário
`;

function setupStore(version = 'seed-v1') {
  const store = new NamespacedKnowledgeStore();
  ingest(store, seedSources(SEED), version);
  return store;
}

describe('Pipeline de ingestão versionado + proveniência', () => {
  it('ingere a seed por agente com proveniência fonte@versão em cada chunk', async () => {
    const store = setupStore();
    expect(store.sizeOf('cfo')).toBeGreaterThan(0);
    expect(store.sizeOf('legal')).toBeGreaterThan(0);
    expect(store.versionOf('cfo')).toBe('seed-v1');

    const chunks = await store.retrieve('cfo', 'funding exposição de caixa', 5);
    expect(chunks.length).toBeGreaterThan(0);
    for (const chunk of chunks) {
      expect(chunk.source).toMatch(/agents-knowledge-seed\.md#cfo@seed-v1/);
      expect(chunk.agentId).toBe('cfo');
    }
  });

  it('re-ingestão com nova versão SUBSTITUI o namespace sem resíduo', async () => {
    const store = setupStore('seed-v1');
    const before = store.sizeOf('cfo');
    expect(before).toBeGreaterThan(0);

    ingest(
      store,
      [
        {
          agentId: 'cfo',
          source: 'politica-financeira-2026.md',
          content:
            'Política curada: exposição máxima de caixa por SPE limitada a 20% do VGV do empreendimento.',
        },
      ],
      'curada-v1',
    );
    expect(store.versionOf('cfo')).toBe('curada-v1');
    expect(store.sizeOf('cfo')).toBe(1); // sem resíduo da seed

    const chunks = await store.retrieve('cfo', 'exposição caixa SPE VGV', 5);
    expect(chunks.every((c) => c.source?.includes('politica-financeira-2026.md@curada-v1'))).toBe(
      true,
    );
    // outro namespace intacto
    expect(store.versionOf('legal')).toBe('seed-v1');
  });

  it('chunker descarta ruído curto e preserva conteúdo', () => {
    const chunks = chunkContent(
      'legal',
      'f.md',
      '# T\n\n- ok\n- Registro de incorporação é pré-condição para vender na planta.',
      'v1',
    );
    expect(chunks).toHaveLength(1);
    expect(chunks[0]!.id).toBe('legal:v1:0');
  });
});

describe('Namespaces isolados por agente', () => {
  it('query financeira NUNCA retorna chunk jurídico (e vice-versa)', async () => {
    const store = setupStore();
    const fromCfo = await store.retrieve('cfo', 'registro incorporação patrimônio afetação', 10);
    expect(fromCfo.every((c) => c.agentId === 'cfo')).toBe(true);

    const fromLegal = await store.retrieve('legal', 'funding exposição caixa MCMV', 10);
    expect(fromLegal.every((c) => c.agentId === 'legal')).toBe(true);
  });

  it('namespace vazio retorna lista vazia — nunca vaza de outro', async () => {
    const store = setupStore(); // vendas não está na SEED de teste
    expect(await store.retrieve('vendas', 'funding caixa', 5)).toEqual([]);
  });

  it('k é respeitado e ranking é determinístico', async () => {
    const store = setupStore();
    const top1 = await store.retrieve('cfo', 'MCMV enquadramento teto preço', 1);
    expect(top1).toHaveLength(1);
    expect(top1[0]!.text).toContain('MCMV');
  });

  it('chunk de outro agente é rejeitado na escrita do namespace (defesa em profundidade)', () => {
    const store = new NamespacedKnowledgeStore();
    const foreign: KbChunk = { id: 'x', agentId: 'legal', text: 'conteúdo jurídico' };
    expect(() => store.replaceNamespace('cfo', [foreign], 'v1')).toThrow(/FR21/);
  });
});

describe('AgentReasoner + prompts restritos', () => {
  class CapturingLlm {
    lastRequest: LlmCompletionRequest | null = null;
    async complete(req: LlmCompletionRequest): Promise<AgentContribution> {
      this.lastRequest = req;
      return {
        agentId: 'presidente', // modelo "errou" o agente de propósito — reasoner corrige
        type: 'atencao',
        severity: 'critical',
        text: 'Vale verificar a exposição de caixa antes de aprovar.',
        modelVersion: 'fake-v1',
      };
    }
  }

  it('fluxo candidato→KB escopada→LLM→contribuição com kbSources (proveniência)', async () => {
    const store = setupStore();
    const llm = new CapturingLlm();
    const reasoner = new AgentReasoner(TEST_COMPANY, store, llm);

    const contribution = await reasoner.reason({
      agentId: 'cfo',
      query: 'funding exposição de caixa financiamento',
      transcript: 'Vamos aprovar o terreno; a exposição de caixa preocupa.',
    });

    expect(contribution.agentId).toBe('cfo'); // o agente é decisão do board
    expect(contribution.kbSources!.length).toBeGreaterThan(0);
    expect(contribution.kbSources!.every((id) => id.startsWith('cfo:'))).toBe(true);
    // contexto entregue ao LLM veio só do namespace do CFO
    expect(llm.lastRequest!.context.every((c) => c.agentId === 'cfo')).toBe(true);
  });

  it('system prompt contém escopo do agente + regras anti-extrapolação', () => {
    for (const agentId of ['cfo', 'legal', 'engenharia', 'futurista'] as const) {
      const system = buildAgentSystem(DEFAULT_AGENT_PROFILES[agentId]!, TEST_COMPANY);
      expect(system).toContain(DEFAULT_AGENT_PROFILES[agentId]!.scope);
      expect(system).toContain('NUNCA opine fora do seu escopo');
      expect(system).toContain('não invente números nem fatos');
      expect(system).toContain('nunca de comando');
      expect(system).toContain('varie a forma como você se dirige ao grupo');
    }
  });

  it('reasoner usa o system restrito na chamada do LLM', async () => {
    const store = setupStore();
    const llm = new CapturingLlm();
    await new AgentReasoner(TEST_COMPANY, store, llm).reason({
      agentId: 'legal',
      query: 'registro incorporação memorial',
      transcript: 'Precisamos registrar a incorporação antes do lançamento.',
    });
    expect(llm.lastRequest!.system).toContain('Legal e Compliance');
    expect(llm.lastRequest!.system).toContain('registro de incorporação');
    expect(llm.lastRequest!.system).toContain('NUNCA opine fora do seu escopo');
  });

  it('DEFAULT_AGENT_PROFILES cobre os 9 agentes do Conselho', () => {
    expect(Object.keys(DEFAULT_AGENT_PROFILES).sort()).toEqual(
      ['arquitetura', 'cfo', 'cs', 'engenharia', 'futurista', 'legal', 'mercado', 'presidente', 'vendas'].sort(),
    );
  });
});
