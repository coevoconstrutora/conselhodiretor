import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    // espelha o alias "@/*" do tsconfig do apps/web p/ os testes de UI
    alias: { '@': fileURLToPath(new URL('./apps/web', import.meta.url)) },
  },
  esbuild: { jsx: 'automatic' }, // JSX runtime do React 19 (testes .tsx sem import React)
  test: {
    include: ['packages/**/src/**/*.test.ts', 'apps/web/**/*.test.{ts,tsx}'],
    exclude: ['**/node_modules/**', '**/.next/**', '**/dist/**'],
    environment: 'node',
    testTimeout: 30000, // PGlite (Postgres WASM) tem init mais lento na 1ª execução
    hookTimeout: 30000, // beforeAll com PGlite também estoura os 10s default sob carga paralela
    // Teto de concorrência: cada suíte com PGlite carrega um Postgres WASM (pesado).
    // Sem teto, o vitest abre ~1 worker por core e as instâncias simultâneas esgotam
    // CPU/memória, causando timeouts intermitentes de init (flake). 4 mantém bom
    // paralelismo com pico seguro de instâncias WASM.
    maxWorkers: 4,
    minWorkers: 1,
  },
});
