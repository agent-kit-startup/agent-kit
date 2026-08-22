# Local LLM lab ops (Docker Compose + Ollama)

How to run the external [Urutau-LLM-Lab](https://github.com/thamaraprata/Urutau-LLM-Lab/) locally, and the reusable ops patterns it demonstrates for any Flask/Ollama-style local LLM stack. **Local and isolated only** — never point lab exercises at hosted third-party instances.

## Topology (docker-compose)

Two services on one bridge network (`urutau-net`):

- **app** — Flask app built from the repo `Dockerfile`, port `5000`, bind-mounts `./data` (SQLite) and `./logs`, `restart: unless-stopped`
- **ollama** — `ollama/ollama:latest`, port `11434`, named volume `ollama-data` for model weights, `OLLAMA_KEEP_ALIVE=24h`

Bring-up:

```bash
cp .env.example .env
docker compose up -d
docker compose exec ollama ollama pull llama3.1:8b   # one-time model pull (~8GB RAM recommended)
# UI: http://localhost:5000
```

## Provider switch (env contract)

Keys come from `.env.example` only — never commit a populated `.env`:

| Key | Purpose |
|-----|---------|
| `LLM_PROVIDER` | `ollama` (default, local) or `openai` |
| `OLLAMA_HOST` / `OLLAMA_MODEL` | Ollama endpoint + model tag |
| `OPENAI_API_KEY` / `OPENAI_MODEL` | Alternative hosted provider; client fails fast when the key is missing |
| `FLASK_ENV` / `FLASK_DEBUG` / `SECRET_KEY` / `PORT` | Flask runtime (lab defaults are development-grade) |
| `DATABASE_PATH` / `LOG_LEVEL` | SQLite path, logging |

Pattern worth reusing: one unified LLM client selects the provider from env at startup and raises immediately on missing credentials, so misconfiguration surfaces at boot rather than mid-request.

## Service surface (for health checks and review)

- `GET /health` — status + active provider; used for container checks
- `POST /api/chat` — the LLM-facing endpoint; the one that carries the OWASP LLM attack surface
- `GET /api/challenges`, `/api/challenges/<id>/hint`, `/api/challenges/<id>/writeup` — curriculum metadata
- Logging pattern worth copying: chat logs record challenge id + message **length**, not message content — transcripts stay out of logs by construction

## Ops review notes (defensive)

- Lab defaults are intentionally development-grade: `FLASK_DEBUG=1`, `app.run(host="0.0.0.0")`, fallback `SECRET_KEY` in compose. Fine for an isolated local lab; each one is a finding if seen in a production LLM service.
- Model weights live in the named volume; `docker compose down -v` removes them (re-pull afterwards).
- Keep lab state out of version control: chat transcripts, `data/` SQLite files, `logs/`, and any populated `.env`.
- Ollama exposes port `11434` on localhost in the lab compose; do not forward it beyond the machine.
