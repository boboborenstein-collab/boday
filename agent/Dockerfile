FROM python:3.12-slim

COPY --from=ghcr.io/astral-sh/uv:0.13.5 /uv /uvx /bin/

WORKDIR /srv
COPY pyproject.toml uv.lock ./
COPY boday_agent ./boday_agent
RUN uv sync --frozen --no-dev && chmod -R a+rX /srv

RUN useradd --create-home --uid 10001 boday
USER boday

CMD uv run --no-sync uvicorn --factory boday_agent.server.app:app_from_env --host 0.0.0.0 --port ${PORT:-8080}
