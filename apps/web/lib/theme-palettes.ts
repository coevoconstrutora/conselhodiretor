/**
 * Paletas de tema pré-montadas — mesmo conceito do seletor "Cores do Tema"
 * do PowerPoint/Office: em vez de escolher cores soltas, a empresa escolhe
 * um conjunto coordenado com 1 clique. `brand` dirige botões/links/bordas em
 * destaque (a cor de identidade); `accentGold` dirige os filetes finos e o
 * eyebrow (frontend-spec). Ambos em HSL triplo ("H S% L%") — mesmo formato
 * dos tokens em `globals.css`, pra poder sobrescrever `--brand`/`--accent-gold`
 * direto via `style` inline (cascata normal, sem precisar do truque de
 * layers usado pra `--company-text`/`--company-title`).
 */
export interface ThemePalette {
  readonly key: string;
  readonly label: string;
  readonly brand: string;
  readonly accentGold: string;
}

export const THEME_PALETTES: readonly ThemePalette[] = [
  { key: 'navy', label: 'Navy (padrão)', brand: '219 55% 26%', accentGold: '210 30% 55%' },
  { key: 'graphite', label: 'Grafite', brand: '220 10% 22%', accentGold: '220 8% 55%' },
  { key: 'slate', label: 'Ardósia', brand: '215 16% 34%', accentGold: '215 10% 60%' },
  { key: 'blue', label: 'Azul', brand: '212 70% 40%', accentGold: '199 65% 55%' },
  { key: 'teal', label: 'Verde-azulado', brand: '182 55% 28%', accentGold: '175 40% 50%' },
  { key: 'green', label: 'Verde', brand: '142 45% 28%', accentGold: '95 35% 48%' },
  { key: 'amber', label: 'Âmbar', brand: '38 72% 32%', accentGold: '45 80% 55%' },
  { key: 'orange', label: 'Laranja', brand: '22 70% 38%', accentGold: '30 80% 55%' },
  { key: 'red', label: 'Vermelho', brand: '4 62% 38%', accentGold: '10 70% 55%' },
  { key: 'purple', label: 'Roxo', brand: '271 40% 38%', accentGold: '280 45% 60%' },
];

export function findThemePalette(key: string | null | undefined): ThemePalette | null {
  if (!key) return null;
  return THEME_PALETTES.find((p) => p.key === key) ?? null;
}
