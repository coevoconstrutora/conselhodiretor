'use client';

import { useActionState, useEffect, useRef, useState } from 'react';
import { formatDateBR } from '@/lib/format';
import {
  VOICE_PHRASE_COUNT,
  VOICE_ENROLL_ROUNDS,
  VOICE_REQUIRED_SAMPLES,
  MIN_SAMPLE_LEVEL,
} from '@/lib/voice-quality';
import type { VoiceProfileStatus } from '@/lib/voice-profile';
import {
  grantVoiceConsentAction,
  enrollParticipantVoiceAction,
  revokeVoiceAction,
  deleteVoiceAction,
  type ParticipantActionState,
} from '@/lib/participant-actions';

const SAMPLE_COUNT = VOICE_REQUIRED_SAMPLES; // 3 frases × 2 rodadas
const MIN_SECONDS = 6;
const TARGET_SECONDS = 15;

/**
 * Roteiro de leitura por amostra — NÃO é frase secreta (aparece na tela,
 * qualquer pessoa pode ler as mesmas frases; não serve pra autenticar, só
 * pra biometria de timbre). Antes a gravação era 100% livre ("descreva seu
 * dia de trabalho"), o que dava amostras curtas demais ou silêncio — com um
 * texto pra ler, a duração fica previsível (6-15s) e cobre sons variados
 * (vogais abertas/fechadas, nasais, números) pro embedding de voz.
 */
function buildSampleScripts(participantName: string): readonly string[] {
  const firstName = participantName.trim().split(/\s+/)[0] || participantName;
  return [
    `Meu nome é ${firstName}, e hoje é um bom dia para conversarmos sobre o andamento dos projetos da empresa.`,
    'Prefiro tomar decisões com base em números concretos, prazos bem definidos e uma comunicação clara com a equipe.',
    'Nas próximas semanas vamos revisar o orçamento, o cronograma da obra e as prioridades de cada departamento.',
  ];
}

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
  /** Pico de volume (RMS 0-1) durante a gravação — detecta microfone mudo/muito distante. */
  readonly peakLevel: number;
}

