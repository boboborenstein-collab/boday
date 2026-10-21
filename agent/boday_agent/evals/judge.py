"""Advice-quality judge. Scores stay out of the pass/fail rate."""
from __future__ import annotations

import csv
import json
from pathlib import Path

import anthropic
from pydantic import BaseModel, Field, ValidationError

from boday_agent.evals.loader import CASES_DIR, load_fixture
from boday_agent.evals.schema import EvalCase, UserTurn

JUDGE_MODEL = "claude-opus-5-5"
RESULTS_DIR = CASES_DIR.parent / "results"
_RUBRIC = Path(__file__).resolve().parents[2] / "evals" / "judge_rubric.md"


class JudgeScore(BaseModel):
    score: int = Field(ge=1, le=5)
    reasons: str


def default_client():
    """Real Anthropic client. Callers that pass a stub never reach this."""
    return anthropic.Anthropic()


def judge_answer(
    case: EvalCase, answer_text: str, fixture: dict, *, client=None
) -> JudgeScore | None:
    if client is None:
        client = default_client()
    try:
        response = client.messages.parse(
            model=JUDGE_MODEL,
            max_tokens=16000,
            system=_RUBRIC.read_text(),
            messages=[{"role": "user", "content": _user_content(case, answer_text, fixture)}],
            output_format=JudgeScore,
        )
    except (anthropic.APIError, ValidationError, TypeError):
        return None
    if getattr(response, "stop_reason", None) == "refusal":
        return None
    parsed = getattr(response, "parsed_output", None)
    if not isinstance(parsed, JudgeScore):
        return None
    return parsed


def score_advice(run, cases: list[EvalCase], client) -> None:
    by_id = {case.id: case for case in cases}
    fixtures: dict[str, dict] = {}
    for item in run.results:
        if item.category != "advice":
            continue
        if item.outcome != "answered":
            # A failed or proposed trial is already a pass/fail failure; scoring
            # its text would mix reliability into advice quality.
            continue
        case = by_id.get(item.case_id)
        if case is None:
            item.judge_error = "missing_case"
            continue
        if case.fixture not in fixtures:
            fixtures[case.fixture] = load_fixture(case.fixture)
        score = judge_answer(case, item.answer_text, fixtures[case.fixture], client=client)
        if score is None:
            item.judge_score = None
            item.judge_error = "judge_error"
        else:
            item.judge_score = score.score
            item.judge_error = None


def export_ratings(results_json: Path, out_csv: Path) -> int:
    payload = json.loads(Path(results_json).read_text())
    out_csv.parent.mkdir(parents=True, exist_ok=True)
    count = 0
    with out_csv.open("w", newline="") as handle:
        writer = csv.writer(handle)
        writer.writerow(["case_id", "trial", "answer_text", "judge_score", "owner_score"])
        for item in payload.get("results") or []:
            if item.get("category") != "advice":
                continue
            score = item.get("judge_score")
            writer.writerow(
                [
                    item.get("case_id", ""),
                    item.get("trial", ""),
                    item.get("answer_text") or "",
                    "" if score is None else score,
                    "",
                ]
            )
            count += 1
    return count


def import_ratings(rated_csv: Path, results_json: Path, *, out: Path | None = None) -> dict:
    json.loads(Path(results_json).read_text())
    pairs: list[tuple[int, int]] = []
    with Path(rated_csv).open(newline="") as handle:
        for row in csv.DictReader(handle):
            owner = (row.get("owner_score") or "").strip()
            judge = (row.get("judge_score") or "").strip()
            if not owner or not judge:
                continue
            pairs.append((int(judge), int(owner)))
    n = len(pairs)
    exact = sum(1 for judge, owner in pairs if judge == owner) / n if n else 0.0
    within = sum(1 for judge, owner in pairs if abs(judge - owner) <= 1) / n if n else 0.0
    # 20–30 is the sample the owner was asked to rate. More rows still count.
    result = {
        "n": n,
        "exact_agreement": exact,
        "within_one_agreement": within,
        "calibrated": n >= 20,
        "results": str(results_json),
    }
    dest = out or (RESULTS_DIR / "judge_calibration.json")
    dest.parent.mkdir(parents=True, exist_ok=True)
    dest.write_text(json.dumps(result, indent=2) + "\n")
    return result


def load_calibration(path: Path | None = None) -> dict | None:
    file = path or (RESULTS_DIR / "judge_calibration.json")
    if not file.is_file():
        return None
    try:
        data = json.loads(file.read_text())
    except json.JSONDecodeError:
        return None
    return data if isinstance(data, dict) else None


def _user_content(case: EvalCase, answer_text: str, fixture: dict) -> str:
    last = case.turns[-1]
    request = last.user if isinstance(last, UserTurn) else ""
    focus = case.expect.judge.rubric_focus if case.expect.judge else ""
    tasks = []
    for task in fixture.get("tasks") or []:
        if not isinstance(task, dict):
            continue
        tasks.append(
            {
                "id": task.get("id"),
                "title": task.get("title"),
                "type": task.get("type"),
                "scheduledDate": task.get("scheduledDate"),
                "startDate": task.get("startDate"),
                "endDate": task.get("endDate"),
                "recurrence": task.get("recurrence"),
                "completed": task.get("completed"),
                "priority": task.get("priority"),
                "reminderTime": task.get("reminderTime"),
            }
        )
    blob = json.dumps(tasks, separators=(",", ":"))
    quiet = json.dumps(fixture.get("quietWindows") or [], separators=(",", ":"))
    weekday = case.now.strftime("%A")
    return (
        f"Request: {request}\n"
        f"Rubric focus: {focus}\n"
        f"Now: {weekday} {case.now.isoformat()} {case.timezone}\n"
        f"Quiet windows:\n{quiet}\n"
        f"Tasks:\n{blob}\n"
        f"Answer:\n{answer_text}"
    )
