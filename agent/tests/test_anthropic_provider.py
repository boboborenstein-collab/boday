from types import SimpleNamespace

import anthropic
import httpx
import pytest

from boday_agent.providers.anthropic_provider import AnthropicProvider
from boday_agent.providers.base import (
    AssistantTurn,
    ProviderError,
    ToolResultMsg,
    ToolResults,
    Usage,
    UserText,
)

TOOLS = [
    {
        "name": "search_tasks",
        "description": "Find tasks",
        "input_schema": {"type": "object"},
    }
]


def ns(**kwargs):
    return SimpleNamespace(**kwargs)


def reply(content, stop="end_turn", usage=(1, 1, 0, 0), model="claude-haiku-5-5"):
    read, write = usage[2], usage[3]
    return ns(
        content=content,
        stop_reason=stop,
        model=model,
        usage=ns(
            input_tokens=usage[0],
            output_tokens=usage[1],
            cache_read_input_tokens=read,
            cache_creation_input_tokens=write,
        ),
    )


def text_reply(text):
    return reply([ns(type="text", text=text)])


class _Messages:
    def __init__(self, owner):
        self.owner = owner
        self.last = None

    def create(self, **kwargs):
        self.last = kwargs
        self.owner.attempts += 1
        if self.owner.errors:
            raise self.owner.errors.pop(0)
        if self.owner.error is not None:
            raise self.owner.error
        return self.owner.reply


class StubClient:
    def __init__(self, reply=None, error=None, errors=()):
        self.reply = reply
        self.error = error
        self.errors = list(errors)
        self.attempts = 0
        self.timeout = None
        self.messages = _Messages(self)
        self.beta = ns(messages=_Messages(self))

    def with_options(self, **kwargs):
        self.timeout = kwargs.get("timeout")
        self.options = kwargs
        return self


def test_request_shape_and_cache_control():
    c = StubClient(reply=text_reply("hi"))
    AnthropicProvider("claude-haiku-5-5", client=c).complete(
        "SYS", [UserText(text="hello")], TOOLS, timeout_s=30
    )
    kw = c.messages.last
    assert kw["system"] == [
        {"type": "text", "text": "SYS", "cache_control": {"type": "ephemeral"}}
    ]
    assert kw["max_tokens"] == 16000 and "thinking" not in kw and "tool_choice" not in kw
    assert set(kw["tools"][0]) == {"name", "description", "input_schema"}
    assert c.timeout == 30


def test_sonnet_uses_server_side_fallback():
    c = StubClient(reply=text_reply("hi"))
    AnthropicProvider("claude-sonnet-5-5", client=c).complete(
        "S", [UserText(text="x")], TOOLS, timeout_s=5
    )
    kw = c.beta.messages.last
    assert kw["betas"] == ["server-side-fallback-2026-07-01"] and kw["fallbacks"] == "default"


def test_tool_use_parsing_usage_and_replay():
    raw = [
        ns(type="thinking", thinking=""),
        ns(type="tool_use", id="tu1", name="search_tasks", input={"query": "x"}),
    ]
    c = StubClient(reply=reply(raw, stop="tool_use", usage=(10, 5, 7, 3)))
    p = AnthropicProvider("claude-haiku-5-5", client=c)
    r = p.complete("S", [UserText(text="x")], TOOLS, timeout_s=5)
    assert r.tool_calls[0].args == {"query": "x"}
    assert r.usage == Usage(
        input_tokens=10, output_tokens=5, cache_read_tokens=7, cache_write_tokens=3
    )
    p.complete(
        "S",
        [
            UserText(text="x"),
            AssistantTurn(response=r),
            ToolResults(
                results=[ToolResultMsg(call_id="tu1", content='{"ok":true}', is_error=False)]
            ),
        ],
        TOOLS,
        timeout_s=5,
    )
    msgs = c.messages.last["messages"]
    assert msgs[1] == {"role": "assistant", "content": raw}
    assert msgs[2]["content"][0] == {
        "type": "tool_result",
        "tool_use_id": "tu1",
        "content": '{"ok":true}',
        "is_error": False,
    }


