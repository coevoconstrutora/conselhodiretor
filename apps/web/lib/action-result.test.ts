import { describe, it, expect } from 'vitest';
import { toActionResult, ACTION_ERROR_MESSAGES } from './action-result';

/** Erros com a MESMA forma dos reais (name/kind atravessam bundles; instanceof não). */
function consentError(): Error {
  const err = new Error('Captura bloqueada: consentimento de gravação ausente ou revogado (consulta c1).');
  err.name = 'RecordingRequiredError';
  return err;
}

function deepgramConfigError(): Error {
  const err = new Error('DEEPGRAM_API_KEY é obrigatório.') as Error & { kind: string };
  err.name = 'DeepgramSttError';
  err.kind = 'config';
  return err;
}

describe('toActionResult (A1 — classificação de erros das server actions)', () => {
  it('RecordingRequiredError → recording-required', () => {
    expect(toActionResult(consentError())).toEqual({ ok: false, code: 'recording-required' });
  });

  it('DeepgramSttError kind=config → stt-missing', () => {
    expect(toActionResult(deepgramConfigError())).toEqual({ ok: false, code: 'stt-missing' });
  });

  it('DeepgramSttError de conexão NÃO vira stt-missing (é internal)', () => {
    const err = new Error('Falha na conexão com o STT (Deepgram).') as Error & { kind: string };
    err.name = 'DeepgramSttError';
    err.kind = 'connection';
    const result = toActionResult(err);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('internal');
  });

  it('mensagem citando DEEPGRAM_API_KEY → stt-missing', () => {
    expect(toActionResult(new Error('DEEPGRAM_API_KEY ausente — configure o STT.'))).toEqual({
      ok: false,
      code: 'stt-missing',
    });
  });

  it('Error genérico → internal com detail', () => {
    const result = toActionResult(new Error('boom'));
    expect(result).toEqual({ ok: false, code: 'internal', detail: 'boom' });
  });

  it('valor não-Error → internal sem detail', () => {
    expect(toActionResult('string qualquer')).toEqual({ ok: false, code: 'internal' });
  });

  it('todas as mensagens são pt-BR acionáveis (nenhuma vazia)', () => {
    for (const msg of Object.values(ACTION_ERROR_MESSAGES)) {
      expect(msg.length).toBeGreaterThan(20);
    }
  });
});
