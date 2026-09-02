'use client';

import { useActionState, useRef, useState } from 'react';
import { formatDateBR } from '@/lib/format';
import type { VoiceProfileStatus } from '@/lib/voice-profile';
import {
  grantVoiceConsentAction,
  enrollParticipantVoiceAction,
  revokeVoiceAction,
  deleteVoiceAction,
  type ParticipantActionState,
} from '@/lib/participant-actions';

const SAMPLE_COUNT = 3;
const MIN_SECONDS = 6;
const TARGET_SECONDS = 15;

const buttonCls =
  'rounded-[var(--radius)] bg-brand px-4 py-2 text-xs font-semibold text-white shadow-sm transition-opacity hover:opacity-90 disabled:opacity-50';
const secondaryButtonCls =
  'rounded-[var(--radius)] border border-ink/15 px-3 py-1.5 text-xs font-semibold text-ink transition-colors hover:bg-surface-muted disabled:opacity-50';

const STATUS_LABEL: Record<string, string> = {
  not_enrolled: 'Não cadastrada',
  pending: 'Cadastro pendente',
  enrolled: 'Cadastrada',
  requires_update: 'Requer atualização',
  consent_revoked: 'Consentimento revogado',
};

function pickMimeType(): string {
  const candidates = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg'];
  for (const c of candidates) {
    if (typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(c)) return c;
  }
  return 'audio/webm';
}

interface RecordedSample {
  readonly blob: Blob;
  readonly durationMs: number;
}

function sampleQualityLabel(durationMs: number): { label: string; ok: boolean } {
  if (durationMs < MIN_SECONDS * 1000) return { label: '⚠ Insuficiente', ok: false };
  if (durationMs < TARGET_SECONDS * 1000) return { label: '● Aceitável', ok: true };
  return { label: '✓ Boa', ok: true };
}

/** Assistente EXPLÍCITO "Cadastrar voz" (Seção 7) — consentimento → mic → 3 amostras → confirmação. Sem frase secreta. */
function VoiceEnrollmentWizard({
  participantId,
  participantName,
  participantArea,
  consentGranted,
  onDone,
}: {
  participantId: string;
  participantName: string;
  participantArea: string | null;
  consentGranted: boolean;
  onDone: () => void;
}) {
  const [step, setStep] = useState<'consent' | 'record' | 'submitting' | 'done'>(
    consentGranted ? 'record' : 'consent',
  );
  const [consentState, consentAction, consentPending] = useActionState<ParticipantActionState, FormData>(
    grantVoiceConsentAction,
    null,
  );
  const [samples, setSamples] = useState<Array<RecordedSample | null>>(Array(SAMPLE_COUNT).fill(null));
  const [recordingIndex, setRecordingIndex] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ ok?: string; qualityScore?: number } | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const startedAtRef = useRef<number>(0);

  async function startRecording(index: number) {
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const mimeType = pickMimeType();
      const recorder = new MediaRecorder(stream, { mimeType });
      const chunks: BlobPart[] = [];
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunks.push(e.data);
      };
      recorder.onstop = () => {
        const durationMs = Date.now() - startedAtRef.current;
        const blob = new Blob(chunks, { type: mimeType });
        setSamples((prev) => {
          const next = [...prev];
          next[index] = { blob, durationMs };
          return next;
        });
        stream.getTracks().forEach((t) => t.stop());
        setRecordingIndex(null);
      };
      mediaRecorderRef.current = recorder;
      startedAtRef.current = Date.now();
      recorder.start();
      setRecordingIndex(index);
    } catch {
      setError('Não foi possível acessar o microfone — verifique a permissão do navegador.');
    }
  }

  function stopRecording() {
    mediaRecorderRef.current?.stop();
  }

  async function submit() {
    setError(null);
    const recorded = samples.filter((s): s is RecordedSample => s !== null);
    if (recorded.length < SAMPLE_COUNT) {
      setError(`Grave as ${SAMPLE_COUNT} amostras antes de confirmar.`);
      return;
    }
    setStep('submitting');
    const formData = new FormData();
    formData.set('participantId', participantId);
    formData.set('participantName', participantName);
    formData.set('participantArea', participantArea ?? '');
    recorded.forEach((s, i) => {
      formData.set(`sample${i}`, s.blob, `sample${i}.webm`);
      formData.set(`sample${i}DurationMs`, String(s.durationMs));
    });
    const res = await enrollParticipantVoiceAction(null, formData);
    if (res?.error) {
      setError(res.error);
      setStep('record');
      return;
    }
    setResult(res);
    setStep('done');
  }

  if (step === 'consent') {
    return (
      <form action={consentAction} className="space-y-3 rounded-[var(--radius)] border border-ink/10 p-4">
        <input type="hidden" name="participantId" value={participantId} />
        <p className="text-sm text-ink">
          A voz de <strong>{participantName}</strong> será usada para:
        </p>
        <ul className="list-disc space-y-0.5 pl-5 text-xs text-ink-muted">
          <li>identificar o participante durante reuniões</li>
          <li>associar a fala ao participante na transcrição</li>
          <li>melhorar a ata automática da reunião</li>
          <li>calcular métricas objetivas de participação</li>
        </ul>
        <p className="text-xs text-ink-muted">
          A biometria <strong>não</strong> é usada para login, pode ser excluída por um administrador
          a qualquer momento, e fica protegida separadamente dos dados comuns do perfil.
        </p>
        <label className="flex items-start gap-2 text-xs font-medium text-ink">
          <input type="checkbox" name="consent" required className="mt-0.5" />
          <span>Autorizo o uso da minha biometria de voz para identificação em reuniões.</span>
        </label>
        {consentState?.error ? <p className="text-xs font-medium text-attn-critical">⚠ {consentState.error}</p> : null}
        <div className="flex items-center gap-2">
          <button type="submit" disabled={consentPending} className={buttonCls}>
            {consentPending ? 'Registrando…' : 'Continuar'}
          </button>
          <button type="button" onClick={onDone} className={secondaryButtonCls}>
            Cancelar
          </button>
        </div>
      </form>
    );
  }

  if (step === 'done') {
    return (
      <div className="space-y-2 rounded-[var(--radius)] border border-success/30 bg-success/5 p-4 text-sm">
        <p className="font-medium text-success">✓ {result?.ok ?? 'Voz cadastrada.'}</p>
        <button type="button" onClick={onDone} className={secondaryButtonCls}>
          Fechar
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-3 rounded-[var(--radius)] border border-ink/10 p-4">
      <p className="text-sm text-ink">
        Grave {SAMPLE_COUNT} amostras falando naturalmente (ex.: descreva seu dia de trabalho) — sem
        frase secreta, {MIN_SECONDS}-{TARGET_SECONDS}s cada.
      </p>
      <div className="space-y-2">
        {Array.from({ length: SAMPLE_COUNT }).map((_, i) => {
          const sample = samples[i];
          const quality = sample ? sampleQualityLabel(sample.durationMs) : null;
          const isRecording = recordingIndex === i;
          return (
            <div key={i} className="flex items-center gap-3 rounded-[var(--radius)] border border-ink/10 p-2.5">
              <span className="w-20 shrink-0 text-xs font-semibold text-ink">Amostra {i + 1}</span>
              {isRecording ? (
                <button type="button" onClick={stopRecording} className={secondaryButtonCls}>
                  ⏹ Parar
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => void startRecording(i)}
                  disabled={recordingIndex !== null}
                  className={secondaryButtonCls}
                >
                  {sample ? '🎙 Regravar' : '🎙 Gravar'}
                </button>
              )}
              {sample && quality ? (
                <span className={`text-xs font-medium ${quality.ok ? 'text-success' : 'text-attn-critical'}`}>
                  {quality.label} ({Math.round(sample.durationMs / 1000)}s)
                </span>
              ) : null}
            </div>
          );
        })}
      </div>
      {error ? <p className="text-xs font-medium text-attn-critical">⚠ {error}</p> : null}
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => void submit()}
          disabled={step === 'submitting' || samples.some((s) => s === null)}
          className={buttonCls}
        >
          {step === 'submitting' ? 'Processando…' : 'Confirmar cadastro'}
        </button>
        <button type="button" onClick={onDone} className={secondaryButtonCls}>
          Cancelar
        </button>
      </div>
    </div>
  );
}

