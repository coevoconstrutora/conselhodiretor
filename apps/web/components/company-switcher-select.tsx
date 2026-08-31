'use client';

import { useRef } from 'react';
import Link from 'next/link';
import { switchCompanyAction } from '@/lib/company-actions';

export function CompanySwitcherSelect({
  companies,
  currentCompanyId,
}: {
  companies: Array<{ id: string; name: string }>;
  currentCompanyId: string;
}) {
  const formRef = useRef<HTMLFormElement>(null);

  return (
    <form ref={formRef} action={switchCompanyAction} className="flex items-center gap-1.5">
      <select
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
      <Link
        href="/admin/companies"
        title="Gerenciar empresas"
        className="rounded-[var(--radius)] border border-ink/15 px-2.5 py-1.5 text-sm text-ink transition-colors hover:bg-surface-muted"
      >
        ⚙
      </Link>
    </form>
  );
}
