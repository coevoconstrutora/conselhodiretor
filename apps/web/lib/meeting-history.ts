import 'server-only';
import {
  listMeetingContributions,
  countMeetingContributionsByAgent,
  listMeetingDecisions,
  listMeetingActionItems,
  loadLatestMeetingAnalysis,
  type MeetingContributionRecord,
  type MeetingDecisionRecord,
  type MeetingActionItemRecord,
  type MeetingImprovement,
} from '@conselho/meeting-report';
import type { AgentId } from '@conselho/providers';
import { getDb } from './db';
import { getEncryptionKey } from './crypto-key';

/**
 * Leituras da reunião ENCERRADA (Etapa "Histórico de reuniões") — reúne os
 * 3 novos registros (contribuições/decisões/ações) para a página histórica
 * com tabs. Cada função degrada para lista vazia em erro (chave rotacionada,
 * linha corrompida) — a aba correspondente só mostra "sem dados", nunca
 * quebra a página inteira.
 */

export async function loadMeetingContributions(meetingId: string): Promise<MeetingContributionRecord[]> {
  const db = await getDb();
  return listMeetingContributions(db, meetingId, getEncryptionKey()).catch((error) => {
    console.error('[historico] carregar contribuições falhou:', error);
    return [];
  });
}

export async function loadMeetingContributionCounts(meetingId: string): Promise<Map<AgentId, number>> {
  const db = await getDb();
  return countMeetingContributionsByAgent(db, meetingId).catch((error) => {
    console.error('[historico] contar contribuições falhou:', error);
    return new Map<AgentId, number>();
  });
}

export async function loadMeetingDecisions(meetingId: string): Promise<MeetingDecisionRecord[]> {
  const db = await getDb();
  return listMeetingDecisions(db, meetingId, getEncryptionKey()).catch((error) => {
    console.error('[historico] carregar decisões falhou:', error);
    return [];
  });
}

export async function loadMeetingActionItems(meetingId: string): Promise<MeetingActionItemRecord[]> {
  const db = await getDb();
  return listMeetingActionItems(db, meetingId, getEncryptionKey()).catch((error) => {
    console.error('[historico] carregar ações falhou:', error);
    return [];
  });
}

/** Análise do Conselho (Seção 30) — carrega a VERSÃO MAIS RECENTE já salva, nunca regenera na abertura da página. */
export async function loadMeetingAnalysis(meetingId: string): Promise<MeetingImprovement | null> {
  const db = await getDb();
  return loadLatestMeetingAnalysis(db, meetingId, getEncryptionKey()).catch((error) => {
    console.error('[historico] carregar análise do conselho falhou:', error);
    return null;
  });
}
