'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import type { SessionSnapshot } from '@conselho/session';

/**
 * <TranscriptPanel> — Feature (frontend-spec §11) — Story 2.4 / FR1.
 *
 * Display da transcrição ao vivo com auto-follow. Consome a sessão da Story 2.3
 * via snapshot+subscribe (nunca fala com o STT direto). Estados: streaming /
 * pausado / erro-transcrição (o erro integra com o banner da Story 2.6).
 *
 * A11y (padrão Story 1.7): `role="log"`; apenas segmentos FINAIS são anunciados
 * (`aria-live="polite"` num sub-elemento) para não metralhar o leitor de tela
 * com parciais; zero animação (`prefers-reduced-motion` por construção).
 */

/** Contrato mínimo que o painel consome da sessão (2.3) — facilita teste/mokagem. */
export interface TranscriptSource {
  getSnapshot(): SessionSnapshot;
  subscribe(listener: () => void): () => void;
}

export type PanelState = 'streaming' | 'pausado' | 'erro-transcricao';

function panelState(snapshot: SessionSnapshot): PanelState {
  if (snapshot.status === 'degraded') return 'erro-transcricao';
  if (snapshot.status === 'ended') return 'pausado';
  return 'streaming';
}

const STATE_LABEL: Record<PanelState, string> = {
  streaming: '● Transcrevendo ao vivo',
  pausado: '⏸ Transcrição pausada',
  'erro-transcricao': '⚠️ Transcrição instável',
};

/** Distância (px) do fundo abaixo da qual consideramos "na ponta" do log. */
const FOLLOW_THRESHOLD_PX = 24;

export function TranscriptPanel({ source }: { source: TranscriptSource }) {
  const [snapshot, setSnapshot] = useState<SessionSnapshot>(() => source.getSnapshot());
  const [following, setFollowing] = useState(true);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const unsubscribe = source.subscribe(() => setSnapshot(source.getSnapshot()));
    setSnapshot(source.getSnapshot());
    return unsubscribe;
  }, [source]);

  // auto-follow: novos segmentos mantêm a visão na ponta enquanto `following`
  useEffect(() => {
    if (following && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [snapshot, following]);

  const onScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight <= FOLLOW_THRESHOLD_PX;
    setFollowing(atBottom);
  }, []);

  const resumeFollow = useCallback(() => {
    setFollowing(true);
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, []);

  const state = panelState(snapshot);

  return (
    <section aria-label="Transcrição da reunião" className="card-premium flex h-full flex-col">
      <header className="flex items-center justify-between rounded-t-(--radius) border-b border-ink/10 bg-surface-muted/60 px-5 py-3">
        <h2 className="font-display text-base font-semibold text-ink">Transcrição</h2>
        <span
          data-testid="panel-state"
          data-state={state}
          className={`rounded-[var(--radius)] border px-2.5 py-0.5 text-[11px] font-medium ${
            state === 'erro-transcricao'
              ? 'border-attn/30 bg-attn-bg text-attn-critical'
              : state === 'pausado'
                ? 'border-ink/15 bg-surface text-ink-muted'
                : 'border-emerald-600/25 bg-emerald-50 text-emerald-700'
          }`}
        >
          {STATE_LABEL[state]}
        </span>
      </header>

      <div
        ref={scrollRef}
        onScroll={onScroll}
        role="log"
        className="flex-1 space-y-2 overflow-y-auto p-5"
      >
        {/* dica de identificação por voz: some assim que a 1ª fala chega — não é
            instrução permanente, é só o empurrão certo na hora certa */}
        {snapshot.finalSegments.length === 0 && !snapshot.partial ? (
          <p className="rounded-[var(--radius)] border border-dashed border-ink/15 bg-surface-muted/60 p-3 text-xs text-ink-muted">
            💡 Dica: peça para cada participante se apresentar no início (ex.: "sou a Marina", "aqui
            é o Carlos") — a transcrição reconhece e passa a identificar quem fala pelo nome.
          </p>
        ) : null}
        {/* finais: imutáveis, anunciados ao leitor de tela */}
        <div aria-live="polite">
          {snapshot.finalSegments.map((segment, i) => (
            <p key={i} className="text-[15px] leading-relaxed text-ink">
              {segment.text}
            </p>
          ))}
        </div>
        {/* parcial corrente: provisório, visualmente distinto, NÃO anunciado */}
        {snapshot.partial ? (
          <p data-testid="partial-segment" aria-hidden="true" className="text-[15px] italic leading-relaxed text-ink-muted/70">
            {snapshot.partial.text}
          </p>
        ) : null}
      </div>

      {!following ? (
        <button
          type="button"
          onClick={resumeFollow}
          className="border-t border-ink/10 bg-surface-muted px-4 py-2 text-xs font-medium text-ink transition-colors hover:bg-white"
        >
          ↓ Voltar ao vivo
        </button>
      ) : null}
    </section>
  );
}
