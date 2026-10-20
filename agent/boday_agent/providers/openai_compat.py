from __future__ import annotations

import json
import time
from urllib.parse import urlsplit

import httpx

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

_FINISH = {
    "stop": "end_turn",
    "tool_calls": "tool_use",
    "length": "max_tokens",
    "content_filter": "refusal",
}


class OpenAICompatProvider:
    name = "openai_compat"

    def __init__(
        self,
        base_url: str,
        model: str,
        *,
        api_key: str | None = None,
        extra_headers: dict[str, str] | None = None,
        is_local: bool = True,
        transport: httpx.BaseTransport | None = None,
        sleep=time.sleep,
    ):
        self.base_url = base_url.rstrip("/")
        self.model = model
        self.api_key = api_key
        self.extra_headers = dict(extra_headers or {})
        self.is_local = is_local
        self.transport = transport
        self.sleep = sleep

    def headers(self) -> dict[str, str]:
        out = dict(self.extra_headers)
        if self.api_key:
            out["Authorization"] = f"Bearer {self.api_key}"
        return out

    def describe(self) -> dict:
        return {
            "provider": "openai_compat",
            "model": self.model,
            "host": urlsplit(self.base_url).netloc,
            "is_local": self.is_local,
        }

    def complete(
        self,
        system: str,
        messages: list[Message],
        tools: list[dict],
        timeout_s: float,
    ) -> ModelResponse:
        url = f"{self.base_url}/chat/completions"
        body = {
            "model": self.model,
            "messages": _messages(system, messages),
            "tools": [
                {
                    "type": "function",
                    "function": {
                        "name": tool["name"],
                        "description": tool["description"],
                        "parameters": tool["input_schema"],
                    },
                }
                for tool in tools
            ],
            "tool_choice": "auto",
        }
        host = urlsplit(self.base_url).netloc
        started = time.perf_counter()
        data = self._post(url, body, host, timeout_s)
        return _parse(data, self.model, (time.perf_counter() - started) * 1000)

    def _post(self, url: str, body: dict, host: str, timeout_s: float) -> dict:
        delays = (0.5, 1.0)
        with httpx.Client(transport=self.transport, timeout=timeout_s) as client:
            for attempt in range(3):
                try:
                    response = client.post(url, json=body, headers=self.headers())
                except (httpx.TimeoutException, httpx.ConnectError) as exc:
                    if attempt == 2:
                        raise ProviderError(
                            f"{type(exc).__name__} {host}", retryable=True
                        ) from None
                    self.sleep(delays[attempt])
                    continue
                status = response.status_code
                if status == 429 or status >= 500:
                    if attempt == 2:
                        raise ProviderError(f"HTTP {status} {host}", retryable=True) from None
                    self.sleep(delays[attempt])
                    continue
                if status >= 400:
                    raise ProviderError(f"HTTP {status} {host}", retryable=False) from None
                return response.json()
        raise ProviderError(f"HTTP error {host}", retryable=True)


def _messages(system: str, messages: list[Message]) -> list[dict]:
    out: list[dict] = [{"role": "system", "content": system}]
    for message in messages:
        if isinstance(message, UserText):
            out.append({"role": "user", "content": message.text})
        elif isinstance(message, AssistantTurn):
            wire: dict = {"role": "assistant", "content": message.response.text or None}
            if message.response.tool_calls:
                wire["tool_calls"] = [
                    {
                        "id": call.id,
                        "type": "function",
                        "function": {"name": call.name, "arguments": call.raw_args},
                    }
                    for call in message.response.tool_calls
                ]
            out.append(wire)
        elif isinstance(message, ToolResults):
            for result in message.results:
                out.append(
                    {"role": "tool", "tool_call_id": result.call_id, "content": result.content}
                )
        else:
            raise TypeError(f"unsupported message {type(message).__name__}")
    return out


def _parse_args(raw: str) -> dict | None:
    try:
        parsed = json.loads(raw)
    except json.JSONDecodeError:
        return None
    if not isinstance(parsed, dict):
        return None
    return parsed


def _stop(reason: str | None, has_tools: bool) -> str:
    if has_tools and reason == "stop":
        return "tool_use"
    return _FINISH.get(reason or "", "other")


def _parse(data: dict, configured_model: str, latency_ms: float) -> ModelResponse:
    choice = data["choices"][0]
    message = choice["message"]
    tool_calls = []
    for call in message.get("tool_calls") or []:
        raw = call["function"]["arguments"]
        tool_calls.append(
            ToolCall(
                id=call["id"],
                name=call["function"]["name"],
                args=_parse_args(raw),
                raw_args=raw,
            )
        )
    usage = data.get("usage") or {}
    return ModelResponse(
        text=message.get("content") or "",
        tool_calls=tool_calls,
        stop_reason=_stop(choice.get("finish_reason"), bool(tool_calls)),
        usage=Usage(
            input_tokens=usage.get("prompt_tokens") or 0,
            output_tokens=usage.get("completion_tokens") or 0,
        ),
        latency_ms=latency_ms,
        model=data.get("model") or configured_model,
        raw=message,
    )
