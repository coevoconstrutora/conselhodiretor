'use server';

import { revalidatePath } from 'next/cache';
import { parseCostLimit, parseModelPrices } from '@conselho/telemetry';
import { getCurrentUser } from './auth';
import { getDb } from './db';
import { saveCostSettings } from './system-settings';

export type CostSettingsActionState = { error?: string; ok?: string } | null;

/** Salva o limite de custo por reunião e a tabela de preços — só super-admin (a action é um endpoint público). */
export async function saveCostSettingsAction(
  _prev: CostSettingsActionState,
  formData: FormData,
): Promise<CostSettingsActionState> {
  const user = await getCurrentUser();
  if (!user) return { error: 'Sessão expirada — faça login novamente.' };
  if (!user.isSuperAdmin) return { error: 'Só o dono da plataforma pode alterar estes limites.' };

  const limit = parseCostLimit(formData.get('meetingCostLimitUsd'));
  if (limit === null) return { error: 'Limite inválido — use um número em US$ (0 desativa a trava).' };

  const prices = parseModelPrices(String(formData.get('modelPrices') ?? ''));
  if (!prices) {
    return {
      error:
        'Tabela de preços inválida — use JSON no formato {"modelo": {"input": 5, "cachedInput": 0.5, "output": 30}} (US$ por 1M de tokens).',
    };
  }

  try {
    const db = await getDb();
    await saveCostSettings(db, { meetingCostLimitUsd: limit, modelPrices: prices }, user.id);
    revalidatePath('/admin/costs');
    return {
      ok:
        limit === 0
          ? 'Salvo — trava de custo DESATIVADA (sem limite por reunião).'
          : `Salvo — limite de US$ ${limit.toFixed(2)} por reunião, já vale para as próximas chamadas.`,
    };
  } catch (err) {
    console.error('[custos] salvar configurações falhou:', err);
    return { error: 'Falha ao salvar as configurações — tente novamente.' };
  }
}
