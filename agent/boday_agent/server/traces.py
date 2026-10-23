from __future__ import annotations

import json
from datetime import UTC, datetime
from typing import Protocol

from boday_agent.tracing import Trace, redact

MAX_TRACE_BYTES = 262_144
_STRING_LIMIT = 2000
_CUT = "…[truncated]"
_SUMMARY_KEYS = (
    "run_id",
    "started_at",
    "provider",
    "selection_reason",
    "prompt_version",
    "request",
    "outcome",
    "error",
    "totals",
)


class TraceSink(Protocol):
    def write(self, trace: Trace, user_id: str) -> None: ...

    def append_feedback(self, run_id: str, user_id: str, event: dict) -> bool: ...


class MemorySink:
    def __init__(self) -> None:
        self.rows: dict[str, dict] = {}

    def write(self, trace: Trace, user_id: str) -> None:
        self.rows[trace.run_id] = {
            "user_id": user_id,
            "data": bounded(redact(trace.model_dump(mode="json"))),
        }

    def append_feedback(self, run_id: str, user_id: str, event: dict) -> bool:
        row = self.rows.get(run_id)
        if row is None or row["user_id"] != user_id:
            return False
        feedback = row["data"].setdefault("feedback", [])
        feedback.append(event)
        return True


class PostgresSink:
    def __init__(self, connect) -> None:
        self._connect = connect

    def write(self, trace: Trace, user_id: str) -> None:
        payload = json.dumps(bounded(redact(trace.model_dump(mode="json"))))
        self._run(
            "insert into public.agent_traces (id, user_id, data) values (%s, %s, %s::jsonb)",
            (trace.run_id, user_id, payload),
        )

    def append_feedback(self, run_id: str, user_id: str, event: dict) -> bool:
        row = self._run(
            "select public.append_agent_feedback(%s, %s, %s::jsonb)",
            (run_id, user_id, json.dumps(event)),
            fetch=True,
        )
        return bool(row[0]) if row else False

    def _run(self, sql: str, params: tuple, *, fetch: bool = False):
        conn = self._connect()
        try:
            cur = conn.cursor()
            try:
                cur.execute(sql, params)
                if fetch:
                    return cur.fetchone()
                return None
            finally:
                cur.close()
        finally:
            conn.close()


def bounded(data: dict) -> dict:
    """Fit a trace under MAX_TRACE_BYTES, marking anything cut.

    First long strings are shortened. If that is not enough, only the summary
    fields are kept, with empty events, warnings, and feedback.
    """
    size = _size(data)
    if size <= MAX_TRACE_BYTES:
        return data
    marker = {"originalBytes": size}
    cut = {**_cut_strings(data), "truncated": marker}
    if _size(cut) <= MAX_TRACE_BYTES:
        return cut
    summary = _cut_strings({key: data.get(key) for key in _SUMMARY_KEYS})
    return {**summary, "events": [], "parse_warnings": [], "feedback": [], "truncated": marker}


def _size(data: dict) -> int:
    return len(json.dumps(data).encode())


def _cut_strings(obj):
    if isinstance(obj, str):
        return obj if len(obj) <= _STRING_LIMIT else obj[:_STRING_LIMIT] + _CUT
    if isinstance(obj, dict):
        return {key: _cut_strings(value) for key, value in obj.items()}
    if isinstance(obj, list):
        return [_cut_strings(item) for item in obj]
    return obj


def postgres_connect(dsn: str):
    def connect():
        import psycopg

        return psycopg.connect(
            dsn,
            prepare_threshold=None,
            connect_timeout=5,
            autocommit=True,
        )

    return connect


def feedback_event(event: str, task_ids: list[str], *, now: datetime) -> dict:
    moment = now if now.tzinfo is not None else now.replace(tzinfo=UTC)
    return {
        "event": event,
        "taskIds": list(task_ids),
        "at": moment.astimezone(UTC).strftime("%Y-%m-%dT%H:%M:%SZ"),
    }
