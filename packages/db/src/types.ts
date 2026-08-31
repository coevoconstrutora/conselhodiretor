/** Tipos das linhas das entidades base. */

export type AppUserRole = 'admin' | 'gestor' | 'convidado';

export interface AppUserRow {
  id: string;
  email: string;
  display_name: string;
  role: AppUserRole;
  created_at: Date;
  updated_at: Date;
}

export interface MeetingRow {
  id: string;
  user_id: string;
  /** Título da reunião cifrado em repouso (AES-256-GCM, base64). */
  title_enc: string;
  status: string;
  /** Gate de gravação: default NEGA — sem confirmação, o STT não abre. */
  recording_confirmed: boolean;
  confirmed_at: Date | null;
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
