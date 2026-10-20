from __future__ import annotations

import json
import time
from typing import Any

import anthropic

from .base import (
    AssistantTurn,
    Message,
    ModelResponse,
    ProviderError,
    ToolCall,
    ToolResults,
    Usage,
    UserText,
)

_FALLBACK_MODELS = frozenset({"claude-sonnet-5-5", "claude-opus-5-5"})
_STOP = {
    "end_turn": "end_turn",
    "tool_use": "tool_use",
    "max_tokens": "max_tokens",
    "refusal": "refusal",
}


class AnthropicProvider:
    name = "anthropic"
    is_local = False

    def __init__(
        self,
        model: str,
        *,
        api_key: str | None = None,
        effort: str | None = None,
        refusal_fallback: bool = True,
        client: Any = None,
    ):
        self.model = model
        self.effort = effort
        self.refusal_fallback = refusal_fallback
        if client is None:
            self.client = anthropic.Anthropic(api_key=api_key, max_retries=2)
        else:
            self.client = client

    def describe(self) -> dict:
        return {
            "provider": "anthropic",
            "model": self.model,
            "effort": self.effort,
            "refusal_fallback": self.refusal_fallback,
        }

    def complete(
        self,
        system: str,
        messages: list[Message],
        tools: list[dict],
        timeout_s: float,
    ) -> ModelResponse:
        kwargs: dict[str, Any] = {
            "model": self.model,
            "max_tokens": 16000,
            "system": [
                {"type": "text", "text": system, "cache_control": {"type": "ephemeral"}}
            ],
            "tools": [
                {
                    "name": tool["name"],
                    "description": tool["description"],
                    "input_schema": tool["input_schema"],
                }
                for tool in tools
            ],
            "messages": [_wire_message(message) for message in messages],
        }
        if self.effort:
            kwargs["output_config"] = {"effort": self.effort}
        client = self.client.with_options(timeout=timeout_s)
        started = time.perf_counter()
        try:
            if self.refusal_fallback and self.model in _FALLBACK_MODELS:
                response = client.beta.messages.create(
                    **kwargs,
                    betas=["server-side-fallback-2026-07-01"],
                    fallbacks="default",
                )
            else:
                response = client.messages.create(**kwargs)
        except (
            anthropic.RateLimitError,
            anthropic.APIConnectionError,
            anthropic.APITimeoutError,
        ) as exc:
            raise _mapped(exc, retryable=True) from None
        except anthropic.APIStatusError as exc:
            raise _mapped(exc, retryable=exc.status_code >= 500) from None
        latency_ms = (time.perf_counter() - started) * 1000
        return _parse(response, latency_ms)


def _mapped(exc: Exception, *, retryable: bool) -> ProviderError:
    status = getattr(exc, "status_code", None)
    message = type(exc).__name__ if status is None else f"{type(exc).__name__}: {status}"
    return ProviderError(message, retryable=retryable)


def _wire_message(message: Message) -> dict:
    if isinstance(message, UserText):
        return {"role": "user", "content": message.text}
    if isinstance(message, AssistantTurn):
        raw = message.response.raw
        content = raw if raw is not None else [{"type": "text", "text": message.response.text}]
        return {"role": "assistant", "content": content}
    if isinstance(message, ToolResults):
        return {
            "role": "user",
            "content": [
                {
                    "type": "tool_result",
                    "tool_use_id": result.call_id,
                    "content": result.content,
                    "is_error": result.is_error,
                }
                for result in message.results
            ],
        }
    raise TypeError(f"unsupported message {type(message).__name__}")


def _parse(response, latency_ms: float) -> ModelResponse:
    texts: list[str] = []
    tool_calls: list[ToolCall] = []
    for block in response.content:
        if block.type == "text":
            texts.append(block.text)
        elif block.type == "tool_use":
            tool_calls.append(
                ToolCall(
                    id=block.id,
                    name=block.name,
                    args=block.input,
                    raw_args=json.dumps(block.input),
                )
            )
    usage = response.usage
    return ModelResponse(
        text="".join(texts),
        tool_calls=tool_calls,
        stop_reason=_STOP.get(response.stop_reason, "other"),
        usage=Usage(
            input_tokens=usage.input_tokens,
            output_tokens=usage.output_tokens,
            cache_read_tokens=usage.cache_read_input_tokens or 0,
            cache_write_tokens=usage.cache_creation_input_tokens or 0,
        ),
        latency_ms=latency_ms,
        model=response.model,
        raw=response.content,
    )
