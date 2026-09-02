/** Tipos das linhas das entidades base. */

export type AppUserRole = 'admin' | 'gestor' | 'convidado';

export interface CompanyRow {
  id: string;
  slug: string;
  name: string;
  created_at: Date;
}

/** Vínculo de uma identidade (app_user) com UMA empresa — papel próprio por empresa. */
export interface CompanyMemberRow {
  id: string;
  user_id: string;
  company_id: string;
  role: AppUserRole;
  created_at: Date;
}

export interface AppUserRow {
  id: string;
  email: string;
  display_name: string;
  role: AppUserRole;
  /** Empresa "casa" do usuário — super_admin acessa outras via seletor. */
  company_id: string;
  is_super_admin: boolean;
  created_at: Date;
  updated_at: Date;
}

export interface MeetingRow {
  id: string;
  user_id: string;
  company_id: string;
  /** Título da reunião cifrado em repouso (AES-256-GCM, base64). */
  title_enc: string;
  status: string;
  /** Gate de gravação: default NEGA — sem confirmação, o STT não abre. */
  recording_confirmed: boolean;
  confirmed_at: Date | null;
  closed_at: Date | null;
  participant_count: number | null;
  meeting_type_id: string | null;
  /** Pauta/roteiro opcional anexado na criação (Etapa "guia de reunião") — cifrado como o título. */
  guidance_enc: string | null;
  /** Nome do arquivo original (não cifrado — só um rótulo, não é conteúdo). */
  guidance_filename: string | null;
  created_at: Date;
  updated_at: Date;
}

/** Tipo de reunião (Comitê Geral, Comitê de Engenharia, ...) — escopa quais
 * conselheiros participam; Presidente nunca entra aqui, sempre sintetiza. */
export interface MeetingTypeRow {
  id: string;
  company_id: string;
  name: string;
  agent_ids: string[];
  is_default: boolean;
  created_at: Date;
  updated_at: Date;
}

export interface AuditLogRow {
  id: string;
  contribution_id: string | null;
  /** Gatilho que disparou a contribuição (Trigger Detector). */
  triggered_by: string;
  /** Fontes de KB usadas (Agent Reasoner/RAG). Proveniência. */
  kb_sources: unknown;
  model_version: string;
  created_at: Date;
}