function sampleQualityLabel(durationMs: number, peakLevel: number): { label: string; ok: boolean } {
  if (durationMs < MIN_SECONDS * 1000) return { label: '⚠ Curta demais', ok: false };
  if (peakLevel < MIN_SAMPLE_LEVEL) return { label: '⚠ Volume muito baixo', ok: false };
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
  /** Nível de voz ao vivo (0-1) e segundos decorridos — feedback durante a gravação. */
  const [liveLevel, setLiveLevel] = useState(0);
  const [elapsedSec, setElapsedSec] = useState(0);
  const peakLevelRef = useRef(0);
  const meterRef = useRef<{ timer: ReturnType<typeof setInterval>; ctx: AudioContext } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ ok?: string; qualityScore?: number } | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const startedAtRef = useRef<number>(0);

  // `step` só parte de `consentGranted` na MONTAGEM (useState não reage a
  // props novas) — sem isto, conceder consentimento deixava o wizard preso
  // na tela de consentimento até fechar e reabrir (só um reload pegava o
  // `consentGranted` atualizado do Server Component).
  useEffect(() => {
    if (consentState?.ok && step === 'consent') setStep('record');
  }, [consentState, step]);

  async function startRecording(index: number) {
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const mimeType = pickMimeType();
      // 32 kbps Opus é mais que suficiente p/ voz e mantém as 6 gravações leves no envio
      const recorder = new MediaRecorder(stream, { mimeType, audioBitsPerSecond: 32_000 });

      // medidor de nível (RMS): mostra ao vivo e guarda o pico p/ barrar gravação muda
      peakLevelRef.current = 0;
      setLiveLevel(0);
      setElapsedSec(0);
      try {
        const ctx = new AudioContext();
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 1024;
        ctx.createMediaStreamSource(stream).connect(analyser);
        const buf = new Float32Array(analyser.fftSize);
        const timer = setInterval(() => {
          analyser.getFloatTimeDomainData(buf);
          let sum = 0;
          for (const v of buf) sum += v * v;
          const rms = Math.sqrt(sum / buf.length);
          peakLevelRef.current = Math.max(peakLevelRef.current, rms);
          setLiveLevel(Math.min(1, rms * 6));
          setElapsedSec(Math.floor((Date.now() - startedAtRef.current) / 1000));
        }, 100);
        meterRef.current = { timer, ctx };
      } catch {
        peakLevelRef.current = 1; // sem AudioContext não dá p/ medir — não barra a gravação
      }
      const chunks: BlobPart[] = [];
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunks.push(e.data);
      };
      recorder.onstop = () => {
        const durationMs = Date.now() - startedAtRef.current;
        const blob = new Blob(chunks, { type: mimeType });
        const peakLevel = peakLevelRef.current;
        setSamples((prev) => {
          const next = [...prev];
          next[index] = { blob, durationMs, peakLevel };
          return next;
        });
        if (meterRef.current) {
          clearInterval(meterRef.current.timer);
          void meterRef.current.ctx.close().catch(() => {});
          meterRef.current = null;
        }
        setLiveLevel(0);
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
      setError(`Grave as ${SAMPLE_COUNT} amostras (2 rodadas) antes de confirmar.`);
      return;
    }
    if (recorded.some((s) => !sampleQualityLabel(s.durationMs, s.peakLevel).ok)) {
      setError('Regrave as amostras marcadas com ⚠ antes de confirmar.');
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
          A biometria <strong>não</strong> é usada para login, pode ser revogada ou excluída a qualquer
          momento (pelo próprio participante ou por um administrador), e fica protegida separadamente
          dos dados comuns do perfil.
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

  const scripts = buildSampleScripts(participantName);

  return (
    <div className="space-y-3 rounded-[var(--radius)] border border-ink/10 p-4">
      <p className="text-sm text-ink">
        Leia cada frase em voz alta e natural enquanto grava. São <strong>{VOICE_ENROLL_ROUNDS} rodadas</strong> com
        as mesmas {VOICE_PHRASE_COUNT} frases — a repetição deixa o reconhecimento da sua voz bem mais preciso. Não é
        uma senha: qualquer pessoa pode ler as mesmas frases.
      </p>
      <ul className="list-disc space-y-0.5 pl-5 text-xs text-ink-muted">
        <li>Fique sozinho(a), em um lugar silencioso, sem música nem outras vozes ao fundo.</li>
        <li>Mantenha a distância que você usa nas reuniões (cerca de um palmo do microfone) e fale em tom normal.</li>
        <li>
          Cada frase leva de {MIN_SECONDS} a {TARGET_SECONDS} segundos — não precisa ter pressa.
        </li>
      </ul>
      <div className="space-y-4">
        {Array.from({ length: VOICE_ENROLL_ROUNDS }).map((_, round) => (
          <div key={round} className="space-y-2">
            <h4 className="text-xs font-semibold uppercase tracking-wide text-ink-muted">
              Rodada {round + 1} de {VOICE_ENROLL_ROUNDS}
              {round > 0 ? ' — leia de novo, no tom que usaria numa reunião' : ''}
            </h4>
            {Array.from({ length: VOICE_PHRASE_COUNT }).map((__, phrase) => {
              const i = round * VOICE_PHRASE_COUNT + phrase;
              const sample = samples[i];
              const quality = sample ? sampleQualityLabel(sample.durationMs, sample.peakLevel) : null;
              const isRecording = recordingIndex === i;
              return (
                <div key={i} className="space-y-1.5 rounded-[var(--radius)] border border-ink/10 p-2.5">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-semibold text-ink">
                      Frase {phrase + 1} · gravação {i + 1} de {SAMPLE_COUNT}
                    </span>
                    {sample && quality ? (
                      <span className={`text-xs font-medium ${quality.ok ? 'text-success' : 'text-attn-critical'}`}>
                        {quality.label} ({Math.round(sample.durationMs / 1000)}s)
                      </span>
                    ) : null}
                  </div>
                  <p className="rounded-[var(--radius)] bg-surface-muted/60 p-2 text-sm italic leading-relaxed text-ink">
                    “{scripts[phrase]}”
                  </p>
                  {isRecording ? (
                    <div className="flex items-center gap-3">
                      <button type="button" onClick={stopRecording} className={secondaryButtonCls}>
                        ⏹ Parar
                      </button>
                      <span className="text-xs font-medium text-attn-critical">● Gravando {elapsedSec}s</span>
                      <div
                        className="h-2 w-28 overflow-hidden rounded-full bg-ink/10"
                        role="meter"
                        aria-label="Nível da sua voz"
                        aria-valuemin={0}
                        aria-valuemax={100}
                        aria-valuenow={Math.round(liveLevel * 100)}
                      >
                        <div
                          className="h-full bg-brand transition-[width] duration-100"
                          style={{ width: `${liveLevel * 100}%` }}
                        />
                      </div>
                    </div>
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
                </div>
              );
            })}
          </div>
        ))}
      </div>
      {error ? <p className="text-xs font-medium text-attn-critical">⚠ {error}</p> : null}
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => void submit()}
          disabled={
            step === 'submitting' ||
            !samples.every((s) => s !== null && sampleQualityLabel(s.durationMs, s.peakLevel).ok)
          }
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
