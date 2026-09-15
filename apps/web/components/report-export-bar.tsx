'use client';

import { useActionState } from 'react';
import { sendReportsEmailAction, type CounselorEmailState } from '@/lib/report-actions';

const linkCls =
  'rounded-[var(--radius)] border border-ink/15 px-3 py-1.5 text-xs font-semibold text-ink transition-colors hover:bg-surface-muted';
const inputCls =
  'w-56 rounded-[var(--radius)] border border-ink/15 bg-white px-2.5 py-1.5 text-xs text-ink transition-colors focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20';

/**
 * Exportar/enviar os relatórios já gerados — PDF/Word para baixar, PDF por
 * e-mail. `pptxReady` (todos os conselheiros + síntese do Presidente
 * gerados) controla o botão de slides — um deck com conselheiro faltando
 * fica incompleto, então nem oferecemos o link (mesmo gate do endpoint).
 */
export function ReportExportBar({ meetingId, pptxReady }: { meetingId: string; pptxReady: boolean }) {
  const [state, formAction, pending] = useActionState<CounselorEmailState, FormData>(
    sendReportsEmailAction,
    null,
  );

  return (
    <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-ink/10 pt-3">
      <a href={`/api/meetings/${meetingId}/report-export?format=pdf`} className={linkCls}>
        📄 Baixar PDF
      </a>
      <a href={`/api/meetings/${meetingId}/report-export?format=docx`} className={linkCls}>
        📝 Baixar Word
      </a>
      {pptxReady ? (
        <a href={`/api/meetings/${meetingId}/report-export?format=pptx`} className={linkCls}>
          🖥️ Baixar PPTX
        </a>
      ) : (
        <span
          className={`${linkCls} cursor-not-allowed opacity-50`}
          title="Disponível quando todos os relatórios dos conselheiros e a síntese do Presidente estiverem prontos."
        >
          🖥️ Baixar PPTX
        </span>
      )}
      <form action={formAction} className="flex items-center gap-2">
        <input type="hidden" name="meetingId" value={meetingId} />
        <input
          name="to"
          type="email"
          placeholder="enviar por e-mail para..."
          required
          className={inputCls}
        />
        <button type="submit" disabled={pending} className={linkCls}>
          {pending ? 'Enviando…' : '✉️ Enviar'}
        </button>
      </form>
      {state?.error ? (
        <p role="alert" className="w-full text-xs font-medium text-attn-critical">
          ⚠ {state.error}
        </p>
      ) : state?.ok ? (
        <p className="w-full text-xs text-success">✓ {state.ok}</p>
      ) : null}
    </div>
  );
}
