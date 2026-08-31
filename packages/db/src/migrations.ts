/**
 * Migrations versionadas (fonte de verdade, em ordem).
 *
 * SQL inline em TS — robusto em qualquer runtime (Node, Vitest, bundle do Next),
 * sem depender de leitura de arquivos `.sql` do disco. Cada entrada é aplicada
 * uma única vez e rastreada em `_migrations` (ver `runMigrations`).
 *
 * Domínio: reuniões empresariais com board de 9 agentes de IA (Conselho).
 * Colunas com sufixo _enc guardam ciphertext base64 (AES-256-GCM, @conselho/crypto).
 */
export interface Migration {
  readonly name: string;
  readonly sql: string;
}

export const MIGRATIONS: ReadonlyArray<Migration> = [
  {
    name: '0001_init',
    sql: `
-- Usuário (empresário) + autenticação por sessão DB-backed.
-- password_hash é scrypt (salt embutido) — nunca em claro.

CREATE TABLE IF NOT EXISTS app_user (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email         text NOT NULL UNIQUE,
  display_name  text NOT NULL,
  password_hash text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS session (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
  token_hash  text NOT NULL UNIQUE,
  expires_at  timestamptz NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_session_user_id ON session(user_id);

-- Reunião: a entidade central. recording_confirmed é o GATE de servidor para
-- abrir o STT — default NEGA (o empresário confirma que os participantes
-- autorizaram a gravação antes de qualquer captura de áudio).
CREATE TABLE IF NOT EXISTS meeting (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id              uuid NOT NULL REFERENCES app_user(id),
  title_enc            text NOT NULL,
  status               text NOT NULL DEFAULT 'open',
  recording_confirmed  boolean NOT NULL DEFAULT false,
  confirmed_at         timestamptz,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_meeting_user_id ON meeting(user_id);
`,
  },
  {
    name: '0002_audit_log',
    sql: `
-- Trilha de auditoria com proveniência completa + imutabilidade no banco.
-- Toda contribuição de agente, síntese e relatório gera uma linha aqui.

CREATE TABLE IF NOT EXISTS audit_log (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contribution_id  uuid,
  triggered_by     text NOT NULL,
  kb_sources       jsonb NOT NULL,
  model_version    text NOT NULL,
  created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_audit_log_contribution_id ON audit_log(contribution_id);

-- Append-only: qualquer UPDATE/DELETE pela aplicação é rejeitado no banco,
-- independente de bug ou bypass na camada de serviço.
CREATE OR REPLACE FUNCTION audit_log_immutable() RETURNS trigger AS $fn$
BEGIN
  RAISE EXCEPTION 'audit_log é append-only: % proibido', TG_OP;
END;
$fn$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_audit_log_immutable ON audit_log;
CREATE TRIGGER trg_audit_log_immutable
  BEFORE UPDATE OR DELETE ON audit_log
  FOR EACH ROW EXECUTE FUNCTION audit_log_immutable();
`,
  },
  {
    name: '0003_transcript',
    sql: `
-- Transcript persistido incrementalmente: cada segmento FINAL do STT vira uma
-- linha cifrada no momento em que chega — a transcrição sobrevive a
-- deploy/restart no meio da reunião (lição herdada do incidente NutriMed 2026-07-01).

CREATE TABLE IF NOT EXISTS transcript_segment (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  meeting_id  uuid NOT NULL REFERENCES meeting(id),
  seq         int NOT NULL,
  content_enc text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (meeting_id, seq)
);
CREATE INDEX IF NOT EXISTS idx_transcript_segment_meeting
  ON transcript_segment(meeting_id, seq);

-- Transcrição REVISADA pelo empresário. Os finais crus do STT permanecem
-- intactos como proveniência ("o que a máquina ouviu"); esta tabela guarda a
-- versão corrigida ("o que de fato foi dito"). Quando existe, é a fonte dos
-- relatórios finais. 1:1 com a reunião.
CREATE TABLE IF NOT EXISTS transcript_review (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  meeting_id  uuid NOT NULL UNIQUE REFERENCES meeting(id),
  content_enc text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
`,
  },
  {
    name: '0004_board_outputs',
    sql: `
-- Sínteses do Presidente do Conselho persistidas durante a reunião (histórico
-- que sobrevive a restart), e os relatórios finais por agente.

CREATE TABLE IF NOT EXISTS board_synthesis (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  meeting_id    uuid NOT NULL REFERENCES meeting(id),
  content_enc   text NOT NULL,
  model_version text,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_board_synthesis_meeting
  ON board_synthesis(meeting_id, created_at);

-- Relatório final por agente (8 conselheiros + a síntese executiva do
-- Presidente, agent_id = 'presidente'). content_enc = markdown editável.
-- UNIQUE (meeting_id, agent_id): regenerar sobrescreve o rascunho.
CREATE TABLE IF NOT EXISTS agent_report (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  meeting_id    uuid NOT NULL REFERENCES meeting(id),
  agent_id      text NOT NULL,
  content_enc   text NOT NULL,
  model_version text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (meeting_id, agent_id)
);
CREATE INDEX IF NOT EXISTS idx_agent_report_meeting ON agent_report(meeting_id);
`,
  },
  {
    name: '0005_counselor_knowledge',
    sql: `
-- "NotebookLM por conselheiro": fontes de conhecimento adicionadas pelo dono
-- (texto colado, link, arquivo) que alimentam o namespace do agente JUNTO com
-- a seed. Conteúdo pode carregar estratégia da empresa ⇒ cifrado em repouso.
-- Aplicação é ao vivo (rebuild do namespace em memória) — sem restart.

CREATE TABLE IF NOT EXISTS kb_source (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id    text NOT NULL,
  kind        text NOT NULL,          -- 'text' | 'url' | 'file'
  title       text NOT NULL,
  ref         text,                   -- URL ou nome do arquivo original
  content_enc text NOT NULL,          -- texto extraído, cifrado (AES-256-GCM)
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_kb_source_agent ON kb_source(agent_id, created_at);

-- Personalização do perfil do conselheiro (nome exibido + escopo do prompt).
-- Sobrepõe o default de AGENT_PROFILES no boot e ao salvar.
CREATE TABLE IF NOT EXISTS agent_profile (
  agent_id     text PRIMARY KEY,
  display_name text NOT NULL,
  scope        text NOT NULL,
  updated_at   timestamptz NOT NULL DEFAULT now()
);
`,
  },
  {
    name: '0006_users_roles',
    sql: `
-- Papéis de acesso: admin (gestão de usuários + acesso total), gestor (uso
-- diário do conselho, sem gestão de usuários) e convidado (só leitura —
-- acompanha reuniões/relatórios sem poder criar/rodar/gerar nada).
ALTER TABLE app_user ADD COLUMN IF NOT EXISTS role text NOT NULL DEFAULT 'gestor';
ALTER TABLE app_user DROP CONSTRAINT IF EXISTS app_user_role_check;
ALTER TABLE app_user ADD CONSTRAINT app_user_role_check CHECK (role IN ('admin', 'gestor', 'convidado'));

-- Promove quem já existe no banco (o dono que rodou create-user antes desta
-- migration) a admin — sem isso ninguém teria acesso à tela de usuários.
UPDATE app_user SET role = 'admin' WHERE role = 'gestor';

-- Recuperação de senha por e-mail (Resend). Mesmo padrão de 'session':
-- só o SHA-256 do token fica no banco; o token em claro só existe no link
-- enviado por e-mail e nunca é persistido.
CREATE TABLE IF NOT EXISTS password_reset_token (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
  token_hash  text NOT NULL UNIQUE,
  expires_at  timestamptz NOT NULL,
  used_at     timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_password_reset_token_user_id ON password_reset_token(user_id);
`,
  },
  {
    name: '0007_company_profile',
    sql: `
-- Perfil da empresa: contexto ÚNICO e compartilhado (nome, porte, segmento,
-- região, notas livres) que entra no prompt de TODOS os 9 conselheiros — ao
-- contrário do kb_source, que é por agente. Linha única (id fixo em 1).
-- Conteúdo sensível (estratégia/porte do negócio) ⇒ cifrado em repouso.
CREATE TABLE IF NOT EXISTS company_profile (
  id          smallint PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  content_enc text NOT NULL,
  updated_at  timestamptz NOT NULL DEFAULT now()
);
`,
  },
];
