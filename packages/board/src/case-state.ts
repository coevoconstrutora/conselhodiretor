import { stripJsonFences, type ILlmProvider, type AgentId } from '@conselho/providers';

/**
 * CaseState (B3) — memória ESTRUTURADA do caso, mantida por IA para IA.
 *
 * A janela de transcript do board é curta (8 segmentos, ~500 palavras); uma
 * consulta de 20min tem ~2.600. O tracker destila a consulta inteira num
 * estado compacto (hipóteses em cena, o que já foi investigado, relatos do
 * paciente, pendências por persona), atualizado por 1 chamada LLM barata a
 * cada N finais — e injetado no prompt de TODAS as personas e da síntese.
 *
 * Uso interno: NUNCA vira card para o empresário. Nenhuma conduta automática.
 * Degradação graciosa: sem `completeText` no provider, o tracker desliga;
 * JSON inválido do modelo mantém o estado anterior — o board nunca cai por ele.
 */

export interface CaseState {
  readonly hypotheses: string[];
  readonly investigated: string[];
  readonly meetingPoints: string[];
  readonly pending: Partial<Record<AgentId, string[]>>;
}

const UPDATER_SYSTEM =
  'Você mantém o ESTADO DA REUNIÃO de uma reunião de negócios de uma incorporadora imobiliária para um conselho de apoio à decisão. ' +
  'Receberá o estado anterior (JSON ou null) e novos trechos da transcrição. ' +
  'Atualize o estado de forma INCREMENTAL: preserve o que segue válido, incorpore o novo, remova o superado. ' +
  'Responda APENAS com JSON válido (sem cercas de código) no formato: ' +
  '{"hypotheses":["..."],"investigated":["..."],"meetingPoints":["..."],"pending":{"engenharia":["..."],"vendas":["..."],"mercado":["..."],"arquitetura":["..."],"legal":["..."],"cs":["..."],"cfo":["..."],"futurista":["..."]}}. ' +
  'Máximo ~120 palavras no total, em português do Brasil, telegráfico. ' +
  'Fatos apenas — NÃO invente achados nem proponha condutas.';

export interface CaseStateTrackerOptions {
  /** Atualiza a cada N segmentos finais novos (default 6). */
  readonly everyNFinals?: number;
  /** Telemetria: chamada de update concluída. */
  readonly onUpdate?: () => void;
  /**
   * Configuração do Presidente — "modelo de acompanhamento" (Seção 2/12-A do
   * pedido): o tracker É o acompanhamento contínuo da reunião. `undefined` ⇒
   * o provider usa o próprio default.
   */
  readonly model?: string;
  readonly reasoningEffort?: string;
}

export class CaseStateTracker {
  private state: CaseState | null = null;
  private readonly newFinals: string[] = [];
  private updating = false;
  private readonly everyN: number;

  constructor(
    private readonly llm: ILlmProvider,
    private readonly opts: CaseStateTrackerOptions = {},
  ) {
    this.everyN = opts.everyNFinals ?? 6;
  }

  /** Tracker ativo? (provider sem completeText ⇒ desligado, sem erro) */
  get enabled(): boolean {
    return typeof this.llm.completeText === 'function';
  }

  get current(): CaseState | null {
    return this.state;
  }

  onFinalSegment(text: string): void {
    if (!this.enabled) return;
    this.newFinals.push(text);
  }

  /**
   * Dispara o update se acumulou >= N finais novos e não há update em voo.
   * Nunca roda 2 em paralelo; falha/JSON inválido mantém o estado anterior.
   */
  async maybeUpdate(): Promise<void> {
    if (!this.enabled || this.updating || this.newFinals.length < this.everyN) return;
    this.updating = true;
    const batch = this.newFinals.splice(0, this.newFinals.length);
    try {
      const res = await this.llm.completeText!({
        system: UPDATER_SYSTEM,
        prompt: JSON.stringify({ estadoAnterior: this.state, novosTrechos: batch }),
        maxTokens: 400,
        model: this.opts.model,
        reasoningEffort: this.opts.reasoningEffort,
      });
      const parsed = parseCaseState(res.text);
      if (parsed) {
        this.state = parsed;
        this.opts.onUpdate?.();
      }
    } catch {
      // estado anterior permanece — o board nunca cai por causa do tracker
    } finally {
      this.updating = false;
    }
  }

  /** Bloco compacto pt-BR para prepend no prompt das personas/síntese ('' se vazio). */
  renderForPrompt(): string {
    if (!this.state) return '';
    const s = this.state;
    const pending = (Object.entries(s.pending) as Array<[AgentId, string[]]>)
      .filter(([, items]) => items?.length)
      .map(([persona, items]) => `${persona}: ${items.join('; ')}`)
      .join(' | ');
    const lines = [
      s.hypotheses.length ? `Temas/decisões em cena: ${s.hypotheses.join('; ')}.` : '',
      s.investigated.length ? `Já investigado/abordado: ${s.investigated.join('; ')}.` : '',
      s.meetingPoints.length ? `Pontos levantados na reunião: ${s.meetingPoints.join('; ')}.` : '',
      pending ? `Pendências por conselheiro — ${pending}.` : '',
    ].filter(Boolean);
    return lines.length ? `ESTADO DO CASO até aqui:\n${lines.join('\n')}` : '';
  }
}

/** Parse tolerante: null em vez de exceção (o board segue com o estado anterior). */
export function parseCaseState(raw: string): CaseState | null {
  const cleaned = stripJsonFences(raw);
  try {
    const obj = JSON.parse(cleaned) as Record<string, unknown>;
    const arr = (v: unknown): string[] =>
      Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
    const pendingRaw = (obj.pending ?? {}) as Record<string, unknown>;
    const pending: Partial<Record<AgentId, string[]>> = {};
    for (const persona of ['engenharia', 'vendas', 'mercado', 'arquitetura', 'legal', 'cs', 'cfo', 'futurista'] as const) {
      const items = arr(pendingRaw[persona]);
      if (items.length) pending[persona] = items;
    }
    return {
      hypotheses: arr(obj.hypotheses),
      investigated: arr(obj.investigated),
      meetingPoints: arr(obj.meetingPoints),
      pending,
    };
  } catch {
    return null;
  }
}
