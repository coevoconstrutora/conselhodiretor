# Conselho — Estado do Projeto

> Board de 9 agentes de IA para reuniões de uma incorporadora imobiliária: transcrição ao
> vivo (Deepgram pt-BR), intervenções dos conselheiros durante a reunião e, ao final,
> 1 relatório por conselheiro + síntese executiva do Presidente. "A IA assiste, você decide."
> Stack: pnpm workspaces · Next.js 16 + React 19 + Tailwind 4 · TS strict · PGlite (dev) /
> Postgres+TLS (prod) · WS na mesma porta do HTTP em produção (BOARD_WS_MODE=attached).
> Derivado da arquitetura do NutriMed (auditada em 2026-07-06), com as dívidas conhecidas
> corrigidas na origem.

## Os 9 agentes + Secretária (slugs de `AgentId` em @conselho/providers)

`engenharia` · `vendas` · `mercado` · `arquitetura` · `legal` · `cs` · `cfo` · `futurista` ·
`presidente` (só sintetiza — não tem triggers). Perfis/escopos: `packages/kb/src/reasoner.ts`
(`DEFAULT_AGENT_PROFILES`). Triggers regex por agente: `packages/engines/src/triggers.ts`.
KB seed: `docs/agents-knowledge-seed.md` (seção `## <slug>` por agente; re-ingestão versionada).

`secretaria` (`SECRETARY_AGENT_ID`, Etapa "Secretária") — 10º papel, presente na reunião mas
sem KB própria e sem triggers (nunca opina/delibera ao vivo, fora do `BoardGatekeeper` e do
`relevanceRouter` — mesmo tratamento do Presidente em `packages/board/src/full-board.ts`).
Ao final, com a síntese do Presidente já pronta, redige a ATA
(`generateSecretaryMinutes`, `packages/meeting-report/src/reports.ts`) a partir da
transcrição + 8 relatórios + síntese — decisões tomadas, metas estabelecidas e ações a
realizar. Persistida na mesma tabela `agent_report` (`agent_id = 'secretaria'`), aba
dedicada "📝 Ata" em `/meetings/[id]` (fallback manual: `generateSecretaryMinutesAction`).
Excluída de tudo que trata "conselheiro" no sentido estrito: KB (`kb-sources.ts`),
experimentos de IA, Auto Configurador, seleção de conselheiros por tipo de reunião.

## Monorepo (17 pacotes)

```
apps/web                 login, lista de reuniões, SALA (board ao vivo + revisão + relatórios)
packages/shared-types    Protocolo WS v1 (WireAgentId, contribution/ping/transcript/status)
packages/crypto          AES-256-GCM (payload base64(iv‖tag‖ct))
packages/db              Migrations 0001–0004 · SqlExecutor COM .transaction() (client dedicado no pg)
packages/auth            scrypt + sessões DB-backed (hash SHA-256 do token)
packages/meetings        Reunião + GATE de gravação (default NEGA) — substitui o consent clínico
packages/audit           Trilha append-only (trigger no banco) · auditedClinicalWrite usa .transaction()
packages/providers       Interfaces NFR8 + fakes + stripJsonFences + BUSINESS_VOCABULARY (boost STT)
packages/stt-deepgram    Adapter Deepgram (keyterm/keywords) + timeout de handshake 15s
packages/llm-anthropic   Adapter Claude (Haiku) + AbortController 60s + erro 'network' tipado
packages/session         MeetingSession (retry/backoff exponencial)
packages/engines         triggers imobiliários + gate (rate por agente 1/min + GLOBAL 4/min) + dedup Jaccard
packages/kb              namespaces por agente + ingestão versionada + AgentReasoner
packages/board           FullBoardOrchestrator (8 conselheiros, presidente sintetiza, CaseState, case review)
packages/board-gateway   WS autenticado /board + /audio — COM handlers de error (socket e servidor)
packages/meeting-report  transcript persistido/revisado + sínteses + 8 relatórios + síntese do Presidente
packages/telemetry       custo/gate/latência + purgeExpired(TTL 24h)
```

