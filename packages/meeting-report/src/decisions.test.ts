import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomBytes } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { runMigrations, pgliteExecutor, type SqlExecutor } from '@conselho/db';
import {
  parseExtractedOutcome,
  extractMeetingOutcome,
  saveMeetingOutcome,
  listMeetingDecisions,
  listMeetingActionItems,
  updateDecisionStatus,
  updateActionItemStatus,
  type ExtractedMeetingOutcome,
} from './decisions';
import type { ILlmProvider, TextCompletionRequest } from '@conselho/providers';

describe('parseExtractedOutcome — parse defensivo (Etapa "Histórico de reuniões")', () => {
  it('extrai decisões e ações de um JSON válido', () => {
    const raw = JSON.stringify({
      decisions: [
        {
          topic: 'Fornecedor de fachada',
          decision: 'Selecionar o fornecedor B',
          status: 'decidido',
          responsible: 'Carlos',
          deadline: '2026-09-10',
          evidence: 'Proposta final aprovada',
        },
      ],
      actionItems: [
        { action: 'Assinar contrato', responsible: 'Jurídico', deadline: '2026-09-15', relatedDecisionTopic: 'Fornecedor de fachada' },
      ],
    });
    const result = parseExtractedOutcome(raw);
    expect(result?.decisions).toHaveLength(1);
    expect(result?.decisions[0]!.status).toBe('decidido');
    expect(result?.actionItems).toHaveLength(1);
    expect(result?.actionItems[0]!.relatedDecisionTopic).toBe('Fornecedor de fachada');
  });

  it('aceita cercas de código markdown ao redor do JSON', () => {
    const raw = '```json\n{"decisions":[],"actionItems":[]}\n```';
    expect(parseExtractedOutcome(raw)).toEqual({ decisions: [], actionItems: [] });
  });

  it('descarta decisão sem topic/decision e ação sem action (campos essenciais ausentes)', () => {
    const raw = JSON.stringify({
      decisions: [{ topic: '', decision: 'x' }, { topic: 'y' }],
      actionItems: [{ action: '' }, { responsible: 'sem action' }],
    });
    const result = parseExtractedOutcome(raw);
    expect(result?.decisions).toHaveLength(0);
    expect(result?.actionItems).toHaveLength(0);
  });

  it('status desconhecido cai em "pendente" (nunca quebra, nunca inventa DECIDIDO)', () => {
    const raw = JSON.stringify({
      decisions: [{ topic: 'x', decision: 'y', status: 'algo-nao-suportado' }],
      actionItems: [],
    });
    expect(parseExtractedOutcome(raw)?.decisions[0]!.status).toBe('pendente');
  });

  it('deadline em formato inválido vira null (nunca quebra o parse)', () => {
    const raw = JSON.stringify({
      decisions: [{ topic: 'x', decision: 'y', deadline: 'semana que vem' }],
      actionItems: [],
    });
    expect(parseExtractedOutcome(raw)?.decisions[0]!.deadline).toBeNull();
  });

  it('JSON malformado devolve null — nunca lança', () => {
    expect(parseExtractedOutcome('isto não é JSON')).toBeNull();
  });

  it('sem decisões nem ações: listas vazias, não null', () => {
    expect(parseExtractedOutcome('{"decisions":[],"actionItems":[]}')).toEqual({
      decisions: [],
      actionItems: [],
    });
  });
});

describe('extractMeetingOutcome — degradação graciosa (nunca derruba a geração dos relatórios)', () => {
  it('provider sem completeText: devolve null sem lançar', async () => {
    const llm: ILlmProvider = { complete: async () => { throw new Error('não deveria chamar complete()'); } };
    expect(await extractMeetingOutcome(llm, 'síntese qualquer')).toBeNull();
  });

  it('completeText lança: devolve null sem lançar', async () => {
    const llm: ILlmProvider = {
      complete: async () => { throw new Error('não deveria chamar complete()'); },
      completeText: async () => { throw new Error('falha de rede'); },
    };
    expect(await extractMeetingOutcome(llm, 'síntese qualquer')).toBeNull();
  });

  it('caminho feliz: repassa a síntese no prompt e o override de modelo/raciocínio', async () => {
    let received: TextCompletionRequest | null = null;
    const llm: ILlmProvider = {
      complete: async () => { throw new Error('não deveria chamar complete()'); },
      completeText: async (req) => {
        received = req;
        return { text: '{"decisions":[],"actionItems":[]}' };
      },
    };
    const result = await extractMeetingOutcome(llm, 'Decidimos selecionar o fornecedor B.', 'gpt-5.6-sol', 'high');
    expect(result).toEqual({ decisions: [], actionItems: [] });
    expect(received!.prompt).toContain('Decidimos selecionar o fornecedor B.');
    expect(received!.model).toBe('gpt-5.6-sol');
    expect(received!.reasoningEffort).toBe('high');
  });

  it('com transcriptFinals: inclui a transcrição no prompt (é lá que aparecem nomes de responsáveis)', async () => {
    let received: TextCompletionRequest | null = null;
    const llm: ILlmProvider = {
      complete: async () => { throw new Error('não deveria chamar complete()'); },
      completeText: async (req) => {
        received = req;
        return { text: '{"decisions":[],"actionItems":[]}' };
      },
    };
    await extractMeetingOutcome(llm, 'Decidimos selecionar o fornecedor B.', undefined, undefined, [
      'Vinícius: eu cuido da automação das certidões.',
    ]);
    expect(received!.prompt).toContain('Vinícius: eu cuido da automação das certidões.');
    expect(received!.prompt).toContain('Decidimos selecionar o fornecedor B.');
  });
});

