import json

from boday_agent.pricing import cost_usd
from boday_agent.providers.base import Usage
from boday_agent.tracing import FileSink, ModelCallEvent, ToolCallEvent, Trace, redact


def test_cost_known_and_unknown():
    assert cost_usd("claude-haiku-5-5", Usage(input_tokens=1_000_000, output_tokens=1_000_000)) == (
        0.60,
        True,
    )
    c, known = cost_usd(
        "claude-sonnet-5-5", Usage(cache_read_tokens=1_000_000, cache_write_tokens=1_000_000)
    )
    assert round(c, 2) == 2.70 and known
    assert cost_usd("qwen3:30b", Usage(input_tokens=10)) == (0.0, False)


def test_redact_keys_values_and_nested():
    out = redact(
        {
            "headers": {"Authorization": "Bearer x", "CF-Access-Client-Secret": "s"},
            "api_key": "sk-ant-abc123",
            "note": "key sk-ant-zzz_9 failed",
            "ok": 1,
        }
    )
    assert out["headers"] == {
        "Authorization": "[REDACTED]",
        "CF-Access-Client-Secret": "[REDACTED]",
    }
    assert out["api_key"] == "[REDACTED]"
    assert out["note"] == "key [REDACTED] failed" and out["ok"] == 1


def test_redact_compound_keys_and_keeps_token_counts():
    out = redact(
        {
            "access_token": "abc",
            "ANTHROPIC_API_KEY": "sk-ant-zzz",
            "input_tokens": 100,
            "note": "Authorization: Bearer sk-proj-abc123",
        }
    )
    assert out["access_token"] == "[REDACTED]"
    assert out["ANTHROPIC_API_KEY"] == "[REDACTED]"
    assert out["input_tokens"] == 100
    assert "sk-proj-abc123" not in out["note"]
    assert "Bearer" not in out["note"]


def test_finalize_totals_and_file_sink(tmp_path):
    t = Trace(
        run_id="r1",
        started_at="2026-10-20T13:00:00Z",
        provider={"provider": "fake"},
        selection_reason="explicit",
        prompt_version="abc",
        request={},
    )
    t.events.append(
        ModelCallEvent(
            step=1,
            provider="fake",
            model="claude-haiku-5-5",
            usage=Usage(input_tokens=100, output_tokens=20),
            cost_usd=0.00002,
            price_known=True,
            latency_ms=50,
            stop_reason="tool_use",
            text="",
            tool_calls=[],
            raw=None,
        )
    )
    t.events.append(
        ToolCallEvent(
            step=1,
            name="search_tasks",
            args={},
            ok=False,
            error_code="TOOL_FAILURE",
            result={},
            latency_ms=1,
            injected_fault="error",
        )
    )
    t.finalize("failed", "step cap", latency_ms=60)
    assert t.totals["model_calls"] == 1 and t.totals["tool_errors"] == 1
    assert t.totals["input_tokens"] == 100
    p = FileSink(tmp_path).write(t)
    assert p == tmp_path / "2026-10-20" / "r1.json"
    assert json.loads(p.read_text())["outcome"] == "failed"


def test_sink_redacts(tmp_path):
    t = Trace(
        run_id="r2",
        started_at="2026-10-20T13:00:00Z",
        provider={"api_key": "sk-ant-x1"},
        selection_reason="explicit",
        prompt_version="abc",
        request={},
        error="401 for key sk-ant-x1",
    )
    text = FileSink(tmp_path).write(t).read_text()
    assert "sk-ant-x1" not in text
