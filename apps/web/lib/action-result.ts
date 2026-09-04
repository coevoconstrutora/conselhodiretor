/**
 * Resultado tipado das server actions (confiabilidade da reunião ao vivo).
 *
 * Em produção o Next.js MASCARA a mensagem de `Error` lançado em server actions
 * (o cliente recebe um texto genérico em inglês). Por isso as actions do fluxo
 * ao vivo NUNCA lançam: retornam `ActionResult` e o cliente mapeia `code` para
 * uma mensagem pt-BR acionável (ACTION_ERROR_MESSAGES).
 */

export type ActionErrorCode =
  | 'unauthenticated'
  | 'recording-required'
  | 'stt-missing'
  | 'no-transcript'
  | 'invalid-input'
  | 'internal';

export type ActionResult = { ok: true } | { ok: false; code: ActionErrorCode; detail?: string };

/** Mensagens pt-BR acionáveis por código — únicas exibidas ao usuário. */
export const ACTION_ERROR_MESSAGES: Record<ActionErrorCode, string> = {
  unauthenticated: 'Sessão expirada — faça login novamente.',
  'recording-required':
    'Gravação não confirmada — confirme que os participantes autorizaram a gravação (botão no topo da página) e tente novamente.',
  'stt-missing': 'O serviço de transcrição não está configurado no servidor — contate o suporte.',
  'no-transcript': 'Sem transcrição nesta sessão — inicie a reunião ao vivo antes de gerar os relatórios.',
  'invalid-input': 'Dados da requisição incompletos — recarregue a página e tente de novo.',
  internal: 'Falha inesperada — tente novamente; se persistir, abra o Diagnóstico.',
};

/**
 * Classifica um erro lançado pelo runtime em um código de ação. Usa `err.name`
 * (e não instanceof) porque a classe pode atravessar fronteiras de bundle.
 */
export function toActionResult(err: unknown): ActionResult {
  if (err instanceof Error) {
    if (err.name === 'RecordingRequiredError') return { ok: false, code: 'recording-required' };
    if (err.name === 'DeepgramSttError' && (err as { kind?: string }).kind === 'config') {
      return { ok: false, code: 'stt-missing' };
    }
    if (/DEEPGRAM_API_KEY/.test(err.message)) return { ok: false, code: 'stt-missing' };
    return { ok: false, code: 'internal', detail: err.message };
  }
  return { ok: false, code: 'internal' };
}
