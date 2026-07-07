'use client';

import { useBoardStore } from '@/lib/board-store';

/**
 * Saúde do pipeline de transcrição visível ao médico (A3): degradação do STT
 * e queda do canal do board eram SILENCIOSAS — o médico via o board "parado"
 * sem saber por quê. Nada renderiza quando está tudo bem (sala calma, E7).
 */
export function PipelineStatusBadge() {
  const pipeline = useBoardStore((s) => s.pipeline);

  if (pipeline.wsGaveUp) {
    return (
      <p
        role="alert"
        className="rounded-[var(--radius)] border border-red-400/40 bg-red-500/15 px-3 py-1.5 text-[11px] font-medium text-red-200"
      >
        🔌 Conexão com o board perdida e não recuperada — verifique a rede e recarregue a página. A
        transcrição já capturada está salva.
      </p>
    );
  }
  if (pipeline.stt === 'degraded') {
    return (
      <p
        role="status"
        className="rounded-[var(--radius)] border border-amber-300/40 bg-amber-400/15 px-3 py-1.5 text-[11px] font-medium text-amber-200"
      >
        ⚠️ Transcrição instável — reconectando ao serviço de voz…
      </p>
    );
  }
  if (pipeline.stt === 'ended') {
    return (
      <p role="status" className="rounded-[var(--radius)] border border-white/15 px-3 py-1.5 text-[11px] text-white/60">
        Transcrição encerrada.
      </p>
    );
  }
  return null;
}
