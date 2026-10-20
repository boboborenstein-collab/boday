"""Propose + control tools. The model can only *propose*; every request is validated here."""
from __future__ import annotations

import copy
import re
from datetime import UTC, date, timedelta
from typing import Annotated, Any, Literal

from pydantic import (
    AfterValidator,
    BaseModel,
    ConfigDict,
    Field,
    StringConstraints,
    field_validator,
)
from pydantic.alias_generators import to_camel

from ..domain.models import OneTimeTask, RecurringTask, Task
from ..domain.recurrence import build_day_list, build_today_list, occurs_on
from .changes import (
    CreateChange,
    DeleteChange,
    ProposedChange,
    StatusChange,
    StatusSnapshot,
    UpdateChange,
)
from .context import RunContext
from .read import PRIORITY_DESC, _in_quiet
from .registry import ToolSpec, register
from .result import ChangeWarning, ErrorCode, ToolError
from .views import normalize

_DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")


def _check_date(v: str) -> str:
    hint = "use resolve_date to convert natural-language dates"
    if not _DATE_RE.match(v):
        raise ValueError(f"must look like yyyy-MM-dd, got {v!r}; {hint}")
    try:
        date.fromisoformat(v)
    except ValueError:
        raise ValueError(f"{v!r} is not a real date; {hint}") from None
    return v


DateStr = Annotated[str, AfterValidator(_check_date)]
TimeStr = Annotated[str, StringConstraints(pattern=r"^([01]\d|2[0-3]):[0-5]\d$")]
Title = Annotated[str, StringConstraints(min_length=1, max_length=200)]
Notes = Annotated[str, StringConstraints(max_length=2000)]
Tag = Annotated[str, StringConstraints(min_length=1, max_length=30)]
Tags = Annotated[list[Tag], Field(max_length=10)]
SubtaskTitle = Annotated[str, StringConstraints(min_length=1, max_length=200)]
Priority = Annotated[int, Field(ge=1, le=5, description=PRIORITY_DESC)]


class _Strict(BaseModel):
    model_config = ConfigDict(extra="forbid")


# -------------------------------------------------------------- recurrence arg


class DailyArg(_Strict):
    kind: Literal["daily"]


class WeeklyArg(_Strict):
    kind: Literal["weekly"]
    days_of_week: list[Annotated[int, Field(ge=0, le=6)]] = Field(
        min_length=1, description="0 = Sunday ... 6 = Saturday."
    )

    @field_validator("days_of_week")
    @classmethod
    def _unique(cls, v: list[int]) -> list[int]:
        if len(set(v)) != len(v):
            raise ValueError("days_of_week must be unique")
        return v


class EveryNDaysArg(_Strict):
    kind: Literal["everyNDays"]
    n: int = Field(ge=1, le=365)


class MonthlyArg(_Strict):
    kind: Literal["monthly"]
    date_of_month: int = Field(ge=1, le=31)


RecurrenceArg = Annotated[
    DailyArg | WeeklyArg | EveryNDaysArg | MonthlyArg, Field(discriminator="kind")
]


def _rec_camel(r: BaseModel) -> dict:
    return {to_camel(k): v for k, v in r.model_dump().items()}


# --------------------------------------------------------------------- helpers


def _bad(msg: str, hint: str | None = None) -> ToolError:
    return ToolError(ErrorCode.INVALID_ARGS, msg, hint)


def _check_range(ctx: RunContext, value: str, name: str) -> None:
    today = ctx.clock.today
    d = date.fromisoformat(value)
    if d < today:
        raise ToolError(
            ErrorCode.INVALID_DATE, f"{name} {value} is before today ({today.isoformat()})."
        )
    if d > today + timedelta(days=ctx.limits.max_days_ahead):
        raise ToolError(
            ErrorCode.INVALID_DATE,
            f"{name} {value} is more than {ctx.limits.max_days_ahead} days ahead.",
        )


