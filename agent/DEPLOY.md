# Deploy the BoDay agent

Stateless Cloud Run service. The app posts a snapshot and a message. The service returns one proposal. It does not read or write the user's task tables.

## owner step — GCP billing

The Cloud Run free tier needs a billing account on the GCP project. The spec quotes 2M requests, 180k vCPU-s, and 360k GiB-s per month, which is more than personal use. Set a budget alert at $1.

## owner step — Supabase migration

Run `agent/sql/agent_traces.sql` in the Supabase SQL editor. It is safe to run again. Then, in that editor, set the role password with `alter role agent_tracer password '...'`. The password is not written into this repo.

The direct database host is IPv6-only on the free plan, and Cloud Run sends IPv4, so use the Supavisor pooler. `AGENT_TRACES_DSN` is:

`postgresql://agent_tracer.cgsjsbsxuzawvgunrpqi:<password>@aws-0-us-west-1.pooler.supabase.com:6543/postgres`

That is transaction mode. Copy the exact host from Supabase → Connect. The pooler user name is the role name, a dot, and the project ref. `postgres_connect` already turns prepared statements off for this mode.

Schedule the delete of rows older than 30 days once `pg_cron` is enabled (Database → Extensions). The comment at the end of the SQL file has the `cron.schedule` statement. This file does not delete rows.

## owner step — Cloud Run

Region `us-west1` (the closest free-tier region to the Supabase project in us-west-1). Fixed flags:

`--region=us-west1 --memory=512Mi --cpu=1 --max-instances=1 --timeout=120 --allow-unauthenticated`

Port `8080`. Cloud Run's default TCP startup probe is the health check. Do not configure an HTTP probe: `GET /health` needs a JWT.

Map these env names as Cloud Run secrets:

- `AGENT_ENCRYPTION_KEY` — standard base64 of 32 bytes
- `SUPABASE_JWKS_URL` — `https://cgsjsbsxuzawvgunrpqi.supabase.co/auth/v1/.well-known/jwks.json`
- `SUPABASE_JWT_SECRET` — only if JWKS is not used; if both are set, JWKS wins
- `SUPABASE_JWT_ISSUER` — `https://cgsjsbsxuzawvgunrpqi.supabase.co/auth/v1`
- `ADMIN_EMAIL`
- `ANTHROPIC_API_KEY`
- `BODAY_LOCAL_BASE_URL`
- `BODAY_LOCAL_MODEL`
- `CF_ACCESS_CLIENT_ID`
- `CF_ACCESS_CLIENT_SECRET`
- `AGENT_TRACES_DSN`
- `AGENT_ALLOWED_ORIGINS` — `https://boday.boapps.workers.dev,http://localhost:5173`
- `PORT` — Cloud Run sets this; the image defaults to 8080

## owner step — the Mac

Ollama starts at login. `cloudflared` serves a hostname under `expense-app.uk` (the spec's example is `llm.expense-app.uk`). Create a Cloudflare Access service token. The Cloud Run service sends `CF-Access-Client-Id` and `CF-Access-Client-Secret`. Put the public `https` base URL (ending in `/v1` if Ollama is mounted there) in `BODAY_LOCAL_BASE_URL` and the chosen model id in `BODAY_LOCAL_MODEL`. Do not pick the model in this repo.

## owner step — the app

Builds run on the owner's Mac, not on Cloudflare. Put `VITE_AGENT_URL=<Cloud Run URL, no trailing slash>` in the repo-root `.env` (gitignored) and then run `npm run build && npx wrangler deploy`. Set an Artifact Registry cleanup policy so the repository stays under 0.5 GB.

## Local run without deploy

From `agent/`:

`uv run uvicorn --factory boday_agent.server.app:app_from_env --reload`

With `AGENT_TRACES_DSN` empty the service uses `MemorySink` and traces disappear when the process stops. `create_app` raises at startup unless `SUPABASE_JWT_SECRET` or `SUPABASE_JWKS_URL` is set. Without `AGENT_ENCRYPTION_KEY`, `POST /encrypt` returns 503 and saved keys cannot be read.
