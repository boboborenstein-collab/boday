import json
from pathlib import Path
from zoneinfo import ZoneInfo

from pydantic import TypeAdapter

from boday_agent.domain.models import OneTimeTask, RecurringTask, Task, TaskCompletion
from boday_agent.domain.recurrence import build_day_list, build_today_list, occurs_on

FX = json.loads((Path(__file__).parent / "fixtures/recurrence_parity.json").read_text())
TASKS = TypeAdapter(list[Task]).validate_python(FX["tasks"])
COMPS = TypeAdapter(list[TaskCompletion]).validate_python(FX["completions"])
TZ = ZoneInfo(FX["timezone"])


def test_occurs_on_matches_typescript():
    for task in TASKS:
        if isinstance(task, RecurringTask):
            got = [d for d in FX["day_lists"] if occurs_on(task, d)]
            assert got == FX["occurs"][task.id], task.id


def test_day_lists_match_typescript():
    for date, ids in FX["day_lists"].items():
        assert [i.task.id for i in build_day_list(TASKS, COMPS, date)] == ids, date


def test_today_lists_match_typescript():
    for today, rows in FX["today_lists"].items():
        got = [[i.task.id, i.carried_over_days, i.completed, i.skipped]
               for i in build_today_list(TASKS, COMPS, today, TZ)]
        assert got == rows, today


def test_weekly_sunday_and_saturday_are_occurrences():
    # days_of_week 0 = Sunday, 6 = Saturday. 2026-06-17 is a Wednesday.
    task = RecurringTask.model_validate({
        "id": "w", "title": "Weekend", "priority": 3,
        "recurrence": {"kind": "weekly", "daysOfWeek": [0, 6]},
        "startDate": "2026-06-01", "createdAt": "2026-06-01T08:00:00.000Z",
    })
    assert occurs_on(task, "2026-06-14")  # Sunday
    assert occurs_on(task, "2026-06-13")  # Saturday
    assert not occurs_on(task, "2026-06-17")


def test_completed_at_just_after_utc_midnight_is_still_local_today():
    # 2026-06-18T03:30:00Z is 23:30 on 2026-06-17 in America/New_York (EDT).
    task = OneTimeTask.model_validate({
        "id": "ot", "title": "Late", "priority": 3, "scheduledDate": "2026-06-17",
        "completed": True, "completedAt": "2026-06-18T03:30:00.000Z",
        "createdAt": "2026-06-17T08:00:00.000Z",
    })
    def ids(day):
        return [(i.task.id, i.completed) for i in build_today_list([task], [], day, TZ)]

    assert ids("2026-06-17") == [("ot", True)]
    assert ids("2026-06-16") == []
    assert ids("2026-06-18") == []


def test_parity_fixture_covers_weekend_weekly_and_utc_midnight():
    by_id = {t.id: t for t in TASKS}
    weekly = by_id["syn-weekly-sun-sat"]
    assert isinstance(weekly, RecurringTask)
    assert weekly.recurrence.days_of_week == [0, 6]
    occurs = FX["occurs"]["syn-weekly-sun-sat"]
    assert "2026-06-14" in occurs and "2026-06-13" in occurs
    assert "2026-06-17" not in occurs
    done = by_id["ot-completed-utc-midnight"]
    assert done.completed_at == "2026-06-18T03:30:00.000Z"
    # Offset -1 from 2026-06-17 is the day before, included as its own "today".
    assert "2026-06-16" in FX["today_lists"]
    today_rows = {row[0]: row for row in FX["today_lists"]["2026-06-17"]}
    assert today_rows["ot-completed-utc-midnight"][2] is True
    assert "ot-completed-utc-midnight" not in [row[0] for row in FX["today_lists"]["2026-06-16"]]