def _warn(code: str, message: str) -> ChangeWarning:
    return ChangeWarning(code=code, message=message)  # type: ignore[arg-type]


def _open_on(ctx: RunContext, ds: str, exclude_id: str | None) -> list[Task]:
    if ds == ctx.clock.today_str:
        items = build_today_list(
            ctx.snapshot.tasks, ctx.snapshot.completions, ds, ctx.clock.tz
        )
    else:
        items = build_day_list(ctx.snapshot.tasks, ctx.snapshot.completions, ds)
    return [
        i.task for i in items
        if not i.completed and not i.skipped and i.task.id != exclude_id
    ]


def _time_warnings(
    ctx: RunContext, ds: str, time: str | None, exclude_id: str | None
) -> list[ChangeWarning]:
    out: list[ChangeWarning] = []
    if not time:
        return out
    clash = [t for t in _open_on(ctx, ds, exclude_id) if t.reminder_time == time]
    if clash:
        names = ", ".join(f"'{t.title}'" for t in clash)
        msg = f"Another open item is also set for {time} on {ds}: {names}."
        out.append(_warn("TIME_CLASH", msg))
    if _in_quiet(ctx, ds, time):
        msg = f"{ds} {time} falls inside a quiet window (Shabbat/holiday)."
        out.append(_warn("QUIET_WINDOW", msg))
    return out


def _recurring_quiet(ctx: RunContext, task: RecurringTask) -> list[ChangeWarning]:
    """QUIET_WINDOW if any occurrence's reminder time falls inside a quiet window."""
    if not task.reminder_time:
        return []
    for w in ctx.snapshot.quiet_windows:
        day = w.start.astimezone(ctx.clock.tz).date()
        last = w.end.astimezone(ctx.clock.tz).date()
        while day <= last:
            ds = day.isoformat()
            if occurs_on(task, ds) and _in_quiet(ctx, ds, task.reminder_time):
                msg = f"An occurrence on {ds} at {task.reminder_time} falls inside a quiet window."
                return [_warn("QUIET_WINDOW", msg)]
            day += timedelta(days=1)
    return []


def _external(task: Task) -> list[ChangeWarning]:
    if task.assigned_by_email:
        return [_warn("EXTERNAL_TASK", f"This task was assigned by {task.assigned_by_email}.")]
    return []


def _commit(ctx: RunContext, change: ProposedChange, summary: str) -> dict:
    ctx.add_change(change)
    return {
        "draft_size": len(ctx.draft),
        "summary": summary,
        "warnings": [w.model_dump() for w in change.warnings],
    }


# ---------------------------------------------------------------------- create


class CreateArgs(_Strict):
    title: Title
    type: Literal["one_time", "recurring"]
    scheduled_date: DateStr | None = Field(
        default=None, description="One-time tasks only: 'yyyy-MM-dd'. Required for one_time."
    )
    recurrence: RecurrenceArg | None = Field(
        default=None, description="Recurring tasks only. Required for recurring."
    )
    start_date: DateStr | None = Field(
        default=None, description="Recurring tasks only: first day, defaults to today."
    )
    end_date: DateStr | None = Field(default=None, description="Recurring tasks only: last day.")
    priority: Priority = 3
    reminder_time: TimeStr | None = Field(default=None, description="'HH:mm' 24h.")
    tags: Tags = Field(default_factory=list)
    notes: Notes | None = None
    subtasks: list[SubtaskTitle] = Field(default_factory=list, max_length=20)


