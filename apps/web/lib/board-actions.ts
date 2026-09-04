'use server';

import { revalidatePath } from 'next/cache';
import { closeMeeting, meetingBelongsToCompany } from '@conselho/meetings';
import { listAgentReports } from '@conselho/meeting-report';
import { getCurrentUser, canWrite } from './auth';
import { getDb } from './db';
import { getEncryptionKey } from './crypto-key';
import { generateReportsCore } from './report-actions';
import {
  startDemoBoard,
  requestSynthesis,
  startLiveBoard,
  stopLiveBoard,
  renameSpeaker,
  setSilentMode,
} from './board-runtime';
import { toActionResult, type ActionResult } from './action-result';

/** Server action: inicia a demo do board (auth + gate de consentimento no caminho). */
export async function startDemoBoardAction(formData: FormData): Promise<void> {
  const user = await getCurrentUser();
  if (!user) throw new Error('Não autenticado.');
  if (!canWrite(user)) throw new Error('Convidados não podem iniciar reuniões.');
  const meetingId = String(formData.get('meetingId') ?? '');
  if (!meetingId) throw new Error('meetingId ausente.');
  const db = await getDb();
  if (!(await meetingBelongsToCompany(db, meetingId, user.companyId))) {
    throw new Error('Reunião não encontrada.');
  }
  await startDemoBoard(meetingId);
}

export type RenameSpeakerState = { error?: string; ok?: string } | null;

/**
 * Server action: Tier 2 — corrige/nomeia "Locutor N" na hora (quando ninguém
 * se apresentou, ou a autoapresentação errou o nome), sem precisar de
 * biometria de voz. Vale a partir da próxima fala daquele número.
 */
export async function renameSpeakerAction(
  _prev: RenameSpeakerState,
  formData: FormData,
): Promise<RenameSpeakerState> {
  const user = await getCurrentUser();
  if (!user) return { error: 'Sessão expirada — faça login novamente.' };
  if (!canWrite(user)) return { error: 'Convidados não podem renomear locutores.' };
  const meetingId = String(formData.get('meetingId') ?? '');
  const speakerNum = String(formData.get('speakerNum') ?? '').trim();
  const name = String(formData.get('name') ?? '').trim();
  const area = String(formData.get('area') ?? '').trim();
  if (!meetingId || !speakerNum) return { error: 'Dados incompletos.' };
  if (!name) return { error: 'Informe um nome.' };
  const db = await getDb();
  if (!(await meetingBelongsToCompany(db, meetingId, user.companyId))) {
    return { error: 'Reunião não encontrada.' };
  }
  const applied = await renameSpeaker(meetingId, speakerNum, name, area || null);
  if (!applied) return { error: 'Sem sessão ativa no momento — inicie o board antes de renomear.' };
  return { ok: `Locutor ${speakerNum} agora aparece como "${name}"${area ? ` (${area})` : ''}.` };
}

export type ToggleSilentModeState = { error?: string; ok?: string; silentMode?: boolean } | null;

/**
 * Server action: liga/desliga o modo silencioso ao vivo (Etapa "board
 * silencioso") — grava e atualiza o caso normalmente, mas para de gerar
 * contribuições/sínteses AO VIVO. Útil numa reunião tumultuada, onde os
 * áudios de opinião gerados na hora não seriam ouvidos por ninguém mesmo.
 */
export async function toggleSilentModeAction(
  _prev: ToggleSilentModeState,
  formData: FormData,
): Promise<ToggleSilentModeState> {
  const user = await getCurrentUser();
  if (!user) return { error: 'Sessão expirada — faça login novamente.' };
  if (!canWrite(user)) return { error: 'Convidados não podem alterar o modo do board.' };
  const meetingId = String(formData.get('meetingId') ?? '');
  if (!meetingId) return { error: 'meetingId ausente.' };
  const enabled = formData.get('enabled') === '1';
  const db = await getDb();
  if (!(await meetingBelongsToCompany(db, meetingId, user.companyId))) {
    return { error: 'Reunião não encontrada.' };
  }
  const applied = await setSilentMode(meetingId, enabled);
  if (!applied) return { error: 'Sem sessão ativa no momento — inicie o board antes de alternar.' };
  return {
    ok: enabled
      ? 'Modo silencioso ligado — o board só grava; os conselheiros voltam a opinar nos relatórios finais.'
      : 'Modo silencioso desligado — o board volta a opinar ao vivo.',
    silentMode: enabled,
  };
}

