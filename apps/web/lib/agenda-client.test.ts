import { describe, it, expect } from 'vitest';
import { agendaConfigFromEnv, listCouncilMeetings, parseAgendaMeeting, DEFAULT_AGENDA_URL } from './agenda-client';

const CONFIG = { baseUrl: 'https://agenda.test', token: 'cdi_SEGREDO' };

const sample = {
  id: 'c1f0',
  title: 'Reunião mensal do comitê',
  description: 'Pauta: orçamento',
  startAt: '2026-11-20T17:00:00.000Z',
  endAt: '2026-11-20T18:00:00.000Z',
  roomName: 'Sala Diretoria',
  meetingUrl: 'https://meet.google.com/abc-defg-hij',
  organizer: { name: 'Fulano', email: 'fulano@empresa.com' },
  participants: [
    { name: 'Ciclano', email: 'ciclano@empresa.com', response: 'accepted' },
    { name: 'Sem resposta válida', email: 'x@y.com', response: 'talvez' },
    { email: 'sem-nome@y.com' },
  ],
};

function fakeFetch(status: number, body: unknown, capture?: { url?: URL; init?: RequestInit }): typeof fetch {
  return (async (url: URL, init: RequestInit) => {
    if (capture) {
      capture.url = url;
      capture.init = init;
    }
    return new Response(JSON.stringify(body), { status });
  }) as unknown as typeof fetch;
}

describe('agendaConfigFromEnv', () => {
  it('sem token a integração fica desligada', () => {
    expect(agendaConfigFromEnv({})).toBeNull();
    expect(agendaConfigFromEnv({ AGENDA_API_TOKEN: '  ' })).toBeNull();
  });
  it('usa a URL padrão e remove barra final', () => {
    expect(agendaConfigFromEnv({ AGENDA_API_TOKEN: 't' })).toEqual({ baseUrl: DEFAULT_AGENDA_URL, token: 't' });
    expect(agendaConfigFromEnv({ AGENDA_API_TOKEN: 't', AGENDA_API_URL: 'https://x.test/' })?.baseUrl).toBe('https://x.test');
  });
});

describe('parseAgendaMeeting', () => {
  it('lê uma reunião completa e descarta participante inválido', () => {
    const m = parseAgendaMeeting(sample)!;
    expect(m.title).toBe('Reunião mensal do comitê');
    expect(m.startAt.toISOString()).toBe('2026-11-20T17:00:00.000Z');
    expect(m.organizer?.name).toBe('Fulano');
    expect(m.participants.map((p) => [p.name, p.response])).toEqual([
      ['Ciclano', 'accepted'],
      ['Sem resposta válida', 'pending'],
    ]);
  });
  it('item sem título ou com data inválida é descartado', () => {
    expect(parseAgendaMeeting({ ...sample, title: '' })).toBeNull();
    expect(parseAgendaMeeting({ ...sample, startAt: 'ontem' })).toBeNull();
    expect(parseAgendaMeeting(null)).toBeNull();
  });
});

describe('listCouncilMeetings', () => {
  it('sem configuração não chama a rede', async () => {
    expect(await listCouncilMeetings(null)).toEqual({ status: 'not_configured' });
  });

  it('envia o Bearer e a janela; devolve só itens válidos', async () => {
    const capture: { url?: URL; init?: RequestInit } = {};
    const from = new Date('2026-11-10T12:00:00Z');
    const to = new Date('2026-12-10T12:00:00Z');
    const res = await listCouncilMeetings(CONFIG, { from, to }, fakeFetch(200, { meetings: [sample, { id: 'x' }] }, capture));
    expect(res.status).toBe('ok');
    if (res.status === 'ok') expect(res.meetings).toHaveLength(1);
    expect((capture.init!.headers as Record<string, string>).Authorization).toBe('Bearer cdi_SEGREDO');
    expect(capture.url!.pathname).toBe('/api/council/meetings');
    expect(capture.url!.searchParams.get('from')).toBe(from.toISOString());
    expect(capture.url!.searchParams.get('to')).toBe(to.toISOString());
  });

  it('401 vira erro amigável e nunca vaza o token', async () => {
    const res = await listCouncilMeetings(CONFIG, {}, fakeFetch(401, { error: 'x' }));
    expect(res.status).toBe('error');
    expect(JSON.stringify(res)).not.toContain('cdi_SEGREDO');
  });

  it('falha de rede não lança', async () => {
    const boom = (async () => {
      throw new Error('ECONNRESET cdi_SEGREDO');
    }) as unknown as typeof fetch;
    const res = await listCouncilMeetings(CONFIG, {}, boom);
    expect(res).toEqual({ status: 'error', message: 'Não foi possível falar com a Agenda.' });
  });
});