def _create(ctx: RunContext, a: CreateArgs) -> dict:
    today = ctx.clock.today_str
    if a.type == "one_time":
        if a.scheduled_date is None:
            raise _bad("scheduled_date is required for one_time tasks.")
        if a.recurrence is not None or a.start_date or a.end_date:
            raise _bad("recurrence, start_date and end_date are only for recurring tasks.")
        _check_range(ctx, a.scheduled_date, "scheduled_date")
    else:
        if a.recurrence is None:
            raise _bad("recurrence is required for recurring tasks.")
        if a.scheduled_date is not None:
            raise _bad("scheduled_date is only for one_time tasks; use start_date.")
        start = a.start_date or today
        _check_range(ctx, start, "start_date")
        if a.end_date is not None and a.end_date < start:
            raise ToolError(ErrorCode.INVALID_DATE, "end_date is before start_date.")

    task_id = ctx.id_gen()
    after: dict[str, Any] = {
        "id": task_id,
        "type": a.type,
        "title": a.title,
        "priority": a.priority,
    }
    if a.type == "one_time":
        after["scheduledDate"] = a.scheduled_date
        after["completed"] = False
    else:
        assert a.recurrence is not None
        after["recurrence"] = _rec_camel(a.recurrence)
        after["startDate"] = a.start_date or today
        if a.end_date is not None:
            after["endDate"] = a.end_date
    if a.reminder_time is not None:
        after["reminderTime"] = a.reminder_time
    if "tags" in a.model_fields_set:
        after["tags"] = list(a.tags)
    if a.notes is not None:
        after["notes"] = a.notes
    if a.subtasks:
        after["subtasks"] = [{"id": ctx.id_gen(), "title": s, "done": False} for s in a.subtasks]
    after["createdAt"] = (
        ctx.clock.now.astimezone(UTC).strftime("%Y-%m-%dT%H:%M:%S.")
        + f"{ctx.clock.now.microsecond // 1000:03d}Z"
    )

    warnings: list[ChangeWarning] = []
    norm = normalize(a.title)
    for t in ctx.snapshot.tasks:
        if normalize(t.title) != norm:
            continue
        if isinstance(t, OneTimeTask):
            dup = a.type == "one_time" and not t.completed and t.scheduled_date == a.scheduled_date
        else:
            dup = not (t.end_date and t.end_date < today)
        if dup:
            msg = f"Similar task already exists: '{t.title}' ({t.id})."
            warnings.append(_warn("POSSIBLE_DUPLICATE", msg))
            break
    if a.type == "one_time" and a.scheduled_date:
        warnings += _time_warnings(ctx, a.scheduled_date, a.reminder_time, None)
    elif a.type == "recurring":
        warnings += _recurring_quiet(ctx, RecurringTask.model_validate(after))

    change = CreateChange(task_id=task_id, after=after, warnings=warnings)
    return _commit(ctx, change, f"Create {a.type.replace('_', '-')} task '{a.title}'")


register(ToolSpec(
    "propose_create_task",
    "Propose creating a new task. one_time needs scheduled_date; recurring needs recurrence "
    "(start_date defaults to today). Dates must be 'yyyy-MM-dd' (use resolve_date first), not "
    "before today and at most 365 days ahead. Nothing is saved until the user approves the "
    "draft. Returns draft_size, summary and warnings.",
    CreateArgs, _create, "propose",
))


# ---------------------------------------------------------------------- update


class UpdateChanges(_Strict):
    title: Title
    priority: Priority
    reminder_time: TimeStr | None
    notes: Notes | None
    tags: Tags
    scheduled_date: DateStr
    recurrence: RecurrenceArg
    end_date: DateStr | None


# all fields optional: omission leaves a field unchanged, explicit null clears nullable ones
for _f in UpdateChanges.model_fields.values():
    _f.default = None
UpdateChanges.model_rebuild(force=True)


class UpdateArgs(_Strict):
    task_id: str = Field(description="The id of the task, as returned by search_tasks.")
    changes: UpdateChanges = Field(
        description="Only the fields to change. Omit a field to leave it; null clears "
        "reminder_time, notes and end_date."
    )


_FIELD_KEYS = {
    "title": "title", "priority": "priority", "reminder_time": "reminderTime",
    "notes": "notes", "tags": "tags", "scheduled_date": "scheduledDate",
    "recurrence": "recurrence", "end_date": "endDate",
}


