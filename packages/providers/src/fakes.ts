/**
 * Implementações fake/determinísticas das 4 interfaces (AC2/AC5).
 *
 * Ativo reutilizável por TODAS as stories de E2–E8 (IDS: serão REUSE): permitem
 * desenvolver e testar o domínio sem provider real nem chaves de API, e sem
 * decidir vendor (decisão de POC). Determinísticos por construção.
 */
import type {
  ISttProvider,
  SttSession,
  ILlmProvider,
  LlmCompletionRequest,
  TextCompletionRequest,
  IKnowledgeRetriever,
  IVideoAssetProvider,
} from './interfaces';
import type {
  AgentId,
  VideoState,
  TranscriptSegment,
  KbChunk,
  AgentContribution,
  ClipRef,
} from './types';

/**
 * STT fake: emite uma sequência fixa de segmentos (parciais → final).
 * Default: simula a fala sendo refinada até o segmento final.
 */
export class FakeSttProvider implements ISttProvider {
  constructor(private readonly segments: readonly TranscriptSegment[] = DEFAULT_SEGMENTS) {}

  openStream(opts: { lang: 'pt-BR' }): SttSession {
    void opts.lang; // contrato exige PT-BR; o fake é agnóstico ao idioma
    const segments = this.segments;
    let closed = false;
    return {
      async *[Symbol.asyncIterator](): AsyncIterator<TranscriptSegment> {
        for (const segment of segments) {
          if (closed) return;
          yield segment;
        }
      },
      async close(): Promise<void> {
        closed = true;
      },
    };
  }
}

const DEFAULT_SEGMENTS: readonly TranscriptSegment[] = [
  { text: 'Paciente', isFinal: false, startMs: 0, endMs: 400 },
  { text: 'Paciente em GLP-1', isFinal: false, startMs: 0, endMs: 900 },
  { text: 'Paciente em GLP-1 com cansaço e platô no peso.', isFinal: true, startMs: 0, endMs: 1500 },
];

/**
 * LLM fake: retorna uma `AgentContribution` previsível. A persona e o tipo
 * são configuráveis; o texto deriva do transcript para ser verificável em teste.
 */
export class FakeLlmProvider implements ILlmProvider {
  constructor(
    private readonly agentId: AgentId = 'presidente',
    private readonly type: AgentContribution['type'] = 'sugestao',
    /** B1: simula o skip do modelo ("nada novo") quando o predicado casa. */
    private readonly opts: { skipIf?: (req: LlmCompletionRequest) => boolean } = {},
  ) {}

  async complete(req: LlmCompletionRequest): Promise<AgentContribution> {
    if (req.allowSkip && this.opts.skipIf?.(req)) {
      return { agentId: this.agentId, type: this.type, severity: 'normal', text: '', skip: true };
    }
    // eco verificável dos priors (B1): testes asseguram que o histórico chegou
    const priors = req.priorContributions?.length ? ` (priors:${req.priorContributions.length})` : '';
    // Ecoa só a ÚLTIMA sentença do transcript (não a janela inteira): um fake
    // que devolvesse o texto completo, crescente a cada chamada, colidiria
    // quase sempre com o dedup semântico anti-repetição (pensado para saída
    // curta de LLM real) — mesmo vindo de personas/tópicos diferentes.
    const lastSentence =
      req.transcript
        .trim()
        .split(/(?<=[.!?])\s+/)
        .filter(Boolean)
        .at(-1) ?? req.transcript;
    return {
      agentId: this.agentId,
      type: this.type,
      severity: 'normal',
      text: `[${this.agentId}] resposta determinística para: ${lastSentence}${priors}`,
      relevanceScore: 0.9,
      triggeredBy: req.transcript,
      kbSources: req.context.map((chunk) => chunk.id),
    };
  }
}

/**
 * Completador de texto fake (B3): respostas roteirizadas em ordem para o
 * `completeText` opcional de ILlmProvider (CaseState/case review). Grava as
 * requisições para verificação em teste. Roteiro esgotado ⇒ repete a última.
 */
export class FakeTextCompleter {
  readonly requests: TextCompletionRequest[] = [];
  private cursor = 0;

  constructor(private readonly script: readonly string[]) {}

  async completeText(req: TextCompletionRequest): Promise<{ text: string; modelVersion?: string }> {
    this.requests.push(req);
    const text = this.script[Math.min(this.cursor, this.script.length - 1)] ?? '';
    this.cursor += 1;
    return { text, modelVersion: 'fake-text-v1' };
  }
}

/**
 * Retriever fake: serve chunks de um catálogo em memória, SEMPRE filtrando pelo
 * namespace da persona (FR21). Retorna no máximo `k` itens, de forma determinística.
 */
export class FakeKnowledgeRetriever implements IKnowledgeRetriever {
  private readonly byPersona: ReadonlyMap<AgentId, readonly KbChunk[]>;

  constructor(catalog: readonly KbChunk[] = DEFAULT_CATALOG) {
    const map = new Map<AgentId, KbChunk[]>();
    for (const chunk of catalog) {
      const list = map.get(chunk.agentId) ?? [];
      list.push(chunk);
      map.set(chunk.agentId, list);
    }
    this.byPersona = map;
  }

  async retrieve(agentId: AgentId, _query: string, k: number): Promise<KbChunk[]> {
    const chunks = this.byPersona.get(agentId) ?? [];
    return chunks.slice(0, Math.max(0, k));
  }
}

const DEFAULT_CATALOG: readonly KbChunk[] = [
  { id: 'cfo-1', agentId: 'cfo', text: 'Avaliar impacto no fluxo de caixa antes de aprovar.', source: 'seed' },
  { id: 'legal-1', agentId: 'legal', text: 'Verificar registro de incorporação antes de lançar vendas.', source: 'seed' },
  { id: 'mercado-1', agentId: 'mercado', text: 'Comparar preço/m² com lançamentos concorrentes do bairro.', source: 'seed' },
];

/**
 * Video fake: resolve um `ClipRef` determinístico por (persona, estado), apontando
 * para uma URL simbólica do catálogo pré-renderizado (ADR-007).
 */
export class FakeVideoAssetProvider implements IVideoAssetProvider {
  getClip(agentId: AgentId, state: VideoState): ClipRef {
    return { agentId, state, url: `fake://clips/${agentId}/${state}.mp4` };
  }
}