Comandos: `pnpm lint` · `pnpm typecheck` · `pnpm test` · `pnpm build` · `pnpm dev` ·
`pnpm create-user -- --email ... --nome ... --senha ... [--desativar-demo]` (usuário dono;
rodar com o dev PARADO em dev local — PGlite é single-process).
Suíte: 389 testes PASS (+1 skip). Login demo (SÓ dev local — nunca seedado com
DATABASE_URL, salvo ALLOW_DEMO_LOGIN=true): `demo@conselho.test` / `conselho123`.

**Docs de produto (para revenda/instalação por terceiros):**
`docs/TUTORIAL.md` (instalação do zero) · `docs/GUIA-APIS.md` (gerar chaves
Anthropic/Deepgram + custos) · `docs/GUIA-CONHECIMENTO.md` (curadoria da KB por
conselheiro — o fosso do produto). `.env.example` documentado campo a campo
(variável real: DATA_ENCRYPTION_KEY).

**"NotebookLM por conselheiro" (migration 0005):** home → seção Conselheiros →
`/counselors/[id]`: editar perfil (nome/escopo → `agent_profile`, aplicado via
`applyAgentProfileOverrides` — muta AGENT_PROFILES compartilhado) e alimentar a
base com texto/link/arquivo (`kb_source`, cifrada+auditada). Toda mudança faz
rebuild AO VIVO do namespace (seed + fontes do banco) via
`apps/web/lib/kb-sources.ts` — sem restart. URL import tem guarda anti-SSRF
(`lib/text-extract.ts`, testado). Verificado ponta a ponta: política ensinada
pela UI ("20% do VGV por SPE") citada pelo CFO na reunião seguinte.

## Fluxo vivo

login → nova reunião → confirmar gravação (gate servidor, default NEGA) → `/meetings/[id]`:
transcrição AO VIVO + faixa dos 9 conselheiros + feed → "▶ Reunião simulada" (roteiro
imobiliário; NÃO persiste transcript) ou "🎙️ Reunião ao vivo" (mic → WS /audio → Deepgram;
transcript persistido cifrado) → contribuições auditadas com anti-repetição (histórico +
skip + dedup semântico + CaseState + case review 90s) → síntese do Presidente (auto/择demanda)
→ 📝 revisão do transcript → 📊 "Gerar relatórios do conselho" (8 relatórios em série +
síntese do Presidente + ata da Secretária; cifrados + auditados atomicamente; editáveis).

## Correções estruturais vs. NutriMed (aplicadas na origem)

- `SqlExecutor.transaction()` — no `pg`, client dedicado do Pool (BEGIN/COMMIT na MESMA
  conexão); `auditedClinicalWrite` usa isso e É usado pelos consumidores (meeting-report).
- Gateway WS: `wss.on('error')` + `socket.on('error')` — socket ruim não derruba o processo.
- `llm-anthropic`: AbortController com timeout 60s + falha de rede vira `AnthropicLlmError('network')`.
- `stt-deepgram`: timeout de handshake de 15s (WS pendurado vira erro de conexão).
- `runtime.active`: TTL de 2h pós-stop (`BOARD_ACTIVE_RETENTION_MS`) + `telemetry.purgeExpired()`.
- Rate-limit GLOBAL do board (4/min default) além do por agente (1/min) — 8 conselheiros
  sem teto global seriam ruído demais.

## Avisos operacionais (herdados do NutriMed — continuam valendo)

- **Next NÃO lê o `.env` da raiz** — keys de runtime em `apps/web/.env.local` (gitignored).
- **Mudou gateway/runtime/migrations? REINICIE o `pnpm dev`** — singletons em `globalThis`
  ignoram HMR; PGlite só aplica migration nova no boot.
- **"▶ Reunião simulada" NÃO persiste transcript** (de propósito).
- **WS em produção = MESMA porta do HTTP** — `BOARD_WS_MODE=attached` + `apps/web/server.mjs`.
  Dev local: `next dev` + gateway na 3001 (`BOARD_WS_MODE=port`, default).
- **Nunca usar heredoc bash com backticks/template literals** — escrever script e executar.

## Feito e verificado ao vivo (2026-07-06/07)

- ✅ Smoke test completo com ANTHROPIC_API_KEY real: reunião simulada → cards
  específicos de Legal/CFO/Vendas/Engenharia/Mercado → síntese do Presidente →
  9 relatórios finais gerados (bug de maxTokens 1500→4000 encontrado e corrigido).