/** Server action: síntese do Aurélio sob demanda (FR18). */
export async function requestSynthesisAction(formData: FormData): Promise<void> {
  const user = await getCurrentUser();
  if (!user) throw new Error('Não autenticado.');
  if (!canWrite(user)) throw new Error('Convidados não podem pedir síntese.');
  const meetingId = String(formData.get('meetingId') ?? '');
  if (!meetingId) throw new Error('meetingId ausente.');
  const db = await getDb();
  if (!(await meetingBelongsToCompany(db, meetingId, user.companyId))) {
    throw new Error('Reunião não encontrada.');
  }
  await requestSynthesis(meetingId);
}

/**
 * Server action: inicia a reunião AO VIVO (mic real → Deepgram → board).
 * NUNCA lança — em produção o Next mascara mensagens de erro de server action;
 * o resultado tipado preserva o motivo (consentimento, STT, etc.) para o cliente.
 */
export async function startLiveBoardAction(meetingId: string): Promise<ActionResult> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, code: 'unauthenticated' };
  if (!canWrite(user)) return { ok: false, code: 'unauthenticated', detail: 'Convidados não podem iniciar reuniões.' };
  if (!meetingId) return { ok: false, code: 'invalid-input' };
  try {
    const db = await getDb();
    if (!(await meetingBelongsToCompany(db, meetingId, user.companyId))) {
      return { ok: false, code: 'invalid-input' };
    }
    await startLiveBoard(meetingId);
    return { ok: true };
  } catch (err) {
    console.error('[board] startLiveBoard falhou:', err);
    return toActionResult(err);
  }
}

/** Server action: encerra a reunião ao vivo (nunca lança). */
export async function stopLiveBoardAction(meetingId: string): Promise<ActionResult> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, code: 'unauthenticated' };
  try {
    await stopLiveBoard(meetingId);
    return { ok: true };
  } catch (err) {
    console.error('[board] stopLiveBoard falhou:', err);
    return toActionResult(err);
  }
}

/**
 * Server action: "Encerrar reunião" — para STT/board (ao vivo OU simulada,
 * `stopLiveBoard` cobre as duas) e marca a reunião como fechada. A partir
 * daqui não dá mais para iniciar nada novo; transcrição e relatórios seguem
 * disponíveis. Nunca lança — botão de risco, precisa de feedback lido.
 *
 * Dispara a geração dos relatórios automaticamente em background (fire-and-
 * forget — são ~10 chamadas de LLM em série, ~1 min+, não dá pra esperar
 * aqui sem travar o clique de "Encerrar"). Só dispara se ainda não há
 * relatório nenhum: se o usuário já gerou/editou manualmente antes de
 * encerrar, encerrar não deve sobrescrever esse trabalho. O botão manual
 * "Gerar/Regenerar relatórios" continua disponível como fallback se a
 * geração automática falhar (erro só vai pro log do servidor, por design —
 * não bloqueia o encerramento).
 */
export async function endMeetingAction(meetingId: string): Promise<ActionResult> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, code: 'unauthenticated' };
  if (!canWrite(user)) return { ok: false, code: 'unauthenticated', detail: 'Convidados não podem encerrar reuniões.' };
  if (!meetingId) return { ok: false, code: 'invalid-input' };
  try {
    const db = await getDb();
    if (!(await meetingBelongsToCompany(db, meetingId, user.companyId))) {
      return { ok: false, code: 'invalid-input' };
    }
    await stopLiveBoard(meetingId);
    await closeMeeting(db, meetingId, user.companyId);
    revalidatePath(`/meetings/${meetingId}`);

    const existingReports = await listAgentReports(db, meetingId, getEncryptionKey()).catch(() => []);
    if (existingReports.length === 0) {
      void generateReportsCore(meetingId, user)
        .then((result) => {
          if (!result.ok) console.error('[relatorios] geração automática pós-encerramento falhou:', result);
          revalidatePath(`/meetings/${meetingId}`);
        })
        .catch((error) => console.error('[relatorios] geração automática pós-encerramento falhou:', error));
    }

    return { ok: true };
  } catch (err) {
    console.error('[board] endMeeting falhou:', err);
    return toActionResult(err);
  }
}
