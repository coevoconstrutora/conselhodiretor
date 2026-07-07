# 🧠 Guia — aprimorando o conhecimento de cada conselheiro

O que diferencia o SEU Conselho de qualquer chatbot genérico é a **base de
conhecimento curada** que cada especialista consulta antes de falar. Este
guia ensina a alimentá-la, ajustá-la e testá-la — **sem programar**.

> **Este é o seu fosso competitivo.** O código qualquer um copia; o
> conhecimento que você acumula aqui (números do seu mercado, políticas da
> sua empresa, lições das suas obras) é o que ninguém tem.

## ⚡ O jeito fácil: pela própria interface (recomendado)

Na página inicial do sistema há a seção **Conselheiros**: clique em qualquer
um deles para abrir o "caderno" dele (`/counselors/<agente>`). Lá você pode,
**sem tocar em código e sem reiniciar nada**:

- **Editar o perfil** — nome exibido e escopo (o que ele pode/não pode
  opinar; vira regra no prompt)
- **📄 Colar texto** — políticas internas, lições, números (1 fato por linha)
- **🔗 Importar link** — o sistema baixa a página e extrai o texto
- **📎 Enviar arquivo** — `.txt`, `.md` ou `.csv` (até 2 MB)
- **🗑 Remover fontes** que ficaram obsoletas

Tudo é **cifrado em repouso, auditado e aplicado ao vivo**: a próxima
contribuição do conselheiro já consulta o material novo. O restante deste
guia explica como o mecanismo funciona por dentro e como escrever conteúdo
que gera boas sugestões — as regras de escrita valem igual para a interface.

---

## Como funciona (2 minutos de teoria)

1. Cada conselheiro tem um **"caderno" exclusivo** (namespace isolado):
   o Legal nunca lê o caderno do CFO, e vice-versa. Isso impede um
   especialista de "opinar" fora da sua área.
2. Quando um assunto surge na reunião, o sistema busca **só no caderno
   daquele especialista** os trechos mais relevantes e entrega ao modelo de
   IA como contexto.
3. Cada resposta registra na auditoria **quais trechos foram usados**
   (proveniência) — você sempre sabe de onde veio uma sugestão.

O conteúdo dos cadernos vive num único arquivo:

```
docs/agents-knowledge-seed.md
```

É Markdown simples. Cada seção `## slug` é o caderno de um conselheiro:

| Seção no arquivo | Conselheiro |
|---|---|
| `## engenharia` | Engenharia e Lean Construction |
| `## vendas` | Vendas e Marketing |
| `## mercado` | Inteligência de Mercado e Produto |
| `## arquitetura` | Arquitetura e Urbanismo |
| `## legal` | Legal e Compliance |
| `## cs` | Customer Success e Pós-venda |
| `## cfo` | CFO — Funding, Caixa e MCMV |
| `## futurista` | Futurista |

> O **Presidente** não tem caderno — ele sintetiza o que os outros dizem.

---

## Passo a passo: adicionando conhecimento

### 1. Abra o arquivo

`docs/agents-knowledge-seed.md` em qualquer editor de texto.

### 2. Encontre a seção do especialista

Ex.: para ensinar algo ao CFO, vá até `## cfo`.

### 3. Adicione uma linha por fato

Cada **linha (bullet) vira um "trecho" independente** que o sistema pode
recuperar. Regras do bom trecho:

```markdown
## cfo

- A exposição máxima de caixa por SPE não deve passar de 20% do VGV do empreendimento.
- Nosso custo de capital de referência é CDI + 4% a.a.; TIR de projeto abaixo de CDI + 8% não aprova.
- Política interna: contingência de obra começa em 8% e consumo acima de 50% antes dos 60% físicos aciona revisão obrigatória de orçamento.
```

**✅ Faça assim:**
- **Um fato por linha**, completo e autossuficiente (a linha será lida
  isolada do resto)
- **Números e limiares** ("acima de X%, faça Y") — é o que torna a sugestão
  acionável
- **Vocabulário que se usa na reunião** (a busca é por palavras: se na
  reunião se fala "VSO", escreva "VSO" no trecho, não só "velocidade de vendas")
- Frases com **pelo menos ~20 caracteres** (linhas muito curtas são
  descartadas como ruído)

**❌ Evite:**
- Parágrafos gigantes com 5 assuntos misturados (dilui a busca)
- Conteúdo que pertence a OUTRO especialista (quebra o isolamento — regra
  jurídica vai no `## legal`, não no `## cfo`)