export function ParticipantVoiceSection({
  participantId,
  participantName,
  participantArea,
  status,
  consentGranted,
}: {
  participantId: string;
  participantName: string;
  participantArea: string | null;
  status: VoiceProfileStatus;
  consentGranted: boolean;
}) {
  const [wizardOpen, setWizardOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  return (
    <div className="space-y-4">
      <div className="rounded-[var(--radius)] border border-ink/10 bg-surface-muted/40 p-4 text-sm">
        <p>
          Status: <strong>{STATUS_LABEL[status.status]}</strong>
        </p>
        {status.status === 'enrolled' ? (
          <div className="mt-2 space-y-0.5 text-xs text-ink-muted">
            <p>Cadastrada em: {status.enrolledAt ? formatDateBR(status.enrolledAt) : '—'}</p>
            <p>Última atualização: {status.lastUpdatedAt ? formatDateBR(status.lastUpdatedAt) : '—'}</p>
            <p>Amostras válidas: {status.sampleCount ?? '—'}</p>
            <p>Modelo: {status.modelProvider ?? '—'} · {status.modelVersion ?? '—'}</p>
            <p>Última identificação: {status.lastUsedAt ? formatDateBR(status.lastUsedAt) : 'nunca'}</p>
            <p>Consentimento: {consentGranted ? 'Concedido' : 'Ausente/revogado'}</p>
            <p className="pt-1 font-medium text-ink">🔒 Criptografia: Ativa (AES-256-GCM)</p>
          </div>
        ) : null}
      </div>

      {!wizardOpen ? (
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" onClick={() => setWizardOpen(true)} className={buttonCls}>
            🎙️ {status.status === 'enrolled' ? 'Atualizar perfil de voz' : 'Cadastrar voz'}
          </button>
          {status.status === 'enrolled' ? (
            <>
              <form action={revokeVoiceAction}>
                <input type="hidden" name="participantId" value={participantId} />
                <button type="submit" className={secondaryButtonCls}>
                  Revogar biometria
                </button>
              </form>
              {!confirmDelete ? (
                <button type="button" onClick={() => setConfirmDelete(true)} className={secondaryButtonCls}>
                  🗑 Excluir biometria
                </button>
              ) : (
                <form action={deleteVoiceAction} className="flex items-center gap-2">
                  <input type="hidden" name="participantId" value={participantId} />
                  <span className="text-xs text-attn-critical">
                    Excluirá os modelos biométricos. O histórico de reuniões permanece.
                  </span>
                  <button type="submit" className="rounded-[var(--radius)] bg-attn-critical px-3 py-1.5 text-xs font-semibold text-white">
                    Confirmar exclusão
                  </button>
                </form>
              )}
            </>
          ) : null}
        </div>
      ) : (
        <VoiceEnrollmentWizard
          participantId={participantId}
          participantName={participantName}
          participantArea={participantArea}
          consentGranted={consentGranted}
          onDone={() => setWizardOpen(false)}
        />
      )}
    </div>
  );
}
