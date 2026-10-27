"""LLM judge and owner-calibration. The client is a stub; nothing is sent."""
import csv
import json
from types import SimpleNamespace

import anthropic

from boday_agent.evals.grader import Grade
from boday_agent.evals.loader import load_fixture
from boday_agent.evals.runner import SuiteRun, TrialResult
from boday_agent.evals.schema import EvalCase
from tests.evals.test_schema import CASE


def advice_case() -> EvalCase:
    return EvalCase.model_validate(
        {
            **CASE,
            "id": "drop-advice",
            "category": "advice",
            "fixture": "overloaded_week",
            "turns": [{"user": "I have a lot this week, what should I drop?"}],
            "expect": {
                "accept": [{"outcome": "answered"}],
                "judge": {"rubric_focus": "names real Wednesday errands"},
            },
        }
    )


class _APIError(anthropic.APIError):
    def __init__(self):
        Exception.__init__(self, "down")


class StubClient:
    def __init__(self, stop_reason="end_turn", error=None):
        self.kwargs = None
        self.stop_reason = stop_reason
        self.error = error
        self.messages = self

    def parse(self, **kwargs):
        self.kwargs = kwargs
        if self.error is not None:
            raise self.error
        from boday_agent.evals.judge import JudgeScore

        parsed = JudgeScore(score=4, reasons="specific")
        return SimpleNamespace(parsed_output=parsed, stop_reason=self.stop_reason)


def _trial(case_id, category, text, score=None):
    return TrialResult(
        case_id=case_id,
        category=category,
        label="either",
        split="dev",
        trial=1,
        outcome="answered",
        grade=Grade(True, 0, "none", None, ""),
        tool_calls=0,
        tool_errors=0,
        input_tokens=0,
        output_tokens=0,
        cost_usd=0.0,
        latency_ms=0.0,
        trace_path="",
        answer_text=text,
        judge_score=score,
    )


def test_judge_request_uses_fixed_model_and_rubric():
    from boday_agent.evals.judge import JUDGE_MODEL, JudgeScore, judge_answer

    client = StubClient()
    score = judge_answer(
        advice_case(),
        "Drop the errands on Wednesday.",
        load_fixture("overloaded_week"),
        client=client,
    )
    assert score is not None and score.score == 4
    assert client.kwargs["model"] == JUDGE_MODEL == "claude-opus-5-5"
    assert client.kwargs["output_format"] is JudgeScore
    assert client.kwargs["max_tokens"] == 16000
    content = client.kwargs["messages"][0]["content"]
    assert "Drop the errands" in content
    assert "weekly" in content
    assert "17:52" in content
    assert "Tuesday" in content
    assert "must not claim to have changed anything" in client.kwargs["system"]


def test_judge_validation_error_does_not_abort_scoring():
    from pydantic import ValidationError

    from boday_agent.evals.judge import JudgeScore, judge_answer, score_advice

    try:
        JudgeScore.model_validate({"score": 9, "reasons": "nope"})
    except ValidationError as exc:
        bad = exc
    else:
        raise AssertionError("score 9 should not validate")
    client = StubClient(error=bad)
    fixture = load_fixture("overloaded_week")
    assert judge_answer(advice_case(), "Drop it.", fixture, client=client) is None
    run = SuiteRun(stamp={}, results=[_trial("drop-advice", "advice", "Drop it.")])
    score_advice(run, [advice_case()], StubClient(error=bad))
    assert run.results[0].judge_score is None
    assert run.results[0].judge_error


def test_judge_refusal_returns_none():
    from boday_agent.evals.judge import judge_answer

    client = StubClient(stop_reason="refusal")
    assert (
        judge_answer(advice_case(), "no", load_fixture("overloaded_week"), client=client) is None
    )


def test_judge_api_error_returns_none():
    from boday_agent.evals.judge import judge_answer

    client = StubClient(error=_APIError())
    assert (
        judge_answer(advice_case(), "no", load_fixture("overloaded_week"), client=client) is None
    )


def test_calibration_agreement(tmp_path):
    from boday_agent.evals.judge import import_ratings

    rated = tmp_path / "rated.csv"
    with rated.open("w", newline="") as handle:
        writer = csv.writer(handle)
        writer.writerow(["case_id", "trial", "answer_text", "judge_score", "owner_score"])
        for index, (judge, owner) in enumerate([(5, 5), (4, 3), (2, 4), (3, 3)], start=1):
            writer.writerow([f"c{index}", 1, "answer", judge, owner])
        writer.writerow(["c5", 1, "unrated", 4, ""])
    results = tmp_path / "results.json"
    results.write_text("{}\n")
    out = tmp_path / "judge_calibration.json"
    result = import_ratings(rated, results, out=out)
    assert result["exact_agreement"] == 0.5
    assert result["within_one_agreement"] == 0.75
    assert json.loads(out.read_text())["exact_agreement"] == 0.5


