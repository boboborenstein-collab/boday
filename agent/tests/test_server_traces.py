import json
import sys
import types
from datetime import UTC, datetime
from pathlib import Path

import pytest

from boday_agent.providers.base import Usage
from boday_agent.server.traces import (
    MAX_TRACE_BYTES,
    MemorySink,
    PostgresSink,
    feedback_event,
    postgres_connect,
)
from boday_agent.tracing import ModelCallEvent, Trace


def test_memory_sink_redacts_and_feedback_is_user_scoped(tmp_path):
    sink = MemorySink()
    trace = Trace(
        run_id="run-1",
        started_at="2026-10-21T18:00:00Z",
        provider={"provider": "anthropic"},
        selection_reason="explicit",
        prompt_version="abc",
        request={"message": "hi", "snapshot_hash": "h"},
        error="bad key sk-ant-example",
    )
    trace.finalize("failed", trace.error, 1)
    sink.write(trace, "user-1")
    blob = json.dumps(sink.rows["run-1"])
    assert "sk-ant-example" not in blob and sink.rows["run-1"]["user_id"] == "user-1"
    assert (
        sink.append_feedback(
            "run-1",
            "user-2",
            {"event": "approve", "taskIds": [], "at": "2026-10-21T18:00:00Z"},
        )
        is False
    )
    assert (
        sink.append_feedback(
            "missing",
            "user-1",
            {"event": "reject", "taskIds": [], "at": "2026-10-21T18:00:00Z"},
        )
        is False
    )
    assert sink.append_feedback(
        "run-1",
        "user-1",
        feedback_event("undo", ["dentist"], now=datetime(2026, 10, 21, 18, 0, tzinfo=UTC)),
    )
    assert sink.rows["run-1"]["data"]["feedback"][0] == {
        "event": "undo",
        "taskIds": ["dentist"],
        "at": "2026-10-21T18:00:00Z",
    }


class FakeCursor:
    def __init__(self):
        self.calls = []

    def execute(self, sql, params=None):
        self.calls.append((sql, params))

    def fetchone(self):
        return (True,)

    def close(self):
        self.closed = True


class FakeConn:
    def __init__(self, cur):
        self.cur = cur
        self.closed = False

    def cursor(self):
        return self.cur

    def close(self):
        self.closed = True


def test_postgres_sink_uses_placeholders():
    cur = FakeCursor()
    sink = PostgresSink(connect=lambda: FakeConn(cur))
    trace = Trace(
        run_id="run-1",
        started_at="2026-10-21T18:00:00Z",
        provider={},
        selection_reason="explicit",
        prompt_version="abc",
        request={},
    )
    sink.write(trace, "user-1")
    sql, params = cur.calls[0]
    assert "%s" in sql and "user-1" not in sql
    assert params[0] == "run-1" and params[1] == "user-1"
    sink.append_feedback(
        "run-1",
        "user-1",
        {"event": "approve", "taskIds": ["dentist"], "at": "2026-10-21T18:00:00Z"},
    )
    sql, params = cur.calls[1]
    assert "append_agent_feedback" in sql and params[1] == "user-1"


def test_sql_file_locks_the_role_down():
    sql = Path("sql/agent_traces.sql").read_text().lower()
    assert "create table if not exists public.agent_traces" in sql
    assert "enable row level security" in sql
    assert "revoke all on public.agent_traces from anon, authenticated" in sql
    assert "revoke all on public.agent_traces from agent_tracer" in sql
    assert "grant insert on public.agent_traces to agent_tracer" in sql
    assert "grant select on public.agent_traces to agent_tracer" not in sql
    assert "grant insert, select" not in sql
    assert sql.count("create policy") == sql.count("drop policy if exists")
    assert "security definer" in sql and "set search_path = ''" in sql
    assert "append_agent_feedback" in sql
    assert "30 days" in sql
    assert "for insert\n  to authenticated" not in sql
    assert "password" not in sql


def test_postgres_connect_disables_prepared_statements(monkeypatch):
    seen = {}
    fake = types.SimpleNamespace(connect=lambda dsn, **kw: seen.update(dsn=dsn, **kw))
    monkeypatch.setitem(sys.modules, "psycopg", fake)
    postgres_connect("postgresql://agent_tracer.ref@pooler.example:6543/postgres")()
    assert seen["prepare_threshold"] is None and seen["connect_timeout"] == 5


def _trace(**fields):
    trace = Trace(
        run_id="run-big",
        started_at="2026-10-21T18:00:00Z",
        provider={"provider": "openai_compat"},
        selection_reason="explicit",
        prompt_version="abc",
        request={"message": "hi", "history_length": 0, "task_count": 0, "snapshot_hash": "h"},
        **fields,
    )
    trace.finalize("failed", "step limit reached", 1)
    return trace


def _big_call(step):
    return ModelCallEvent(
        step=step, provider="openai_compat", model="m", usage=Usage(), cost_usd=0.0,
        price_known=False, latency_ms=1.0, stop_reason="tool_use", text="y" * 100_000,
        tool_calls=[], raw={"blob": "x" * 400_000},
    )


def _stored(sink_kind, trace):
    if sink_kind == "memory":
        sink = MemorySink()
        sink.write(trace, "user-1")
        return json.dumps(sink.rows[trace.run_id]["data"])
    cur = FakeCursor()
    PostgresSink(connect=lambda: FakeConn(cur)).write(trace, "user-1")
    return cur.calls[0][1][2]


@pytest.mark.parametrize("sink_kind", ["memory", "postgres"])
def test_a_small_trace_is_stored_whole(sink_kind):
    data = json.loads(_stored(sink_kind, _trace()))
    assert "truncated" not in data and data["outcome"] == "failed"


@pytest.mark.parametrize("sink_kind", ["memory", "postgres"])
def test_long_strings_are_cut_to_fit_the_cap(sink_kind):
    trace = _trace(events=[_big_call(i) for i in range(1, 9)])
    blob = _stored(sink_kind, trace)
    assert len(blob.encode()) <= MAX_TRACE_BYTES
    data = json.loads(blob)
    assert data["truncated"]["originalBytes"] > 8 * 500_000
    assert len(data["events"]) == 8 and data["events"][0]["text"].endswith("[truncated]")
    assert data["run_id"] == "run-big" and data["totals"]["model_calls"] == 8


@pytest.mark.parametrize("sink_kind", ["memory", "postgres"])
def test_a_trace_too_big_after_cutting_strings_keeps_a_summary(sink_kind):
    trace = _trace(parse_warnings=[f"task {i}: bad priority" for i in range(40_000)])
    blob = _stored(sink_kind, trace)
    assert len(blob.encode()) <= MAX_TRACE_BYTES
    data = json.loads(blob)
    assert data["truncated"]["originalBytes"] > MAX_TRACE_BYTES
    assert data["request"]["message"] == "hi" and data["outcome"] == "failed"
    assert data["events"] == [] and data["parse_warnings"] == []
    assert data["feedback"] == []  # append_agent_feedback still has an array to extend
