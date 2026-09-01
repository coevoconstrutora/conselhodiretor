# syntax=docker/dockerfile:1
#
# conselho-voice-embed — serviço isolado (Fly app próprio) de embeddings de
# voz (Resemblyzer/PyTorch). Separado do app Next.js principal de propósito:
# dependência pesada (modelo + PyTorch) longe do processo do board; se este
# serviço cair, o Conselho continua funcionando (biometria é best-effort).

FROM python:3.11-slim

RUN apt-get update \
  && apt-get install -y --no-install-recommends ffmpeg \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# CPU-only primeiro — evita puxar as wheels CUDA (o resemblyzer traria por
# padrão via requirements.txt) numa máquina shared-cpu sem GPU.
RUN pip install --no-cache-dir torch --index-url https://download.pytorch.org/whl/cpu

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY main.py .

EXPOSE 8080
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8080"]
