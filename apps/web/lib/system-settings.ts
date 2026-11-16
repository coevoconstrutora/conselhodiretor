import 'server-only';
import type { SqlExecutor } from '@conselho/db';
import {
  DEFAULT_MEETING_COST_LIMIT_USD,
  DEFAULT_MODEL_PRICES,
  parseCostLimit,
  parseModelPrices,
  type ModelPrices,
} from '@conselho/telemetry';

/**
 * Configurações globais do sistema (tabela `system_setting`, só o super-admin
 * edita em /admin/costs). Hoje: limite de custo de LLM por reunião ao vivo e a
 * tabela de preços por modelo usada para medir esse custo.
 *
 * Precedência do limite: valor salvo na tela > env `MEETING_COST_LIMIT_USD` >
 * padrão (US$ 3). `0` desativa a trava. O limite vale SÓ para o conselho ao vivo,
 * nunca para os relatórios finais pós-reunião.
 */
const KEY_LIMIT = 'meeting_cost_limit_usd';
const KEY_PRICES = 'llm_model_prices';

export interface CostSettings {
  /** Limite por reunião em US$ (0 = sem limite). */
  readonly meetingCostLimitUsd: number;
  readonly limitSource: 'tela' | 'env' | 'padrão';
  readonly modelPrices: ModelPrices;
  readonly pricesSource: 'tela' | 'padrão';
}

/** Cache curto: a trava consulta a cada chamada ao LLM, o banco não precisa ser lido a cada vez. */
const CACHE_TTL_MS = 10_000;
let cache: { at: number; value: CostSettings } | null = null;

function envLimit(): number | null {
  return parseCostLimit(process.env.MEETING_COST_LIMIT_USD);
}

export async function getCostSettings(db: SqlExecutor): Promise<CostSettings> {
  if (cache && Date.now() - cache.at < CACHE_TTL_MS) return cache.value;
  const res = await db.query<{ key: string; value: string }>(
    'SELECT key, value FROM system_setting WHERE key = ANY($1)',
    [[KEY_LIMIT, KEY_PRICES]],
  );
  const stored = new Map(res.rows.map((r) => [r.key, r.value]));

  const storedLimit = parseCostLimit(stored.get(KEY_LIMIT));
  const fromEnv = envLimit();
  const storedPrices = parseModelPrices(stored.get(KEY_PRICES));

  const value: CostSettings = {
    meetingCostLimitUsd: storedLimit ?? fromEnv ?? DEFAULT_MEETING_COST_LIMIT_USD,
    limitSource: storedLimit !== null ? 'tela' : fromEnv !== null ? 'env' : 'padrão',
    modelPrices: storedPrices ?? DEFAULT_MODEL_PRICES,
    pricesSource: storedPrices ? 'tela' : 'padrão',
  };
  cache = { at: Date.now(), value };
  return value;
}

export async function saveCostSettings(
  db: SqlExecutor,
  input: { meetingCostLimitUsd: number; modelPrices: ModelPrices },
  updatedBy: string,
): Promise<void> {
  const upsert = `INSERT INTO system_setting (key, value, updated_by) VALUES ($1, $2, $3)
                  ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now(), updated_by = EXCLUDED.updated_by`;
  await db.query(upsert, [KEY_LIMIT, String(input.meetingCostLimitUsd), updatedBy]);
  await db.query(upsert, [KEY_PRICES, JSON.stringify(input.modelPrices), updatedBy]);
  cache = null; // vale já na próxima chamada ao LLM
}
