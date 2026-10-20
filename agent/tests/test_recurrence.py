import json
from pathlib import Path
from zoneinfo import ZoneInfo

from pydantic import TypeAdapter

from boday_agent.domain.models import RecurringTask, Task, TaskCompletion
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
