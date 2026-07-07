# 📜 Histórico de implementação — Conselho

> Registro consolidado de tudo que foi construído, em ordem, com as decisões
> e verificações de cada etapa. Data-base: **2026-07-07**.
> Complementa o [CLAUDE.md](../CLAUDE.md) (estado atual) e o
> [README.md](../README.md) (visão de produto).

## Origem

O Conselho nasceu de uma **auditoria técnica completa do NutriMed**
(sistema de board de especialistas de IA para consultas de nutrologia, em
produção), da qual extraímos a arquitetura de transcrição ao vivo +
agentes reagindo em tempo real, redirecionada para **reuniões empresariais
de uma incorporadora imobiliária**. Repositório novo, história limpa,
17 pacotes TypeScript em monorepo pnpm.

Decisões de fundação (aprovadas em plano):
- Repositório limpo (não fork) — sem bagagem do domínio médico
- 9 agentes definidos pelo dono: Engenharia/Lean, Vendas & Marketing,
  Inteligência de Mercado, Arquitetura & Urbanismo, Legal & Compliance,
  Customer Success, CFO (Funding/Caixa/MCMV), Futurista e **Presidente do
  Conselho** (sintetizador — não contribui, consolida)
- Relatório final: 1 por conselheiro + síntese executiva do Presidente
- Login simples de usuário único (dono)

## Fase 1 — Fundação (infra)

- Monorepo pnpm · TS strict · ESLint flat · Vitest · Prettier
- `crypto` (AES-256-GCM), `auth` (scrypt + sessão DB por hash de token),
  `audit` (trilha append-only com trigger de imutabilidade no banco),
  `db` (PGlite dev / Postgres+TLS prod), `meetings` (gate de gravação
  default-NEGA), `providers` (interfaces de fornecedor + fakes)
- Migrations 0001–0004: app_user/session/meeting, audit_log, transcript
  (segmentos + revisão), board_synthesis + agent_report

**Correções estruturais aplicadas na origem** (achados da auditoria do
NutriMed, corrigidos aqui desde o dia 1):
1. `SqlExecutor.transaction()` — no `pg`, client dedicado do Pool
   (BEGIN/COMMIT na MESMA conexão); `auditedClinicalWrite` usa isso e É
   usado pelos consumidores (escrita sensível + auditoria são atômicas)
2. Gateway WS com `wss.on('error')` + `socket.on('error')` — socket ruim
   não derruba o processo
3. `llm-anthropic` com AbortController/timeout 60s + erro `network` tipado;
   `stt-deepgram` com timeout de handshake 15s
4. `runtime.active` com TTL 2h pós-encerramento + `telemetry.purgeExpired()`
   (fim do vazamento de memória)
5. Rate-limit GLOBAL do board (4/min) além do por agente (1/min) — 8
   conselheiros sem teto global seriam ruído

## Fase 2 — Transcrição ao vivo

- `session` (MeetingSession: acúmulo de finais/parciais, retry com backoff,
  gate de gravação antes de abrir stream)
- `stt-deepgram` (WS nativo, keyterm/keywords, boost de vocabulário)
- `board-gateway` (WS autenticado `/board` + `/audio`, mesma porta do HTTP
  em produção via `server.mjs` + `BOARD_WS_MODE=attached`)
- Transcript persistido cifrado por segmento (sobrevive a restart)
- `BUSINESS_VOCABULARY`: ~70 termos de incorporação (VGV, MCMV, INCC,
  habite-se, registro de incorporação…) para o boost do STT

## Fase 3 — Board dos 9 conselheiros

- `engines`: triggers regex por agente do domínio imobiliário (critical
  fura fila: embargo, ação judicial, estouro de caixa) → score → dedup por
  tópico (60s) → pausa natural (2,5s) → rate-limit (agente + global)
- `kb`: namespaces isolados por agente (Legal nunca lê o caderno do CFO),
  ingestão versionada, `AgentReasoner` com prompt restrito ao escopo
- `board`: `FullBoardOrchestrator` — 8 conselheiros simultâneos, CaseState
  (memória estruturada da reunião), case review periódico em pausa,
  dedup semântico (Jaccard) pré e pós-LLM, síntese do Presidente
  (automática em silêncio ou sob demanda), divergência transparente
