'use client';

import { useEffect, useState } from 'react';
import { useBoardStore } from '@/lib/board-store';
import { pickRecorderMime } from '@/lib/microphone';
import type { PipelineStatusReport } from '@/lib/board-runtime';

/**
 * Modo diagnóstico (A5): triagem do pipeline de transcrição em 30s, sem
 * precisar de logs do servidor. Enquanto aberto, faz poll do snapshot do
 * servidor (3s) e combina com o estado local do navegador (mic/formato/WS).
 */

function Line({ ok, label, detail }: { ok: boolean | null; label: string; detail?: string }) {
  return (
    <li className="flex items-baseline gap-2 text-sm">
      <span aria-hidden>{ok === null ? '…' : ok ? '✔' : '✖'}</span>
      <span className={ok === false ? 'font-medium text-red-600' : 'text-ink'}>{label}</span>
      {detail ? <span className="text-xs text-ink-muted">{detail}</span> : null}
    </li>
  );
}

export function DiagnosticsPanel({ meetingId }: { meetingId: string }) {
  const [open, setOpen] = useState(false);
  const [report, setReport] = useState<PipelineStatusReport | null>(null);
  const [fetchFailed, setFetchFailed] = useState(false);
  const [browser, setBrowser] = useState<{ mic: boolean; format: boolean } | null>(null);
  const pipeline = useBoardStore((s) => s.pipeline);

  // capacidades do navegador só no cliente (evita mismatch de hidratação)
  useEffect(() => {
    setBrowser({
      mic: Boolean(navigator.mediaDevices?.getUserMedia),
      format: pickRecorderMime().supported,
    });
  }, []);

  useEffect(() => {
    if (!open) return;
    let disposed = false;
    const load = async () => {
      try {
        const res = await fetch(`/api/consultations/${meetingId}/pipeline-status`);
        if (!res.ok) throw new Error(String(res.status));
        const data = (await res.json()) as PipelineStatusReport;
        if (!disposed) {
          setReport(data);
          setFetchFailed(false);
        }
      } catch {
        if (!disposed) setFetchFailed(true);
      }
    };
    void load();
    const timer = setInterval(load, 3000);
    return () => {
      disposed = true;
      clearInterval(timer);
    };
  }, [open, meetingId]);

  const lastFinal =
    report?.lastFinalAgoMs != null ? `último segmento há ${Math.round(report.lastFinalAgoMs / 1000)}s` : undefined;

  return (
    <details
      className="card-premium mt-6 p-4"
      open={open}
      onToggle={(event) => setOpen((event.target as HTMLDetailsElement).open)}
    >
      <summary className="cursor-pointer text-sm font-semibold text-ink">
        🩺 Diagnóstico do pipeline de transcrição
      </summary>
      <div className="mt-3">
        {fetchFailed ? (
          <p className="text-sm text-red-600">
            Não foi possível consultar o servidor — verifique a rede ou recarregue a página.
          </p>
        ) : null}
        <ul className="space-y-1.5" aria-label="Checagens do pipeline">
          <Line ok={browser ? browser.mic : null} label="Microfone disponível no navegador" />
          <Line
            ok={browser ? browser.format : null}
            label="Formato de gravação compatível (WebM/Opus)"
            detail={browser && !browser.format ? 'use Chrome ou Edge no computador' : undefined}
          />
          <Line ok={pipeline.wsConnected} label="Canal do board conectado (WS)" />
          <Line ok={report ? report.deepgramConfigured : null} label="Serviço de voz configurado (servidor)" />
          <Line ok={report ? report.anthropicConfigured : null} label="IA do board configurada (servidor)" />
          <Line ok={report ? report.active : null} label="Consulta ativa no servidor" />
          <Line ok={report ? report.audioSinkRegistered : null} label="Canal de áudio ativo no servidor" />
          <Line
            ok={report ? report.sttStatus === 'live' : null}
            label={`Transcrição: ${report ? report.sttStatus : '…'}`}
            detail={lastFinal}
          />
          <Line
            ok={report ? report.persistedFinals > 0 : null}
            label={`Falas salvas no servidor: ${report ? report.persistedFinals : '…'}`}
            detail="sobrevivem a reinício — insumo da nota"
          />
        </ul>
        <p className="mt-3 text-[11px] text-ink-muted">
          Atualiza a cada 3s enquanto aberto. Nenhum dado clínico é exibido aqui.
        </p>
      </div>
    </details>
  );
}
