'use client';

import { useEffect, useRef, useState } from 'react';
import {
  REASONING_MODELS,
  REASONING_EFFORTS,
  VOICES,
  SPEECH_RATES,
  DEFAULT_AI_MODEL,
  DEFAULT_REASONING_EFFORT,
  DEFAULT_SPEECH_RATE,
  VOICE_STYLE_MAX,
  findReasoningModel,
} from '@/lib/ai-config';

const selectCls =
  'w-full rounded-[var(--radius)] border border-ink/15 bg-white px-3 py-2 text-sm text-ink transition-colors focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20';

/**
 * "Configuração da IA" — modelo de raciocínio, nível de raciocínio, voz,
 * estilo de voz e velocidade da fala, INDIVIDUAIS por conselheiro (Etapa "IA
 * por conselheiro"). Vive DENTRO do `<form>` do perfil (mesmos `name` que
 * `parseProfileFields` lê) — salva junto com o resto do perfil, não tem
 * submit próprio. Listas de opções vêm todas de `ai-config.ts` — única fonte
 * de verdade, nunca duplicadas aqui.
 */
export function AiVoiceConfigFields({
  aiModel,
  reasoningEffort,
  voice,
  voiceInstructions,
  speechRate,
  fallbackVoice,
}: {
  aiModel: string | null;
  reasoningEffort: string | null;
  voice: string | null;
  voiceInstructions: string | null;
  speechRate: number | null;
  /** Voz que este conselheiro usa HOJE sem configuração própria (tts-voices.ts) — usada no preview quando "Voz" está em branco. */
  fallbackVoice: string;
}) {
  const [model, setModel] = useState(aiModel ?? DEFAULT_AI_MODEL);
  const [selectedVoice, setSelectedVoice] = useState(voice ?? '');
  const [instructions, setInstructions] = useState(voiceInstructions ?? '');
  const [speed, setSpeed] = useState(String(speechRate ?? DEFAULT_SPEECH_RATE));
  const [previewState, setPreviewState] = useState<'idle' | 'loading' | 'error'>('idle');
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const objectUrlRef = useRef<string | null>(null);

  useEffect(
    () => () => {
      if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
    },
    [],
  );

  const modelInfo = findReasoningModel(model);
  const fallbackLabel = VOICES.find((v) => v.value === fallbackVoice)?.label ?? fallbackVoice;

  async function playPreview() {
    setPreviewState('loading');
    try {
      const res = await fetch('/api/tts/preview', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          voice: selectedVoice || fallbackVoice,
          instructions: instructions.trim() || undefined,
          speed: Number(speed),
        }),
      });
      if (!res.ok) throw new Error('preview falhou');
      const blob = await res.blob();
      if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
      const url = URL.createObjectURL(blob);
      objectUrlRef.current = url;
      if (!audioRef.current) audioRef.current = new Audio();
      audioRef.current.src = url;
      await audioRef.current.play();
      setPreviewState('idle');
    } catch {
      setPreviewState('error');
    }
  }

  return (
    <div className="rounded-[var(--radius)] border border-ink/10 bg-surface-muted/40 p-4">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-ink-muted">Configuração da IA</h3>

      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <label className="block">
          <span className="text-xs font-semibold text-ink">Modelo de raciocínio</span>
          <select name="aiModel" value={model} onChange={(e) => setModel(e.target.value)} className={selectCls}>
            {REASONING_MODELS.map((m) => (
              <option key={m.value} value={m.value}>
                {m.label}
              </option>
            ))}
          </select>
          {modelInfo ? <p className="mt-1 text-[11px] text-ink-muted">{modelInfo.description}</p> : null}
        </label>

        <label className="block">
          <span className="text-xs font-semibold text-ink">Nível de raciocínio</span>
          <select
            name="reasoningEffort"
            defaultValue={reasoningEffort ?? DEFAULT_REASONING_EFFORT}
            className={selectCls}
          >
            {REASONING_EFFORTS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
          <p className="mt-1 text-[11px] text-ink-muted">
            Define quanto processamento analítico o conselheiro deve utilizar antes de emitir sua opinião.
          </p>
        </label>
      </div>

      <div className="mt-3 grid gap-3 sm:grid-cols-[1fr_10rem_auto] sm:items-end">
        <label className="block">
          <span className="text-xs font-semibold text-ink">Voz</span>
          <select
            name="voice"
            value={selectedVoice}
            onChange={(e) => setSelectedVoice(e.target.value)}
            className={selectCls}
          >
            <option value="">— padrão do conselheiro ({fallbackLabel}) —</option>
            {VOICES.map((v) => (
              <option key={v.value} value={v.value}>
                {v.label}
              </option>
            ))}
          </select>
        </label>

        <label className="block">
          <span className="text-xs font-semibold text-ink">Velocidade da fala</span>
          <select name="speechRate" value={speed} onChange={(e) => setSpeed(e.target.value)} className={selectCls}>
            {SPEECH_RATES.map((r) => (
              <option key={r.value} value={r.value}>
                {r.label}
              </option>
            ))}
          </select>
        </label>

        <button
          type="button"
          onClick={() => void playPreview()}
          disabled={previewState === 'loading'}
          className="rounded-[var(--radius)] border border-ink/15 px-3 py-2 text-xs font-semibold text-ink transition-colors hover:bg-surface-muted disabled:opacity-50"
        >
          {previewState === 'loading' ? '… gerando' : '🔊 Ouvir voz'}
        </button>
      </div>
      {previewState === 'error' ? (
        <p className="mt-1 text-[11px] font-medium text-attn-critical">
          ⚠ Não foi possível gerar o preview — tente de novo.
        </p>
      ) : null}

      <label className="mt-3 block">
        <span className="text-xs font-semibold text-ink">Estilo de voz (opcional)</span>
        <textarea
          name="voiceInstructions"
          value={instructions}
          onChange={(e) => setInstructions(e.target.value.slice(0, VOICE_STYLE_MAX))}
          rows={2}
          maxLength={VOICE_STYLE_MAX}
          placeholder="ex.: profissional, calmo, experiente, objetivo, com ritmo moderado e tom executivo"
          className={selectCls}
        />
        <p className="mt-1 flex items-center justify-between text-[11px] text-ink-muted">
          <span>Define como o conselheiro deve se expressar verbalmente. Não altera seus critérios de decisão.</span>
          <span className="shrink-0 pl-2">
            {instructions.length}/{VOICE_STYLE_MAX}
          </span>
        </p>
      </label>
    </div>
  );
}
