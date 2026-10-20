"""Port of src/lib/recurrence.ts (pure functions; dates are 'yyyy-MM-dd')."""
from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime
from zoneinfo import ZoneInfo

from boday_agent.domain.models import OneTimeTask, RecurringTask, Task, TaskCompletion


@dataclass
class DayItem:
    task: Task
    completed: bool
    skipped: bool
    carried_over_days: int


def _d(s: str) -> date:
    return date.fromisoformat(s)


def occurs_on(task: RecurringTask, date_str: str) -> bool:
    if date_str < task.start_date:
        return False
    if task.end_date and date_str > task.end_date:
        return False
    r = task.recurrence
    if r.kind == "daily":
        return True
    if r.kind == "weekly":
        return (_d(date_str).weekday() + 1) % 7 in r.days_of_week
    if r.kind == "everyNDays":
        if r.n <= 0:
            return False
        diff = (_d(date_str) - _d(task.start_date)).days
        return diff >= 0 and diff % r.n == 0
    return _d(date_str).day == r.date_of_month


def is_one_time_active(task: OneTimeTask, date_str: str) -> bool:
    return (not task.completed) and task.scheduled_date <= date_str


def carry_over_days(task: OneTimeTask, date_str: str) -> int:
    return max(0, (_d(date_str) - _d(task.scheduled_date)).days)


def _sets(completions: list[TaskCompletion]) -> tuple[set[tuple[str, str]], set[tuple[str, str]]]:
    done = {(c.task_id, c.completion_date) for c in completions if not c.skipped}
    skipped = {(c.task_id, c.completion_date) for c in completions if c.skipped}
    return done, skipped


def build_today_list(
    tasks: list[Task], completions: list[TaskCompletion], today: str, tz: ZoneInfo
) -> list[DayItem]:
    done, skipped = _sets(completions)
    items: list[DayItem] = []
    for task in tasks:
        if isinstance(task, OneTimeTask):
            if is_one_time_active(task, today):
                items.append(DayItem(task, False, False, carry_over_days(task, today)))
            elif task.completed and task.completed_at and (
                datetime.fromisoformat(task.completed_at).astimezone(tz).date().isoformat() == today
            ):
                items.append(DayItem(task, True, False, 0))
        elif occurs_on(task, today):
            key = (task.id, today)
            items.append(DayItem(task, key in done, key in skipped, 0))
    return sort_day_items(items)


def build_day_list(
    tasks: list[Task], completions: list[TaskCompletion], date_str: str
) -> list[DayItem]:
    done, skipped = _sets(completions)
    items: list[DayItem] = []
    for task in tasks:
        if isinstance(task, OneTimeTask):
            if task.scheduled_date == date_str:
                items.append(DayItem(task, task.completed, False, 0))
        elif occurs_on(task, date_str):
            key = (task.id, date_str)
            items.append(DayItem(task, key in done, key in skipped, 0))
    return sort_day_items(items)


def sort_day_items(items: list[DayItem]) -> list[DayItem]:
    # Stable sort, keys mirror the TS comparator.
    return sorted(
        items,
        key=lambda i: (
            i.completed or i.skipped,
            i.task.priority,
            -i.carried_over_days,
            i.task.created_at,
        ),
    )
