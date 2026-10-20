from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path

from pydantic import ValidationError

from boday_agent.domain.models import Snapshot
from boday_agent.loop import AgentRequest, run_agent
from boday_agent.prompt import HistoryTurn
from boday_agent.providers.anthropic_provider import AnthropicProvider
from boday_agent.providers.auto import select_provider
from boday_agent.providers.openai_compat import OpenAICompatProvider
from boday_agent.tracing import FileSink


def main(argv: list[str] | None = None) -> int:
    parser = _parser()
    try:
        args = parser.parse_args(argv)
    except SystemExit as exc:
        return exc.code if isinstance(exc.code, int) else 2
    try:
        provider, reason = make_provider(args)
    except ValueError as exc:
        print(exc, file=sys.stderr)
        return 2
    snapshot = _load_snapshot(args.snapshot, args.now)
    if snapshot is None:
        print(f"unreadable snapshot: {args.snapshot}", file=sys.stderr)
        return 2
    history = _load_history(args.history)
    if history is None:
        print(f"unreadable history: {args.history}", file=sys.stderr)
        return 2
    result = run_agent(
        AgentRequest(message=args.message, history=history, snapshot=snapshot),
        provider,
        selection_reason=reason,
    )
    path = FileSink(Path(args.traces_dir)).write(result.trace)
    payload = {
        "outcome": result.outcome,
        "text": result.text,
        "changes": result.changes,
        "question": result.question,
        "options": result.options,
        "trace_path": str(path),
        "cost_usd": result.trace.totals.get("cost_usd", 0),
        "latency_ms": result.trace.totals.get("latency_ms", 0),
        "provider": result.trace.provider,
    }
    json.dump(payload, sys.stdout)
    sys.stdout.write("\n")
    return 0


def make_provider(args):
    api_key = _api_key(args.api_key_env)
    headers = _headers(args.header or [])
    if args.provider == "anthropic":
        model = args.model or "claude-haiku-5-5"
        return AnthropicProvider(model, api_key=api_key, effort=args.effort), "explicit"
    if not args.base_url:
        raise ValueError("--base-url is required for provider " + args.provider)
    if not args.model:
        raise ValueError("--model is required for provider " + args.provider)
    if args.provider == "openai":
        return (
            OpenAICompatProvider(
                args.base_url,
                args.model,
                api_key=api_key,
                extra_headers=headers or None,
            ),
            "explicit",
        )
    # Auto's fallback resolves its own Anthropic credentials. The key from
    # --api-key-env stays on the explicit OpenAI/Anthropic providers and is
    # not sent to the local endpoint.
    local = OpenAICompatProvider(
        args.base_url,
        args.model,
        extra_headers=headers or None,
    )
    fallback = AnthropicProvider("claude-haiku-5-5", effort=args.effort)
    return select_provider(local, fallback)


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="boday-agent")
    parser.add_argument("message")
    parser.add_argument("--snapshot", required=True)
    parser.add_argument(
        "--provider", default="anthropic", choices=["anthropic", "openai", "auto"]
    )
    parser.add_argument("--model", default=None)
    parser.add_argument("--base-url", default=None)
    parser.add_argument("--api-key-env", default=None)
    parser.add_argument("--header", action="append", default=None)
    parser.add_argument("--effort", default=None)
    parser.add_argument("--now", default=None)
    parser.add_argument("--history", default=None)
    parser.add_argument("--traces-dir", default="traces")
    return parser


def _api_key(name: str | None) -> str | None:
    if not name:
        return None
    try:
        return os.environ[name]
    except KeyError as exc:
        raise ValueError(f"environment variable {name} is not set") from exc


def _headers(items: list[str]) -> dict[str, str]:
    headers = {}
    for raw in items:
        if ":" not in raw:
            raise ValueError(f"header must look like 'Name: value', got {raw!r}")
        key, value = raw.split(":", 1)
        headers[key.strip()] = value.strip()
    return headers


def _load_snapshot(path: str, now: str | None) -> Snapshot | None:
    try:
        data = json.loads(Path(path).read_text())
    except (OSError, json.JSONDecodeError):
        return None
    if not isinstance(data, dict):
        return None
    if now:
        data["now"] = now
    try:
        return Snapshot.from_app(data)
    except ValidationError:
        return None


def _load_history(path: str | None) -> list[HistoryTurn] | None:
    if not path:
        return []
    try:
        raw = json.loads(Path(path).read_text())
        if not isinstance(raw, list):
            return None
        return [HistoryTurn.model_validate(item) for item in raw]
    except (OSError, json.JSONDecodeError, ValidationError):
        return None
