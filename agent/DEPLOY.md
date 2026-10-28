# Deploy the BoDay agent

Stateless Cloud Run service. The app posts a snapshot and a message. The service returns one proposal. It does not read or write the user's task tables.

## owner step — GCP billing

The Cloud Run free tier needs a billing account on the GCP project. The spec quotes 2M requests, 180k vCPU-s, and 360k GiB-s per month, which is more than personal use. Set a budget alert at $1.

## owner step — Supabase migration

Run `agent/sql/agent_traces.sql` in the Supabase SQL editor. It is safe to run again. Then, in that editor, set the role password with `alter role agent_tracer password '...'`. The password is not written into this repo.

The direct database host is IPv6-only on the free plan, and Cloud Run sends IPv4, so use the Supavisor pooler. `AGENT_TRACES_DSN` is:

`postgresql://agent_tracer.cgsjsbsxuzawvgunrpqi:<password>@aws-1-us-west-1.pooler.supabase.com:6543/postgres`

That is transaction mode. The host is `aws-1`, not `aws-0`: `aws-0` answers "tenant/user not found" for this project. Copy the exact host from Supabase → Connect if it ever changes. The pooler user name is the role name, a dot, and the project ref. `postgres_connect` already turns prepared statements off for this mode.

Schedule the delete of rows older than 30 days once `pg_cron` is enabled (Database → Extensions). The comment at the end of the SQL file has the `cron.schedule` statement. This file does not delete rows.

## owner step — Cloud Run

Region `us-west1` (the closest free-tier region to the Supabase project in us-west-1). Fixed flags:

`--region=us-west1 --memory=512Mi --cpu=1 --max-instances=1 --timeout=120 --allow-unauthenticated`

Port `8080`. Cloud Run's default TCP startup probe is the health check. Do not configure an HTTP probe: `GET /health` needs a JWT.

### Secrets

Store these in Secret Manager and map them with `--set-secrets`. Secret Manager's free tier covers 6 active secret versions, and this list uses 5, or 6 with `SUPABASE_JWT_SECRET`.

- `AGENT_ENCRYPTION_KEY` — standard base64 of 32 bytes; see "Encryption key" below
- `ANTHROPIC_API_KEY`
- `CF_ACCESS_CLIENT_ID` — only for Local mode
- `CF_ACCESS_CLIENT_SECRET` — only for Local mode
- `AGENT_TRACES_DSN`
- `SUPABASE_JWT_SECRET` — only if JWKS is not used; if both are set, JWKS wins

Create each one once, and let the service account read it. `PROJECT_NUMBER` is on the GCP dashboard:

```sh
printf '%s' '<value>' | gcloud secrets create anthropic-api-key --data-file=-
gcloud secrets add-iam-policy-binding anthropic-api-key \
  --member=serviceAccount:PROJECT_NUMBER-compute@developer.gserviceaccount.com \
  --role=roles/secretmanager.secretAccessor
```

### Config

Plain environment variables. None of them is secret.

- `SUPABASE_JWKS_URL` — `https://cgsjsbsxuzawvgunrpqi.supabase.co/auth/v1/.well-known/jwks.json`
- `SUPABASE_JWT_ISSUER` — `https://cgsjsbsxuzawvgunrpqi.supabase.co/auth/v1`
- `ADMIN_EMAIL`
- `BODAY_LOCAL_BASE_URL`
- `BODAY_LOCAL_MODEL`
- `BODAY_LOCAL_EFFORT` — optional, default `none` (thinking off for the local model; set it empty to send no `reasoning_effort` at all). Only BoDay's requests carry it; LM Studio's own settings are untouched.
- `AGENT_ALLOWED_ORIGINS` — `https://boday.boapps.workers.dev,http://localhost:5173`
- `PORT` — Cloud Run sets this itself; do not set it. The image defaults to 8080.

### Encryption key

The key must be exactly 32 random bytes in standard base64, with no trailing newline, or the service will not start:

```sh
openssl rand -base64 32 | tr -d '\n' | gcloud secrets create agent-encryption-key --data-file=-
```

Grant the service account access to it as above. Never commit the key or paste it into a chat.

### Deploy command

Deployed 2026-10-26 without Local mode: the two `CF_ACCESS_*` secrets and the `BODAY_LOCAL_*` variables were left out (all four are optional). Service URL: `https://boday-agent-430294896514.us-west1.run.app`. Add them with the full command below once the tunnel exists.

Run from the repo root. Cloud Build builds `agent/Dockerfile`, so nothing is built on the Mac:

