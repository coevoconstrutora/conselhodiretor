# Conselho — Estado do Projeto

> Board de 9 agentes de IA para reuniões de uma incorporadora imobiliária: transcrição ao
> vivo (Deepgram pt-BR), intervenções dos conselheiros durante a reunião e, ao final,
> 1 relatório por conselheiro + síntese executiva do Presidente. "A IA assiste, você decide."
> Stack: pnpm workspaces · Next.js 16 + React 19 + Tailwind 4 · TS strict · PGlite (dev) /
> Postgres+TLS (prod) · WS na mesma porta do HTTP em produção (BOARD_WS_MODE=attached).
> Derivado da arquitetura do NutriMed (auditada em 2026-07-06), com as dívidas conhecidas
> corrigidas na origem.

## Os 9 agentes (slugs de `AgentId` em @conselho/providers)

`engenharia` · `vendas` · `mercado` · `arquitetura` · `legal` · `cs` · `cfo` · `futurista` ·
`presidente` (só sintetiza — não tem triggers). Perfis/escopos: `packages/kb/src/reasoner.ts`
(`AGENT_PROFILES`). Triggers regex por agente: `packages/engines/src/triggers.ts`.
KB seed: `docs/agents-knowledge-seed.md` (seção `## <slug>` por agente; re-ingestão versionada).

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
Suíte: 178 testes PASS (+1 skip). Login demo (SÓ dev local — nunca seedado com
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
síntese do Presidente; cifrados + auditados atomicamente; editáveis).

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
- Registro completo: `docs/HISTORICO.md`.

## Pendências

1. Teste com mic real (DEEPGRAM_API_KEY) — plumbing pronto, herdado testado do NutriMed.
2. Upload de PDF/Word no NotebookLM (extração via Claude — hoje: .txt/.md/.csv ou colar texto).
3. Enriquecer as bases via UI (/counselors) com conteúdo real do empresário.
4. Middleware global de auth do Next (hoje: `getCurrentUser()` manual por página, como no NutriMed).
5. Export dos relatórios (PDF/Word) e envio por e-mail.
6. Deploy (Fly.io/outro) quando o empresário aprovar o piloto local.
7. 🔐 Rotacionar a ANTHROPIC_API_KEY usada nos testes (passou pelo chat) antes de demo pública.
