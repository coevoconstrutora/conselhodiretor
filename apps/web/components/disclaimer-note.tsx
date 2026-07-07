/**
 * <DisclaimerNote> — Atom (frontend-spec §11.1) — Story 1.7 / FR19.
 *
 * Disclaimer "IA assiste, você decide": torna inequívoco que as contribuições
 * do board são apoio à decisão, nunca conduta prescrita (postura CFM, ADR-006).
 *
 * - Texto centralizado em UMA fonte (`DISCLAIMER_TEXT`) — sem duplicação
 *   divergente (AC6). Tom de sugestão, nunca de comando (frontend-spec §4.4).
 * - Acessível (AC5): `role="note"`, ícone decorativo escondido do leitor de
 *   tela (`aria-hidden`), contraste AA (ink-muted sobre marfim ≥ 7:1), sem
 *   nenhuma animação — `prefers-reduced-motion` é respeitado por construção.
 */

/** Fonte única do texto do disclaimer (AC2/AC6 — frontend-spec §6 e §11.1). */
export const DISCLAIMER_TEXT = 'Sugestão de apoio do conselho. A decisão é sua.';

export interface DisclaimerNoteProps {
  /**
   * `chrome`: rodapé persistente da aplicação (assinado "— Conselho").
   * `card`: contexto de contribuição do board (inline, sem assinatura).
   */
  variant?: 'chrome' | 'card';
}

export function DisclaimerNote({ variant = 'card' }: DisclaimerNoteProps) {
  return (
    <p role="note" aria-label="Aviso: a IA assiste, você decide" className="text-xs text-ink-muted">
      <span aria-hidden="true">ⓘ </span>
      {DISCLAIMER_TEXT}
      {variant === 'chrome' ? ' — Conselho' : null}
    </p>
  );
}
