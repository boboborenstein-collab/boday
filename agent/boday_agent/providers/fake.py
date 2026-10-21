from __future__ import annotations

import json

from .base import ModelResponse, ToolCall, Usage


class FakeProvider:
    def __init__(
        self,
        script: list[ModelResponse | Exception],
        name: str = "fake",
        model: str = "fake-1",
        is_local: bool = False,
    ):
        self.script = list(script)
        self.name = name
        self.model = model
        self.is_local = is_local
        self.calls: list[tuple] = []
        self.timeouts: list[float] = []

    def complete(
        self, system: str, messages: list, tools: list[dict], timeout_s: float
    ) -> ModelResponse:
        self.calls.append((system, messages, tools))
        self.timeouts.append(timeout_s)
        if not self.script:
            raise AssertionError("FakeProvider script exhausted")
        item = self.script.pop(0)
        if isinstance(item, Exception):
            raise item
        return item

    def describe(self) -> dict:
        return {"provider": self.name, "model": self.model, "is_local": self.is_local}


def _usage() -> Usage:
    return Usage(input_tokens=100, output_tokens=20)


def fake_text(text: str) -> ModelResponse:
    return ModelResponse(
        text=text,
        tool_calls=[],
        stop_reason="end_turn",
        usage=_usage(),
        latency_ms=0.0,
        model="fake-1",
    )


def fake_tools(*calls: tuple[str, dict]) -> ModelResponse:
    tool_calls = [
        ToolCall(id=f"call-{i}", name=name, args=args, raw_args=json.dumps(args))
        for i, (name, args) in enumerate(calls, start=1)
    ]
    return ModelResponse(
        text="",
        tool_calls=tool_calls,
        stop_reason="tool_use",
        usage=_usage(),
        latency_ms=0.0,
        model="fake-1",
    )
