import { NextResponse } from 'next/server';
import { getAgentProfiles } from '@conselho/kb';
import { getCurrentUser } from '@/lib/auth';
import { getDb } from '@/lib/db';
import { loadAndApplyProfileOverrides } from '@/lib/kb-sources';
import { resolveAgentVoice, buildVoiceInstructions } from '@/lib/tts-voices';

/**
 * Voz dos conselheiros (OpenAI TTS) — texto de uma contribuição → áudio.
 * Sem SDK de vendor (mesmo padrão dos adapters de LLM). Autenticado: evita
 * que a chave da OpenAI vire um proxy de TTS aberto para quem tiver o link.
 */
const OPENAI_TTS_ENDPOINT = 'https://api.openai.com/v1/audio/speech';
const TTS_MODEL = 'gpt-4o-mini-tts'; // versão mais nova, mais barata que tts-1
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

  const voice = resolveAgentVoice(agentId);
  const instructions = buildVoiceInstructions(profile.displayName, profile.riskPosture);
  const response = await fetch(OPENAI_TTS_ENDPOINT, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: TTS_MODEL,
      voice,
      input: text.slice(0, MAX_CHARS),
      instructions,
      response_format: 'mp3',
    }),
  });

  if (!response.ok || !response.body) {
    const detail = await response.text().catch(() => '');
    console.error(`[tts] OpenAI falhou (${response.status}): ${detail.slice(0, 200)}`);
    return NextResponse.json({ error: 'tts-failed' }, { status: 502 });
  }

  return new Response(response.body, {
    headers: { 'content-type': 'audio/mpeg', 'cache-control': 'no-store' },
  });
}
