/**
 * Cliente da API do sistema Agenda (somente leitura) — reuniões marcadas com
 * "Enviar ao comitê". Contrato: docs/api-conselho.md do repositório da Agenda.
 *
 * Só roda NO SERVIDOR: o token (`cdi_…`, escopo council:read) vem de
 * AGENDA_API_TOKEN e NUNCA vai ao navegador, a logs nem ao repositório.
 * Sem `server-only` aqui apenas para ser testável por unidade (fetch injetável).
 */

export const DEFAULT_AGENDA_URL = 'https://agenda-web-seven.vercel.app';
const REQUEST_TIMEOUT_MS = 6_000;

export interface AgendaParticipant {
  readonly name: string;
  readonly email: string;
  readonly response: 'pending' | 'accepted' | 'declined' | 'tentative';
}

export interface AgendaMeeting {
  readonly id: string;
  readonly title: string;
  readonly description: string | null;
  readonly startAt: Date;
  readonly endAt: Date;
  readonly roomName: string | null;
  readonly meetingUrl: string | null;
  readonly organizer: { readonly name: string; readonly email: string } | null;
  readonly participants: readonly AgendaParticipant[];
}

export type AgendaResult =
  | { status: 'ok'; meetings: AgendaMeeting[] }
  | { status: 'not_configured' }
  | { status: 'error'; message: string };

export interface AgendaConfig {
  readonly baseUrl: string;
  readonly token: string;
}

/** Lê a configuração do ambiente — `null` quando o token não foi definido (integração desligada). */
export function agendaConfigFromEnv(env: Record<string, string | undefined> = process.env): AgendaConfig | null {
  const token = env.AGENDA_API_TOKEN?.trim();
  if (!token) return null;
  return { baseUrl: (env.AGENDA_API_URL?.trim() || DEFAULT_AGENDA_URL).replace(/\/+$/, ''), token };
}

const RESPONSES = new Set(['pending', 'accepted', 'declined', 'tentative']);

function str(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null;
}

/** Parse defensivo de um item — item malformado é descartado, nunca derruba a lista. */
export function parseAgendaMeeting(raw: unknown): AgendaMeeting | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const id = str(r.id);
  const title = str(r.title);
  const startAt = str(r.startAt) ? new Date(r.startAt as string) : null;
  const endAt = str(r.endAt) ? new Date(r.endAt as string) : null;
  if (!id || !title || !startAt || !endAt || Number.isNaN(startAt.getTime()) || Number.isNaN(endAt.getTime())) {
    return null;
  }
  const org = r.organizer as Record<string, unknown> | null | undefined;
  const participants = Array.isArray(r.participants)
    ? (r.participants as Record<string, unknown>[]).flatMap((p): AgendaParticipant[] => {
        const name = str(p?.name);
        if (!name) return [];
        return [
          {
            name,
            email: str(p.email) ?? '',
            response: RESPONSES.has(p.response as string) ? (p.response as AgendaParticipant['response']) : 'pending',
          },
        ];
      })
    : [];
  return {
    id,
    title,
    description: str(r.description),
    startAt,
    endAt,
    roomName: str(r.roomName),
    meetingUrl: str(r.meetingUrl),
    organizer: org && str(org.name) ? { name: str(org.name)!, email: str(org.email) ?? '' } : null,
    participants,
  };
}

/**
 * Reuniões marcadas para o comitê na janela [from, to]. Nunca lança: falha de
 * rede/token vira `error` (a home segue funcionando sem a agenda). A mensagem
 * de erro nunca inclui o token.
 */
export async function listCouncilMeetings(
  config: AgendaConfig | null,
  window: { from?: Date; to?: Date } = {},
  fetchImpl: typeof fetch = fetch,
): Promise<AgendaResult> {
  if (!config) return { status: 'not_configured' };
  const url = new URL(`${config.baseUrl}/api/council/meetings`);
  if (window.from) url.searchParams.set('from', window.from.toISOString());
  if (window.to) url.searchParams.set('to', window.to.toISOString());

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetchImpl(url, {
      headers: { Authorization: `Bearer ${config.token}`, Accept: 'application/json' },
      cache: 'no-store',
      signal: controller.signal,
    });
    if (res.status === 401) {
      return { status: 'error', message: 'A Agenda recusou o token (inválido ou revogado) — gere um novo em Cadastros → Integrações.' };
    }
    if (!res.ok) return { status: 'error', message: `A Agenda respondeu ${res.status}.` };
    const body = (await res.json()) as { meetings?: unknown };
    const meetings = Array.isArray(body.meetings)
      ? body.meetings.flatMap((m) => {
          const parsed = parseAgendaMeeting(m);
          return parsed ? [parsed] : [];
        })
      : [];
    return { status: 'ok', meetings };
  } catch (err) {
    const timedOut = err instanceof Error && err.name === 'AbortError';
    return { status: 'error', message: timedOut ? 'A Agenda demorou demais para responder.' : 'Não foi possível falar com a Agenda.' };
  } finally {
    clearTimeout(timer);
  }
}
