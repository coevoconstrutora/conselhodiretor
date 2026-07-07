'use client';

import { useEffect, useRef, useState } from 'react';
import { useBoardStore } from '@/lib/board-store';

/**
 * Vinheta de alerta (Sala de Board — NFR4): quando chega ⚠️ crítico, as bordas
 * da tela inteira acendem em laranja por 2s — percepção periférica antes da
 * leitura. Puramente decorativa (aria-hidden, pointer-events:none); o anúncio
 * acessível é a região assertive do feed. Reduced-motion: não renderiza (CSS).
 */
export function AlertVignette() {
  const contributions = useBoardStore((s) => s.contributions);
  const [vignetteId, setVignetteId] = useState<string | null>(null);
  const seenRef = useRef<string | null>(null);
  const mountedAtRef = useRef(Date.now());

  useEffect(() => {
    const latest = contributions[contributions.length - 1];
    if (!latest || latest.id === seenRef.current) return;
    seenRef.current = latest.id;
    if (latest.at < mountedAtRef.current) return; // ignora histórico no mount
    if (latest.contribution.severity !== 'critical') return;

    setVignetteId(latest.id);
    const timer = setTimeout(() => setVignetteId(null), 2200);
    return () => clearTimeout(timer);
  }, [contributions]);

  if (!vignetteId) return null;
  return <div key={vignetteId} aria-hidden="true" className="alert-vignette" />;
}
