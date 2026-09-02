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
  {
    name: '0012_meeting_types',
    sql: `
-- Tipos de reunião (ex.: "Comitê Geral" com os 8 conselheiros, "Comitê de
-- Engenharia" só com Engenharia) — o dono define quais conselheiros
-- participam de cada tipo; o Presidente sempre sintetiza no final e por
-- isso NUNCA entra em agent_ids (não é um "participante" que reage a gatilho).
CREATE TABLE IF NOT EXISTS meeting_type (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id  uuid NOT NULL REFERENCES company(id) ON DELETE CASCADE,
  name        text NOT NULL,
  agent_ids   text[] NOT NULL,
  is_default  boolean NOT NULL DEFAULT false,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, name)
);
CREATE INDEX IF NOT EXISTS idx_meeting_type_company ON meeting_type(company_id);

-- Semeia "Comitê Geral" (todos os 8) pra toda empresa já existente — nunca
-- deixa uma empresa sem nenhum tipo pra escolher ao criar reunião.
INSERT INTO meeting_type (company_id, name, agent_ids, is_default)
SELECT id, 'Comitê Geral',
  ARRAY['engenharia','vendas','mercado','arquitetura','legal','cs','cfo','futurista'],
  true
FROM company
ON CONFLICT (company_id, name) DO NOTHING;

ALTER TABLE meeting ADD COLUMN IF NOT EXISTS meeting_type_id uuid REFERENCES meeting_type(id);
`,
  },
  {
    name: '0013_custom_counselors',
    sql: `
-- Conselheiros CUSTOM: cada empresa pode criar conselheiros além dos 9
-- padrão. Um agent_profile sem trigger_keywords é um dos padrão (usa os
-- gatilhos curados no código, packages/engines/src/triggers.ts); COM
-- trigger_keywords é custom (o dono escreveu as palavras que o disparam,
-- não dá pra curar automaticamente um escopo desconhecido).
ALTER TABLE agent_profile ADD COLUMN IF NOT EXISTS trigger_keywords text[];
`,
  },
  {
    name: '0014_kb_source_rescan',
    sql: `
-- Revisão automática de fontes por LINK: o dono marca "revisar a cada N
-- dias" (opcional) e o sistema rebaixa o link de novo quando vence — sem
-- isso, uma fonte de URL fica congelada no dia em que foi importada.
ALTER TABLE kb_source ADD COLUMN IF NOT EXISTS rescan_days integer;
ALTER TABLE kb_source ADD COLUMN IF NOT EXISTS last_scanned_at timestamptz;
ALTER TABLE company_source ADD COLUMN IF NOT EXISTS rescan_days integer;
ALTER TABLE company_source ADD COLUMN IF NOT EXISTS last_scanned_at timestamptz;
`,
  },
  {
    name: '0015_agent_profile_scope_split',
    sql: `
-- "Escopo" vira 2 campos na autoria: "o que pode" e "o que não pode" opinar
-- (menos ambíguo que 1 parágrafo livre misturando os dois). \`scope\` continua
-- sendo o campo ÚNICO lido pelo prompt (compatibilidade com todo o resto do
-- sistema) — é reconstruído a partir dos 2 campos toda vez que o dono salva.
ALTER TABLE agent_profile ADD COLUMN IF NOT EXISTS scope_can text;
ALTER TABLE agent_profile ADD COLUMN IF NOT EXISTS scope_cannot text;
`,
  },
  {
    name: '0016_agent_profile_icon',
    sql: `
-- Ícone por conselheiro (Font Awesome, conjunto curado em
-- apps/web/lib/agent-icons.tsx) — null cai no emoji (comportamento atual).
ALTER TABLE agent_profile ADD COLUMN IF NOT EXISTS icon_key text;
-- Formação/experiência/bio do "persona" — diferente do escopo (que é REGRA
-- do prompt): aqui é contexto de quem ele É, injetado como pano de fundo,
-- não como restrição do que pode opinar.
ALTER TABLE agent_profile ADD COLUMN IF NOT EXISTS bio text;
`,
  },
  {
    name: '0017_agent_profile_decision_context',
    sql: `
-- Estrutura completa do perfil profissional do conselheiro: formação
-- (renomeado de "bio" — mesmo conceito, campo mais explícito), critérios de
-- decisão (o que ele pesa ao avaliar propostas) e postura de risco. Todos
-- entram no system prompt como CONTEXTO de quem o conselheiro é/como pensa —
-- nunca como instrução de formatação de resposta (essa continua fixa no
-- código, igual pra todos).
ALTER TABLE agent_profile RENAME COLUMN bio TO professional_profile;
ALTER TABLE agent_profile ADD COLUMN IF NOT EXISTS decision_criteria text;
ALTER TABLE agent_profile ADD COLUMN IF NOT EXISTS risk_posture text;
ALTER TABLE agent_profile ADD COLUMN IF NOT EXISTS risk_posture_notes text;
`,
  },
  {
    name: '0018_agent_profile_icon_color',
    sql: `
-- Cor do ícone (hex) — só vale quando icon_key também está setado (o emoji
-- de fallback mantém a cor própria dele, não dá pra tingir emoji).
ALTER TABLE agent_profile ADD COLUMN IF NOT EXISTS icon_color text;
`,
  },
  {
    name: '0019_meeting_improvement',
    sql: `
-- Aprendizado do PRODUTO (não do negócio): a cada reunião ENCERRADA, uma
-- análise automática ("o que dava pra melhorar no Conselho nesta reunião" —
-- gatilhos, repetição, tom, lacuna de KB) fica registrada aqui, só para
-- LEITURA por enquanto — nada aqui é aplicado sozinho (tela /melhorias).
CREATE TABLE IF NOT EXISTS meeting_improvement (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  meeting_id   uuid NOT NULL REFERENCES meeting(id) ON DELETE CASCADE,
  company_id   uuid NOT NULL REFERENCES company(id) ON DELETE CASCADE,
  content_enc  text NOT NULL,
  model_version text,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_meeting_improvement_company ON meeting_improvement(company_id);
CREATE INDEX IF NOT EXISTS idx_meeting_improvement_meeting ON meeting_improvement(meeting_id);
`,
  },
  {
    name: '0020_voice_profile',
    sql: `
-- Reconhecimento de voz ENTRE reuniões (Tier 3 — dado biométrico, LGPD Art.
-- 5º II). Opt-in por empresa (company_profile.voiceRecognitionEnabled, no
-- blob cifrado — sem migration própria). 1 linha por PESSOA (não por
-- reunião): o embedding (256 floats do Resemblyzer) fica cifrado como
-- qualquer outro dado sensível deste produto (AES-256-GCM, packages/crypto).
-- Poucas dezenas de linhas por empresa — comparar por similaridade de
-- cosseno em JS puro é instantâneo, não precisa de pgvector.
CREATE TABLE IF NOT EXISTS voice_profile (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id    uuid NOT NULL REFERENCES company(id) ON DELETE CASCADE,
  name          text NOT NULL,
  area          text,
  embedding_enc text NOT NULL,
  sample_count  int NOT NULL DEFAULT 1,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_voice_profile_company ON voice_profile(company_id);
`,
  },
  {
    name: '0021_meeting_guidance',
    sql: `
-- Pauta/roteiro opcional anexado na criação da reunião — vira contexto extra
-- para os conselheiros (mesmo padrão de cifra do título). Puramente
-- informativo: o board não é obrigado a seguir a ordem, só passa a
-- "conhecer" o roteiro.
ALTER TABLE meeting ADD COLUMN IF NOT EXISTS guidance_enc text;
ALTER TABLE meeting ADD COLUMN IF NOT EXISTS guidance_filename text;
`,
  },
  {
    name: '0022_agent_profile_briefing',
    sql: `
-- Resumo curto (≤140 chars) gerado por IA a partir do perfil INTEIRO do
-- conselheiro (escopo + perfil profissional + critérios + postura de risco)
-- — usado nos cards/listas em vez de truncar cru o texto do escopo (que
-- carregava o prefixo "PODE opinar sobre:" do prompt, desperdiçando espaço
-- e cortando no meio da frase). Não cifrado — mesmo padrão do resto de
-- agent_profile (dado de configuração do produto, não do negócio).
ALTER TABLE agent_profile ADD COLUMN IF NOT EXISTS briefing text;
`,
  },
  {
    name: '0023_agent_profile_ai_voice_config',
    sql: `
-- IA e voz INDIVIDUAIS por conselheiro (Etapa "IA por conselheiro") — modelo
-- de raciocínio, nível de raciocínio, voz, estilo de voz e velocidade da
-- fala. Compatível com conselheiros existentes: ai_model/reasoning_effort/
-- speech_rate ganham DEFAULT (Postgres aplica o valor a linhas já
-- existentes sem reescrever a tabela); voice/voice_instructions ficam NULL
-- de propósito — o conselheiro continua na voz global/padrão por agentId
-- (apps/web/lib/tts-voices.ts) até alguém configurar uma voz própria.
ALTER TABLE agent_profile ADD COLUMN IF NOT EXISTS ai_model text DEFAULT 'gpt-5.6-luna';
ALTER TABLE agent_profile ADD COLUMN IF NOT EXISTS reasoning_effort text DEFAULT 'medium';
ALTER TABLE agent_profile ADD COLUMN IF NOT EXISTS voice text;
ALTER TABLE agent_profile ADD COLUMN IF NOT EXISTS voice_instructions text;
ALTER TABLE agent_profile ADD COLUMN IF NOT EXISTS speech_rate real DEFAULT 1.0;
`,
  },
  {
    name: '0024_president_config',
    sql: `
-- Configuração do Presidente (governança) — SINGLETON por empresa, distinta
-- de agent_profile: o Presidente não tem 1 modelo, tem 2 (acompanhamento e
-- síntese), mais um 3º nível de raciocínio só para a síntese final de
-- encerramento, mais uma camada de governança (nível de intervenção,
-- política de consenso, autoridade) sem equivalente num conselheiro comum.
-- Não cifrado — mesmo padrão de agent_profile (config do produto, não do
-- negócio). Sem linha ⇒ aplicação usa os defaults do pedido (compat total).
CREATE TABLE IF NOT EXISTS president_config (
  company_id                       uuid PRIMARY KEY REFERENCES company(id) ON DELETE CASCADE,
  monitoring_model                 text NOT NULL DEFAULT 'gpt-5.6-terra',
  monitoring_reasoning_effort      text NOT NULL DEFAULT 'medium',
  synthesis_model                  text NOT NULL DEFAULT 'gpt-5.6-sol',
  synthesis_reasoning_effort       text NOT NULL DEFAULT 'high',
  final_synthesis_reasoning_effort text NOT NULL DEFAULT 'xhigh',
  intervention_level               text NOT NULL DEFAULT 'moderate',
  consensus_policy                 text NOT NULL DEFAULT 'preserve_disagreement',
  can_request_counselors           boolean NOT NULL DEFAULT true,
  can_register_decisions           boolean NOT NULL DEFAULT true,
  can_override_specialist          boolean NOT NULL DEFAULT false,
  auto_interruption                boolean NOT NULL DEFAULT false,
  updated_at                       timestamptz NOT NULL DEFAULT now()
);
`,
  },
  {
    name: '0025_participants_biometrics',
    sql: `
-- Participante REAL de reunião (Etapa "Participantes"): distinto de app_user
-- (login) — uma pessoa pode participar de reuniões sem NUNCA ter conta no
-- sistema, e um app_user pode opcionalmente referenciar seu Participant.
CREATE TABLE IF NOT EXISTS participant (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id     uuid NOT NULL REFERENCES company(id) ON DELETE CASCADE,
  name           text NOT NULL,
  email          text,
  job_title      text,
  department     text,
  company_name   text,
  app_user_id    uuid REFERENCES app_user(id) ON DELETE SET NULL,
  status         text NOT NULL DEFAULT 'active',
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  last_meeting_at timestamptz
);
CREATE INDEX IF NOT EXISTS idx_participant_company ON participant(company_id);

-- Consentimento auditável (LGPD Art. 5º II — dado biométrico) — HISTÓRICO,
-- nunca sobrescrito: revogar grava um NOVO registro, a linha anterior
-- permanece intacta como prova do que foi consentido e quando.
CREATE TABLE IF NOT EXISTS participant_biometric_consent (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  participant_id uuid NOT NULL REFERENCES participant(id) ON DELETE CASCADE,
  consent_type   text NOT NULL DEFAULT 'voice_biometrics',
  status         text NOT NULL, -- granted | revoked
  version        text NOT NULL DEFAULT 'v1',
  granted_at     timestamptz NOT NULL DEFAULT now(),
  revoked_at     timestamptz,
  granted_by     uuid REFERENCES app_user(id) ON DELETE SET NULL,
  source         text NOT NULL DEFAULT 'admin_enrollment',
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_biometric_consent_participant ON participant_biometric_consent(participant_id);

-- voice_profile (migration 0020) passa a ser ligado a um Participant (era só
-- "nome solto" por empresa). Colunas antigas (name/area) permanecem — ainda
-- usadas como fallback de exibição sem precisar de JOIN — e novas linhas
-- continuam preenchendo-as a partir do Participant, por compatibilidade.
-- SEM KMS/envelope encryption (decisão explícita do dono): mesmo padrão
-- AES-256-GCM simples já usado em embedding_enc (@conselho/crypto),
-- consistente com o resto do produto — nenhuma infra de KMS existe neste
-- deploy. "Não substituir silenciosamente" (pedido) = nunca fazer UPDATE no
-- embedding_enc de uma linha ativa: reenrollment marca a linha antiga como
-- 'superseded' (revoked_at preenchido) e INSERE uma linha nova — histórico
-- de versões preservado como múltiplas linhas, sem coluna de versão à parte.
ALTER TABLE voice_profile ADD COLUMN IF NOT EXISTS participant_id uuid REFERENCES participant(id) ON DELETE CASCADE;
ALTER TABLE voice_profile ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'active';
ALTER TABLE voice_profile ADD COLUMN IF NOT EXISTS model_provider text NOT NULL DEFAULT 'resemblyzer';
ALTER TABLE voice_profile ADD COLUMN IF NOT EXISTS model_name text NOT NULL DEFAULT 'resemblyzer';
ALTER TABLE voice_profile ADD COLUMN IF NOT EXISTS model_version text NOT NULL DEFAULT 'v1';
ALTER TABLE voice_profile ADD COLUMN IF NOT EXISTS quality_score real;
ALTER TABLE voice_profile ADD COLUMN IF NOT EXISTS last_used_at timestamptz;
ALTER TABLE voice_profile ADD COLUMN IF NOT EXISTS revoked_at timestamptz;
CREATE INDEX IF NOT EXISTS idx_voice_profile_participant ON voice_profile(participant_id);

-- Mapeamento locutor→participante POR REUNIÃO (diarização do Deepgram só
-- devolve "speaker_0/1/2" anônimos — isto é o elo com uma identidade real).
-- PK composta (meeting_id, speaker_label): 1 linha por locutor detectado.
CREATE TABLE IF NOT EXISTS meeting_speaker (
  meeting_id           uuid NOT NULL REFERENCES meeting(id) ON DELETE CASCADE,
  speaker_label        text NOT NULL,
  participant_id       uuid REFERENCES participant(id) ON DELETE SET NULL,
  identification_status text NOT NULL DEFAULT 'unknown',
  confidence           real,
  identification_source text,
  confirmed_by_user_id uuid REFERENCES app_user(id) ON DELETE SET NULL,
  confirmed_at         timestamptz,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (meeting_id, speaker_label)
);
CREATE INDEX IF NOT EXISTS idx_meeting_speaker_participant ON meeting_speaker(participant_id);

-- Analytics OBJETIVAS de participação (nunca estado emocional/psicológico —
-- só contagens observáveis). 1 linha por participante por reunião.
CREATE TABLE IF NOT EXISTS participant_meeting_analytics (
  meeting_id      uuid NOT NULL REFERENCES meeting(id) ON DELETE CASCADE,
  participant_id  uuid NOT NULL REFERENCES participant(id) ON DELETE CASCADE,
  speaking_turns  int NOT NULL DEFAULT 0,
  speech_share    real,
  created_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (meeting_id, participant_id)
);
`,
  },
  {
    name: '0026_meeting_history',
    sql: `
-- Reunião histórica de verdade (Etapa "Histórico de reuniões"): hoje só a
-- SÍNTESE do Presidente é persistida por contribuição (board_synthesis) —
-- as contribuições REGULARES dos 8 conselheiros (atencao/sugestao/hipotese)
-- só viviam em memória (perdidas ao reiniciar/expirar o TTL). Esta migration
-- fecha essa lacuna + adiciona Decisões/Ações (extraídas por IA da síntese
-- final, 1x por reunião) + a referência explícita de contexto entre reuniões.
--
-- Conteúdo sensível vira 1 blob JSON cifrado por linha (content_enc) — mesmo
-- padrão do resto do produto; metadados curtos (tipo/severidade/status/prazo)
-- ficam em claro para filtrar/ordenar sem decifrar every row.
CREATE TABLE IF NOT EXISTS meeting_contribution (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  meeting_id    uuid NOT NULL REFERENCES meeting(id) ON DELETE CASCADE,
  agent_id      text NOT NULL,
  type          text NOT NULL,
  severity      text NOT NULL,
  urgency       text,
  category      text,
  content_enc   text NOT NULL,
  model_version text,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_meeting_contribution_meeting ON meeting_contribution(meeting_id, created_at);

-- Decision Ledger (Seção 5 "DECISÕES") — 1 linha por decisão/recomendação
-- identificada na síntese final.
CREATE TABLE IF NOT EXISTS meeting_decision (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  meeting_id    uuid NOT NULL REFERENCES meeting(id) ON DELETE CASCADE,
  status        text NOT NULL DEFAULT 'pendente', -- decidido | recomendado | pendente | cancelado
  deadline      timestamptz,
  content_enc   text NOT NULL, -- {topic, decision, responsible, evidence}
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_meeting_decision_meeting ON meeting_decision(meeting_id);

-- Ações (Seção 5 "AÇÕES") — pode (ou não) originar de uma decisão específica.
CREATE TABLE IF NOT EXISTS meeting_action_item (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  meeting_id    uuid NOT NULL REFERENCES meeting(id) ON DELETE CASCADE,
  decision_id   uuid REFERENCES meeting_decision(id) ON DELETE SET NULL,
  status        text NOT NULL DEFAULT 'pendente',
  deadline      timestamptz,
  content_enc   text NOT NULL, -- {action, responsible}
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_meeting_action_item_meeting ON meeting_action_item(meeting_id);

-- Contexto ENTRE reuniões — referência EXPLÍCITA (Seção 14), escolhida pelo
-- dono ao criar a reunião nova, nunca atribuída sozinha. Substitui a injeção
-- automática das últimas 3 sínteses (comportamento antigo, sem opt-in) —
-- decisão explícita desta etapa: só entra contexto anterior quando ESCOLHIDO.
ALTER TABLE meeting ADD COLUMN IF NOT EXISTS previous_context_meeting_id uuid REFERENCES meeting(id) ON DELETE SET NULL;
`,
  },
  {
    name: '0027_meeting_analysis',
    sql: `
-- Auto-análise ESTRUTURADA (Etapa "Auto-análise e melhoria contínua") —
-- meeting_improvement (migration 0019) guardava só texto livre; agora
-- guarda TAMBÉM o JSON estruturado completo (scores, forças, problemas,
-- recomendações, análise por conselheiro/Presidente/continuidade/custo).
-- content_enc continua sendo o "Resumo da análise" (narrativa), agora
-- GERADA a partir do estruturado, não o contrário. Nunca sobrescreve:
-- reanalisar insere uma linha nova (histórico de versões via created_at).
ALTER TABLE meeting_improvement ADD COLUMN IF NOT EXISTS structured_enc text;
ALTER TABLE meeting_improvement ADD COLUMN IF NOT EXISTS overall_score int;
`,
  },
];
