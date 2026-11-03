# Plano — sair do Managed Postgres do Fly (MPG) para reduzir custo

> Status: **PLANO, nada executado.** Escrito em 2026-11-03 a partir da fatura do Fly de outubro/2026.

## 1. Por que

Fatura do mês passado: **US$ 53,34** (≈ 32 dias). Poucas reuniões, mas:

| Item | US$ | % |
|---|---|---|
| MPG Cluster (+ storage) | 41,49 | 78% |
| Máquinas (CPU + RAM extra) | 11,59 | 22% |
| Banda | 0,25 | <1% |

O cluster `conselho-diretor-db` (id `n83v7rgj96mr5gxk`, gru, PG 16, 4,9 GB usados de 20 GB alocados) já está
no plano **Basic**, o piso do MPG: preço fixo, 24/7, independe de uso. Não há como reduzi-lo.

## 2. Decisão: onde passa a morar o banco

| | Neon (SP, pago por uso) | VPS única (app + Postgres) | Ficar no MPG |
|---|---|---|---|
| Custo mensal estimado¹ | banco US$ 4–10 + Fly US$ ~12 = **US$ 16–22** | **US$ 7–9** (Hostinger KVM 2: R$ 33–39 promocional; renova mais caro) | US$ 53 |
| Operação | quase nenhuma (backup/PITR gerenciados) | **sua**: patches, firewall, TLS (Caddy), backup, restore testado, monitoramento, deploy | nenhuma |
| Disponibilidade | gerenciada; 1ª conexão após ocioso ~0,5–1 s | 1 máquina = ponto único de falha | HA incluído |
| Reversível? | sim (dump/restore) | sim, mas mais trabalho | — |
| Mudança no app | pequena (pool, ver §4) | média (compose + proxy + CI de deploy) | — |

