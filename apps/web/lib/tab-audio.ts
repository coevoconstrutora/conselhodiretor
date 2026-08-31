/**
 * Captura de áudio de ABA/JANELA (ex.: Google Meet rodando no navegador),
 * alternativa ao microfone físico quando a sala tem ruído de ambiente —
 * `getDisplayMedia` devolve o áudio digital da chamada, sem o barulho da sala.
 *
 * Mesma forma de `checkMicrophone` (microphone.ts): devolve um MediaStream
 * pronto para `createAudioSource`, que é agnóstico à origem do stream.
 */

export type TabAudioStatus = 'ok' | 'denied' | 'no-audio-track' | 'unavailable';

/** Superfície mínima usada (mockável em teste). */
export interface DisplayMediaLike {
  getDisplayMedia(constraints: { video: boolean; audio: boolean }): Promise<MediaStream>;
}

/**
 * Pede ao usuário para escolher uma aba/janela/tela e compartilhar o áudio
 * dela. `getDisplayMedia` exige `video: true` para abrir o seletor do
 * navegador — a faixa de vídeo é descartada imediatamente após a escolha,
 * nunca é lida nem enviada a lugar nenhum.
 */
export async function captureTabAudio(
  mediaDevices: DisplayMediaLike | undefined,
): Promise<{ status: TabAudioStatus; stream?: MediaStream }> {
  if (!mediaDevices?.getDisplayMedia) return { status: 'unavailable' };
  let raw: MediaStream;
  try {
    raw = await mediaDevices.getDisplayMedia({ video: true, audio: true });
  } catch (err) {
    const name = err instanceof DOMException ? err.name : '';
    if (name === 'NotAllowedError' || name === 'SecurityError') return { status: 'denied' };
    return { status: 'unavailable' };
  }

  const audioTracks = raw.getAudioTracks();
  const videoTracks = raw.getVideoTracks();
  for (const track of videoTracks) track.stop(); // só precisamos do áudio

  if (audioTracks.length === 0) {
    for (const track of audioTracks) track.stop();
    return { status: 'no-audio-track' };
  }

  return { status: 'ok', stream: new MediaStream(audioTracks) };
}
