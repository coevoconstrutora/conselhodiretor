import { createHash } from 'node:crypto';
import { NextResponse } from 'next/server';
import { getAgentProfiles } from '@conselho/kb';
import { getCurrentUser } from '@/lib/auth';
import { getDb } from '@/lib/db';
import { loadAndApplyProfileOverrides } from '@/lib/kb-sources';
import { resolveAgentVoice, buildVoiceInstructions } from '@/lib/tts-voices';
import { expandForSpeech } from '@/lib/tts-glossary';
import { synthesizeSpeech } from '@/lib/openai-tts';
import { DEFAULT_SPEECH_RATE } from '@/lib/ai-config';

/**
 * Voz dos conselheiros (OpenAI TTS) — texto de uma contribuição → áudio.
 * Autenticado: evita que a chave da OpenAI vire um proxy de TTS aberto para
 * quem tiver o link. Usa a voz/instruções/velocidade INDIVIDUAIS do
 * conselheiro (Etapa "IA por conselheiro") quando configuradas; sem isso,
 * cai no fallback por agentId de sempre (tts-voices.ts).
 */
const MAX_CHARS = 4000; // teto da própria API da OpenAI para entrada de fala

export async function POST(request: Request): Promise<NextResponse | Response> {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return NextResponse.json({ error: 'tts-not-configured' }, { status: 503 });

  let body: { agentId?: string; text?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'invalid-json' }, { status: 400 });
  }

  const agentId = body.agentId;
  const text = (body.text ?? '').trim();
  if (!agentId) return NextResponse.json({ error: 'invalid-agent' }, { status: 400 });
  // roster REAL da empresa (padrão + conselheiros CUSTOM), nunca uma lista fixa no código
  const db = await getDb();
  await loadAndApplyProfileOverrides(db, user.companyId);
  const profile = getAgentProfiles(user.companyId)[agentId];
  if (!profile) {
    return NextResponse.json({ error: 'invalid-agent' }, { status: 400 });
  }
  if (!text) return NextResponse.json({ error: 'empty-text' }, { status: 400 });

  const voice = profile.voice ?? resolveAgentVoice(agentId);
  const instructions =
    profile.voiceInstructions?.trim() || buildVoiceInstructions(profile.displayName, profile.riskPosture);
  const input = expandForSpeech(text).slice(0, MAX_CHARS);
  const speed = profile.speechRate ?? DEFAULT_SPEECH_RATE;

  // Custo: a mesma fala é pedida por cada navegador conectado à reunião. Cache em
  // memória (por voz/estilo/velocidade/texto) + deduplicação de requisições em voo:
  // a OpenAI cobra o áudio UMA vez por contribuição, não uma por ouvinte.
  const cacheKey = createHash('sha256').update(`${voice}\n${instructions}\n${speed}\n${input}`).digest('hex');
  let audio = ttsCache.get(cacheKey);
  if (!audio) {
    audio = synthesizeToBuffer({ apiKey, voice, input, instructions, speed });
    ttsCache.set(cacheKey, audio);
    while (ttsCache.size > TTS_CACHE_MAX_ENTRIES) {
      ttsCache.delete(ttsCache.keys().next().value as string);
    }
    audio.catch(() => ttsCache.delete(cacheKey)); // falha nunca fica em cache
  }

  try {
    const buffer = await audio;
    return new Response(new Uint8Array(buffer), {
      headers: { 'content-type': 'audio/mpeg', 'cache-control': 'private, max-age=3600' },
    });
  } catch (error) {
    console.error(`[tts] OpenAI falhou: ${error instanceof Error ? error.message : String(error)}`);
    return NextResponse.json({ error: 'tts-failed' }, { status: 502 });
  }
}

/** Cache de áudio em memória (reuniões ao vivo no mesmo processo) — limitado em nº de entradas. */
const TTS_CACHE_MAX_ENTRIES = 60;
const ttsCache = new Map<string, Promise<Buffer>>();

async function synthesizeToBuffer(opts: Parameters<typeof synthesizeSpeech>[0]): Promise<Buffer> {
  const response = await synthesizeSpeech(opts);
  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new Error(`${response.status} ${detail.slice(0, 200)}`);
  }
  return Buffer.from(await response.arrayBuffer());
}
