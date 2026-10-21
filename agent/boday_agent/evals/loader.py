"""Load eval cases and fixtures, and check the suite for authoring errors."""
from __future__ import annotations

import json
from pathlib import Path

import yaml
from pydantic import ValidationError

import boday_agent.tools  # noqa: F401  (registers tools so fault names can be checked)
from boday_agent.domain.models import Snapshot
from boday_agent.evals.schema import EvalCase
from boday_agent.tools.faults import FaultPlan
from boday_agent.tools.registry import REGISTRY

_AGENT_ROOT = Path(__file__).resolve().parents[2]
CASES_DIR = _AGENT_ROOT / "evals" / "cases"
FIXTURES_DIR = _AGENT_ROOT / "evals" / "fixtures"


def load_cases(dir: Path = CASES_DIR) -> list[EvalCase]:
    cases: list[EvalCase] = []
    for path in sorted(dir.glob("*.yaml")):
        try:
            raw = yaml.safe_load(path.read_text())
        except yaml.YAMLError as exc:
            raise ValueError(f"{path.name}: {exc}") from exc
        if not isinstance(raw, list):
            raise ValueError(f"{path.name}: expected a YAML list of cases")
        for index, item in enumerate(raw):
            case_id = item.get("id") if isinstance(item, dict) else None
            label = case_id if isinstance(case_id, str) else f"index {index}"
            try:
                cases.append(EvalCase.model_validate(item))
            except ValidationError as exc:
                raise ValueError(f"{path.name}: case {label}: {exc}") from exc
    return cases


def load_fixture(name: str, dir: Path = FIXTURES_DIR) -> dict:
    path = dir / f"{name}.json"
    data = json.loads(path.read_text())
    if not isinstance(data, dict):
        raise ValueError(f"{path.name}: fixture must be a JSON object")
    missing = [key for key in ("tasks", "completions", "quietWindows") if key not in data]
    if missing:
        raise ValueError(f"{path.name}: missing keys {missing}")
    return data


def build_snapshot(case: EvalCase, fixture: dict) -> Snapshot:
    return Snapshot.from_app({**fixture, "now": case.now.isoformat(), "timezone": case.timezone})


def _task_ids(fixture_dir: Path, name: str) -> set[str] | None:
    path = fixture_dir / f"{name}.json"
    if not path.is_file():
        return None
    data = json.loads(path.read_text())
    tasks = data.get("tasks") if isinstance(data, dict) else None
    if not isinstance(tasks, list):
        return set()
    ids: set[str] = set()
    for task in tasks:
        if isinstance(task, dict) and isinstance(task.get("id"), str):
            ids.add(task["id"])
    return ids


def validate_suite(cases: list[EvalCase], fixtures_dir: Path) -> list[str]:
    errors: list[str] = []
    seen: set[str] = set()
    for case in cases:
        if case.id in seen:
            errors.append(f"{case.id}: duplicate id")
        seen.add(case.id)

        ids = _task_ids(fixtures_dir, case.fixture)
        if ids is None:
            errors.append(f"{case.id}: unknown fixture '{case.fixture}'")
            ids = set()

        named: list[str] = []
        for acceptable in case.expect.accept:
            for change in acceptable.changes:
                if change.task:
                    named.append(change.task)
        named.extend(case.expect.forbid_touch)
        for task_id in named:
            if task_id not in ids:
                errors.append(f"{case.id}: task '{task_id}' not in fixture '{case.fixture}'")

        advice = case.category == "advice"
        has_judge = case.expect.judge is not None
        if advice != has_judge:
            errors.append(f"{case.id}: judge must be present iff category is advice")
        errors.extend(_fault_errors(case))
    return errors


def _fault_errors(case: EvalCase) -> list[str]:
    """FaultPlan owns the call and kind rules; each fault is checked on its own
    so every bad fault is reported once, without pydantic's wrapper text."""
    errors: list[str] = []
    for fault in case.faults:
        if fault.tool not in REGISTRY:
            errors.append(f"{case.id}: unknown fault tool {fault.tool!r}")
        try:
            FaultPlan(faults=[fault])
        except ValidationError as exc:
            for item in exc.errors():
                message = str(item["msg"]).removeprefix("Value error, ")
                errors.append(f"{case.id}: {message}")
    return errors