- Opiniões vagas sem critério ("vender bem é importante") — não geram
  sugestão útil

### 4. Reinicie o sistema

O conhecimento é carregado **no boot**:

```bash
# Ctrl+C no terminal e depois:
pnpm dev
```

### 5. Teste

Rode uma **▶ Reunião simulada** (ou fale ao microfone) mencionando o
assunto que você adicionou. O conselheiro certo deve trazer o novo
conhecimento na sugestão.

---

## De onde tirar bom conteúdo

| Fonte | Vai para o caderno de |
|---|---|
| Políticas internas da empresa (alçadas, limites, processos) | todos |
| Lições aprendidas de obras/projetos anteriores | engenharia, arquitetura |
| Tabela de indicadores que a diretoria acompanha (VSO alvo, CAC por canal, NPS mínimo) | vendas, mercado, cs |
| Regras de negócio do funding (bancos com quem trabalha, exigências) | cfo |
| Pareceres jurídicos recorrentes, cláusulas padrão | legal |
| Relatórios setoriais (CBIC, sindicatos, Abrainc) — resumidos em bullets | mercado, futurista |

**Método sugerido (1h por semana):** ao fim de cada semana, pergunte-se
"o que eu gostaria que o conselho tivesse me lembrado?" — e escreva 3–5
bullets nos cadernos certos. Em 3 meses o sistema conhece a sua operação
melhor que qualquer consultor externo.

---

## Ajustes avançados (mexem em código, mas são simples)

### Mudar o nome/escopo de um conselheiro

Arquivo: `packages/kb/src/reasoner.ts` → objeto `AGENT_PROFILES`.
Cada agente tem `displayName` (nome exibido) e `scope` (o que ele pode ou
não opinar — é injetado no prompt como regra rígida).

### Mudar os gatilhos (o que "acorda" cada conselheiro)

Arquivo: `packages/engines/src/triggers.ts`.
Cada conselheiro tem uma lista de expressões (regex) que disparam sua
análise — ex.: o CFO acorda com "fluxo de caixa", "VGV", "MCMV"…
Adicione termos do seu dia a dia. `severityHint: 'critical'` faz o alerta
**furar a fila** (usar só para riscos graves: embargo, ação judicial,
estouro de caixa).

### Melhorar a transcrição de termos técnicos

Arquivo: `packages/providers/src/vocabulary.ts` → `BUSINESS_VOCABULARY`.
Termos que o reconhecimento de voz erra (siglas, nomes próprios do seu
mercado) entram aqui para receber reforço no Deepgram. Mantenha a lista
curada (~60–80 termos) — lista gigante degrada o reconhecimento.

### Trocar os 9 especialistas por outros (outro setor)

O sistema é agnóstico de domínio. Para vender para outro setor (ex.:
clínicas, advocacia, agro), altere em sequência:

1. `packages/providers/src/types.ts` → slugs de `AgentId`
2. `packages/kb/src/reasoner.ts` → `AGENT_PROFILES` (nomes/escopos)
3. `packages/engines/src/triggers.ts` → gatilhos do novo domínio
4. `packages/providers/src/vocabulary.ts` → vocabulário do novo domínio
5. `docs/agents-knowledge-seed.md` → cadernos do novo domínio
6. `apps/web/components/counselor-strip.tsx` e
   `apps/web/components/suggestion-card.tsx` → nomes/emojis exibidos
7. Rode `pnpm typecheck && pnpm test` — o compilador aponta qualquer canto
   esquecido

---

## Auditoria: conferindo de onde veio cada sugestão

Toda contribuição e relatório gravam trilha de auditoria com os IDs dos
trechos de conhecimento usados (`kbSources`). Formato do ID:

```
cfo:seed-v1:3   →  caderno do CFO, versão seed-v1, 4º trecho (conta do 0)
```

Quando fizer uma grande revisão da base, atualize a etiqueta de versão em
`apps/web/lib/board-runtime.ts` (procure por `'seed-v1'` → mude para
`'curada-v2'` etc.). Assim a auditoria distingue sugestões dadas com a base
antiga vs. a nova.

---

## Checklist de qualidade da base

- [ ] Cada bullet é autossuficiente (faz sentido lido sozinho)?
- [ ] Tem número/limiar/critério acionável?
- [ ] Usa as palavras que as pessoas falam na reunião?
- [ ] Está no caderno do especialista certo?
- [ ] Reiniciou o sistema depois de editar?
- [ ] Testou com uma reunião simulada mencionando o tema?
