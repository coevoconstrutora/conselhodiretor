'use client';

import { useEffect, useReducer } from 'react';
import { useBoardStore, type BoardContributionItem } from '@/lib/board-store';
import { AgentIcon } from '@/lib/agent-icons';

/**
 * Faixa dos conselheiros no topo da sala (padrão + CUSTOM da empresa, e
 * escopados pelo tipo de reunião — ver `agents` prop). Quem contribui ganha
 * SPOTLIGHT (o quadro cresce), balão de fala com a contribuição e
 * equalizador pulsando. Em repouso a sala é 100% parada. Avatares
 * tipográficos (iniciais + emoji) — retratos/vídeo são iteração futura; o
 * slot já tem a proporção.
 *
 * A11y: balão é aria-hidden (o feed anuncia via ARIA-live — sem duplicar);
 * reduced-motion desliga equalizador e a transição de tamanho (CSS).
 */

export interface StripCounselor {
  readonly id: string;
  readonly emoji: string;
  readonly iconKey?: string | null;
  readonly iconColor?: string | null;
  readonly name: string;
  readonly area: string;
}

const SIGNAL_WINDOW_MS = 8000;
const SPEAK_WINDOW_MS = 7000;
const SNIPPET_MAX = 120;

const TYPE_ICON: Record<string, string> = {
  atencao: '⚠️',
  sugestao: '💡',
  hipotese: '🔍',
  sintese: '📋',
};

function latestBy(
  contributions: BoardContributionItem[],
  agentId: string,
): BoardContributionItem | null {
  for (let i = contributions.length - 1; i >= 0; i--) {
    if (contributions[i]!.contribution.agentId === agentId) return contributions[i]!;
  }
  return null;
}

