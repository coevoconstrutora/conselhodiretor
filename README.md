# Conselho

Board de **9 agentes de IA especialistas** que assiste reuniões empresariais ao vivo
(incorporação imobiliária): transcrição em tempo real, intervenções durante a reunião
(perguntas, sugestões, análises e alertas de risco) e, ao final, **um relatório por
conselheiro + a síntese executiva do Presidente do Conselho**.

> A IA assiste — a decisão é sempre do empresário. Todo output é rascunho revisável,
> cifrado em repouso (AES-256-GCM) e auditado (trilha append-only).

## Os 9 conselheiros

| Agente | Escopo |
|---|---|
| Engenharia e Lean Construction | custos/prazos de obra, método construtivo, produtividade |
| Vendas e Marketing | funil, VSO, campanhas, distratos |
| Inteligência de Mercado e Produto | concorrência, demanda, tipologia, precificação |
| Arquitetura e Urbanismo | projeto, aprovações, zoneamento, potencial construtivo |
| Legal e Compliance | contratos, registro de incorporação, riscos jurídicos |
| Customer Success e Pós-venda | entrega, assistência técnica, NPS |
| CFO — Funding, Caixa e MCMV | fluxo de caixa, funding, viabilidade, MCMV |
| Futurista | tendências, tecnologia, cenários de longo prazo |
| **Presidente do Conselho** | **sintetiza**, expõe divergências, modera |

## "NotebookLM" de cada conselheiro

Na home, a seção **Conselheiros** abre a página de gestão de cada agente
(`/counselors/<agente>`), onde o dono — sem programar e sem reiniciar nada:

- **edita o perfil** (nome + escopo, que vira regra rígida no prompt);
- **alimenta a base de conhecimento** com 📄 texto colado, 🔗 links (o
  sistema baixa e extrai o texto) e 📎 arquivos `.txt`/`.md`/`.csv`;
- **remove fontes obsoletas**.

Tudo cifrado em repouso, auditado e **aplicado ao vivo**: a próxima
contribuição do conselheiro já consulta o material novo. Cada agente tem um
namespace isolado — o Legal nunca lê o caderno do CFO. Guia de curadoria:
[docs/GUIA-CONHECIMENTO.md](docs/GUIA-CONHECIMENTO.md).

## Stack

pnpm workspaces · Next.js 16 + React 19 + Tailwind 4 · TypeScript strict ·
PGlite (dev) / Postgres+TLS (prod) · WebSocket (mesma porta do HTTP em produção) ·
Deepgram (STT pt-BR com boost de vocabulário imobiliário) · Claude (Anthropic) · Vitest.

## Arquitetura (herdada e endurecida do NutriMed)

```
Áudio (mic) → WS /audio → Deepgram (STT streaming pt-BR)
  → MeetingSession (acúmulo + retry/backoff, transcript persistido cifrado)
  → TriggerDetector (regex por agente, zero LLM)
  → BoardGatekeeper (score → dedup → pausa natural → rate-limit por agente + teto global)
  → AgentReasoner (KB por namespace do agente + Claude)
  → dedup semântico (Jaccard, reunião inteira, pré e pós-LLM)
  → auditoria (append-only, trigger de banco) → WS /board → feed na sala
  → Presidente sintetiza (automático em pausa ou sob demanda)

Ao encerrar: revisão do transcript pelo empresário →
  8 relatórios (1 por conselheiro) + síntese executiva do Presidente,
  todos cifrados + auditados ATOMICAMENTE, editáveis na UI.
```

Correções estruturais aplicadas desde o dia 1 (achados da auditoria do NutriMed):
`SqlExecutor.transaction()` com client dedicado do pool (escrita+auditoria atômicas de verdade),
handlers de `error` no gateway WS, timeout/AbortController nos adapters de LLM e STT,
TTL de retenção no runtime e na telemetria (sem vazamento de memória), rate-limit global do board.

## Rodando

> 📖 **Nunca instalou? Comece pelo [tutorial completo](docs/TUTORIAL.md)** —
> do computador vazio ao sistema rodando, passo a passo, sem conhecimento prévio.

```bash
pnpm install
cp .env.example apps/web/.env.local   # preencher DATA_ENCRYPTION_KEY (+ ANTHROPIC/DEEPGRAM p/ modo real)
pnpm dev                              # http://localhost:3000
```

Login demo (só em dev local): `demo@conselho.test` / `conselho123`.
Criar o SEU usuário (obrigatório em produção — o demo nunca é criado lá):

```bash
pnpm create-user -- --email voce@empresa.com --nome "Seu Nome" --senha "SenhaForte123" --desativar-demo
```

Fluxo: nova reunião → confirmar gravação (gate de servidor, default NEGA) →
**▶ Reunião simulada** (roteiro que dispara vários conselheiros; não persiste transcript)
ou **🎙️ Reunião ao vivo** (mic real; transcript persistido cifrado) → cards no feed →
síntese do Presidente → revisar transcrição → **📊 Gerar relatórios do conselho**.

## Documentação

| Guia | Para quê |
|---|---|
| **[docs/TUTORIAL.md](docs/TUTORIAL.md)** | Instalação completa do zero (pré-requisitos → produção) |
| **[docs/GUIA-APIS.md](docs/GUIA-APIS.md)** | Criar as contas e gerar as chaves (Anthropic + Deepgram), custos |
| **[docs/GUIA-CONHECIMENTO.md](docs/GUIA-CONHECIMENTO.md)** | Aprimorar o conhecimento de cada conselheiro (o fosso do produto) |
| **[docs/HISTORICO.md](docs/HISTORICO.md)** | Registro consolidado de tudo que foi construído e verificado |

## Comandos

| Comando | |
|---|---|
| `pnpm dev` | app web em desenvolvimento |
| `pnpm create-user -- --email ... --nome ... --senha ...` | cria/atualiza o usuário dono (e `--desativar-demo`) |
| `pnpm lint` / `pnpm typecheck` / `pnpm test` / `pnpm build` | gates de qualidade |

## Base de conhecimento

`docs/agents-knowledge-seed.md` — uma seção `## <slug>` por conselheiro. Enriquecer o
conteúdo = re-ingestão versionada no boot; sem mudança de código.
Guia completo: [docs/GUIA-CONHECIMENTO.md](docs/GUIA-CONHECIMENTO.md).