def _current_value(task: Task, field: str) -> Any:
    v = getattr(task, field, None)
    if field == "recurrence" and v is not None:
        return v.model_dump(by_alias=True)
    return v


def _update(ctx: RunContext, a: UpdateArgs) -> dict:
    task = ctx.require_seen(a.task_id)
    ch = a.changes
    given = ch.model_fields_set
    if not given:
        raise _bad("changes is empty; give at least one field to change.")
    one_time = isinstance(task, OneTimeTask)
    if not one_time and "scheduled_date" in given:
        raise ToolError(
            ErrorCode.WRONG_TASK_TYPE,
            "scheduled_date only applies to one-time tasks; this task is recurring.",
        )
    if one_time and ("recurrence" in given or "end_date" in given):
        raise ToolError(
            ErrorCode.WRONG_TASK_TYPE,
            "recurrence and end_date only apply to recurring tasks; this task is one-time.",
        )

    new_values: dict[str, Any] = {}
    for f in _FIELD_KEYS:
        if f not in given:
            continue
        v = getattr(ch, f)
        if f == "recurrence":
            v = _rec_camel(v)
        elif f == "tags":
            v = list(v)
        new_values[f] = v

    patch: dict[str, Any] = {}
    before: dict[str, Any] = {}
    raw = ctx.snapshot.raw_tasks.get(task.id, {})
    for f, v in new_values.items():
        if v == _current_value(task, f):
            continue
        key = _FIELD_KEYS[f]
        patch[key] = v
        before[key] = copy.deepcopy(raw.get(key))
    if not patch:
        raise _bad("No change: every requested value already equals the current value.")

    if "scheduled_date" in new_values and "scheduledDate" in patch:
        _check_range(ctx, new_values["scheduled_date"], "scheduled_date")
    if "end_date" in patch and patch["endDate"] is not None:
        assert isinstance(task, RecurringTask)
        if patch["endDate"] < task.start_date:
            raise ToolError(ErrorCode.INVALID_DATE, "end_date is before start_date.")

    warnings = _external(task)
    if isinstance(task, OneTimeTask) and ("reminderTime" in patch or "scheduledDate" in patch):
        ds = patch.get("scheduledDate", task.scheduled_date)
        tm = patch["reminderTime"] if "reminderTime" in patch else task.reminder_time
        warnings += _time_warnings(ctx, ds, tm, task.id)
    elif isinstance(task, RecurringTask) and set(patch) & {
        "reminderTime", "recurrence", "endDate"
    }:
        warnings += _recurring_quiet(ctx, RecurringTask.model_validate({**raw, **patch}))

    change = UpdateChange(task_id=task.id, patch=patch, before_fields=before, warnings=warnings)
    return _commit(ctx, change, f"Update '{task.title}': " + ", ".join(patch))


register(ToolSpec(
    "propose_update_task",
    "Propose editing fields of an existing task (get its id from search_tasks first). "
    "Pass only the fields to change inside `changes`; omitted fields stay as they are and "
    "null clears reminder_time, notes or end_date. scheduled_date is for one-time tasks; "
    "recurrence and end_date are for recurring tasks. Dates 'yyyy-MM-dd' (use resolve_date). "
    "Nothing is saved until the user approves. Returns draft_size, summary and warnings.",
    UpdateArgs, _update, "propose",
))


# ------------------------------------------------------------------ set_status


class SetStatusArgs(_Strict):
    task_id: str = Field(description="The id of the task, as returned by search_tasks.")
    status: Literal["done", "undone", "skipped"]
    date: DateStr | None = Field(
        default=None,
        description="Recurring tasks only: which occurrence, 'yyyy-MM-dd' (default today). "
        "Ignored for one-time tasks.",
    )


