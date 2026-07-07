import { describe, it, expect } from 'vitest';
import type { TranscriptSegment } from '@conselho/providers';
import {
  DeepgramSttProvider,
  DeepgramSttError,
  deepgramConfigFromEnv,
  buildListenUrl,
  type WebSocketLike,
  type WsEventLike,
} from './deepgram';

/** Socket fake: grava o que foi enviado e permite replay de eventos do vendor. */
class FakeSocket implements WebSocketLike {
  sent: Array<string | ArrayBufferLike | Uint8Array> = [];
  closedWith: { code?: number; reason?: string } | null = null;
  private listeners = new Map<string, Array<(e: WsEventLike) => void>>();

  send(data: string | ArrayBufferLike | Uint8Array): void {
    this.sent.push(data);
  }
  close(code?: number, reason?: string): void {
    this.closedWith = { code, reason };
  }
  addEventListener(type: string, listener: (e: WsEventLike) => void): void {
    const list = this.listeners.get(type) ?? [];
    list.push(listener);
    this.listeners.set(type, list);
  }
  emit(type: string, event: WsEventLike = {}): void {
    for (const l of this.listeners.get(type) ?? []) l(event);
  }
  /** Replay de uma mensagem Results do protocolo listen. */
  results(transcript: string, isFinal: boolean, start?: number, duration?: number): void {
    this.emit('message', {
      data: JSON.stringify({
        type: 'Results',
        is_final: isFinal,
        start,
        duration,
        channel: { alternatives: [{ transcript }] },
      }),
    });
  }
}

function makeProvider(socket: FakeSocket, urlSink?: { url?: string }) {
  return new DeepgramSttProvider({
    apiKey: 'test-key',
    now: () => 1_000_000,
    socketFactory: (url) => {
      if (urlSink) urlSink.url = url;
      return socket;
    },
  });
}

async function collect(iterable: AsyncIterable<TranscriptSegment>, n: number) {
  const out: TranscriptSegment[] = [];
  for await (const s of iterable) {
    out.push(s);
    if (out.length >= n) break;
  }
  return out;
}