- UI da sala: faixa dos 9 conselheiros (estados ouvindo/falando/sinalizando,
  spotlight, silenciar), transcrição ao vivo, feed com hierarquia de
  segurança, Modo Foco (tecla F), telemetria (custo/gate/latência)

**Verificado ao vivo com Claude real**: fala sobre ação judicial + fluxo de
caixa disparou Legal (critical) e CFO com análises específicas; síntese do
Presidente consolidou e devolveu a decisão ao dono.

## Fase 4 — Relatórios finais

- `meeting-report`: transcript persistido/revisado + sínteses + relatórios
- Revisão da transcrição pelo dono (a versão corrigida vira a fonte)
- Geração: 8 relatórios (1 por conselheiro, com "o que você apontou ao
  vivo" como âncora anti-invenção) + síntese executiva do Presidente a
  partir dos 8 — em série, cifrados, auditados, editáveis na UI
- Bug real encontrado e corrigido no teste: `maxTokens` 1500 truncava o
  JSON do relatório → 4000

## Design "engenharia corporativa"

- Paleta navy/ardósia (substituiu o dourado/oliva herdado), Inter única,
  cantos quase retos (`--radius: 3px` em token único — 28+ usos)
- Linguagem de prancha de desenho técnico: grade papel-milimetrado no
  fundo, marcas de registro (crosshair) nos cards, divisor estilo linha de
  cota, índices de prancha `01/ 02/ 03/` nos títulos de seção

## Produtização (venda/instalação por terceiros)

- **`pnpm create-user`** — CLI para o dono criar/atualizar o próprio
  usuário (+ `--desativar-demo`); em produção o usuário demo NUNCA é
  seedado (correção de segurança: credencial pública não nasce em banco de
  cliente)
- **`docs/TUTORIAL.md`** — instalação do zero ao sistema rodando
- **`docs/GUIA-APIS.md`** — criar contas/chaves Anthropic e Deepgram, custos
  (reunião típica < US$ 1), limites de gasto, segurança de chaves
- **`docs/GUIA-CONHECIMENTO.md`** — curadoria da base de cada conselheiro
- `.env.example` documentado campo a campo (corrigido bug: a variável real
  é `DATA_ENCRYPTION_KEY`)

## "NotebookLM por conselheiro" (migration 0005)

- Home → seção **Conselheiros** → `/counselors/[id]`:
  - **Perfil editável** (nome + escopo → tabela `agent_profile`; aplicado
    ao registry vivo via `applyAgentProfileOverrides`)
  - **Fontes de conhecimento** (tabela `kb_source`, cifradas + auditadas):
    📄 texto colado · 🔗 link (download + extração de texto, com guarda
    anti-SSRF testada) · 📎 arquivo .txt/.md/.csv (até 2 MB)
  - **Aplicação AO VIVO**: cada mudança reconstrói o namespace do agente
    em memória (seed + fontes do banco) — sem reiniciar o servidor
- **Prova de fogo executada**: política "exposição máxima de caixa por SPE
  = 20% do VGV" ensinada pela UI foi citada pelo CFO na reunião simulada
  seguinte — RAG de ponta a ponta comprovado

## Estado dos gates (2026-07-07)

- **184 testes** PASS (+1 skip) · lint · typecheck · build — todos verdes
- Fluxos verificados no navegador: login próprio → reunião → board com
  Claude real → revisão → 9 relatórios → ensino de conhecimento → agente
  citando o conhecimento ensinado

## Pendências conhecidas (próximos passos)

1. Upload de **PDF/Word** direto no NotebookLM (extração via Claude —
   infraestrutura de visão/documento já mapeada)
2. Export dos relatórios (PDF/Word) e envio por e-mail
3. Middleware global de auth do Next (hoje: `getCurrentUser()` por página)
4. Deploy gerenciado (Fly.io/Railway/Render) quando o piloto local aprovar
5. Multi-tenant OU empacotamento "uma instância por cliente" para venda
6. Rotacionar a chave Anthropic usada nos testes antes de demo pública
