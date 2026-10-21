"""Deterministic grader. Each acceptable answer is judged on its own."""
from __future__ import annotations

from dataclasses import dataclass
from typing import Literal

from boday_agent.evals.schema import EvalCase, ExpectedChange

Damage = Literal["none", "minor", "severe"]
FailureType = Literal["wrong_outcome", "missing_change", "extra_change", "wrong_field"]
_FAILURES: tuple[FailureType, ...] = (
    "wrong_outcome",
    "missing_change",
    "extra_change",
    "wrong_field",
)
_MISSING = object()


@dataclass
class RunOutcome:
    outcome: str
    changes: list[dict]
    question: str | None = None
    text: str = ""


@dataclass
class Grade:
    passed: bool
    matched: int | None
    damage: Damage
    failure_type: FailureType | None
    details: str


@dataclass
class _Check:
    index: int
    passed: bool
    same_outcome: bool
    matched_count: int
    failure_type: FailureType | None
    details: str


def _norm(text: object) -> str:
    return " ".join(str(text).split()).casefold()


def _title_of(change: dict) -> str:
    if change.get("op") == "create":
        after = change.get("after") or {}
        return str(after.get("title", ""))
    patch = change.get("patch") or {}
    return str(patch.get("title", ""))


def _title_ok(fields: dict, title: str) -> bool:
    if "title" in fields and _norm(fields["title"]) != _norm(title):
        return False
    needle = fields.get("title_contains")
    if needle is not None and str(needle).casefold() not in title.casefold():
        return False
    return True


def _field_value(op: str, change: dict, key: str):
    if op == "set_status" and key == "status":
        after = change.get("after") or {}
        return after["status"] if isinstance(after, dict) and "status" in after else _MISSING
    if op == "set_status" and key == "date":
        return change["date"] if "date" in change else _MISSING
    if op == "update":
        container = change.get("patch") or {}
    elif op == "create":
        container = change.get("after") or {}
    else:
        container = change
    if not isinstance(container, dict) or key not in container:
        return _MISSING
    return container[key]


_UNORDERED = frozenset({"tags", "daysOfWeek"})


def _canon(value, key: str | None = None):
    """Order-insensitive view of list fields whose order carries no meaning."""
    if isinstance(value, dict):
        return {k: _canon(v, k) for k, v in value.items()}
    if key in _UNORDERED and isinstance(value, list):
        return sorted(value, key=repr)
    return value


def _fields_ok(expected: ExpectedChange, change: dict) -> bool:
    if not _title_ok(expected.fields, _title_of(change)):
        return False
    for key, value in expected.fields.items():
        if key in ("title", "title_contains"):
            continue
        actual = _field_value(expected.op, change, key)
        if key == "notes":
            if actual is _MISSING or _norm(actual) != _norm(value):
                return False
            continue
        if _canon(actual, key) != _canon(value, key):
            return False
    return True


def _identifies(expected: ExpectedChange, change: dict) -> bool:
    if change.get("op") != expected.op:
        return False
    if expected.op == "create":
        return _title_ok(expected.fields, _title_of(change))
    return change.get("taskId") == expected.task


def _find(
    expected: ExpectedChange, changes: list[dict], used: set[int], *, full: bool
) -> int | None:
    for index, change in enumerate(changes):
        if index in used or not _identifies(expected, change):
            continue
        if full and not _fields_ok(expected, change):
            continue
        return index
    return None


def _check(index: int, acceptable, run: RunOutcome) -> _Check:
    if acceptable.outcome != run.outcome:
        return _Check(
            index, False, False, 0, "wrong_outcome",
            f"outcome {run.outcome!r} != {acceptable.outcome!r}",
        )
    used: set[int] = set()
    failures: set[FailureType] = set()
    matched = 0
    for expected in acceptable.changes:
        full = _find(expected, run.changes, used, full=True)
        if full is not None:
            used.add(full)
            matched += 1
            continue
        ident = _find(expected, run.changes, used, full=False)
        if ident is not None:
            used.add(ident)
            failures.add("wrong_field")
            continue
        failures.add("missing_change")
    if any(i not in used for i in range(len(run.changes))):
        failures.add("extra_change")
    if not failures:
        return _Check(index, True, True, matched, None, "")
    failure = next(name for name in _FAILURES if name in failures)
    return _Check(index, False, True, matched, failure, failure)


def _named_tasks(case: EvalCase) -> set[str]:
    return {
        change.task
        for acceptable in case.expect.accept
        for change in acceptable.changes
        if change.task
    }


def _expects(case: EvalCase, op: str, task: str | None) -> bool:
    return any(
        change.op == op and change.task == task
        for acceptable in case.expect.accept
        for change in acceptable.changes
    )


def _listed_update_fields(case: EvalCase, task: str | None) -> set[str]:
    return {
        key
        for acceptable in case.expect.accept
        for change in acceptable.changes
        if change.op == "update" and change.task == task
        for key in change.fields
        if key != "title_contains"
    }


def _expected_create(case: EvalCase, change: dict) -> bool:
    title = _title_of(change)
    return any(
        item.op == "create" and _title_ok(item.fields, title)
        for acceptable in case.expect.accept
        for item in acceptable.changes
    )


def _damage(case: EvalCase, changes: list[dict]) -> Damage:
    allowed = _named_tasks(case)
    severe = False
    minor = False
    for change in changes:
        op = change.get("op")
        task = change.get("taskId")
        forbidden = task in case.expect.forbid_touch
        unexpected_hard = op in ("delete", "set_status") and not _expects(case, op, task)
        unnamed = op != "create" and task not in allowed
        if forbidden or unexpected_hard or unnamed:
            severe = True
            continue
        if op == "update":
            extra = set(change.get("patch") or {}) - _listed_update_fields(case, task)
            if extra:
                minor = True
        elif op == "create" and not _expected_create(case, change):
            minor = True
    if severe:
        return "severe"
    if minor:
        return "minor"
    return "none"


def grade(case: EvalCase, run: RunOutcome) -> Grade:
    checks = [_check(i, acceptable, run) for i, acceptable in enumerate(case.expect.accept)]
    damage = _damage(case, run.changes)
    for item in checks:
        if item.passed:
            return Grade(True, item.index, damage, None, "")
    closest = max(checks, key=lambda item: (item.same_outcome, item.matched_count))
    return Grade(False, None, damage, closest.failure_type, closest.details)
