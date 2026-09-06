'use client';

import { useEffect, useRef } from 'react';
import { subscribeRecallVideo } from '@/lib/recall-video-bus';
import type { RecallParticipantState } from '@/lib/board-store';

/**
 * Decodifica e desenha o vídeo H.264 de UM participante do bot do Recall.ai
 * (Etapa "Ver participantes/tela compartilhada do Meet") — mesmo padrão do
 * exemplo oficial (`recallai/participant-live-video`): WebCodecs
 * (`VideoDecoder`) direto num `<canvas>`, sem passar pelo React a cada frame
 * (por isso os frames chegam por `recall-video-bus.ts`, fora do Zustand).
 */

const H264_CODEC = 'avc1.42E01E';

/** Varre por start codes de NAL e olha o tipo da primeira slice — 5 = IDR (keyframe). */
function isKeyframe(data: Uint8Array): boolean {
  for (let i = 0; i < data.length - 4; i++) {
    if (data[i] === 0 && data[i + 1] === 0 && (data[i + 2] === 1 || (data[i + 2] === 0 && data[i + 3] === 1))) {
      const nalOffset = data[i + 2] === 1 ? i + 3 : i + 4;
      const nalType = data[nalOffset]! & 0x1f;
      if (nalType === 5) return true;
      if (nalType === 1) return false;
    }
  }
  return false;
}

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function RecallCanvas({
  participantId,
  videoType,
  hidden,
  className,
}: {
  participantId: number;
  videoType: 'webcam' | 'screenshare';
  hidden: boolean;
  className?: string;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (typeof VideoDecoder === 'undefined') return; // navegador sem WebCodecs
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;

    const decoder = new VideoDecoder({
      output: (frame) => {
        if (canvas.width !== frame.displayWidth || canvas.height !== frame.displayHeight) {
          canvas.width = frame.displayWidth;
          canvas.height = frame.displayHeight;
        }
        ctx.drawImage(frame, 0, 0, frame.displayWidth, frame.displayHeight);
        frame.close();
      },
      error: (err) => console.error(`[recall] VideoDecoder (${videoType}) erro:`, err),
    });
    decoder.configure({ codec: H264_CODEC });

    const unsubscribe = subscribeRecallVideo(participantId, (frame) => {
      if (frame.videoType !== videoType) return;
      if (decoder.state !== 'configured' || decoder.decodeQueueSize > 20) return; // fila cheia — descarta (evita acumular atraso)
      const bytes = base64ToBytes(frame.bufferB64);
      decoder.decode(
        new EncodedVideoChunk({
          type: isKeyframe(bytes) ? 'key' : 'delta',
          timestamp: frame.at,
          data: bytes,
        }),
      );
    });

    return () => {
      unsubscribe();
      if (decoder.state !== 'closed') decoder.close();
    };
  }, [participantId, videoType]);

  return <canvas ref={canvasRef} hidden={hidden} className={className} />;
}

export function RecallParticipantTile({ participant }: { participant: RecallParticipantState }) {
  return (
    <div className="rounded-[var(--radius)] border border-white/15 bg-black/40 p-2 text-white">
      <p className="truncate text-xs font-medium">
        {participant.name ?? `Participante #${participant.participantId}`}
        {participant.screenshareOn ? ' · 🖥️ compartilhando tela' : ''}
      </p>
      <RecallCanvas
        participantId={participant.participantId}
        videoType="screenshare"
        hidden={!participant.screenshareOn}
        className="mt-1 w-full rounded-[var(--radius)] bg-black"
      />
      <RecallCanvas
        participantId={participant.participantId}
        videoType="webcam"
        hidden={participant.screenshareOn}
        className="mt-1 w-full rounded-[var(--radius)] bg-black"
      />
    </div>
  );
}
