# 🚀 Tutorial completo — do zero ao Conselho rodando na sua máquina

Este guia leva você **do computador vazio até o sistema funcionando**, passo a
passo, sem assumir conhecimento prévio. Ao final você terá:

- ✅ O sistema rodando na sua máquina (`http://localhost:3000`)
- ✅ Seu próprio usuário e senha (dono do sistema)
- ✅ Os 9 conselheiros de IA respondendo de verdade nas suas reuniões
- ✅ Transcrição ao vivo pelo microfone
- ✅ Relatórios finais gerados por reunião

**Tempo estimado:** 30–45 minutos (a maior parte é criar as contas de API).

---

## Índice

1. [Pré-requisitos (instalar uma única vez)](#1-pré-requisitos)
2. [Baixar o projeto](#2-baixar-o-projeto)
3. [Instalar as dependências](#3-instalar-as-dependências)
4. [Configurar as chaves (arquivo .env.local)](#4-configurar-as-chaves)
5. [Criar o SEU usuário](#5-criar-o-seu-usuário)
6. [Rodar o sistema](#6-rodar-o-sistema)
7. [Primeiro uso — passo a passo na tela](#7-primeiro-uso)
8. [Reunião ao vivo com microfone](#8-reunião-ao-vivo-com-microfone)
9. [Colocar em produção (opcional)](#9-produção)
10. [Problemas comuns e soluções](#10-problemas-comuns)

---

## 1. Pré-requisitos

Você precisa de 3 programas instalados. Se já tem, pule para o passo 2.

### 1.1 Node.js (versão 20 ou superior)

O motor JavaScript que roda o sistema.

- Baixe em: **https://nodejs.org** → botão **LTS** (versão recomendada)
- Instale com as opções padrão (next, next, finish)
- Confira no terminal: `node --version` → deve mostrar `v20.x` ou maior

> **Windows:** use o terminal "PowerShell" ou "Prompt de Comando".
> **Mac:** use o app "Terminal".

### 1.2 pnpm (gerenciador de pacotes)

Depois de instalar o Node, rode no terminal:

```bash
npm install -g pnpm
```

Confira: `pnpm --version` → deve mostrar `10.x` ou maior.

### 1.3 Git

Para baixar o código.

- Baixe em: **https://git-scm.com/downloads** e instale com as opções padrão
- Confira: `git --version`

---

## 2. Baixar o projeto

No terminal, navegue até a pasta onde quer guardar o projeto e clone:

```bash
git clone <URL-DO-SEU-REPOSITORIO> conselho
cd conselho
```

> Substitua `<URL-DO-SEU-REPOSITORIO>` pela URL do seu repositório Git
> (ex.: `https://github.com/sua-conta/conselho.git`). Se você recebeu o
> projeto como um arquivo .zip, extraia e abra o terminal dentro da pasta.

---

## 3. Instalar as dependências

Dentro da pasta do projeto:

```bash
pnpm install
```

Isso baixa tudo o que o sistema precisa (leva 2–5 minutos na primeira vez).

**Teste rápido de sanidade** (opcional, mas recomendado):

```bash
pnpm test
```

Deve terminar com todos os testes passando (`178 passed`). Se passou, o
sistema está íntegro na sua máquina.

---

## 4. Configurar as chaves

O sistema usa dois serviços externos de IA:

| Serviço | Para quê | Obrigatório? |
|---|---|---|
| **Anthropic (Claude)** | O cérebro dos 9 conselheiros | Sem ele, roda em modo demonstração (respostas de exemplo) |
| **Deepgram** | Transcrição de voz em tempo real | Só para reunião com microfone real |

### 4.1 Gere as chaves

Siga o guia dedicado: **[docs/GUIA-APIS.md](GUIA-APIS.md)** — ele mostra,
tela a tela, como criar as contas e gerar as duas chaves (10–15 min).

### 4.2 Crie o arquivo de configuração

Na raiz do projeto:

```bash
# Windows (PowerShell)
Copy-Item .env.example apps/web/.env.local

# Mac/Linux
cp .env.example apps/web/.env.local
```

> ⚠️ **Atenção ao caminho**: o arquivo vai em `apps/web/.env.local` —
> o sistema NÃO lê um `.env` na raiz do projeto.

### 4.3 Preencha o arquivo

Abra `apps/web/.env.local` em qualquer editor de texto e preencha:

```bash
# Gere esta chave rodando no terminal:
# node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
DATA_ENCRYPTION_KEY=cole_aqui_o_resultado_do_comando_acima

ANTHROPIC_API_KEY=sk-ant-api03-...   # do guia de APIs
DEEPGRAM_API_KEY=...                 # do guia de APIs (opcional no início)
```

> 🔐 Este arquivo **nunca** entra no Git (já está no `.gitignore`).
> Guarde a `DATA_ENCRYPTION_KEY` num lugar seguro: ela cifra todos os dados
> das suas reuniões — se perdê-la, os dados ficam ilegíveis para sempre.

---

## 5. Criar o SEU usuário

Em desenvolvimento local existe um usuário demo (`demo@conselho.test` /
`conselho123`) para experimentar. Para ter o **seu** acesso:

> ⚠️ Rode este comando com o sistema **parado** (se o `pnpm dev` estiver
> rodando, dê `Ctrl+C` antes). O banco local é de processo único — o
> servidor só enxerga o usuário novo depois de reiniciar.

```bash
pnpm create-user -- --email voce@suaempresa.com.br --nome "Seu Nome" --senha "UmaSenhaForte123" --desativar-demo
```

- `--desativar-demo` desliga o login demo (recomendado quando o sistema é seu)
- Para **trocar a senha** depois, rode o mesmo comando com a senha nova
  (e-mail existente = atualização)

> Em **produção** o usuário demo nunca é criado automaticamente — este
> comando é a única forma de criar o primeiro acesso, por segurança.

---

## 6. Rodar o sistema

```bash
pnpm dev
```

Aguarde a mensagem `✓ Ready` e abra no navegador:

**http://localhost:3000**

Faça login com o usuário que você criou no passo 5.

> Para parar o sistema: `Ctrl+C` no terminal.
> ⚠️ Se você editar arquivos de configuração/migrations com o sistema
> rodando, **reinicie** (`Ctrl+C` e `pnpm dev` de novo).

---

## 7. Primeiro uso

Siga esta sequência na tela para conhecer o fluxo completo:

1. **+ Nova reunião** → dê um título (ex.: "Reunião de diretoria — teste")
2. **Confirmar gravação** → o botão azul confirma que os participantes
   autorizaram a gravação (nada é capturado antes disso — proteção de servidor)
3. **▶ Reunião simulada** → roda um roteiro fictício de reunião de
   incorporadora (obra atrasada, ação judicial, queda de vendas, MCMV).
   Observe:
   - A **transcrição** aparecendo ao vivo no painel central
   - Os **conselheiros** acendendo ("● falando") na faixa superior
   - Os **cards** no Feed de Sugestões — cada especialista aponta riscos do
     seu escopo
   - A **síntese do Presidente** consolidando (automática na pausa, ou
     clique em "📋 Síntese do Presidente")
4. **📝 Transcrição da reunião** → revise/corrija o texto (é dele que os
   relatórios nascem) e salve
5. **📊 Gerar relatórios do conselho** → aguarde ~1–2 min: são 9 gerações
   (um relatório por conselheiro + a síntese executiva do Presidente).
   Cada um é um rascunho editável — ajuste e salve.

**Pronto — esse é o produto.** Repare no rodapé de tudo: *"a decisão é sua"*
— o sistema assiste, o dono decide.

---

## 8. Reunião ao vivo com microfone

Requisitos: `DEEPGRAM_API_KEY` configurada (passo 4) e um microfone.

1. Abra uma reunião com gravação confirmada
2. Clique em **🎙️ Reunião ao vivo**
3. O navegador vai pedir permissão de microfone → **Permitir**
4. Fale normalmente — a transcrição aparece em tempo real e os conselheiros
   reagem ao que é dito
5. Ao terminar, clique em **⏹ Encerrar**

> Dica: fale termos do setor ("fluxo de caixa", "registro de incorporação",
> "VSO", "MCMV") — são os gatilhos que acordam cada conselheiro.
> A transcrição fica salva (cifrada) mesmo se o servidor reiniciar no meio.

---

## 9. Produção

Para usar fora da sua máquina (acessar do escritório, celular etc.):

**Checklist mínimo de produção:**

- [ ] Um Postgres gerenciado com TLS (ex.: [Neon](https://neon.tech) — tem
      plano gratuito) → configure `DATABASE_URL`
- [ ] `DATA_ENCRYPTION_KEY` forte, gerada nova, guardada em cofre de senhas
- [ ] Crie seu usuário no banco de produção:
      `DATABASE_URL=... pnpm create-user -- --email ... --nome ... --senha ...`
- [ ] `BOARD_WS_MODE=attached` e o servidor iniciado via
      `node apps/web/server.mjs` (WebSocket na mesma porta do HTTP — evita
      bloqueio de portas em redes corporativas)
- [ ] `NUNCA` defina `ALLOW_DEMO_LOGIN=true` em produção
- [ ] HTTPS obrigatório (o provedor de hospedagem resolve — Fly.io, Railway,
      Render etc.)

O projeto builda com `pnpm build` e está pronto para qualquer host Node 20+.

---

## 10. Problemas comuns

| Sintoma | Causa provável | Solução |
|---|---|---|
| "Credenciais inválidas" no login | Usuário não existe neste banco | Rode `pnpm create-user ...` (cada banco — dev/produção — tem seus usuários) |
| Conselheiros respondem "[legal] resposta determinística..." | `ANTHROPIC_API_KEY` ausente | Preencha em `apps/web/.env.local` e **reinicie** o `pnpm dev` |
| "O serviço de transcrição não está configurado" | `DEEPGRAM_API_KEY` ausente | Idem acima — e use "▶ Reunião simulada" enquanto isso |
| Mudei o `.env.local` e nada aconteceu | Next só lê env no boot | `Ctrl+C` e `pnpm dev` de novo |
| Porta 3000 ocupada | Outro programa usando | Feche o outro programa, ou `PORT=3001 pnpm dev` |
| Erro `EPERM`/permissão no Windows | Antivírus ou terminal sem permissão | Rode o terminal como usuário normal (não precisa admin) e adicione a pasta à exclusão do antivírus |
| "Sem transcrição nesta sessão" ao gerar relatório | Reunião simulada não persiste transcript (proposital) | Use a reunião ao vivo (mic), ou revise/salve a transcrição manualmente antes |
| Relatórios falham com erro de JSON | Resposta da IA truncada (raro) | Clique em "Regenerar relatórios" — o sistema tenta de novo |

---

## Próximos passos

- **[docs/GUIA-APIS.md](GUIA-APIS.md)** — criar as contas e chaves de API
- **[docs/GUIA-CONHECIMENTO.md](GUIA-CONHECIMENTO.md)** — aprimorar o
  conhecimento de cada conselheiro (é aqui que o sistema vira **seu**:
  o diferencial competitivo é a base de conhecimento que você curar)
