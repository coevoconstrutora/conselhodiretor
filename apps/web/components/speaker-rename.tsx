'use client';

import { useActionState, useEffect, useState } from 'react';
import { renameSpeakerAction, type RenameSpeakerState } from '@/lib/board-actions';

interface KnownSpeaker {
  readonly speakerNum: string;
  readonly name: string;
  readonly area: string | null;
}

/** 1 locutor detectado ("Locutor N") sem nome — formulário compacto de correção manual (Tier 2). */
function SpeakerRenameRow({ meetingId, speakerNum }: { meetingId: string; speakerNum: string }) {
  const [state, formAction, pending] = useActionState<RenameSpeakerState, FormData>(
    renameSpeakerAction,
    null,
  );
  const [name, setName] = useState('');
  const [area, setArea] = useState('');

  if (state?.ok) {
    return (
      <span className="rounded-[var(--radius)] border border-emerald-300/25 bg-emerald-400/10 px-2.5 py-1 text-xs text-emerald-200">
        ✓ Locutor {speakerNum} → {name || '(nomeado)'}
        {area ? ` · ${area}` : ''}
      </span>
    );
  }

  return (
    <form action={formAction} className="flex items-center gap-1.5">
      <input type="hidden" name="meetingId" value={meetingId} />
      <input type="hidden" name="speakerNum" value={speakerNum} />
      <span className="text-xs text-white/70">Locutor {speakerNum}:</span>
      <input
        name="name"
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="nome"
        className="w-24 rounded-[var(--radius)] border border-white/20 bg-white/10 px-2 py-1 text-xs text-white placeholder:text-white/40 focus:outline-none focus:ring-1 focus:ring-white/40"
      />
      <input
        name="area"
        value={area}
        onChange={(e) => setArea(e.target.value)}
        placeholder="área (opcional)"
        className="w-28 rounded-[var(--radius)] border border-white/20 bg-white/10 px-2 py-1 text-xs text-white placeholder:text-white/40 focus:outline-none focus:ring-1 focus:ring-white/40"
      />
      <button
        type="submit"
        disabled={pending || !name.trim()}
        className="rounded-[var(--radius)] border border-white/25 px-2 py-1 text-xs font-semibold text-white transition-colors hover:bg-white/10 disabled:opacity-40"
      >
        {pending ? '…' : 'Salvar'}
      </button>
      {state?.error ? <span className="text-xs text-red-300">⚠ {state.error}</span> : null}
    </form>
  );
}

/**
 * Tier 2 — correção manual de "Locutor N" quando ninguém se apresentou (ou a
 * autoapresentação errou o nome/área). Detecta os números vistos até agora
 * varrendo os finais da transcrição — some sozinho quando não há nenhum
 * "Locutor N" pendente (reunião sem diarização, ou todos já nomeados).
 */
export function SpeakerRenamePanel({
  meetingId,
  finals,
}: {
  meetingId: string;
  finals: readonly string[];
}) {
  const numbers = new Set<string>();
  for (const line of finals) {
    const match = /^Locutor (\d+):/.exec(line);
    if (match) numbers.add(match[1]!);
  }
  if (numbers.size === 0) return null;

  return (
    <div className="flex flex-wrap items-center gap-2 border-t border-white/10 pt-3">
      <span className="text-xs font-semibold text-white/60">🎙️ Nomear locutores:</span>
      {[...numbers].sort().map((num) => (
        <SpeakerRenameRow key={num} meetingId={meetingId} speakerNum={num} />
      ))}
    </div>
  );
}

/**
 * Lista viva de quem já falou e se identificou (nome + área) nesta reunião —
 * autoapresentação OU correção manual, as duas alimentam o mesmo tracker no
 * servidor. Poll simples (5s), some sozinha se ninguém foi identificado
 * ainda. Não é biometria: reseta a cada reunião nova.
 */
export function SpeakerRosterPanel({ meetingId }: { meetingId: string }) {
  const [speakers, setSpeakers] = useState<KnownSpeaker[]>([]);

  useEffect(() => {
    let disposed = false;
    const load = async () => {
      try {
        const res = await fetch(`/api/meetings/${meetingId}/speakers`);
        if (!res.ok) return;
        const data = (await res.json()) as { speakers: KnownSpeaker[] };
        if (!disposed) setSpeakers(data.speakers);
      } catch {
        // poll falhou — tenta de novo no próximo tick, não é crítico
      }
    };
    void load();
    const timer = setInterval(load, 5000);
    return () => {
      disposed = true;
      clearInterval(timer);
    };
  }, [meetingId]);

  if (speakers.length === 0) return null;

  return (
    <div className="flex flex-wrap items-center gap-2 border-t border-white/10 pt-3">
      <span className="text-xs font-semibold text-white/60">👥 Quem já falou:</span>
      {speakers.map((s) => (
        <span
          key={s.speakerNum}
          className="rounded-[var(--radius)] border border-white/15 bg-white/5 px-2.5 py-1 text-xs text-white/90"
        >
          {s.name}
          {s.area ? <span className="text-white/60"> · {s.area}</span> : null}
        </span>
      ))}
    </div>
  );
}
