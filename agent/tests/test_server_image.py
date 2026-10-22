from pathlib import Path


def test_image_and_runbook_match_the_spec():
    docker = Path("Dockerfile").read_text()
    assert "python:3.12-slim" in docker
    assert "uv sync --frozen --no-dev" in docker
    assert "--factory boday_agent.server.app:app_from_env" in docker
    assert "${PORT:-8080}" in docker
    assert "USER " in docker
    ignore = Path(".dockerignore").read_text()
    for name in (".venv", "tests", ".env", "traces"):
        assert name in ignore
    doc = Path("DEPLOY.md").read_text()
    for snippet in (
        "max-instances=1",
        "allow-unauthenticated",
        "timeout=120",
        "us-west1",
        "--memory=512Mi",
        "--cpu=1",
        "$1",
        "0.5 GB",
        "2M requests",
        "180k vCPU-s",
        "360k GiB-s",
        "pooler.supabase.com",
        "agent_tracer.cgsjsbsxuzawvgunrpqi",
        "IPv6",
        "expense-app.uk",
        "CF-Access-Client-Id",
        "AGENT_ENCRYPTION_KEY",
        "AGENT_TRACES_DSN",
        "AGENT_ALLOWED_ORIGINS",
        "SUPABASE_JWKS_URL",
        "SUPABASE_JWT_ISSUER",
        "https://boday.boapps.workers.dev",
        "http://localhost:5173",
        "VITE_AGENT_URL",
        "npm run build && npx wrangler deploy",
        "30 days",
        "owner step",
    ):
        assert snippet in doc
    assert "sk-ant-" not in doc
