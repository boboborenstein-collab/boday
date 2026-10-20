from __future__ import annotations

from typing import Any, Literal, Protocol

from pydantic import BaseModel

StopReason = Literal["end_turn", "tool_use", "max_tokens", "refusal", "other"]


class Usage(BaseModel):
    input_tokens: int = 0
    output_tokens: int = 0
    cache_read_tokens: int = 0
    cache_write_tokens: int = 0

    def __add__(self, other: Usage) -> Usage:
        if not isinstance(other, Usage):
            return NotImplemented
        return Usage(
            input_tokens=self.input_tokens + other.input_tokens,
            output_tokens=self.output_tokens + other.output_tokens,
            cache_read_tokens=self.cache_read_tokens + other.cache_read_tokens,
            cache_write_tokens=self.cache_write_tokens + other.cache_write_tokens,
        )


class ToolCall(BaseModel):
    id: str
    name: str
    args: dict[str, Any] | None
    raw_args: str


class ModelResponse(BaseModel):
    text: str
    tool_calls: list[ToolCall]
    stop_reason: StopReason
    usage: Usage
    latency_ms: float
    model: str
    raw: Any = None

    def __eq__(self, other: object) -> bool:
        if not isinstance(other, ModelResponse):
            return NotImplemented
        return (
            self.text == other.text
            and self.tool_calls == other.tool_calls
            and self.stop_reason == other.stop_reason
            and self.usage == other.usage
            and self.latency_ms == other.latency_ms
            and self.model == other.model
        )


class UserText(BaseModel):
    kind: Literal["user_text"] = "user_text"
    text: str


class AssistantTurn(BaseModel):
    kind: Literal["assistant"] = "assistant"
    response: ModelResponse


class ToolResultMsg(BaseModel):
    call_id: str
    content: str
    is_error: bool


class ToolResults(BaseModel):
    kind: Literal["tool_results"] = "tool_results"
    results: list[ToolResultMsg]


Message = UserText | AssistantTurn | ToolResults


class ProviderError(Exception):
    def __init__(self, message: str, retryable: bool):
        super().__init__(message)
        self.message = message
        self.retryable = retryable


class Provider(Protocol):
    name: str
    model: str
    is_local: bool

    def complete(
        self,
        system: str,
        messages: list[Message],
        tools: list[dict],
        timeout_s: float,
    ) -> ModelResponse: ...

    def describe(self) -> dict: ...
