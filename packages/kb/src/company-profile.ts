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
  readonly size?: string;
  readonly segment?: string;
  readonly region?: string;
  readonly notes?: string;
  /** Texto extraído dos documentos anexados (company_source), já concatenado/truncado. */
  readonly sourcesText?: string;
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
