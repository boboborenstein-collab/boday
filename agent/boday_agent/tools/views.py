"""Model-facing views of tasks. User text (title, notes, subtasks) passes through verbatim."""
from __future__ import annotations

import re
import unicodedata
from datetime import timedelta

from ..domain.clock import Clock
from ..domain.models import OneTimeTask, RecurringTask, Task, TaskCompletion
from ..domain.recurrence import carry_over_days, occurs_on
from .context import Limits

_DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]


def normalize(text: str) -> str:
    decomposed = unicodedata.normalize("NFKD", text)
    stripped = "".join(c for c in decomposed if not unicodedata.combining(c))
    cleaned = "".join(c if (c.isalnum() or c == " ") else " " if c.isspace() else ""
                      for c in stripped)
    return re.sub(r" +", " ", cleaned.lower()).strip()


def describe_schedule(task: RecurringTask) -> str:
    r = task.recurrence
    if r.kind == "daily":
        return "daily"
    if r.kind == "weekly":
        return "weekly on " + ", ".join(_DOW[d] for d in sorted(r.days_of_week))
    if r.kind == "everyNDays":
        return f"every {r.n} days"
    return f"monthly on day {r.date_of_month}"


def task_summary(task: Task, clock: Clock) -> dict:
    out: dict = {
        "id": task.id,
        "title": task.title,
        "type": task.type,
        "priority": task.priority,
        "tags": list(task.tags),
        "reminder_time": task.reminder_time,
        "external": bool(task.assigned_by_email),
    }
    if isinstance(task, OneTimeTask):
        out["scheduled_date"] = task.scheduled_date
        out["completed"] = task.completed
        out["carried_over_days"] = (
            0 if task.completed else carry_over_days(task, clock.today_str)
        )
    else:
        out["schedule"] = describe_schedule(task)
        out["start_date"] = task.start_date
        out["end_date"] = task.end_date
    return out


def task_detail(
    task: Task, completions: list[TaskCompletion], clock: Clock, limits: Limits
) -> dict:
    out = task_summary(task, clock)
    out["notes"] = task.notes
    out["subtasks"] = [{"title": s.title, "done": s.done} for s in task.subtasks]
    out["assigned_by"] = task.assigned_by_email
    if isinstance(task, RecurringTask):
        done = {c.completion_date for c in completions if c.task_id == task.id and not c.skipped}
        skipped = {c.completion_date for c in completions if c.task_id == task.id and c.skipped}
        today = clock.today
        history = []
        for back in range(limits.recent_history_days - 1, -1, -1):
            d = (today - timedelta(days=back)).isoformat()
            if not occurs_on(task, d):
                continue
            if d in done:
                status = "done"
            elif d in skipped:
                status = "skipped"
            elif d == today.isoformat():
                status = "open"
            else:
                status = "missed"
            history.append({"date": d, "status": status})
        out["recent_history"] = history
    return out
