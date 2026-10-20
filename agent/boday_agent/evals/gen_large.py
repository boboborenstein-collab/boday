"""Deterministic 200-task fixture.

`python -m boday_agent.evals.gen_large` rewrites `evals/fixtures/large.json`
byte-for-byte. The 25 `typical_week` tasks are copied in verbatim; the rest
are drawn from `random.Random(20261020)`.
"""
from __future__ import annotations

import json
import random
from datetime import date, timedelta

from boday_agent.evals.loader import FIXTURES_DIR

_CREATED = "2026-09-01T12:00:00Z"
_ONE_START = date(2026, 9, 15)
_ONE_END = date(2026, 12, 31)
_SPAN = (_ONE_END - _ONE_START).days
_ADJECTIVES = (
    "amber", "brisk", "calm", "daily", "early", "final", "gentle", "hasty",
    "inner", "joint", "keen", "local", "minor", "neat", "open", "plain",
    "quiet", "rapid", "small", "tidy",
)
_NOUNS = (
    "audit", "budget", "checklist", "draft", "errand", "followup", "invoice",
    "journal", "kickoff", "lunch", "memo", "outreach", "packet", "queue",
    "recap", "survey", "template", "update", "visit", "worksheet",
)
_TAGS = ("work", "home", "health")
_KINDS = ("daily", "weekly", "everyNDays", "monthly")
_EXTRA_ONE_TIME = 133  # 17 in typical_week + 133 = 150
_EXTRA_RECURRING = 42  # 8 in typical_week + 42 = 50
_NOVEMBER = 30
_COMPLETED = 19  # plus typical_week's completed `report` = 20


def _dumps(data: dict) -> str:
    return json.dumps(data, indent=2, ensure_ascii=False) + "\n"


def _title(rng: random.Random, n: int) -> str:
    return f"{rng.choice(_ADJECTIVES)} {rng.choice(_NOUNS)} {n}"


def _flavor(rng: random.Random) -> tuple[int, str, str | None]:
    priority = rng.randint(1, 4)
    tag = rng.choice(_TAGS)
    reminder = f"{rng.randint(6, 20):02d}:00" if rng.random() < 0.5 else None
    return priority, tag, reminder


def _one_time(rng: random.Random, index: int) -> dict:
    priority, tag, reminder = _flavor(rng)
    completed = index >= _EXTRA_ONE_TIME - _COMPLETED
    if index < _NOVEMBER:
        scheduled = date(2026, 11, 1) + timedelta(days=index)
    elif completed:
        offset = index - (_EXTRA_ONE_TIME - _COMPLETED)
        scheduled = date(2026, 9, 16) + timedelta(days=offset)
    else:
        scheduled = _ONE_START + timedelta(days=rng.randrange(_SPAN + 1))
    task: dict = {
        "id": f"g-ot-{index + 1:03d}",
        "type": "one_time",
        "title": _title(rng, index + 1),
        "priority": priority,
        "tags": [tag],
        "scheduledDate": scheduled.isoformat(),
        "completed": completed,
        "createdAt": _CREATED,
    }
    if reminder:
        task["reminderTime"] = reminder
    if completed:
        task["completedAt"] = "2026-09-20T15:00:00Z"
    return task


def _recurring(rng: random.Random, index: int) -> dict:
    priority, tag, reminder = _flavor(rng)
    kind = _KINDS[index % len(_KINDS)]
    if kind == "weekly":
        count = rng.randint(1, 3)
        recurrence: dict = {"kind": kind, "daysOfWeek": sorted(rng.sample(range(7), count))}
    elif kind == "everyNDays":
        recurrence = {"kind": kind, "n": rng.randint(1, 14)}
    elif kind == "monthly":
        recurrence = {"kind": kind, "dateOfMonth": rng.randint(1, 28)}
    else:
        recurrence = {"kind": "daily"}
    start = date(2026, 9, 1) + timedelta(days=rng.randrange(30))
    task: dict = {
        "id": f"g-rec-{index + 1:03d}",
        "type": "recurring",
        "title": _title(rng, index + 1),
        "priority": priority,
        "tags": [tag],
        "recurrence": recurrence,
        "startDate": start.isoformat(),
        "createdAt": _CREATED,
    }
    if reminder:
        task["reminderTime"] = reminder
    return task


def build(typical: dict) -> dict:
    rng = random.Random(20261020)
    tasks = list(typical["tasks"])
    tasks.extend(_one_time(rng, i) for i in range(_EXTRA_ONE_TIME))
    tasks.extend(_recurring(rng, i) for i in range(_EXTRA_RECURRING))
    return {
        "tasks": tasks,
        "completions": typical["completions"],
        "quietWindows": typical["quietWindows"],
    }


def render() -> str:
    typical = json.loads((FIXTURES_DIR / "typical_week.json").read_text())
    return _dumps(build(typical))


def main() -> None:
    (FIXTURES_DIR / "large.json").write_text(render())


if __name__ == "__main__":
    main()