```sh
gcloud run deploy boday-agent \
  --source agent \
  --region=us-west1 --memory=512Mi --cpu=1 --max-instances=1 --timeout=120 \
  --allow-unauthenticated \
  --set-secrets=AGENT_ENCRYPTION_KEY=agent-encryption-key:latest,ANTHROPIC_API_KEY=anthropic-api-key:latest,CF_ACCESS_CLIENT_ID=cf-access-client-id:latest,CF_ACCESS_CLIENT_SECRET=cf-access-client-secret:latest,AGENT_TRACES_DSN=agent-traces-dsn:latest \
  --set-env-vars='^;^SUPABASE_JWKS_URL=https://cgsjsbsxuzawvgunrpqi.supabase.co/auth/v1/.well-known/jwks.json;SUPABASE_JWT_ISSUER=https://cgsjsbsxuzawvgunrpqi.supabase.co/auth/v1;ADMIN_EMAIL=<admin email>;BODAY_LOCAL_BASE_URL=<tunnel https URL>;BODAY_LOCAL_MODEL=<model id>;AGENT_ALLOWED_ORIGINS=https://boday.boapps.workers.dev,http://localhost:5173'
```

The `^;^` prefix makes `;` the separator, so the comma inside `AGENT_ALLOWED_ORIGINS` stays in the value. Run the same command again to deploy a new version.

### Rotating the key

Rotating the key makes every saved API key unreadable. Ciphertexts are bound to the key and there is no second key to fall back on. Rotate only if the key may have leaked.

1. Add a new version: `openssl rand -base64 32 | tr -d '\n' | gcloud secrets versions add agent-encryption-key --data-file=-`
2. Deploy again with the deploy command, so a new revision reads `:latest`.
3. Destroy the old version, so it can no longer decrypt anything and stays out of the free-tier count: `gcloud secrets versions destroy <old version> --secret=agent-encryption-key`
4. Tell users to save their key again in Settings. Until they do, runs answer `400 KEY_DECRYPT_FAILED` ("The saved API key could not be read. Save it again in Settings."). That includes the owner.

## owner step — the Mac

Local mode: Auto (owner only) sends the request to LM Studio on the Mac when it answers within 2 s, otherwise to Haiku.

- **LM Studio:** the server runs on `localhost:1234` with Just-in-Time model loading on, so `/v1/models` answers even when no model is in RAM and the first request loads it (about 19 s for `qwen/qwen3.6-35b-a3b`, inside the 90 s local budget). Idle models unload after 60 min. Turn on "run the LLM server on login" in LM Studio's settings.
- **Tunnel:** `cloudflared` (Homebrew) runs a named tunnel `boday-llm` that serves `https://llm.expense-app.uk` → `http://localhost:1234`. Config in `~/.cloudflared/config.yml`; installed as a login service with `cloudflared service install`.
- **Cloudflare Access:** a self-hosted application on `llm.expense-app.uk` with one policy, action *Service Auth*, include the service token `boday-agent`. Without the token the hostname answers 403. Store the token's two halves as secrets straight from the clipboard, never through a chat or a file:

  ```sh
  pbpaste | tr -d '\n' | gcloud secrets create cf-access-client-id --data-file=-
  pbpaste | tr -d '\n' | gcloud secrets create cf-access-client-secret --data-file=-
  ```

- **Env:** `BODAY_LOCAL_BASE_URL=https://llm.expense-app.uk/v1`, `BODAY_LOCAL_MODEL=qwen/qwen3.6-35b-a3b`.
- If the Mac sleeps, or LM Studio or the tunnel is not running, Auto falls back to Haiku and the trace says why (`auto: local unreachable ...`).

## owner step — the app

Builds run on the owner's Mac, not on Cloudflare. Put `VITE_AGENT_URL=<Cloud Run URL, no trailing slash>` in the repo-root `.env` (gitignored) and then run `npm run build && npx wrangler deploy`. Set an Artifact Registry cleanup policy so the repository stays under 0.5 GB.

## Local run without deploy

From `agent/`:

`uv run uvicorn --factory boday_agent.server.app:app_from_env --reload`

With `AGENT_TRACES_DSN` empty the service uses `MemorySink` and traces disappear when the process stops. `create_app` raises at startup unless `SUPABASE_JWT_SECRET` or `SUPABASE_JWKS_URL` is set. Without `AGENT_ENCRYPTION_KEY`, `POST /encrypt` returns 503 and saved keys cannot be read.