def test_report_places_agreement_next_to_advice_quality(tmp_path):
    from boday_agent.evals.metrics import compute_metrics
    from boday_agent.evals.report import write_report

    run = SuiteRun(
        stamp={"date": "2026-10-21", "model": "fake-1", "split": "dev"},
        results=[
            _trial("drop-advice", "advice", "Drop Wednesday.", 4),
            _trial("b", "advice", "x", 2),
        ],
    )
    metrics = compute_metrics(run)
    assert metrics.advice_quality_mean == 3
    _json, md_path = write_report(
        run,
        metrics,
        tmp_path,
        calibration={
            "exact_agreement": 0.5,
            "within_one_agreement": 0.75,
            "n": 4,
            "calibrated": False,
        },
    )
    line = next(row for row in md_path.read_text().splitlines() if "Advice quality" in row)
    assert "3.000" in line
    assert "0.500" in line and "0.750" in line


class CountingClient(StubClient):
    def __init__(self):
        super().__init__()
        self.calls = 0

    def parse(self, **kwargs):
        self.calls += 1
        return super().parse(**kwargs)


def test_judge_scores_only_answered_advice_trials():
    from dataclasses import replace

    from boday_agent.evals.judge import score_advice

    answered = _trial("drop-advice", "advice", "Drop the errands.")
    failed = replace(_trial("drop-advice", "advice", ""), trial=2, outcome="failed")
    proposed = replace(_trial("drop-advice", "advice", "Moved it."), trial=3, outcome="proposed")
    run = SuiteRun(stamp={}, results=[answered, failed, proposed])
    client = CountingClient()
    score_advice(run, [advice_case()], client)
    assert client.calls == 1
    assert [item.judge_score for item in run.results] == [4, None, None]
    assert [item.judge_error for item in run.results] == [None, None, None]


def _judge_cli(tmp_path, monkeypatch, scorer):
    from boday_agent.evals.cli import main

    run = SuiteRun(
        stamp={"date": "2026-10-21", "model": "fake-1", "split": "dev"},
        results=[_trial("drop-advice", "advice", "Drop the errands.")],
    )
    monkeypatch.setattr("boday_agent.evals.cli.run_suite", lambda *a, **k: run)
    monkeypatch.setattr("boday_agent.evals.cli.default_client", lambda: StubClient())
    monkeypatch.setattr("boday_agent.evals.cli.score_advice", scorer)
    code = main(
        [
            "run", "--provider", "anthropic", "--category", "advice", "--judge",
            "--out", str(tmp_path),
        ]
    )
    return code, sorted(tmp_path.glob("*.json"))


def test_judge_crash_keeps_the_suite_report(tmp_path, monkeypatch):
    def explode(run, cases, client):
        raise RuntimeError("judge exploded")

    code, files = _judge_cli(tmp_path, monkeypatch, explode)
    assert code == 1
    assert len(files) == 1
    saved = json.loads(files[0].read_text())
    assert saved["results"][0]["answer_text"] == "Drop the errands."


def test_judge_scores_are_written_into_the_same_report(tmp_path, monkeypatch):
    def score(run, cases, client):
        for item in run.results:
            item.judge_score = 4

    code, files = _judge_cli(tmp_path, monkeypatch, score)
    assert code == 0
    assert len(files) == 1
    saved = json.loads(files[0].read_text())
    assert saved["results"][0]["judge_score"] == 4
    assert saved["metrics"]["advice_quality_mean"] == 4


def test_judge_sees_completions_so_missed_occurrences_are_checkable():
    # Without completions the judge called real missed recurring days
    # "invented" (adv-behind, baseline calibration).
    from boday_agent.evals.judge import judge_answer

    fixture = {
        "tasks": [{"id": "gym", "title": "Gym", "recurrence": {"kind": "daily"}}],
        "completions": [
            {"id": "c1", "taskId": "gym", "completionDate": "2026-10-14", "skipped": False},
            {"id": "c2", "taskId": "gym", "completionDate": "2026-10-15", "skipped": True},
        ],
        "quietWindows": [],
    }
    client = StubClient()
    judge_answer(advice_case(), "You missed gym on the 16th.", fixture, client=client)
    content = client.kwargs["messages"][0]["content"]
    assert "Completions" in content
    assert '"taskId":"gym","date":"2026-10-14","skipped":false' in content
    assert '"date":"2026-10-15","skipped":true' in content


def test_rejudge_rescores_rated_answers_and_keeps_reference_scores(tmp_path):
    from boday_agent.evals.judge import rejudge_ratings

    rated = tmp_path / "rated.csv"
    with rated.open("w", newline="") as handle:
        writer = csv.writer(handle)
        writer.writerow(["case_id", "trial", "answer_text", "judge_score", "owner_score", "reason"])
        writer.writerow(["drop-advice", "1", "Drop the errands.", "1", "5", "right"])
        writer.writerow(["drop-advice", "2", "Which day?", "", "2", "asked instead"])
        writer.writerow(["no-such-case", "1", "text", "3", "3", "gone"])
    out = tmp_path / "rejudged.csv"
    client = CountingClient()
    count = rejudge_ratings(rated, out, cases=[advice_case()], client=client)
    assert count == 1 and client.calls == 1
    rows = list(csv.DictReader(out.open(newline="")))
    assert [r["judge_score"] for r in rows] == ["4", "", ""]
    assert [r["owner_score"] for r in rows] == ["5", "2", "3"]
    assert rows[0]["reason"] == "right"
