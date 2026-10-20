"""Replay each expected proposal through the real tools."""
from __future__ import annotations

import boday_agent.tools  # noqa: F401  (registers the tools)
from boday_agent.evals.grader import RunOutcome, grade
from boday_agent.evals.loader import build_snapshot
from boday_agent.evals.schema import EvalCase, ExpectedChange
from boday_agent.tools.context import Limits, RunContext, counting_ids
from boday_agent.tools.registry import execute


def _snake(key: str) -> str:
    chars: list[str] = []
    for char in key:
        if char.isupper():
            chars.append("_")
            chars.append(char.lower())
        else:
            chars.append(char)
    return "".join(chars)


def _snake_value(value):
    if isinstance(value, dict):
        return {_snake(key): _snake_value(item) for key, item in value.items()}
    if isinstance(value, list):
        return [_snake_value(item) for item in value]
    return value


def _tool_call(change: ExpectedChange) -> tuple[str, dict]:
    fields = dict(change.fields)
    if "title" not in fields and "title_contains" in fields:
        fields["title"] = fields.pop("title_contains")
    else:
        fields.pop("title_contains", None)
    if change.op == "set_status" and fields.get("status") == "open":
        # The draft stores the resulting status; the tool argument is the verb.
        fields["status"] = "undone"
    payload = _snake_value(fields)
    if change.op == "create":
        return "propose_create_task", payload
    if change.op == "update":
        return "propose_update_task", {"task_id": change.task, "changes": payload}
    if change.op == "delete":
        return "propose_delete_task", {"task_id": change.task, "reason": "oracle"}
    args: dict = {"task_id": change.task, "status": payload.get("status")}
    if "date" in payload:
        args["date"] = payload["date"]
    return "propose_set_status", args


def check_expectations(case: EvalCase, fixture: dict) -> list[str]:
    errors: list[str] = []
    for index, acceptable in enumerate(case.expect.accept):
        if acceptable.outcome != "proposed":
            continue
        ctx = RunContext.create(
            build_snapshot(case, fixture),
            limits=Limits(max_search_results=1000),
            id_gen=counting_ids(),
        )
        execute(ctx, "search_tasks", {"include_completed": True})
        failed = False
        for change_index, change in enumerate(acceptable.changes):
            name, args = _tool_call(change)
            record = execute(ctx, name, args)
            if record.result.ok:
                continue
            failed = True
            info = record.result.error
            code = info.code if info is not None else "TOOL_FAILURE"
            message = info.message if info is not None else "tool call failed"
            errors.append(
                f"{case.id} acceptable #{index} change #{change_index}: {code} {message}"
            )
        if failed:
            continue
        graded = grade(case, RunOutcome("proposed", ctx.draft_payload()))
        if graded.passed and graded.damage == "none":
            continue
        errors.append(
            f"{case.id} acceptable #{index}: oracle draft graded "
            f"passed={graded.passed} damage={graded.damage} failure={graded.failure_type}"
        )
    return errors