describe('saveMeetingOutcome — "itens monitorados" sobrevivem à regeneração (Etapa "Acompanhamento")', () => {
  let db: PGlite;
  let exec: SqlExecutor;
  let companyId: string;
  let meetingId: string;
  const key = randomBytes(32);

  function outcome(overrides: Partial<ExtractedMeetingOutcome> = {}): ExtractedMeetingOutcome {
    return {
      decisions: [
        {
          topic: 'Fornecedor de fachada',
          decision: 'Selecionar o fornecedor B para o revestimento externo',
          status: 'pendente',
          responsible: 'Carlos',
          deadline: null,
          evidence: '',
        },
      ],
      actionItems: [
        { action: 'Assinar contrato com o fornecedor B', responsible: 'Jurídico', deadline: null, relatedDecisionTopic: null },
      ],
      ...overrides,
    };
  }

  beforeAll(async () => {
    db = new PGlite();
    exec = pgliteExecutor(db);
    await runMigrations(exec);
    const company = await exec.query<{ id: string }>("SELECT id FROM company WHERE slug = 'coevo'");
    companyId = company.rows[0]!.id;
    const user = await exec.query<{ id: string }>(
      'INSERT INTO app_user (email, display_name, company_id) VALUES ($1, $2, $3) RETURNING id',
      ['teste-decisions@coevo.test', 'Teste', companyId],
    );
    const meeting = await exec.query<{ id: string }>(
      'INSERT INTO meeting (user_id, company_id, title_enc) VALUES ($1, $2, $3) RETURNING id',
      [user.rows[0]!.id, companyId, 'x'],
    );
    meetingId = meeting.rows[0]!.id;
  });

  afterAll(async () => {
    await db.close();
  });

  it('primeira geração: decisão/ação nascem com manuallyEdited=false e o status da extração', async () => {
    await saveMeetingOutcome(exec, meetingId, outcome(), key);
    const decisions = await listMeetingDecisions(exec, meetingId, key);
    const actions = await listMeetingActionItems(exec, meetingId, key);
    expect(decisions).toHaveLength(1);
    expect(decisions[0]!.status).toBe('pendente');
    expect(decisions[0]!.manuallyEdited).toBe(false);
    expect(actions).toHaveLength(1);
    expect(actions[0]!.status).toBe('pendente');
    expect(actions[0]!.manuallyEdited).toBe(false);
  });

  it('marcar ação como concluída à mão e regenerar (texto quase igual): status manual sobrevive', async () => {
    const before = await listMeetingActionItems(exec, meetingId, key);
    await updateActionItemStatus(exec, before[0]!.id, 'concluida');

    // regenera com o MESMO conteúdo (simula reextração da IA) — a ação
    // reaparece com texto quase idêntico, deve casar por similaridade e
    // herdar o status 'concluida' em vez de voltar pra 'pendente'.
    await saveMeetingOutcome(exec, meetingId, outcome(), key);

    const after = await listMeetingActionItems(exec, meetingId, key);
    expect(after).toHaveLength(1);
    expect(after[0]!.status).toBe('concluida');
    expect(after[0]!.manuallyEdited).toBe(true);
  });

  it('ação totalmente diferente na regeneração: NÃO herda o status manual de um item não relacionado', async () => {
    await saveMeetingOutcome(
      exec,
      meetingId,
      outcome({
        actionItems: [
          { action: 'Revisar o cronograma da obra com a equipe de engenharia', responsible: '', deadline: null, relatedDecisionTopic: null },
        ],
      }),
      key,
    );
    const after = await listMeetingActionItems(exec, meetingId, key);
    expect(after).toHaveLength(1);
    expect(after[0]!.status).toBe('pendente');
    expect(after[0]!.manuallyEdited).toBe(false);
  });

  it('updateDecisionStatus marca manually_edited=true e sobrevive a uma regeneração com o mesmo texto', async () => {
    await saveMeetingOutcome(exec, meetingId, outcome(), key);
    const decisions = await listMeetingDecisions(exec, meetingId, key);
    await updateDecisionStatus(exec, decisions[0]!.id, 'cancelado');

    await saveMeetingOutcome(exec, meetingId, outcome(), key); // reextração "concordando" com status diferente (pendente)

    const after = await listMeetingDecisions(exec, meetingId, key);
    expect(after[0]!.status).toBe('cancelado');
    expect(after[0]!.manuallyEdited).toBe(true);
  });

  it('updateDecisionStatus rejeita status inválido', async () => {
    const decisions = await listMeetingDecisions(exec, meetingId, key);
    // @ts-expect-error valor fora do union, testando a guarda em runtime
    await expect(updateDecisionStatus(exec, decisions[0]!.id, 'nao-existe')).rejects.toThrow();
  });
});