describe('DeepgramSttProvider (Story 2.1)', () => {
  describe('AC1/AC2 — parciais e finais distinguíveis', () => {
    it('mapeia Results parcial/final para TranscriptSegment', async () => {
      const socket = new FakeSocket();
      const session = makeProvider(socket).openStream({ lang: 'pt-BR' });

      socket.results('Paciente em', false, 0, 0.9);
      socket.results('Paciente em GLP-1 com cansaço.', true, 0, 1.5);

      const [partial, final] = await collect(session, 2);
      expect(partial).toMatchObject({ text: 'Paciente em', isFinal: false });
      expect(final).toMatchObject({ text: 'Paciente em GLP-1 com cansaço.', isFinal: true });
      await session.close();
    });

    it('ignora Metadata e resultados vazios', async () => {
      const socket = new FakeSocket();
      const session = makeProvider(socket).openStream({ lang: 'pt-BR' });

      socket.emit('message', { data: JSON.stringify({ type: 'Metadata' }) });
      socket.results('', false);
      socket.results('só este vale.', true);

      const [only] = await collect(session, 1);
      expect(only!.text).toBe('só este vale.');
      await session.close();
    });
  });

  describe('AC4 — timestamps para latência (NFR5)', () => {
    it('segmento carrega startMs/endMs do vendor + receivedAtMs do cliente', async () => {
      const socket = new FakeSocket();
      const session = makeProvider(socket).openStream({ lang: 'pt-BR' });
      socket.results('com tempo.', true, 2.5, 1.25);
      const [seg] = await collect(session, 1);
      expect(seg).toMatchObject({ startMs: 2500, endMs: 3750, receivedAtMs: 1_000_000 });
      await session.close();
    });
  });

  describe('AC3/NFR8 — URL do protocolo e boost de vocabulário (T4)', () => {
    it('monta a URL com language=pt-BR, interim_results e keywords', () => {
      const url = buildListenUrl(
        { apiKey: 'k' },
        { lang: 'pt-BR', vocabularyBoost: ['semaglutida', 'TSH'] },
      );
      const parsed = new URL(url);
      expect(parsed.searchParams.get('language')).toBe('pt-BR');
      expect(parsed.searchParams.get('interim_results')).toBe('true');
      expect(parsed.searchParams.getAll('keywords')).toEqual(['semaglutida', 'TSH']);
      expect(parsed.searchParams.get('model')).toBe('nova-2'); // default
    });

    it('no Nova-3 usa keyterm (não keywords — que o Deepgram ignora nesse modelo) — POC 2.5', () => {
      const url = buildListenUrl(
        { apiKey: 'k', model: 'nova-3' },
        { lang: 'pt-BR', vocabularyBoost: ['precordial', 'semaglutida'] },
      );
      const parsed = new URL(url);
      expect(parsed.searchParams.get('model')).toBe('nova-3');
      expect(parsed.searchParams.getAll('keyterm')).toEqual(['precordial', 'semaglutida']);
      expect(parsed.searchParams.getAll('keywords')).toEqual([]);
    });

    it('autentica via subprotocolo token (sem header custom)', () => {
      const socket = new FakeSocket();
      let protocols: string[] = [];
      const provider = new DeepgramSttProvider({
        apiKey: 'secret',
        socketFactory: (_url, p) => {
          protocols = p;
          return socket;
        },
      });
      provider.openStream({ lang: 'pt-BR' });
      expect(protocols).toEqual(['token', 'secret']);
    });
  });

  describe('AC5 — erros tipados', () => {
    it('erro de conexão encerra a iteração com DeepgramSttError', async () => {
      const socket = new FakeSocket();
      const session = makeProvider(socket).openStream({ lang: 'pt-BR' });
      socket.emit('error');
      await expect(collect(session, 1)).rejects.toBeInstanceOf(DeepgramSttError);
    });

    it('close não-1000 inesperado vira erro; close 1000 encerra limpo', async () => {
      const s1 = new FakeSocket();
      const session1 = makeProvider(s1).openStream({ lang: 'pt-BR' });
      s1.emit('close', { code: 1011 });
      await expect(collect(session1, 1)).rejects.toThrow(/1011/);

      const s2 = new FakeSocket();
      const session2 = makeProvider(s2).openStream({ lang: 'pt-BR' });
      s2.results('fim.', true);
      s2.emit('close', { code: 1000 });
      const segs = [];
      for await (const seg of session2) segs.push(seg);
      expect(segs.map((s) => s.text)).toEqual(['fim.']);
    });
  });

  describe('AC6 — credenciais do ambiente', () => {
    it('DEEPGRAM_API_KEY ausente gera erro claro de config', () => {
      expect(() => deepgramConfigFromEnv({} as NodeJS.ProcessEnv)).toThrow(/DEEPGRAM_API_KEY/);
    });

    it('apiKey vazia é rejeitada na construção', () => {
      expect(() => new DeepgramSttProvider({ apiKey: '' })).toThrow(DeepgramSttError);
    });
  });

  describe('Áudio (contrato consumido pela 2.2)', () => {
    it('bombeia a fonte de áudio após open e envia CloseStream no fim', async () => {
      const socket = new FakeSocket();
      async function* audio() {
        yield new Uint8Array([1, 2]);
        yield new Uint8Array([3]);
      }
      const session = makeProvider(socket).openStream({ lang: 'pt-BR', audio: audio() });
      socket.emit('open');
      await new Promise((r) => setTimeout(r, 0));

      expect(socket.sent).toHaveLength(3);
      expect(socket.sent[2]).toBe(JSON.stringify({ type: 'CloseStream' }));
      await session.close();
      expect(socket.closedWith?.code).toBe(1000);
    });
  });
});

// Integração real (AC7): só roda com credencial e flag explícita — nunca no CI.
describe.skipIf(!process.env.STT_E2E)('Deepgram E2E real (STT_E2E=1)', () => {
  it('abre stream real e fecha sem erro', async () => {
    const provider = new DeepgramSttProvider(deepgramConfigFromEnv());
    const session = provider.openStream({ lang: 'pt-BR' });
    await session.close();
  });
});
