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
            raise CassetteMismatch(f"cassette missing: {path}")
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
        info = data.get("provider") or {}
        self.name = str(info.get("provider") or "replay")
        self.model = str(info.get("model") or "replay")
        self.is_local = bool(info.get("is_local", False))
        self._describe = info if isinstance(info, dict) else {}

    def describe(self) -> dict:
        return self._describe

    def complete(self, system: str, messages: list, tools: list[dict], timeout_s: float):
        if self._index >= len(self._responses):
            raise CassetteMismatch("cassette exhausted")
        response = self._responses[self._index]
        self._index += 1
        return response


def cassette_path(directory: Path, case_id: str, trial: int) -> Path:
    return Path(directory) / f"{case_id}--t{trial}.json"


def regressions_against(baseline: Path, results: list) -> list[str]:
    """Cases that passed every baseline trial and do not pass every current trial."""
    payload = json.loads(Path(baseline).read_text())
    before: dict[str, list[bool]] = {}
    for row in payload.get("results") or []:
        grade = row.get("grade") or {}
        before.setdefault(row["case_id"], []).append(bool(grade.get("passed")))
    after: dict[str, list[bool]] = {}
    for item in results:
        after.setdefault(item.case_id, []).append(bool(item.grade.passed))
    return sorted(
        case_id
        for case_id, flags in before.items()
        if flags and all(flags) and case_id in after and not all(after[case_id])
    )
