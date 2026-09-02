import 'server-only';

/**
 * Chamada HTTP crua ao TTS da OpenAI — compartilhada entre `/api/tts` (fala
 * de uma contribuição real) e `/api/tts/preview` (Etapa "IA por conselheiro"
 * — botão "Ouvir voz" antes de salvar). Sem SDK de vendor, mesmo padrão dos
 * adapters de LLM. `TTS_MODEL` é a ÚNICA definição no app — nunca duplicar.
 */
const OPENAI_TTS_ENDPOINT = 'https://api.openai.com/v1/audio/speech';
export const TTS_MODEL = 'gpt-4o-mini-tts'; // versão mais nova, mais barata que tts-1

export async function synthesizeSpeech(opts: {
  readonly apiKey: string;
  readonly voice: string;
  readonly input: string;
  readonly instructions?: string;
  readonly speed?: number;
}): Promise<Response> {
  return fetch(OPENAI_TTS_ENDPOINT, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${opts.apiKey}`,
    },
    body: JSON.stringify({
      model: TTS_MODEL,
      voice: opts.voice,
      input: opts.input,
      ...(opts.instructions ? { instructions: opts.instructions } : {}),
      speed: opts.speed ?? 1.0,
      response_format: 'mp3',
    }),
  });
}
