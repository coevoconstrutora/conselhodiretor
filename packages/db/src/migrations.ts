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
  {
    name: '0008_company_sources',
    sql: `
-- Documentos do perfil da empresa (texto/link/arquivo) — mesmo padrão do
-- kb_source, mas SEM agent_id: entra no bloco de contexto de TODOS os 9
-- conselheiros (companyProfileBlock), não é indexado por RAG por agente.
CREATE TABLE IF NOT EXISTS company_source (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind        text NOT NULL,          -- 'text' | 'url' | 'file'
  title       text NOT NULL,
  ref         text,                   -- URL ou nome do arquivo original
  content_enc text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_company_source_created ON company_source(created_at);
`,
  },
  {
    name: '0009_meeting_summary',
    sql: `
-- Resumo pós-reunião: duração (closed_at - confirmed_at) e nº de presentes
-- (informado na confirmação de gravação) — exibidos quando a reunião encerra.
ALTER TABLE meeting ADD COLUMN IF NOT EXISTS closed_at timestamptz;
ALTER TABLE meeting ADD COLUMN IF NOT EXISTS participant_count int;
`,
  },
  {
    name: '0010_multi_company',
    sql: `
-- Multi-empresa: cada empresa tem seus próprios usuários, reuniões,
-- conselheiros e conhecimento — isolados. 'coevo' é a empresa default
-- (backfill de tudo que já existia antes desta migration).
CREATE TABLE IF NOT EXISTS company (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug       text NOT NULL UNIQUE,
  name       text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO company (slug, name) VALUES ('coevo', 'Coevo Construtora')
  ON CONFLICT (slug) DO NOTHING;

-- app_user: pertence a UMA empresa (home); is_super_admin ignora o filtro e
-- acessa qualquer empresa via seletor (ver session.active_company_id).
ALTER TABLE app_user ADD COLUMN IF NOT EXISTS company_id uuid REFERENCES company(id);
ALTER TABLE app_user ADD COLUMN IF NOT EXISTS is_super_admin boolean NOT NULL DEFAULT false;
UPDATE app_user SET company_id = (SELECT id FROM company WHERE slug = 'coevo') WHERE company_id IS NULL;
ALTER TABLE app_user ALTER COLUMN company_id SET NOT NULL;
CREATE INDEX IF NOT EXISTS idx_app_user_company ON app_user(company_id);

-- Promove o super-admin combinado (idempotente — no-op se o e-mail não existir ainda)
UPDATE app_user SET is_super_admin = true WHERE email = 'vitor@coevoconstrutora.com.br';

ALTER TABLE meeting ADD COLUMN IF NOT EXISTS company_id uuid REFERENCES company(id);
UPDATE meeting SET company_id = (SELECT id FROM company WHERE slug = 'coevo') WHERE company_id IS NULL;
ALTER TABLE meeting ALTER COLUMN company_id SET NOT NULL;
CREATE INDEX IF NOT EXISTS idx_meeting_company ON meeting(company_id, created_at);

ALTER TABLE kb_source ADD COLUMN IF NOT EXISTS company_id uuid REFERENCES company(id);
UPDATE kb_source SET company_id = (SELECT id FROM company WHERE slug = 'coevo') WHERE company_id IS NULL;
ALTER TABLE kb_source ALTER COLUMN company_id SET NOT NULL;
DROP INDEX IF EXISTS idx_kb_source_agent;
CREATE INDEX IF NOT EXISTS idx_kb_source_company_agent ON kb_source(company_id, agent_id, created_at);

-- agent_profile: era PK(agent_id) só — vira PK(company_id, agent_id), já que
-- cada empresa clonada tem sua PRÓPRIA cópia editável dos 9 papéis.
ALTER TABLE agent_profile ADD COLUMN IF NOT EXISTS company_id uuid REFERENCES company(id);
UPDATE agent_profile SET company_id = (SELECT id FROM company WHERE slug = 'coevo') WHERE company_id IS NULL;
ALTER TABLE agent_profile ALTER COLUMN company_id SET NOT NULL;
ALTER TABLE agent_profile DROP CONSTRAINT IF EXISTS agent_profile_pkey;
ALTER TABLE agent_profile ADD PRIMARY KEY (company_id, agent_id);

-- company_profile: era singleton id=1 — vira singleton POR EMPRESA (PK=company_id).
ALTER TABLE company_profile DROP CONSTRAINT IF EXISTS company_profile_pkey;
ALTER TABLE company_profile ADD COLUMN IF NOT EXISTS company_id uuid REFERENCES company(id);
UPDATE company_profile SET company_id = (SELECT id FROM company WHERE slug = 'coevo') WHERE company_id IS NULL;
ALTER TABLE company_profile ALTER COLUMN company_id SET NOT NULL;
ALTER TABLE company_profile DROP COLUMN IF EXISTS id;
ALTER TABLE company_profile ADD PRIMARY KEY (company_id);

ALTER TABLE company_source ADD COLUMN IF NOT EXISTS company_id uuid REFERENCES company(id);
UPDATE company_source SET company_id = (SELECT id FROM company WHERE slug = 'coevo') WHERE company_id IS NULL;
ALTER TABLE company_source ALTER COLUMN company_id SET NOT NULL;
DROP INDEX IF EXISTS idx_company_source_created;
CREATE INDEX IF NOT EXISTS idx_company_source_company ON company_source(company_id, created_at);

-- session: empresa que o super-admin está VISUALIZANDO agora (NULL = a própria/home).
ALTER TABLE session ADD COLUMN IF NOT EXISTS active_company_id uuid REFERENCES company(id);
`,
  },
  {
    name: '0011_company_membership',
    sql: `
-- Vínculo usuário↔empresas: UMA identidade (email/senha únicos por pessoa)
-- pode pertencer a VÁRIAS empresas, com um papel PRÓPRIO em cada uma — antes
-- só dava pra ter 1 conta por empresa (e-mail repetido virava "já existe").
CREATE TABLE IF NOT EXISTS company_member (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
  company_id  uuid NOT NULL REFERENCES company(id) ON DELETE CASCADE,
  role        text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, company_id)
);
ALTER TABLE company_member DROP CONSTRAINT IF EXISTS company_member_role_check;
ALTER TABLE company_member ADD CONSTRAINT company_member_role_check CHECK (role IN ('admin', 'gestor', 'convidado'));
CREATE INDEX IF NOT EXISTS idx_company_member_user ON company_member(user_id);
CREATE INDEX IF NOT EXISTS idx_company_member_company ON company_member(company_id);

-- Backfill: todo app_user existente vira 1 membership na company_id/role atuais
-- (app_user.company_id/role continuam existindo como "empresa/papel padrão"
-- de login, mas quem manda no acesso a CADA empresa agora é company_member).
INSERT INTO company_member (user_id, company_id, role)
SELECT id, company_id, role FROM app_user
ON CONFLICT (user_id, company_id) DO NOTHING;
`,
  },
];
