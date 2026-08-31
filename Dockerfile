# syntax=docker/dockerfile:1

# ─────────────────────────────────────────────────────────────────────────
# Conselho — imagem de produção (Fly.io)
#
# Estratégia: NÃO usa `next build` output:'standalone'. O file tracing
# automático do Next não captura corretamente dependências alcançadas via
# dynamic import dentro de instrumentation.ts (ex.: `ws`, usado pelo
# board-gateway) — o WebSocket do board quebraria silenciosamente em
# produção. Em vez disso, a imagem final carrega o node_modules completo do
# workspace pnpm (mais simples e confiável que reconstruir a árvore traçada).
#
# BOARD_WS_MODE=attached: WS na MESMA porta do HTTP via apps/web/server.mjs
# (CLAUDE.md / docs/TUTORIAL.md §9).
# ─────────────────────────────────────────────────────────────────────────

FROM node:22-bookworm-slim AS base
RUN corepack enable && corepack prepare pnpm@10.4.1 --activate
WORKDIR /app

# ── deps: instala tudo (dev+prod — precisa de typescript p/ buildar os pacotes)
FROM base AS deps
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY apps/web/package.json apps/web/package.json
COPY packages/audit/package.json packages/audit/package.json
COPY packages/auth/package.json packages/auth/package.json
COPY packages/board/package.json packages/board/package.json
COPY packages/board-gateway/package.json packages/board-gateway/package.json
COPY packages/crypto/package.json packages/crypto/package.json
COPY packages/db/package.json packages/db/package.json
COPY packages/engines/package.json packages/engines/package.json
COPY packages/kb/package.json packages/kb/package.json
COPY packages/llm-anthropic/package.json packages/llm-anthropic/package.json
COPY packages/llm-gemini/package.json packages/llm-gemini/package.json
COPY packages/llm-openai/package.json packages/llm-openai/package.json
COPY packages/meeting-report/package.json packages/meeting-report/package.json
COPY packages/meetings/package.json packages/meetings/package.json
COPY packages/providers/package.json packages/providers/package.json
COPY packages/session/package.json packages/session/package.json
COPY packages/shared-types/package.json packages/shared-types/package.json
COPY packages/stt-deepgram/package.json packages/stt-deepgram/package.json
COPY packages/telemetry/package.json packages/telemetry/package.json
RUN pnpm install --frozen-lockfile

# ── builder: código completo + build (tsc dos pacotes + next build)
FROM deps AS builder
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN pnpm build

# ── runner: imagem final de produção
FROM base AS runner
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV BOARD_WS_MODE=attached
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

RUN groupadd --system --gid 1001 nodejs \
  && useradd --system --uid 1001 --gid nodejs nextjs

COPY --from=builder --chown=nextjs:nodejs /app /app
USER nextjs

# server.mjs chama next({ hostname, port }) SEM `dir` — o Next resolve o
# distDir ('.next') relativo ao cwd do processo. Em dev, `pnpm --filter
# @conselho/web dev` já roda com cwd em apps/web; aqui replicamos isso via
# WORKDIR, senão o Next procura /app/.next (raiz do monorepo) em vez de
# /app/apps/web/.next e recusa subir ("Could not find a production build").
WORKDIR /app/apps/web

EXPOSE 3000
CMD ["node", "server.mjs"]