¹ Estimativas. Neon Launch: US$ 0,106/CU-h + US$ 0,35/GB-mês, sem mínimo, suspende após 5 min ocioso
([neon.com](https://neon.com/pricing) — confirmar antes de contratar). Hostinger: valores de artigos de 2026, não da página
oficial; confirmar também **se há datacenter em São Paulo** (benchmarks mostram EUA).

**Recomendação:** Neon. A diferença para a VPS é ~US$ 10/mês; em troca, você não vira o DBA/SRE de dados de
diretoria (transcrições, ata). A VPS só compensa se já houver alguém na Coevo que opere servidores com rotina de
backup. As fases 1–3 e 5 abaixo servem para os dois destinos; muda só a Fase 0 e a string de conexão.

## 3. Pré-requisitos (o que preciso de você)

- Conta Neon com cartão (cobrança pelo seu usuário) e um projeto **PG 16**, região **aws-sa-east-1 (São Paulo)**, plano Launch.
  Defina **limite de compute 0,25–1 CU** e um alerta de gasto mensal.
- Credenciais do MPG (para o dump). `fly mpg proxy` abre túnel local; o usuário/senha vêm de `fly mpg users`/painel.
  **Hoje o `DATABASE_URL` do Fly é secret e não dá para ler** — anote a string atual do MPG antes do corte (rollback).
- Cliente Postgres **16 ou superior** no seu PC (`pg_dump`, `pg_restore`, `psql`) — **não está instalado**.
  Opção sem instalar nada: `docker run --rm postgres:17 pg_dump …` se houver Docker.
- `DATA_ENCRYPTION_KEY` de produção só será necessária se quiser validar descriptografia localmente
  (vai em `apps/web/.env.local`, gitignored). Alternativa: validar só no smoke test do corte.

## 4. Riscos encontrados no código (tratar ANTES do corte)

1. **`Pool` sem handler de erro** — `packages/db/src/pg-executor.ts:57`. Quando o servidor derruba uma conexão
   ociosa (suspend do Neon, restart do banco), o `pg` emite `'error'` no pool; sem listener isso é exceção não tratada e
   **derruba o processo Node (e as reuniões ao vivo)**. É risco hoje também, no MPG. Correção:
   `pool.on('error', log)`, `idleTimeoutMillis ≈ 30s`, `connectionTimeoutMillis ≈ 15s` (cobre cold start),
   `keepAlive: true`, `max` pequeno (5–10; app é instância única).
2. **Conexão direta, não pooler.** Usar o endpoint *direct* do Neon (sem `-pooler`): o app usa `BEGIN/COMMIT` em client
   dedicado e migrations multi-statement; PgBouncer em modo transação não traz ganho com 1 instância.
3. **Query string do Neon.** Remover `channel_binding=require` da `DATABASE_URL` (o `pg` pode não negociar) e manter
   `sslmode=require`. O certificado do Neon é de CA pública, então o `rejectUnauthorized: true` de
   `packages/db/src/connection.ts` funciona sem mudança.
4. **O banco precisa ficar ocioso para a economia existir.** Se algo consultar o banco a cada poucos minutos, o
   compute nunca suspende (0,25 CU 24/7 ≈ US$ 19/mês — mais caro que o ganho). Revisado: o health check `/login` é
   página cliente (sem banco), `telemetry.purgeExpired` é em memória, heartbeat do gateway é só WS. **Validar no
   staging** observando "active time" do compute no console do Neon durante 1 dia sem reunião.
5. **Extensões:** não há `CREATE EXTENSION` nas migrations (cosseno de voz em JS puro, sem pgvector). Confirmar com
   `\dx` no MPG. `gen_random_uuid` é nativo no PG ≥ 13.
6. **Trilha de auditoria append-only** é trigger no banco: `pg_dump` leva trigger e função, mas **testar depois do
   restore** (um `UPDATE` em tabela de auditoria deve falhar).
7. **4,9 GB** é o uso do cluster (WAL, índices, todos os bancos). Medir `pg_database_size` e o tamanho por tabela no
   dump; se o lógico for bem menor, o storage no Neon custa menos que US$ 1,72.

## 5. Fases

**Fase 0 — Endurecer o pool (sem trocar de banco).** Implementar o item 1 de §4 + teste; `pnpm lint typecheck test`;
deploy no Fly ainda apontando para o MPG. Benefício imediato, risco baixo.

**Fase 1 — Medir e ensaiar o dump.** `fly mpg proxy` → `pg_dump -Fc --no-owner --no-acl` para arquivo local (guardar
**cifrado e fora do repo**: contém dados de diretoria). Registrar tamanhos, contagem de linhas por tabela, `\dx`,
versão do PG.

**Fase 2 — Restore em banco de teste do Neon e validação.** `pg_restore --no-owner --no-acl` em um *branch/banco de
teste*. Comparar contagem de linhas por tabela com a origem; testar o trigger de auditoria; rodar o app local com
`DATABASE_URL` do teste: login, abrir reunião, ler transcrição (prova que a chave de criptografia bate), gerar relatório
curto. Medir cold start (esperar 5+ min, fazer 1ª requisição). Observar 1 dia se o compute suspende.

**Fase 3 — Corte (janela de 10–20 min, fora de horário, sem reunião e sem bot do Recall ativo).**
1. Avisar usuários. Anotar `DATABASE_URL` atual do MPG.
2. Parar a máquina do app (`fly machine stop`) para congelar escritas.
3. `pg_dump` final → restore em banco **novo** do Neon (descartar o de teste).
4. Comparar contagem de linhas origem × destino.
5. `fly secrets set DATABASE_URL=<neon direct>` (reinicia o app).
6. Smoke test: login, lista de reuniões, abrir reunião antiga (transcrição legível), reunião nova com transcrição
   gravando, gerar relatórios, exportar PPTX, trigger de auditoria.

**Fase 4 — Rollback.** Antes de ~1 h de uso: `fly secrets set DATABASE_URL=<MPG antigo>`. Depois disso, escritas feitas
no Neon se perderiam; nesse caso é dump do Neon → restore no MPG. Por isso o MPG **fica de pé 7 dias** após o corte.

**Fase 5 — Descomissionar (só com sua confirmação explícita; irreversível).**
Após 7 dias estáveis: guardar um último dump cifrado, `fly mpg destroy n83v7rgj96mr5gxk`, remover máquinas paradas
(2 em `conselho-diretor`, 2 em `conselho-voice-embed`). Configurar PITR do Neon (7 dias, se disponível no plano)
e, opcionalmente, um `pg_dump` semanal para fora do Neon (backup no mesmo fornecedor não é backup completo).

## 5b. Hibernação do app (noites, fins de semana, dias sem reunião)

Decisão do dono: não precisa ficar ligado 24/7. **Em vez de horário fixo (22h–7h, sem fins de semana), usar parada
por ociosidade** do próprio Fly: cobre noites, fins de semana e dias vazios sem cron externo, e nunca derruba uma
reunião às 22h30 porque o relógio mandou. O Neon já faz isso sozinho (suspende após 5 min sem consultas).

Mudança em `fly.toml` (`[http_service]`): `auto_stop_machines = "stop"`, `auto_start_machines = true`,
`min_machines_running = 0`; remover o comentário que justifica `auto_stop_machines=false`.

Verificado no código: nada roda sozinho com o app parado. O bot do Recall é criado por ação do usuário
(`recall-actions.ts`, sem entrada agendada), o webhook `/api/recall-webhook` é best-effort (responde 200 até em erro; a
conexão do Recall acorda a máquina via `auto_start`), o ticker do board só existe durante a reunião, o health check do
Fly não conta como tráfego. Único requisito de estar acordado é reunião ao vivo — e WebSocket aberto
(`/board`, `/audio`, `/recall-media`, heartbeat de 30 s) mantém a máquina viva.

**Riscos / a validar antes de confiar:**
1. Reunião com silêncio longo: abrir uma reunião de teste, ficar 15 min sem falar, confirmar que a máquina não parou.
   (O comentário atual do `fly.toml` indica que isso já preocupou; não foi medido.) Rollback: voltar `min_machines_running = 1`.
2. Cold start após parada: boot do Next + warm-up do board (`instrumentation.ts`) + migrations. Medir; a 1ª pessoa
   da manhã espera alguns segundos. Testar `"suspend"` (retoma mais rápido e preserva memória) como alternativa.
3. Estado em memória (board/CaseState de reuniões em andamento) se perde se a máquina parar — só ocorre sem conexões
   abertas, então reuniões ativas não são afetadas.
4. Máquina parada ainda cobra o rootfs (centavos).

Custo esperado do app com parada por ociosidade: **~US$ 0,5–2/mês** (vs ~US$ 6 hoje). Total com Neon: **~US$ 2–8/mês**.

## 6. Depois

- Atualizar `/admin/costs` (`apps/web/lib/costs/`): hoje o painel não vê o MPG nem o app `conselho-voice-embed`
  (ver memória do projeto) e passará a não ver o Neon. Adicionar Neon (API de consumo) ou, no mínimo, nota na tela.
- Atualizar `CLAUDE.md` (Postgres+TLS em Neon), `docs/TUTORIAL.md` (passo de `DATABASE_URL`) e `docs/HISTORICO.md`.
- Opcional, ganho menor: app de 1 GB → 512 MB (~US$ 1,80/mês) **após** medir o pico real de memória (painel Metrics do Fly).
- Investigar por que as máquinas custaram ~2× o esperado (US$ 11,59 vs ~US$ 6 de uma máquina 1 GB 24/7): Cost Explorer
  filtrado por app.

## 7. Critérios de pronto

- Fatura do Fly sem MPG; custo total mensal (Fly + banco) < US$ 25.
- Compute do banco suspende quando não há reunião (verificado no console).
- Nenhum crash por conexão derrubada (log do pool) após 1 semana.
- Backup restaurado com sucesso pelo menos uma vez em ambiente de teste.
