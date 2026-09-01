/**
 * Perfil da empresa: contexto ÚNICO e compartilhado entre TODOS os 9
 * conselheiros DE UMA EMPRESA (nome, porte, segmento, região, notas) — ao
 * contrário de `kb_source`/`agent_profile`, que são por agente. Multi-tenant:
 * um Map por `companyId`, isolado — nunca vaza entre empresas no mesmo
 * processo. Mesmo padrão de mutação em memória do reasoner: o objeto
 * daquela empresa vale imediatamente para reasoner/síntese/relatórios, sem
 * restart.
 */
export interface CompanyProfile {
  readonly name?: string;
  readonly cnpj?: string;
  readonly size?: string;
  readonly segment?: string;
  /** Cidades onde a empresa atua — uma empresa raramente atua numa cidade só. */
  readonly region?: readonly string[];
  readonly notes?: string;
  /** Texto extraído dos documentos anexados (company_source), já concatenado/truncado. */
  readonly sourcesText?: string;
  /** Logo da empresa — data URL (base64), sem storage externo. Só exibição, nunca entra no prompt. */
  readonly logoDataUrl?: string | null;
  /** Paleta pré-montada (`apps/web/lib/theme-palettes.ts`) — dirige brand/accent coordenados. Só exibição. */
  readonly themePalette?: string | null;
  /** Tema visual por empresa — hex (#rrggbb) ou null (usa o padrão do produto/paleta). Só exibição. */
  readonly themeTextColor?: string | null;
  readonly themeTitleColor?: string | null;
  readonly themeBackground?: 'grid' | 'plain' | null;
  /** Tier 3 — reconhecimento de voz ENTRE reuniões (dado biométrico, LGPD). Opt-in, default false. */
  readonly voiceRecognitionEnabled?: boolean;
}

const profilesByCompany = new Map<string, CompanyProfile>();

export function applyCompanyProfile(companyId: string, profile: CompanyProfile): void {
  profilesByCompany.set(companyId, { ...profile });
}

export function getCompanyProfile(companyId: string): CompanyProfile {
  return profilesByCompany.get(companyId) ?? {};
}

/** Bloco a anexar em QUALQUER system prompt de conselheiro ('' se nada cadastrado). */
export function companyProfileBlock(companyId: string): string {
  const current = getCompanyProfile(companyId);
  const parts: string[] = [];
  if (current.name) parts.push(`Empresa: ${current.name}`);
  if (current.cnpj) parts.push(`CNPJ: ${current.cnpj}`);
  if (current.size) parts.push(`Porte: ${current.size}`);
  if (current.segment) parts.push(`Segmento: ${current.segment}`);
  if (current.region?.length) parts.push(`Região de atuação: ${current.region.join(', ')}`);
  if (current.notes) parts.push(`Contexto adicional: ${current.notes}`);
  const header = parts.length > 0 ? `\n\nCONTEXTO DA EMPRESA (use como referência em toda contribuição):\n${parts.join('\n')}` : '';
  const docs = current.sourcesText
    ? `\n\nDOCUMENTOS DA EMPRESA (anexados pelo dono):\n${current.sourcesText}`
    : '';
  return header + docs;
}