export function CounselorStrip({
  agents,
  closed = false,
  voiceEnabled = true,
}: {
  agents: readonly StripCounselor[];
  closed?: boolean;
  /** Voz ligada (não mutada/Modo Foco)? Com voz, "falando" sincroniza com o
   * áudio de verdade (`speakingAgentId`); sem voz, cai na janela de tempo
   * (só feedback visual — nunca haveria áudio pra sincronizar com). */
  voiceEnabled?: boolean;
}) {
  const contributions = useBoardStore((s) => s.contributions);
  const silenced = useBoardStore((s) => s.silenced);
  const toggleSilence = useBoardStore((s) => s.toggleSilence);
  const speakingAgentId = useBoardStore((s) => s.speakingAgentId);
  const [, tick] = useReducer((x: number) => x + 1, 0);
  const now = Date.now();

  const states = agents.map((counselor) => {
    const latest = latestBy(contributions, counselor.id);
    const isSilenced = silenced.has(counselor.id);
    const signaling =
      !closed &&
      !!latest &&
      contributions.some(
        (c) =>
          c.contribution.agentId === counselor.id &&
          c.contribution.severity === 'critical' &&
          now - c.at < SIGNAL_WINDOW_MS,
      );
    const speaking =
      !closed &&
      !signaling &&
      !!latest &&
      (voiceEnabled ? speakingAgentId === counselor.id : now - latest.at < SPEAK_WINDOW_MS);
    return { counselor, latest, isSilenced, signaling, speaking };
  });

  // spotlight = agente ativo mais recente (sinalizando vence empate)
  const activeIdx = states.reduce<number>((best, s, i) => {
    if (!s.signaling && !s.speaking) return best;
    if (best === -1) return i;
    const a = states[best]!;
    return (s.latest?.at ?? 0) > (a.latest?.at ?? 0) ? i : best;
  }, -1);

  // enquanto há fala/sinal ativo, re-renderiza a cada 1s p/ expirar as janelas
  const anyActive = activeIdx !== -1;
  useEffect(() => {
    if (!anyActive) return;
    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, [anyActive]);

  const active = activeIdx >= 0 ? states[activeIdx]! : null;
  const bubble =
    active && active.latest && !active.isSilenced
      ? active.latest.contribution.text.length > SNIPPET_MAX
        ? `${active.latest.contribution.text.slice(0, SNIPPET_MAX)}…`
        : active.latest.contribution.text
      : null;

  return (
    <div data-testid="counselor-strip" className="space-y-2">
      {/* balão do spotlight — a contribuição "sai" do quadro de quem falou */}
      {bubble && active ? (
        <div
          aria-hidden="true"
          data-testid={`speech-${active.counselor.id}`}
          className={`board-entry rounded-[var(--radius)] border p-2.5 backdrop-blur-md ${
            active.signaling
              ? 'border-attn/60 bg-black/75 ring-1 ring-attn/40'
              : 'border-white/15 bg-black/65'
          }`}
        >
          <p className="text-[12px] leading-snug text-white/95">
            <span className="mr-1 font-semibold">
              <AgentIcon
                iconKey={active.counselor.iconKey}
                iconColor={active.counselor.iconColor}
                emoji={active.counselor.emoji}
              />{' '}
              {active.counselor.name}:
            </span>
            <span className="mr-1">{TYPE_ICON[active.latest!.contribution.type] ?? '💡'}</span>
            {bubble}
          </p>
        </div>
      ) : null}

      <div className="grid grid-cols-3 gap-2 sm:[grid-template-columns:repeat(auto-fit,minmax(72px,1fr))]">
        {states.map(({ counselor, isSilenced, signaling, speaking }, i) => {
          const inSpotlight = i === activeIdx;
          return (
            <figure
              key={counselor.id}
              data-testid={`counselor-${counselor.id}`}
              data-state={
                isSilenced
                  ? 'silenciado'
                  : signaling
                    ? 'sinalizando'
                    : speaking
                      ? 'falando'
                      : closed
                        ? 'encerrado'
                        : 'ouvindo'
              }
              className={`group relative flex flex-col items-center justify-center overflow-hidden rounded-[var(--radius)] border border-white/10 bg-white/5 px-1 py-3 ring-2 transition-all motion-reduce:transition-none ${
                signaling
                  ? 'ring-attn shadow-[0_0_24px_hsl(var(--attn)/0.5)]'
                  : speaking
                    ? 'ring-emerald-300/70 shadow-[0_0_18px_hsl(168_60%_55%/0.4)]'
                    : 'ring-transparent'
              } ${isSilenced || closed ? 'opacity-50' : ''} ${inSpotlight ? 'bg-white/10' : ''}`}
            >
              <AgentIcon
                iconKey={counselor.iconKey}
                iconColor={counselor.iconColor}
                emoji={counselor.emoji}
                className={`text-2xl ${isSilenced ? 'grayscale' : ''}`}
              />
              <figcaption className="mt-1 text-center">
                <p className="text-[11px] font-semibold leading-tight text-white">
                  {counselor.name}
                </p>
                <p className="text-[9px] leading-tight text-white/60">{counselor.area}</p>
                <p className="mt-0.5 text-[9px] font-medium">
                  {isSilenced ? (
                    <span className="text-white/60">🔇</span>
                  ) : signaling ? (
                    <span className="text-attn">▲ sinalizando</span>
                  ) : speaking ? (
                    <span className="text-emerald-300">● falando</span>
                  ) : closed ? (
                    <span className="text-white/40">encerrado</span>
                  ) : (
                    <span className="text-emerald-200/80">● ouvindo</span>
                  )}
                </p>
              </figcaption>

              {/* equalizador — só enquanto há fala/sinal ativo */}
              {(speaking || signaling) && !isSilenced ? (
                <div aria-hidden="true" className="mt-1 flex items-end gap-[3px]">
                  <span
                    className={`eq-bar h-2.5 w-[3px] rounded-full ${signaling ? 'bg-attn' : 'bg-emerald-300'}`}
                  />
                  <span
                    className={`eq-bar h-3.5 w-[3px] rounded-full [animation-delay:150ms] ${signaling ? 'bg-attn' : 'bg-emerald-300'}`}
                  />
                  <span
                    className={`eq-bar h-2 w-[3px] rounded-full [animation-delay:300ms] ${signaling ? 'bg-attn' : 'bg-emerald-300'}`}
                  />
                </div>
              ) : null}

              {/* silenciar — discreto até o hover */}
              <button
                type="button"
                aria-pressed={isSilenced}
                aria-label={`${isSilenced ? 'Reativar' : 'Silenciar'} ${counselor.name}`}
                onClick={() => toggleSilence(counselor.id)}
                className="absolute right-1 top-1 rounded-[var(--radius)] bg-black/45 px-1.5 py-0.5 text-[9px] font-semibold text-white/90 opacity-0 backdrop-blur-sm transition-opacity focus-visible:opacity-100 group-hover:opacity-100"
              >
                {isSilenced ? 'ativar' : 'mudo'}
              </button>
            </figure>
          );
        })}
      </div>
    </div>
  );
}
