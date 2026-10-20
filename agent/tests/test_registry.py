import pytest
from pydantic import BaseModel, ConfigDict

from boday_agent.tools.context import RunContext, counting_ids
from boday_agent.tools.faults import Fault, FaultPlan
from boday_agent.tools.registry import REGISTRY, ToolSpec, execute, register, tool_schemas
from boday_agent.tools.result import ToolResult


class _EchoArgs(BaseModel):
    model_config = ConfigDict(extra="forbid")
    text: str


class _NoArgs(BaseModel):
    model_config = ConfigDict(extra="forbid")


def _boom(ctx, args):
    raise RuntimeError("secret internals")


@pytest.fixture(autouse=True)
def throwaway_tools():
    register(ToolSpec("echo", "Echo text back.", _EchoArgs,
                      lambda ctx, a: {"text": a.text}, "read"))
    register(ToolSpec("boom", "Always fails.", _NoArgs, _boom, "read"))
    yield
    REGISTRY.pop("echo", None)
    REGISTRY.pop("boom", None)


def test_unknown_tool(ctx):
    r = execute(ctx, "nope", {}).result
    assert not r.ok and r.error.code == "INVALID_ARGS" and "echo" in r.error.hint


def test_bad_args_are_structured(ctx):
    r = execute(ctx, "echo", {"text": 1, "extra": True}).result
    assert not r.ok and r.error.code == "INVALID_ARGS"


def test_unexpected_exception_becomes_tool_failure(ctx):
    r = execute(ctx, "boom", {}).result
    assert r.error.code == "TOOL_FAILURE" and "secret internals" not in r.error.message


def test_error_fault_on_second_call_only(snap):
    plan = FaultPlan(faults=[Fault(tool="echo", call=2, kind="error")])
    ctx = RunContext.create(snap, faults=plan)
    assert execute(ctx, "echo", {"text": "a"}).result.ok
    rec = execute(ctx, "echo", {"text": "b"})
    assert rec.result.error.code == "TOOL_FAILURE" and rec.injected_fault == "error"


def test_empty_fault_rejected_for_non_list_tool():
    with pytest.raises(ValueError):
        FaultPlan(faults=[Fault(tool="get_task", call=1, kind="empty")])


def test_schemas_have_name_description_schema():
    s = {t["name"]: t for t in tool_schemas()}["echo"]
    assert s["input_schema"]["properties"]["text"]["type"] == "string" and s["description"]


def test_counting_ids():
    gen = counting_ids()
    assert [gen(), gen()] == ["new-1", "new-2"]


def test_success_json_omits_nulls():
    assert ToolResult.success({"a": 1}).to_model_json() == '{"ok":true,"data":{"a":1}}'


def test_timeout_fault(snap):
    plan = FaultPlan(faults=[Fault(tool="echo", call=1, kind="timeout")])
    ctx = RunContext.create(snap, faults=plan)
    r = execute(ctx, "echo", {"text": "a"})
    assert r.result.error.message == "timed out" and r.injected_fault == "timeout"


def test_empty_and_truncated_faults_on_search():
    search = ToolSpec("search_tasks", "s", _NoArgs,
                      lambda c, a: {"results": [1, 2], "total": 2, "truncated": False}, "read")
    saved = REGISTRY.get("search_tasks")
    register(search)
    try:
        for kind, expected in [
            ("empty", {"results": [], "total": 0, "truncated": False}),
            ("truncated", {"results": [1], "total": 2, "truncated": True}),
        ]:
            from boday_agent.domain.models import Snapshot
            snap = Snapshot.from_app({"tasks": [], "now": "2026-10-20T09:00:00-04:00",
                                      "timezone": "America/New_York"})
            ctx = RunContext.create(snap, faults=FaultPlan(
                faults=[Fault(tool="search_tasks", call=1, kind=kind)]))
            rec = execute(ctx, "search_tasks", {})
            assert rec.result.data == expected and rec.injected_fault == kind
    finally:
        if saved is not None:
            REGISTRY["search_tasks"] = saved
        else:
            REGISTRY.pop("search_tasks", None)


def test_require_seen_and_task(ctx):
    from boday_agent.tools.result import ToolError
    with pytest.raises(ToolError) as e:
        ctx.task("zzz")
    assert e.value.code == "NOT_FOUND"
    with pytest.raises(ToolError) as e:
        ctx.require_seen("gym")
    assert e.value.code == "UNSEEN_ID" and "search_tasks" in e.value.hint
    ctx.mark_seen(["gym"])
    assert ctx.require_seen("gym").id == "gym"
    assert counting_ids()() == "new-1"
