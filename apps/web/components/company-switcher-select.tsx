'use client';

import { useRef } from 'react';
import { switchCompanyAction } from '@/lib/company-actions';

/**
 * Empresa ativa SEMPRE visível (evita ação na empresa errada por engano) —
 * combobox pra quem tem mais de uma; rótulo fixo pra quem só tem uma.
 */
export function CompanySwitcherSelect({
  companies,
  currentCompanyId,
}: {
  companies: Array<{ id: string; name: string }>;
  currentCompanyId: string;
}) {
  const formRef = useRef<HTMLFormElement>(null);
  if (companies.length < 2) {
    const current = companies.find((c) => c.id === currentCompanyId);
    if (!current) return null;
    return (
      <span
        title="Empresa ativa"
        className="rounded-[var(--radius)] border border-ink/15 bg-surface-muted px-2.5 py-1.5 text-sm font-medium text-ink"
      >
        {current.name}
      </span>
    );
  }

  return (
    <form ref={formRef} action={switchCompanyAction}>
      {/* key força remount ao trocar — <select defaultValue> só aplica no mount
          inicial; sem isso, o valor exibido ficava "preso" na empresa anterior
          mesmo depois do servidor confirmar a troca. */}
      <select
        key={currentCompanyId}
        name="companyId"
        defaultValue={currentCompanyId}
        onChange={() => formRef.current?.requestSubmit()}
        className="rounded-[var(--radius)] border border-ink/15 bg-white px-2.5 py-1.5 text-sm text-ink"
      >
        {companies.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name}
          </option>
        ))}
      </select>
    </form>
  );
}
