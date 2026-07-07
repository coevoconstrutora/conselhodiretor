/**
 * Utilitário compartilhado de parsing tolerante de saída de LLM.
 *
 * Modelos às vezes envolvem o JSON em cercas de código (```json … ```), com ou
 * sem rótulo de linguagem. Este strip é a ÚNICA fonte de verdade para remover
 * essas cercas — antes vivia copiado em 5 parsers (anthropic, case-state,
 * case-review, food-vision, lab-import). Uma mudança de formato do modelo se
 * corrige em um lugar só, em vez de deixar 4 parsers devolvendo null em silêncio.
 */
export function stripJsonFences(raw: string): string {
  return raw
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/```\s*$/, '')
    .trim();
}
