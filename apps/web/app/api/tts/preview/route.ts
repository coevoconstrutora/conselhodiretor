import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { synthesizeSpeech } from '@/lib/openai-tts';
import { isValidVoice, isValidSpeechRate, VOICE_PREVIEW_TEXT, VOICE_STYLE_MAX, DEFAULT_SPEECH_RATE } from '@/lib/ai-config';

/**
 * Preview de voz (Etapa "IA por conselheiro", botão "Ouvir voz") — gera um
 * áudio curto com a voz/estilo/velocidade AINDA NÃO SALVOS do formulário,
 * sem precisar de um `agentId` nem salvar o conselheiro primeiro. Texto
 * SEMPRE fixo (VOICE_PREVIEW_TEXT) — nunca o que o cliente mandar, por
 * custo/abuso.
 */
export async function POST(request: Request): Promise<NextResponse | Response> {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return NextResponse.json({ error: 'tts-not-configured' }, { status: 503 });

  let body: { voice?: string; instructions?: string; speed?: number };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'invalid-json' }, { status: 400 });
  }

  // nunca confiar em voz/velocidade arbitrárias vindas do cliente — só as suportadas (ai-config.ts)
  if (!isValidVoice(body.voice)) return NextResponse.json({ error: 'invalid-voice' }, { status: 400 });
  const speed = isValidSpeechRate(body.speed) ? body.speed : DEFAULT_SPEECH_RATE;
  const instructions =
    typeof body.instructions === 'string' ? body.instructions.trim().slice(0, VOICE_STYLE_MAX) || undefined : undefined;

  const response = await synthesizeSpeech({
    apiKey,
    voice: body.voice,
    input: VOICE_PREVIEW_TEXT,
    instructions,
    speed,
  });

  if (!response.ok || !response.body) {
    const detail = await response.text().catch(() => '');
    console.error(`[tts-preview] OpenAI falhou (${response.status}): ${detail.slice(0, 200)}`);
    return NextResponse.json({ error: 'tts-failed' }, { status: 502 });
  }

  return new Response(response.body, {
    headers: { 'content-type': 'audio/mpeg', 'cache-control': 'no-store' },
  });
}
