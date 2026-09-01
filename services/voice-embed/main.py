"""
conselho-voice-embed — serviço interno de embeddings de voz (Resemblyzer).

Recebe um clipe de áudio (qualquer formato que o ffmpeg decodifique — o
board manda o mesmo WebM/Opus que já usa pro STT, sem transcodificar do
lado Node) e devolve um vetor de 256 floats que representa a voz de quem
fala nesse clipe. Este serviço NÃO guarda nada — quem persiste o embedding
(cifrado) é o app principal (apps/web, Postgres).

Autenticação: header X-Internal-Token (segredo compartilhado via env var —
nunca hardcoded, nunca em log). Serviço isolado (Fly app próprio) do
conselho-diretor principal: se cair, o board continua funcionando (Tier 1/2
de nomeação por texto seguem de pé — biometria é estritamente opcional).
"""

import io
import os

import numpy as np
from fastapi import FastAPI, Header, HTTPException, UploadFile
from pydub import AudioSegment
from resemblyzer import VoiceEncoder, preprocess_wav

app = FastAPI(title="conselho-voice-embed")
encoder = VoiceEncoder()  # carrega o modelo uma vez, no boot do processo

INTERNAL_TOKEN = os.environ.get("VOICE_EMBED_TOKEN")

# Resemblyzer trabalha a 16kHz; menos que isso de amostras pós-processamento
# (silêncio/trechos fracos já descartados por preprocess_wav) não dá pra
# confiar num embedding — melhor recusar do que devolver algo ruim.
MIN_SAMPLES_16K = int(16_000 * 0.5)  # ~0.5s


def _check_token(token: str | None) -> None:
    if not INTERNAL_TOKEN:
        raise HTTPException(status_code=503, detail="VOICE_EMBED_TOKEN não configurado no servidor.")
    if token != INTERNAL_TOKEN:
        raise HTTPException(status_code=401, detail="Token inválido.")


@app.get("/health")
def health() -> dict:
    return {"status": "ok"}


@app.post("/embed")
async def embed(file: UploadFile, x_internal_token: str | None = Header(default=None)) -> dict:
    _check_token(x_internal_token)

    raw = await file.read()
    if len(raw) == 0:
        raise HTTPException(status_code=400, detail="Arquivo de áudio vazio.")

    try:
        audio = AudioSegment.from_file(io.BytesIO(raw))
    except Exception as exc:  # decodificação do ffmpeg falhou (formato inválido/corrompido)
        raise HTTPException(
            status_code=400, detail=f"Não foi possível decodificar o áudio: {exc}"
        ) from exc

    audio = audio.set_channels(1)
    samples = np.array(audio.get_array_of_samples()).astype(np.float32)
    samples /= np.iinfo(audio.array_type).max  # normaliza pro range [-1, 1] que o encoder espera

    # preprocess_wav resample pra 16kHz, normaliza volume e corta silêncio —
    # tudo que o Resemblyzer precisa antes de gerar o embedding.
    wav = preprocess_wav(samples, source_sr=audio.frame_rate)
    if len(wav) < MIN_SAMPLES_16K:
        raise HTTPException(
            status_code=400,
            detail="Áudio curto demais (ou majoritariamente silêncio) para um embedding confiável.",
        )

    embedding = encoder.embed_utterance(wav)
    return {"embedding": embedding.tolist()}
