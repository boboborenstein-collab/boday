import json

import httpx
import pytest

from boday_agent.providers.base import (
    AssistantTurn,
    ProviderError,
    ToolResultMsg,
    ToolResults,
    UserText,
)
from boday_agent.providers.openai_compat import OpenAICompatProvider

TOOLS = [
    {"name": "search_tasks", "description": "Find tasks", "input_schema": {"type": "object"}}
]

CHAT_TEXT_REPLY = {
    "model": "qwen3:30b",
    "choices": [
        {"finish_reason": "stop", "message": {"role": "assistant", "content": "hi"}}
    ],
    "usage": {"prompt_tokens": 3, "completion_tokens": 1},
}


def chat_tool_reply(calls):
    return {
        "model": "m",
        "choices": [
            {
                "finish_reason": "tool_calls",
                "message": {
                    "role": "assistant",
                    "content": None,
                    "tool_calls": [
                        {
                            "id": call_id,
                            "type": "function",
                            "function": {"name": name, "arguments": arguments},
                        }
                        for call_id, name, arguments in calls
                    ],
                },
            }
        ],
    }


def test_request_shape_and_headers():
    seen = {}

    def handler(req):
        seen["req"] = req
        return httpx.Response(200, json=CHAT_TEXT_REPLY)

    p = OpenAICompatProvider(
        "https://llm.example.com/v1",
        "qwen3:30b",
        extra_headers={"CF-Access-Client-Id": "id", "CF-Access-Client-Secret": "s"},
        transport=httpx.MockTransport(handler),
    )
    p.complete("SYS", [UserText(text="hi")], TOOLS, timeout_s=10)
    body = json.loads(seen["req"].content)
    assert body["messages"][0] == {"role": "system", "content": "SYS"}
    assert body["tool_choice"] == "auto"
    assert body["tools"][0]["type"] == "function"
    assert seen["req"].headers["CF-Access-Client-Id"] == "id"
    assert "CF-Access" not in json.dumps(p.describe())
    assert p.describe()["host"] == "llm.example.com"


def test_malformed_arguments_become_none():
    reply = chat_tool_reply([("c1", "search_tasks", "{query: dentist")])
    p = OpenAICompatProvider(
        "http://x/v1",
        "m",
        transport=httpx.MockTransport(lambda r: httpx.Response(200, json=reply)),
    )
    r = p.complete("S", [UserText(text="x")], TOOLS, timeout_s=5)
    assert r.tool_calls[0].args is None
    assert r.tool_calls[0].raw_args == "{query: dentist"
    assert r.stop_reason == "tool_use"


def test_tool_results_serialize_as_tool_role():
    seen = []

    def handler(req):
        seen.append(json.loads(req.content))
        if len(seen) == 1:
            return httpx.Response(
                200, json=chat_tool_reply([("c1", "search_tasks", '{"query":"x"}')])
            )
        return httpx.Response(200, json=CHAT_TEXT_REPLY)

    p = OpenAICompatProvider("http://x/v1", "m", transport=httpx.MockTransport(handler))
    first = p.complete("S", [UserText(text="x")], TOOLS, timeout_s=5)
    p.complete(
        "S",
        [
            UserText(text="x"),
            AssistantTurn(response=first),
            ToolResults(
                results=[ToolResultMsg(call_id="c1", content='{"ok":true}', is_error=False)]
            ),
        ],
        TOOLS,
        timeout_s=5,
    )
    messages = seen[1]["messages"]
    assistant = next(m for m in messages if m["role"] == "assistant")
    tool = next(m for m in messages if m["role"] == "tool")
    assert assistant["tool_calls"][0]["id"] == "c1"
    assert tool == {"role": "tool", "tool_call_id": "c1", "content": '{"ok":true}'}


def test_retries_then_fails_retryable():
    calls = []
    slept = []

    def handler(req):
        calls.append(1)
        return httpx.Response(503)

    p = OpenAICompatProvider(
        "http://x/v1",
        "m",
        transport=httpx.MockTransport(handler),
        sleep=lambda seconds: slept.append(seconds),
    )
    with pytest.raises(ProviderError) as err:
        p.complete("S", [UserText(text="x")], TOOLS, timeout_s=5)
    assert len(calls) == 3 and err.value.retryable
    assert slept == [0.5, 1.0]
    assert "503" in str(err.value) and "x" in str(err.value)


def test_400_not_retried():
    calls = []

    def handler(req):
        calls.append(1)
        return httpx.Response(400, json={"error": "bad key sk-ant-leak"})

    p = OpenAICompatProvider("http://x/v1", "m", transport=httpx.MockTransport(handler))
    with pytest.raises(ProviderError) as err:
        p.complete("S", [UserText(text="x")], TOOLS, timeout_s=5)
    assert len(calls) == 1 and err.value.retryable is False
    assert "sk-ant-leak" not in str(err.value)
    assert "400" in str(err.value)
