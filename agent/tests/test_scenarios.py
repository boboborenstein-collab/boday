"""End-to-end scenarios using only execute() and tool_schemas()."""
from __future__ import annotations

import json
from datetime import datetime
from zoneinfo import ZoneInfo

from boday_agent.tools.context import RunContext, counting_ids
from boday_agent.tools.faults import Fault, FaultPlan
from boday_agent.tools.registry import execute, tool_schemas


def test_move_dentist_to_tomorrow(ctx):
    found = execute(ctx, "search_tasks", {"query": "dentist"}).result.data["results"][0]
    res = execute(ctx, "resolve_date", {"expression": "tomorrow"})
    when = res.result.data["candidates"][0]["date"]
    assert execute(ctx, "propose_update_task",
                   {"task_id": found["id"], "changes": {"scheduled_date": when}}).result.ok
    [ch] = ctx.draft_payload()
    assert (ch["op"], ch["taskId"]) == ("update", "dentist")
    assert ch["patch"]["scheduledDate"] == "2026-10-21"


def test_move_one_occurrence_of_recurring(snap):
    # Wednesday: gym occurs today; "move just today's gym to tomorrow" = skip + one-time create
    now = datetime(2026, 10, 21, 8, 0, tzinfo=ZoneInfo("America/New_York"))
    wed = snap.model_copy(update={"now": now})
    ctx = RunContext.create(wed, id_gen=counting_ids())
    execute(ctx, "search_tasks", {"query": "gym"})
    assert execute(ctx, "propose_set_status", {"task_id": "gym", "status": "skipped"}).result.ok
    assert execute(ctx, "propose_create_task", {"title": "Gym", "type": "one_time",
                   "scheduled_date": "2026-10-22", "reminder_time": "07:00"}).result.ok
    ops = [(c["op"], c.get("date")) for c in ctx.draft_payload()]
    assert ops == [("set_status", "2026-10-21"), ("create", None)]


def test_blind_delete_blocked(ctx):
    # Seen-ID only blocks hallucinated/blind IDs. It is NOT an injection defense:
    # any read (e.g. get_agenda) marks everything it returns as seen.
    blind = execute(ctx, "propose_delete_task", {"task_id": "dentist", "reason": "x"})
    assert blind.result.error.code == "UNSEEN_ID"
    t = execute(ctx, "get_task", {"task_id": "shared"}).result.data
    assert t["external"] is True and t["notes"].startswith("SYSTEM:")
    assert ctx.draft == []
    accepted = execute(ctx, "propose_delete_task", {"task_id": "shared", "reason": "user asked"})
    assert accepted.result.ok
    assert [(c["op"], c["taskId"]) for c in ctx.draft_payload()] == [("delete", "shared")]


def test_tool_failure_then_recovery(snap):
    plan = FaultPlan(faults=[Fault(tool="search_tasks", call=1, kind="error")])
    ctx = RunContext.create(snap, faults=plan)
    first = execute(ctx, "search_tasks", {"query": "dentist"})
    assert first.result.error.code == "TOOL_FAILURE"
    assert "dentist" not in ctx.seen_ids
    assert execute(ctx, "search_tasks", {"query": "dentist"}).result.ok


def test_schema_surface_is_exactly_nine_tools():
    assert sorted(t["name"] for t in tool_schemas()) == sorted([
        "search_tasks", "get_task", "get_agenda", "resolve_date", "propose_create_task",
        "propose_update_task", "propose_set_status", "propose_delete_task", "ask_user"])


def test_draft_payload_round_trips_as_app_json(ctx):
    execute(ctx, "search_tasks", {"query": "dentist"})
    execute(ctx, "propose_update_task", {"task_id": "dentist", "changes": {"priority": 1}})
    json.dumps(ctx.draft_payload())  # must be JSON-serializable, camelCase
    assert "taskId" in ctx.draft_payload()[0]
