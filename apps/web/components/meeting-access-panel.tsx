'use client';

import { useActionState } from 'react';
import {
  setMeetingConfidentialAction,
  shareMeetingAction,
  unshareMeetingAction,
  type MeetingAccessState,
} from '@/lib/meeting-access-actions';
import { MeetingTypeTag } from './meeting-tags';

const btnCls =
  'rounded-[var(--radius)] border border-ink/15 px-3 py-1.5 text-xs font-semibold text-ink transition-colors hover:bg-surface-muted disabled:opacity-50';

export interface ShareEntry {
  userId: string;
  displayName: string;
  email: string;
}

/**
 * Quem criou, tipo (tag), confidencialidade e compartilhamento da reunião.
 * Só o criador (`isOwner`) altera; os demais veem o estado em leitura.
 */
export function MeetingAccessPanel({
  meetingId,
  creatorName,
  meetingTypeName,
  confidential,
  isOwner,
  shares,
  candidates,
  attendees,
}: {
  meetingId: string;
  creatorName: string;
  meetingTypeName: string | null;
  confidential: boolean;
  isOwner: boolean;
  shares: ShareEntry[];
  /** Usuários da empresa que ainda não têm acesso por compartilhamento (e não são o criador). */
  candidates: ShareEntry[];
  attendees: string[];
}) {
  const [confState, confAction, confPending] = useActionState<MeetingAccessState, FormData>(
    setMeetingConfidentialAction,
    null,
  );
  const [shareState, shareAction, sharePending] = useActionState<MeetingAccessState, FormData>(
    shareMeetingAction,
    null,
  );

  return (
    <section aria-label="Acesso à reunião" className="card-premium mb-5 space-y-3 p-4">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-ink">
        <span>
          Criada por <strong>{creatorName}</strong>
          {isOwner ? ' (você)' : ''}
        </span>
        {meetingTypeName ? <MeetingTypeTag name={meetingTypeName} /> : null}
        {confidential ? (
          <span className="rounded-full bg-attn-critical/10 px-2.5 py-0.5 text-xs font-semibold text-attn-critical">
            🔐 Confidencial
          </span>
        ) : (
          <span className="rounded-full bg-surface-muted px-2.5 py-0.5 text-xs font-medium text-ink-muted">
            Aberta à empresa
          </span>
        )}
        {attendees.length > 0 ? (
          <span className="text-xs text-ink-muted">👥 Presentes: {attendees.join(', ')}</span>
        ) : null}
      </div>

      {confidential ? (
        <p className="text-xs text-ink-muted">
          Só o criador, quem esteve presente (e tem conta no sistema) e quem foi convidado abaixo veem o conteúdo.
        </p>
      ) : null}

      {isOwner ? (
        <div className="space-y-3 border-t border-ink/10 pt-3">
          <form action={confAction} className="flex flex-wrap items-center gap-3">
            <input type="hidden" name="meetingId" value={meetingId} />
            <input type="hidden" name="confidential" value={confidential ? '0' : '1'} />
            <button type="submit" disabled={confPending} className={btnCls}>
              {confPending
                ? 'Salvando…'
                : confidential
                  ? '🔓 Tornar aberta à empresa'
                  : '🔐 Marcar como confidencial'}
            </button>
            {confState?.error ? <span className="text-xs font-medium text-attn-critical">⚠ {confState.error}</span> : null}
            {confState?.ok ? <span className="text-xs font-medium text-success">✓ {confState.ok}</span> : null}
          </form>

          <div className="space-y-2">
            <h3 className="text-xs font-semibold text-ink">Compartilhada com</h3>
            {shares.length === 0 ? (
              <p className="text-xs text-ink-muted">Ninguém além dos presentes.</p>
            ) : (
              <ul className="flex flex-wrap gap-2">
                {shares.map((s) => (
                  <li
                    key={s.userId}
                    className="flex items-center gap-2 rounded-full border border-ink/15 bg-white px-3 py-1 text-xs text-ink"
                  >
                    <span title={s.email}>{s.displayName}</span>
                    <form action={unshareMeetingAction}>
                      <input type="hidden" name="meetingId" value={meetingId} />
                      <input type="hidden" name="userId" value={s.userId} />
                      <button
                        type="submit"
                        aria-label={`Remover acesso de ${s.displayName}`}
                        className="text-ink-muted hover:text-attn-critical"
                      >
                        ✕
                      </button>
                    </form>
                  </li>
                ))}
              </ul>
            )}
            {candidates.length > 0 ? (
              <form action={shareAction} className="flex flex-wrap items-center gap-2">
                <input type="hidden" name="meetingId" value={meetingId} />
                <select
                  name="userId"
                  required
                  defaultValue=""
                  className="rounded-[var(--radius)] border border-ink/15 bg-white px-2.5 py-1.5 text-xs text-ink"
                >
                  <option value="" disabled>
                    Escolha uma pessoa…
                  </option>
                  {candidates.map((c) => (
                    <option key={c.userId} value={c.userId}>
                      {c.displayName} — {c.email}
                    </option>
                  ))}
                </select>
                <button type="submit" disabled={sharePending} className={btnCls}>
                  {sharePending ? 'Compartilhando…' : '+ Compartilhar'}
                </button>
                {shareState?.error ? (
                  <span className="text-xs font-medium text-attn-critical">⚠ {shareState.error}</span>
                ) : null}
                {shareState?.ok ? <span className="text-xs font-medium text-success">✓ {shareState.ok}</span> : null}
              </form>
            ) : null}
          </div>
        </div>
      ) : null}
    </section>
  );
}
