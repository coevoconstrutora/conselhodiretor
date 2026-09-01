'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';

export interface ConfigMenuItem {
  href: string;
  label: string;
}

/** Menu único "Configuração" — agrupa as telas administrativas (antes eram
 * links soltos no cabeçalho, um por permissão, poluindo a barra). */
export function ConfigMenu({ items }: { items: ConfigMenuItem[] }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onClickOutside = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onClickOutside);
    document.addEventListener('keydown', onEscape);
    return () => {
      document.removeEventListener('mousedown', onClickOutside);
      document.removeEventListener('keydown', onEscape);
    };
  }, [open]);

  if (items.length === 0) return null;

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="menu"
        className="rounded-[var(--radius)] border border-ink/15 px-3.5 py-1.5 text-sm text-ink transition-colors hover:bg-surface-muted"
      >
        ⚙ Configuração
      </button>
      {open ? (
        <div
          role="menu"
          className="absolute right-0 z-20 mt-1.5 min-w-[180px] rounded-[var(--radius)] border border-ink/10 bg-white py-1.5 shadow-lg"
        >
          {items.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              role="menuitem"
              onClick={() => setOpen(false)}
              className="block px-4 py-2 text-sm text-ink transition-colors hover:bg-surface-muted"
            >
              {item.label}
            </Link>
          ))}
        </div>
      ) : null}
    </div>
  );
}
