/**
 * Perfil da empresa: contexto ÚNICO e compartilhado entre TODOS os 9
 * conselheiros (nome, porte, segmento, região, notas livres) — ao contrário
 * de `kb_source`/`agent_profile`, que são por agente. Mesmo padrão de mutação
 * em memória de `applyAgentProfileOverrides`: o objeto compartilhado vale
 * imediatamente para reasoner/síntese/relatórios, sem restart.
 */
export interface CompanyProfile {
  readonly name?: string;
  readonly size?: string;
  readonly segment?: string;
  readonly region?: string;
  readonly notes?: string;
  /** Texto extraído dos documentos anexados (company_source), já concatenado/truncado. */
  readonly sourcesText?: string;
}

let current: CompanyProfile = {};

export function applyCompanyProfile(profile: CompanyProfile): void {
  current = { ...profile };
}

export function getCompanyProfile(): CompanyProfile {
  return current;
}

/** Bloco a anexar em QUALQUER system prompt de conselheiro ('' se nada cadastrado). */
export function companyProfileBlock(): string {
  const parts: string[] = [];
  if (current.name) parts.push(`Empresa: ${current.name}`);
  if (current.size) parts.push(`Porte: ${current.size}`);
  if (current.segment) parts.push(`Segmento: ${current.segment}`);
  if (current.region) parts.push(`Região de atuação: ${current.region}`);
  if (current.notes) parts.push(`Contexto adicional: ${current.notes}`);
  const header = parts.length > 0 ? `\n\nCONTEXTO DA EMPRESA (use como referência em toda contribuição):\n${parts.join('\n')}` : '';
  const docs = current.sourcesText
    ? `\n\nDOCUMENTOS DA EMPRESA (anexados pelo dono):\n${current.sourcesText}`
    : '';
  return header + docs;
}