def _status_error(cls, status, message):
    request = httpx.Request("POST", "https://api.anthropic.com/v1/messages")
    return cls(message=message, response=httpx.Response(status, request=request), body=None)


def test_sdk_retries_are_disabled_and_deadline_limits_our_retries(monkeypatch):
    now = {"t": 50.0}
    monkeypatch.setattr(
        "boday_agent.providers.anthropic_provider.time.monotonic", lambda: now["t"]
    )
    c = StubClient(reply=text_reply("hi"))
    AnthropicProvider("claude-haiku-5-5", client=c).complete(
        "S", [UserText(text="x")], TOOLS, timeout_s=30
    )
    assert c.options.get("max_retries") == 0
    assert c.timeout == 30

    calls = {"n": 0}

    class RateStub(StubClient):
        def with_options(self, **kwargs):
            self.timeout = kwargs.get("timeout")
            self.options = kwargs
            return self

    rate = RateStub(error=_status_error(anthropic.RateLimitError, 429, "slow"))
    original = rate.messages.create

    def counting_create(**kwargs):
        calls["n"] += 1
        return original(**kwargs)

    rate.messages.create = counting_create

    def advance(seconds):
        now["t"] += seconds

    with pytest.raises(ProviderError):
        AnthropicProvider("claude-haiku-5-5", client=rate, sleep=advance).complete(
            "S", [UserText(text="x")], TOOLS, timeout_s=0.4
        )
    assert calls["n"] == 1


def test_error_mapping_hides_details():
    c = StubClient(error=_status_error(anthropic.AuthenticationError, 401, "bad key sk-ant-x"))
    with pytest.raises(ProviderError) as ei:
        AnthropicProvider("claude-haiku-5-5", client=c).complete(
            "S", [UserText(text="x")], TOOLS, timeout_s=5
        )
    e401 = ei.value
    assert e401.retryable is False and "sk-ant" not in str(e401)

    c = StubClient(error=_status_error(anthropic.RateLimitError, 429, "slow sk-ant-x"))
    with pytest.raises(ProviderError) as ei:
        AnthropicProvider("claude-haiku-5-5", client=c, sleep=lambda s: None).complete(
            "S", [UserText(text="x")], TOOLS, timeout_s=5
        )
    e429 = ei.value
    assert e429.retryable is True


@pytest.mark.parametrize(
    "cls,status",
    [
        (anthropic.RateLimitError, 429),
        (anthropic.InternalServerError, 500),
        (anthropic.InternalServerError, 503),
        (anthropic.OverloadedError, 529),
    ],
)
def test_retryable_status_retries_twice_with_backoff(cls, status):
    sleeps = []
    c = StubClient(error=_status_error(cls, status, "busy sk-ant-x"))
    with pytest.raises(ProviderError) as ei:
        AnthropicProvider("claude-haiku-5-5", client=c, sleep=sleeps.append).complete(
            "S", [UserText(text="x")], TOOLS, timeout_s=30
        )
    assert c.attempts == 3 and sleeps == [0.5, 1.0]
    assert ei.value.retryable is True and "sk-ant" not in str(ei.value)


def test_server_error_then_success_returns_response():
    c = StubClient(
        reply=text_reply("hi"),
        errors=[_status_error(anthropic.OverloadedError, 529, "overloaded")],
    )
    r = AnthropicProvider("claude-haiku-5-5", client=c, sleep=lambda s: None).complete(
        "S", [UserText(text="x")], TOOLS, timeout_s=30
    )
    assert r.text == "hi" and c.attempts == 2


def test_client_error_is_not_retried():
    c = StubClient(error=_status_error(anthropic.BadRequestError, 400, "bad"))
    with pytest.raises(ProviderError) as ei:
        AnthropicProvider("claude-haiku-5-5", client=c, sleep=lambda s: None).complete(
            "S", [UserText(text="x")], TOOLS, timeout_s=30
        )
    assert c.attempts == 1 and ei.value.retryable is False
