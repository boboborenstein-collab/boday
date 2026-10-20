from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any, Literal

from pydantic import BaseModel, Field

from boday_agent.providers.base import ToolCall, Usage

_SECRET_KEY = re.compile(
    r"api[_-]?key|authorization|x-api-key|secret|token|password|"
    r"cf-access-client-id|cf-access-client-secret",
    re.IGNORECASE,
)
_SECRET_VALUE = re.compile(
    r"sk-ant-[A-Za-z0-9_-]+|sk-proj-[A-Za-z0-9_-]+|sk-or-[A-Za-z0-9_-]+|"
    r"gsk_[A-Za-z0-9_-]+|Bearer\s+\S+",
    re.IGNORECASE,
)


def redact(obj: Any) -> Any:
    """Deep copy with secret keys and token strings removed.

    Key names match by substring so compound names such as access_token are
    covered. Integer and float values are left alone, so token counts whose
    keys contain "token" stay intact.
    """
    if isinstance(obj, str):
        return _SECRET_VALUE.sub("[REDACTED]", obj)
    if isinstance(obj, dict):
        out = {}
        for key, value in obj.items():
            if isinstance(key, str) and _SECRET_KEY.search(key) and isinstance(value, str):
                out[key] = "[REDACTED]"
            else:
                out[key] = redact(value)
        return out
    if isinstance(obj, list):
        return [redact(item) for item in obj]
    if isinstance(obj, tuple):
        return tuple(redact(item) for item in obj)
    return obj


class ModelCallEvent(BaseModel):
    type: Literal["model_call"] = "model_call"
    step: int
    provider: str
    model: str
    usage: Usage
    cost_usd: float
    price_known: bool
    latency_ms: float
    stop_reason: str
    text: str
    tool_calls: list[ToolCall]
    raw: Any = None


class ToolCallEvent(BaseModel):
    type: Literal["tool_call"] = "tool_call"
    step: int
    name: str
    args: dict | None
    ok: bool
    error_code: str | None
    result: dict
    latency_ms: float
    injected_fault: str | None


class Trace(BaseModel):
    run_id: str
    started_at: str
    provider: dict
    selection_reason: str
    prompt_version: str
    request: dict
    outcome: str | None = None
    error: str | None = None
    events: list[ModelCallEvent | ToolCallEvent] = Field(default_factory=list)
    totals: dict = Field(default_factory=dict)
    parse_warnings: list[str] = Field(default_factory=list)
    feedback: list[dict] = Field(default_factory=list)

    def finalize(self, outcome: str, error: str | None, latency_ms: float) -> None:
        self.outcome = outcome
        self.error = error
        model_calls = [e for e in self.events if isinstance(e, ModelCallEvent)]
        tool_calls = [e for e in self.events if isinstance(e, ToolCallEvent)]
        self.totals = {
            "model_calls": len(model_calls),
            "tool_calls": len(tool_calls),
            "tool_errors": sum(1 for e in tool_calls if not e.ok),
            "input_tokens": sum(e.usage.input_tokens for e in model_calls),
            "output_tokens": sum(e.usage.output_tokens for e in model_calls),
            "cache_read_tokens": sum(e.usage.cache_read_tokens for e in model_calls),
            "cache_write_tokens": sum(e.usage.cache_write_tokens for e in model_calls),
            "cost_usd": sum(e.cost_usd for e in model_calls),
            "latency_ms": latency_ms,
        }


class FileSink:
    def __init__(self, root: Path):
        self.root = root

    def write(self, trace: Trace) -> Path:
        day = trace.started_at[:10]
        path = self.root / day / f"{trace.run_id}.json"
        path.parent.mkdir(parents=True, exist_ok=True)
        payload = redact(trace.model_dump(mode="json"))
        path.write_text(json.dumps(payload))
        return path
