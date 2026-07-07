import { describe, it, expect } from 'vitest';
import type {
  ISttProvider,
  ILlmProvider,
  IKnowledgeRetriever,
  IVideoAssetProvider,
} from './interfaces';
import type { TranscriptSegment, KbChunk, VideoState } from './types';
import {
  FakeSttProvider,
  FakeLlmProvider,
  FakeKnowledgeRetriever,
  FakeVideoAssetProvider,
} from './fakes';

// Os fakes são atribuídos às interfaces — prova de conformidade de tipo (AC1/AC2).
const stt: ISttProvider = new FakeSttProvider();
const llm: ILlmProvider = new FakeLlmProvider();
const retriever: IKnowledgeRetriever = new FakeKnowledgeRetriever();
const video: IVideoAssetProvider = new FakeVideoAssetProvider();

describe('ISttProvider (fake) — streaming parciais/finais', () => {
  it('emite uma sequência determinística terminando em segmento final', async () => {
    const session = stt.openStream({ lang: 'pt-BR' });
    const got: TranscriptSegment[] = [];
    for await (const segment of session) {
      got.push(segment);
    }
    await session.close();

    expect(got.length).toBeGreaterThanOrEqual(2);
    expect(got.some((s) => !s.isFinal)).toBe(true); // há parciais
    expect(got.at(-1)?.isFinal).toBe(true); // termina no final
  });

  it('close() interrompe a iteração sem emitir mais segmentos', async () => {
    const session = new FakeSttProvider([
      { text: 'a', isFinal: false },
      { text: 'a b', isFinal: true },
    ]).openStream({ lang: 'pt-BR' });
    await session.close();
    const got: TranscriptSegment[] = [];
    for await (const segment of session) got.push(segment);
    expect(got).toHaveLength(0);
  });
});

describe('ILlmProvider (fake) — AgentContribution previsível', () => {
  it('retorna contribuição determinística derivada do transcript', async () => {
    const context: KbChunk[] = [{ id: 'k1', agentId: 'mercado', text: 'demanda' }];
    const contribution = await llm.complete({
      system: 'persona Yara',
      context,
      transcript: 'cansaço e platô',
    });
    expect(contribution.agentId).toBe('presidente'); // default do fake
    expect(contribution.type).toBe('sugestao');
    expect(contribution.severity).toBe('normal');
    expect(contribution.text).toContain('cansaço e platô');
    expect(contribution.kbSources).toEqual(['k1']); // proveniência (audit 1.5)
  });

  it('permite configurar persona e tipo', async () => {
    const agente = new FakeLlmProvider('mercado', 'hipotese');
    const contribution = await agente.complete({ system: '', context: [], transcript: 't' });
    expect(contribution.agentId).toBe('mercado');
    expect(contribution.type).toBe('hipotese');
  });
});

describe('IKnowledgeRetriever (fake) — escopo por persona (FR21)', () => {
  it('recupera SÓ chunks do namespace da persona pedida', async () => {
    const outro = await retriever.retrieve('legal', 'registro', 10);
    expect(outro.length).toBeGreaterThan(0);
    expect(outro.every((c) => c.agentId === 'legal')).toBe(true);
  });

  it('não vaza conhecimento de outra persona', async () => {
    const agente = await retriever.retrieve('mercado', 'qualquer', 10);
    expect(agente.some((c) => c.agentId === 'legal')).toBe(false);
    expect(agente.some((c) => c.agentId === 'presidente')).toBe(false);
  });

  it('respeita o limite k', async () => {
    const catalog: KbChunk[] = [
      { id: 'a1', agentId: 'presidente', text: '1' },
      { id: 'a2', agentId: 'presidente', text: '2' },
      { id: 'a3', agentId: 'presidente', text: '3' },
    ];
    const r = new FakeKnowledgeRetriever(catalog);
    expect(await r.retrieve('presidente', 'q', 2)).toHaveLength(2);
  });

  it('persona sem chunks retorna lista vazia (não erro)', async () => {
    const empty = new FakeKnowledgeRetriever([]);
    expect(await empty.retrieve('presidente', 'q', 5)).toEqual([]);
  });
});

describe('IVideoAssetProvider (fake) — catálogo pré-renderizado (ADR-007)', () => {
  it('resolve um ClipRef determinístico por (persona, estado)', () => {
    const states: VideoState[] = ['ouvindo', 'pensando', 'sinalizando'];
    for (const state of states) {
      const clip = video.getClip('presidente', state);
      expect(clip.agentId).toBe('presidente');
      expect(clip.state).toBe(state);
      expect(clip.url).toContain(`presidente/${state}`);
    }
  });
});
