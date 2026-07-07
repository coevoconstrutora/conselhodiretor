# 🔑 Guia passo a passo — gerando as chaves de API

O Conselho usa dois serviços de IA. Este guia mostra como criar as contas,
gerar as chaves e quanto isso custa. **Tempo total: 10–15 minutos.**

| Serviço | Função no sistema | Custo típico |
|---|---|---|
| **Anthropic (Claude)** | O cérebro dos 9 conselheiros e dos relatórios | Centavos de dólar por reunião |
| **Deepgram** | Transcrição de voz em tempo real (pt-BR) | ~US$ 0,006 por minuto de áudio |

> 💡 Uma reunião de 1 hora custa, somando tudo, tipicamente **menos de
> US$ 1,00**. O painel de Telemetria dentro do sistema mostra o custo real
> de cada reunião.

---

## Parte 1 — Anthropic (Claude)

### 1.1 Criar a conta

1. Acesse **https://console.anthropic.com**
2. Clique em **Sign Up** e crie a conta (e-mail ou Google)
3. Confirme o e-mail de verificação

### 1.2 Adicionar créditos

A API é pré-paga (você deposita um valor e ele vai sendo consumido):

1. No console, abra **Settings → Billing** (menu da engrenagem)
2. Clique em **Add credits** e adicione o valor inicial
   (**US$ 5 já dura semanas** de uso normal — o modelo usado, Claude Haiku,
   é o mais barato da linha)
3. Cadastre um cartão de crédito internacional

### 1.3 Gerar a chave

1. No menu lateral, abra **API Keys**
2. Clique em **Create Key**
3. Dê um nome identificável (ex.: `conselho-producao`)
4. **Copie a chave imediatamente** — ela começa com `sk-ant-api03-...` e
   **só é exibida uma vez**
5. Cole no seu `apps/web/.env.local`:

```bash
ANTHROPIC_API_KEY=sk-ant-api03-SUACHAVEAQUI
```

### 1.4 (Recomendado) Definir um limite de gastos

Em **Settings → Limits**, defina um teto mensal (ex.: US$ 25). Se algo
sair do esperado, o gasto para automaticamente nesse valor.

---

## Parte 2 — Deepgram (transcrição de voz)

### 2.1 Criar a conta

1. Acesse **https://console.deepgram.com**
2. Clique em **Sign Up** (e-mail, Google ou GitHub)
3. Confirme o e-mail

> 🎁 Na criação da conta a Deepgram dá **US$ 200 de crédito gratuito** —
> isso equivale a mais de **500 horas** de transcrição antes de pagar
> qualquer coisa.

### 2.2 Gerar a chave

1. No console, menu lateral → **API Keys**
2. Clique em **Create a New API Key**
3. Nome: `conselho` · Permissão: **Member** é suficiente
4. **Copie a chave** (também só aparece uma vez)
5. Cole no seu `apps/web/.env.local`:

```bash
DEEPGRAM_API_KEY=SUACHAVEAQUI
```

### 2.3 Modelo usado

O sistema usa o modelo **Nova** da Deepgram com boost de vocabulário do
setor imobiliário (VGV, MCMV, INCC, habite-se, registro de incorporação…)
já embarcado — nada a configurar.

---

## Parte 3 — Chave de criptografia (gerada por você, sem conta)

Os dados das reuniões são cifrados em repouso com uma chave **sua**, que
nunca sai da sua máquina/servidor. Gere no terminal:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

Cole o resultado no `.env.local`:

```bash
DATA_ENCRYPTION_KEY=resultado_do_comando_acima
```

> 🔐 **Guarde uma cópia num cofre de senhas** (1Password, Bitwarden…).
> Sem esta chave, os dados cifrados são irrecuperáveis — por design.

---

## Segurança das chaves — regras de ouro

1. **Nunca** compartilhe uma chave por e-mail, WhatsApp ou chat — quem tem a
   chave gasta na sua conta
2. **Nunca** commite o `.env.local` no Git (o projeto já bloqueia isso via
   `.gitignore` — não remova)
3. Se uma chave vazar (ou você suspeitar): **revogue no console** do
   provedor (botão delete/revoke ao lado da chave) e gere outra — leva 1 min
4. Ao vender/instalar o sistema para um cliente, **cada cliente cria as
   próprias contas e chaves** — o custo de IA fica na conta dele, e um
   cliente nunca tem acesso ao consumo do outro
5. Defina limites de gasto (passo 1.4) em toda conta de produção

## Verificando se funcionou

Com as chaves no `.env.local`, reinicie o sistema (`Ctrl+C` → `pnpm dev`) e:

1. Abra uma reunião → painel **🩺 Diagnóstico** (no fim da página)
2. Deve mostrar: `IA do board configurada (servidor) ✓` e
   `Deepgram configurado ✓`
3. Rode **▶ Reunião simulada** — se os cards vierem com análises em
   português natural (e não "[legal] resposta determinística..."), o Claude
   está ativo
