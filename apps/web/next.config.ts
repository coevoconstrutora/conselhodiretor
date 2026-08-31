import type { NextConfig } from 'next';
import path from 'node:path';

const nextConfig: NextConfig = {
  // NÃO usar output:'standalone': o file tracing automático do Next não
  // capturou `ws` (dependência do board-gateway, alcançada via dynamic
  // import dentro de instrumentation.ts) — WebSocket do board quebraria
  // silenciosamente em produção. A imagem Docker leva o node_modules
  // completo em vez de depender do tracing.
  //
  // Raiz do file tracing = raiz do monorepo (senão o Next detecta a raiz
  // errada por causa do pnpm-lock.yaml estar fora de apps/web).
  outputFileTracingRoot: path.join(__dirname, '../../'),
  // Pacotes de workspace consumidos a partir do código-fonte TS.
  transpilePackages: [
    '@conselho/shared-types',
    '@conselho/crypto',
    '@conselho/db',
    '@conselho/auth',
    '@conselho/providers',
    '@conselho/meetings',
    '@conselho/audit',
    '@conselho/engines',
    '@conselho/kb',
    '@conselho/board',
    '@conselho/board-gateway',
    '@conselho/session',
    '@conselho/telemetry',
    '@conselho/meeting-report',
    '@conselho/llm-anthropic',
    '@conselho/llm-gemini',
    '@conselho/llm-openai',
    '@conselho/stt-deepgram',
  ],
  // Drivers de banco rodam no servidor — não empacotar (require nativo em runtime).
  serverExternalPackages: ['pg', '@electric-sql/pglite'],
};

export default nextConfig;
