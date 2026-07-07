import { create } from 'zustand';
import type { BoardServerMessage, WireContribution } from '@conselho/shared-types';

/**
 * `useBoardStore` (Stories 3.3 + E7 — frontend-spec §11.2): fila de
 * contribuições + guarda-corpos de APRESENTAÇÃO no cliente (ADR-008):
 * fixar 📌 / dispensar ✓ com undo (FR15), silenciar doutor (FR13),
 * Modo Foco (FR16 — só ⚠️ passam; resto fica represado) e a transcrição
 * ao vivo p/ o `<TranscriptPanel>`. A lógica de score/rate/dedup é do
 * servidor (E4) — aqui é só apresentação.
 */

export interface BoardContributionItem {
  readonly id: string;
  readonly meetingId: string;
  readonly triggeredBy: string;
  readonly at: number;
  readonly contribution: WireContribution;
  /** >1 ⇒ card consolidado (FR11). */
  readonly agentIds?: readonly string[];
  /** Divergência transparente (FR7). */
  readonly divergent?: boolean;
}

export interface TranscriptState {
  readonly finals: readonly string[];
  readonly partial: string | null;
}

/** Saúde do pipeline de transcrição visível ao médico (A3). */
export interface PipelineState {
  /** Espelho do SessionStatus do servidor ('idle' = nada iniciado ainda). */
  readonly stt: 'idle' | 'live' | 'degraded' | 'ended';
  readonly wsConnected: boolean;
  /** Reconexão do /board esgotou as tentativas — exige recarregar. */
  readonly wsGaveUp: boolean;
  /** Último transcript (parcial ou final) recebido — insumo do watchdog. */
  readonly lastTranscriptAt: number | null;
}

interface BoardState {
  contributions: BoardContributionItem[];
  pinned: Set<string>;
  dismissed: Set<string>;
  /** Último dispensado (undo 5s — FR15). */
  lastDismissed: string | null;
  silenced: Set<string>; // agentIds silenciadas (FR13)
  focusMode: boolean; // FR16
  /** Represadas pelo Modo Foco (contador no banner). */
  heldByFocus: number;
  transcript: TranscriptState;
  pipeline: PipelineState;

  addContribution(item: BoardContributionItem): void;
  addTranscript(text: string, isFinal: boolean): void;
  setSttStatus(stt: PipelineState['stt']): void;
  setWsConnected(connected: boolean): void;
  setWsGaveUp(): void;
  togglePin(id: string): void;
  dismiss(id: string): void;
  undoDismiss(): void;
  toggleSilence(agentId: string): void;
  toggleFocusMode(): void;
  clear(): void;
}

export const useBoardStore = create<BoardState>((set) => ({
  contributions: [],
  pinned: new Set(),
  dismissed: new Set(),
  lastDismissed: null,
  silenced: new Set(),
  focusMode: false,
  heldByFocus: 0,
  transcript: { finals: [], partial: null },
  pipeline: { stt: 'idle', wsConnected: false, wsGaveUp: false, lastTranscriptAt: null },

  addContribution: (item) =>
    set((state) => {
      if (state.contributions.some((c) => c.id === item.id)) return state; // dedup (AC4 da 3.3)
      if (state.silenced.has(item.contribution.agentId) && item.contribution.severity !== 'critical') {
        return state; // doutor silenciado (FR13) — ⚠️ sempre passa
      }
      if (state.focusMode && item.contribution.severity !== 'critical') {
        return { ...state, heldByFocus: state.heldByFocus + 1 }; // Modo Foco (FR16)
      }
      return { ...state, contributions: [...state.contributions, item] };
    }),

  addTranscript: (text, isFinal) =>
    set((state) => ({
      transcript: isFinal
        ? { finals: [...state.transcript.finals, text], partial: null }
        : { ...state.transcript, partial: text },
      pipeline: { ...state.pipeline, lastTranscriptAt: Date.now() },
    })),

  setSttStatus: (stt) => set((state) => ({ pipeline: { ...state.pipeline, stt } })),

  setWsConnected: (connected) =>
    set((state) => ({ pipeline: { ...state.pipeline, wsConnected: connected } })),

  setWsGaveUp: () => set((state) => ({ pipeline: { ...state.pipeline, wsGaveUp: true } })),

  togglePin: (id) =>
    set((state) => {
      const pinned = new Set(state.pinned);
      if (pinned.has(id)) pinned.delete(id);
      else pinned.add(id);
      return { pinned };
    }),

  dismiss: (id) =>
    set((state) => {
      const dismissed = new Set(state.dismissed);
      dismissed.add(id);
      return { dismissed, lastDismissed: id };
    }),

  undoDismiss: () =>
    set((state) => {
      if (!state.lastDismissed) return state;
      const dismissed = new Set(state.dismissed);
      dismissed.delete(state.lastDismissed);
      return { dismissed, lastDismissed: null };
    }),

  toggleSilence: (agentId) =>
    set((state) => {
      const silenced = new Set(state.silenced);
      if (silenced.has(agentId)) silenced.delete(agentId);
      else silenced.add(agentId);
      return { silenced };
    }),

  toggleFocusMode: () =>
    set((state) => (state.focusMode ? { focusMode: false, heldByFocus: 0 } : { focusMode: true })),

  clear: () =>
    set({
      contributions: [],
      pinned: new Set(),
      dismissed: new Set(),
      lastDismissed: null,
      silenced: new Set(),
      focusMode: false,
      heldByFocus: 0,
      transcript: { finals: [], partial: null },
      pipeline: { stt: 'idle', wsConnected: false, wsGaveUp: false, lastTranscriptAt: null },
    }),
}));

/** Converte mensagem do fio em item do store (ignora versões/tipos desconhecidos). */
export function toContributionItem(message: BoardServerMessage): BoardContributionItem | null {
  if (message.v !== 1 || message.type !== 'contribution') return null;
  return {
    id: message.id,
    meetingId: message.meetingId,
    triggeredBy: message.triggeredBy,
    at: message.at,
    contribution: message.contribution,
    agentIds: message.agentIds,
    divergent: message.divergent,
  };
}

/** Ordenação do feed (FR9): ⚠️ não-resolvidos + 📌 no topo; resto cronológico inverso. */
export function feedOrder(
  contributions: readonly BoardContributionItem[],
  pinned: ReadonlySet<string>,
  dismissed: ReadonlySet<string>,
): { critical: BoardContributionItem[]; regular: BoardContributionItem[] } {
  const visible = contributions.filter((c) => !dismissed.has(c.id));
  const critical = visible.filter((c) => c.contribution.severity === 'critical' || pinned.has(c.id));
  const regular = visible
    .filter((c) => !critical.includes(c))
    .sort((a, b) => b.at - a.at); // cronológico inverso
  return { critical, regular };
}
