"""Record model responses and replay them when the prompt has not changed."""
from __future__ import annotations

import json
from pathlib import Path

from boday_agent.evals.loader import CASES_DIR
from boday_agent.prompt import PROMPT_VERSION
from boday_agent.providers.base import ModelResponse

CASSETTES_DIR = CASES_DIR.parent / "cassettes"


class CassetteMismatch(Exception):
    """The cassette cannot be replayed. Re-record it."""


class RecordingProvider:
    """Delegates to an inner provider and writes each response on close."""

    def __init__(self, inner, cassette: Path):
        self.inner = inner
        self.cassette = Path(cassette)
        self._responses: list[ModelResponse] = []

    @property
    def name(self) -> str:
        return self.inner.name

    @property
    def model(self) -> str:
        return self.inner.model

    @property
    def is_local(self) -> bool:
        return self.inner.is_local

    def describe(self) -> dict:
        return self.inner.describe()

    def complete(self, system: str, messages: list, tools: list[dict], timeout_s: float):
        response = self.inner.complete(system, messages, tools, timeout_s)
        self._responses.append(response)
        return response

    def close(self) -> None:
        payload = {
            "prompt_version": PROMPT_VERSION,
            "provider": self.describe(),
            "responses": [
                item.model_dump(mode="json", exclude={"raw"}) for item in self._responses
            ],
        }
        self.cassette.parent.mkdir(parents=True, exist_ok=True)
        self.cassette.write_text(json.dumps(payload, indent=2) + "\n")


class ReplayProvider:
    """Plays a cassette back. Refuses a cassette recorded under another prompt."""

    def __init__(self, cassette: Path):
        path = Path(cassette)
        if not path.is_file():
            raise CassetteMismatch(f"cassette missing: {path}: re-record with --record")
        data = json.loads(path.read_text())
        recorded = data.get("prompt_version")
        if recorded != PROMPT_VERSION:
            raise CassetteMismatch(
                f"cassette recorded with prompt {recorded}, current {PROMPT_VERSION}: "
                "re-record with --record"
            )
        self._responses = [
            ModelResponse.model_validate(item) for item in data.get("responses") or []
        ]
        self._index = 0
        self.path = path
        # The loop turns any provider exception into a failed trial, so the
        # runner checks this flag after the run and aborts instead.
        self.exhausted = False
        info = data.get("provider") or {}
        self.name = str(info.get("provider") or "replay")
        self.model = str(info.get("model") or "replay")
        self.is_local = bool(info.get("is_local", False))
        self._describe = info if isinstance(info, dict) else {}

    def describe(self) -> dict:
        return self._describe

    def complete(self, system: str, messages: list, tools: list[dict], timeout_s: float):
        if self._index >= len(self._responses):
            self.exhausted = True
            raise CassetteMismatch("cassette exhausted")
        response = self._responses[self._index]
        self._index += 1
        return response


def cassette_path(directory: Path, case_id: str, trial: int) -> Path:
    return Path(directory) / f"{case_id}--t{trial}.json"


def regressions_against(baseline: Path, results: list) -> list[str]:
    """Problems with this run against the baseline, compared per (case, trial).

    Replay is deterministic, so a trial that passed in the baseline must pass
    now. A trial the baseline does not have, or a baseline with no results,
    is a problem too: the gate must not pass by having nothing to compare.
    """
    payload = json.loads(Path(baseline).read_text())
    rows = payload.get("results") or []
    if not rows:
        return ["baseline has no results"]
    before = {
        (row["case_id"], int(row.get("trial", 1))): bool((row.get("grade") or {}).get("passed"))
        for row in rows
    }
    problems = []
    for item in sorted(results, key=lambda r: (r.case_id, r.trial)):
        key = (item.case_id, item.trial)
        label = f"{item.case_id} t{item.trial}"
        if key not in before:
            problems.append(f"{label}: not in the baseline")
        elif before[key] and not item.grade.passed:
            problems.append(f"{label}: passed in the baseline, fails now")
    return problems
