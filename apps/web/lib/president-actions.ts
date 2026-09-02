'use server';

import { revalidatePath } from 'next/cache';
import { getCurrentUser, canWrite } from './auth';
import { getDb } from './db';
import { savePresidentConfig, type PresidentConfigFieldsInput } from './president-config-store';

export type PresidentActionState = { error?: string; ok?: string } | null;

/** Edita a "Configuração do Presidente" (governança) — vale imediatamente para as próximas sínteses. */
export async function updatePresidentConfigAction(
  _prev: PresidentActionState,
  formData: FormData,
): Promise<PresidentActionState> {
  const user = await getCurrentUser();
  if (!user) return { error: 'Sessão expirada — faça login novamente.' };
  if (!canWrite(user)) return { error: 'Convidados não podem editar a configuração do Presidente.' };
  try {
    const fields: PresidentConfigFieldsInput = {
      monitoringModel: String(formData.get('monitoringModel') ?? '').trim() || null,
      monitoringReasoningEffort: String(formData.get('monitoringReasoningEffort') ?? '').trim() || null,
      synthesisModel: String(formData.get('synthesisModel') ?? '').trim() || null,
      synthesisReasoningEffort: String(formData.get('synthesisReasoningEffort') ?? '').trim() || null,
      finalSynthesisReasoningEffort: String(formData.get('finalSynthesisReasoningEffort') ?? '').trim() || null,
      interventionLevel: String(formData.get('interventionLevel') ?? '').trim() || null,
      canRequestCounselors: formData.get('canRequestCounselors') === 'on',
      canRegisterDecisions: formData.get('canRegisterDecisions') === 'on',
      canOverrideSpecialist: formData.get('canOverrideSpecialist') === 'on',
      autoInterruption: formData.get('autoInterruption') === 'on',
    };
    const db = await getDb();
    await savePresidentConfig(db, user.companyId, fields);
    revalidatePath('/counselors/presidente');
    return { ok: 'Configuração do Presidente atualizada — já vale para a próxima síntese.' };
  } catch (err) {
    console.error('[presidente] editar configuração falhou:', err);
    return { error: err instanceof Error ? err.message : 'Falha inesperada ao salvar a configuração.' };
  }
}
