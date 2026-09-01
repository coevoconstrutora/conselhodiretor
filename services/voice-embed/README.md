# conselho-voice-embed

Serviço interno (Python/FastAPI) que transforma um clipe de áudio num vetor
de 256 floats (embedding de voz, via [Resemblyzer](https://github.com/resemble-ai/Resemblyzer)).
Usado pelo Conselho para reconhecer o mesmo participante em reuniões
diferentes, sem precisar se reapresentar — feature opt-in por empresa
(dado biométrico, LGPD).

Este serviço **não guarda nada**: recebe áudio, devolve o vetor, esquece.
Quem persiste o embedding (cifrado) é o app principal (`apps/web`,
Postgres, tabela `voice_profile`).

## Rodar localmente

Precisa de Python 3.11+ e `ffmpeg` instalado no sistema.

```bash
cd services/voice-embed
pip install torch --index-url https://download.pytorch.org/whl/cpu
pip install -r requirements.txt
VOICE_EMBED_TOKEN=um-segredo-qualquer uvicorn main:app --reload --port 8080
```

Teste:

```bash
curl -X POST http://localhost:8080/embed \
  -H "X-Internal-Token: um-segredo-qualquer" \
  -F "file=@algum-audio.wav"
```

## Deploy (Fly.io — app próprio, separado do `conselho-diretor`)

```bash
flyctl deploy --config services/voice-embed/fly.toml --dockerfile services/voice-embed/Dockerfile services/voice-embed
flyctl secrets set VOICE_EMBED_TOKEN=<gerar um segredo forte> -a conselho-voice-embed
```

O app principal precisa do MESMO valor em `VOICE_EMBED_TOKEN` (Fly secret
em `conselho-diretor`) para autenticar as chamadas — nunca versionado, só
como secret nos dois apps.

## Por que um serviço separado (não dentro do Next.js)

Os modelos de embedding de voz maduros são Python/PyTorch — não existe
equivalente Node maduro. Isolar num Fly app próprio evita colocar
PyTorch/modelo (peso considerável) no processo do board, e significa que
se este serviço cair ou estiver fora do ar, o Conselho continua
funcionando normalmente (a nomeação por autoapresentação em texto e a
correção manual — Tier 1/2 — não dependem disto).