def _set_status(ctx: RunContext, a: SetStatusArgs) -> dict:
    task = ctx.require_seen(a.task_id)
    target = "open" if a.status == "undone" else a.status
    if isinstance(task, OneTimeTask):
        if a.status == "skipped":
            raise ToolError(
                ErrorCode.WRONG_TASK_TYPE, "One-time tasks cannot be skipped; mark done or delete."
            )
        current = "done" if task.completed else "open"
        ds = None
    else:
        ds = a.date or ctx.clock.today_str
        if not occurs_on(task, ds):
            raise ToolError(
                ErrorCode.INVALID_DATE, f"'{task.title}' does not occur on {ds}.",
                "Use get_task recent_history or get_agenda to find real occurrence dates.",
            )
        if ds > ctx.clock.today_str:
            _check_range(ctx, ds, "date")
        if a.status == "done" and ds > ctx.clock.today_str:
            raise ToolError(ErrorCode.INVALID_DATE, "Cannot mark a future occurrence done.")
        current = "open"
        for c in ctx.snapshot.completions:
            if c.task_id == task.id and c.completion_date == ds:
                current = "skipped" if c.skipped else "done"
                break
    if current == target:
        raise _bad(f"No change: '{task.title}' is already {current}.")
    change = StatusChange(
        task_id=task.id, date=ds,
        before=StatusSnapshot(status=current), after=StatusSnapshot(status=target),
        warnings=_external(task),
    )
    where = f" on {ds}" if ds else ""
    return _commit(ctx, change, f"Mark '{task.title}' {a.status}{where}")


register(ToolSpec(
    "propose_set_status",
    "Propose marking a task done, undone (reopen) or skipped. One-time tasks: done/undone "
    "only. Recurring tasks: acts on one occurrence `date` (default today; must be a day the "
    "task occurs; done cannot be in the future, skipped can). Nothing is saved until the "
    "user approves. Returns draft_size, summary and warnings.",
    SetStatusArgs, _set_status, "propose",
))


# ---------------------------------------------------------------------- delete


class DeleteArgs(_Strict):
    task_id: str = Field(description="The id of the task, as returned by search_tasks.")
    reason: Annotated[str, StringConstraints(min_length=1, max_length=200)] = Field(
        description="Why the task should be deleted (shown to the user)."
    )


def _delete(ctx: RunContext, a: DeleteArgs) -> dict:
    task = ctx.require_seen(a.task_id)
    snap = ctx.snapshot
    comps = [
        copy.deepcopy(snap.raw_completions[c.id])
        for c in snap.completions
        if c.task_id == task.id and c.id in snap.raw_completions
    ]
    change = DeleteChange(
        task_id=task.id, reason=a.reason,
        before_raw=copy.deepcopy(snap.raw_tasks[task.id]),
        before_completions_raw=comps, warnings=_external(task),
    )
    return _commit(ctx, change, f"Delete '{task.title}'")


register(ToolSpec(
    "propose_delete_task",
    "Propose deleting a task and its completion history (at most 3 deletes per proposal). "
    "Give a short reason. Nothing is deleted until the user approves. Returns draft_size, "
    "summary and warnings.",
    DeleteArgs, _delete, "propose",
))


# -------------------------------------------------------------------- ask_user


class AskUserArgs(_Strict):
    question: Annotated[str, StringConstraints(min_length=1, max_length=300)]
    options: list[Annotated[str, StringConstraints(max_length=80)]] = Field(
        default_factory=list, max_length=6, description="Optional quick-reply choices."
    )


def _ask_user(ctx: RunContext, a: AskUserArgs) -> dict:
    ctx.question = a
    return {"asked": True}


register(ToolSpec(
    "ask_user",
    "Ask the user a clarifying question (optionally with up to 6 quick-reply options) when "
    "the request is ambiguous, e.g. several tasks match or a date is unclear. Ends your turn "
    "once the question is shown.",
    AskUserArgs, _ask_user, "control",
))