- ✅ Autenticação do dono: `pnpm create-user` + demo nunca seedado em produção.
- ✅ NotebookLM por conselheiro: política ensinada via UI citada pelo CFO na
  reunião seguinte (RAG ponta a ponta comprovado).
- ✅ Layout corporativo navy + linguagem de prancha de engenharia.
- ✅ **LLM plugável de verdade**: novo `packages/llm-gemini` (Google Gemini) +
  factory única `apps/web/lib/llm.ts` — seleção por env (`LLM_PROVIDER` ou
  auto: GEMINI_API_KEY > ANTHROPIC_API_KEY > fake). Default do Gemini:
  `gemini-flash-latest` com **fallback automático de modelo** em 503/404
  (lição: gemini-2.5 foi aposentado pelo Google e virou 404) e
  `thinkingBudget: 0` nas respostas curtas do board (Gemini 3 "pensa" por
  default e estouraria maxOutputTokens baixos).
- Registro completo: `docs/HISTORICO.md`.

## Itens monitorados (Decisões/Ações, migration 0033)

`meeting_decision`/`meeting_action_item` ganharam `manually_edited boolean`
(ações também ganharam `status` de verdade: `pendente`/`concluida` — a
coluna já existia desde a 0026, mas nunca era lida/escrita). Dono edita
status direto nas abas Decisões/Ações da reunião
(`updateDecisionStatusAction`/`updateActionItemStatusAction`,
`apps/web/lib/decision-actions.ts`). Regenerar relatórios reextrai tudo do
zero (`saveMeetingOutcome`) — para não perder o que foi marcado à mão, cada
item novo é casado por similaridade Jaccard de keywords (`@conselho/engines`,
reaproveita a mesma lógica do dedup semântico do board) contra os itens já
editados manualmente daquela reunião; havendo casamento (score ≥ 0.5), o
status manual sobrevive em vez de ser sobrescrito pela extração nova. Sem
painel cross-reunião por enquanto — só dentro de cada reunião.

## Pendências

1. Teste com mic real (DEEPGRAM_API_KEY) — plumbing pronto, herdado testado do NutriMed.
2. Upload de PDF/Word no NotebookLM (extração via Claude — hoje: .txt/.md/.csv ou colar texto).
3. Enriquecer as bases via UI (/counselors) com conteúdo real do empresário.
4. Middleware global de auth do Next (hoje: `getCurrentUser()` manual por página, como no NutriMed).
5. 🔐 Rotacionar a ANTHROPIC_API_KEY usada nos testes (passou pelo chat) antes de demo pública.
~~Export dos relatórios (PDF/Word) e envio por e-mail~~ — feito (`report-export.ts` +
`email.ts`). ~~Deploy~~ — feito: app `conselho-diretor` já rodando em produção no Fly.io
(`conselho-diretor.fly.dev`). ~~"Resetar conselheiros"~~ — feito (`/counselors`,
`resetDefaultCounselorProfiles`, só isSuperAdmin).

**Área de custos (`/admin/costs`, só isSuperAdmin) — `apps/web/lib/costs/`:**
Anthropic (Usage & Cost Admin API — precisa de `ANTHROPIC_ADMIN_API_KEY`, chave Admin
SEPARADA da chave de chat) e OpenAI (Costs API — `OPENAI_ADMIN_API_KEY`, idem) trazem
custo REAL faturado. Deepgram (billing breakdown, reusa `DEEPGRAM_API_KEY`) idem.
Recall.ai só expõe MINUTOS de bot (`/api/v1/billing/usage/`), nunca US$ — o painel
estima (minutos × `RECALL_HOURLY_RATE_USD`). Fly.io NÃO tem NENHUMA API de
billing/fatura pública (confirmado em fly.io/docs/about/billing) — o painel estima
pelas máquinas ativas (Fly Machines API) × tarifa pública, sem banda/volumes/região
(`FLY_API_TOKEN`). Cada provedor sem a chave configurada aparece como "indisponível"
sem quebrar o resto do painel — nenhuma chave admin foi gerada/testada de verdade ainda
(pendência: validar com credenciais reais).
