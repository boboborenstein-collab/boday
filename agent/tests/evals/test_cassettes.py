"""Record model responses and replay them without calling a provider."""
import json
from collections import Counter

import pytest

from boday_agent.evals.grader import Grade
from boday_agent.evals.loader import CASES_DIR, build_snapshot, load_cases, load_fixture
from boday_agent.evals.schema import EvalCase
from boday_agent.loop import AgentRequest, run_agent
from boday_agent.providers.fake import FakeProvider, fake_text
from boday_agent.tools.context import counting_ids
from tests.evals.test_runner import DENTIST_SCRIPT, case
from tests.evals.test_schema import CASE


def request() -> AgentRequest:
    loaded = EvalCase.model_validate(CASE)
    snapshot = build_snapshot(loaded, load_fixture("typical_week"))
    return AgentRequest(message=loaded.turns[-1].user, snapshot=snapshot)


def test_record_then_replay_is_identical(tmp_path):
    from boday_agent.evals.cassettes import RecordingProvider, ReplayProvider

    cas = tmp_path / "c.json"
    recorded = RecordingProvider(FakeProvider(DENTIST_SCRIPT), cas)
    first = run_agent(request(), recorded, id_gen=counting_ids())
    recorded.close()
    second = run_agent(request(), ReplayProvider(cas), id_gen=counting_ids())
    assert (first.outcome, first.changes) == (second.outcome, second.changes)
    saved = json.loads(cas.read_text())
    assert saved["responses"] and all("raw" not in item for item in saved["responses"])


def test_stale_prompt_refuses(tmp_path):
    from boday_agent.evals.cassettes import CassetteMismatch, ReplayProvider

    cas = tmp_path / "c.json"
    cas.write_text(
        json.dumps(
            {
                "prompt_version": "000000000000",
                "provider": {"provider": "fake", "model": "fake-1"},
                "responses": [],
            }
        )
    )
    with pytest.raises(CassetteMismatch, match="re-record"):
        ReplayProvider(cas)


def test_exhausted(tmp_path):
    from boday_agent.evals.cassettes import CassetteMismatch, RecordingProvider, ReplayProvider

    cas = tmp_path / "c.json"
    recorded = RecordingProvider(FakeProvider([fake_text("hi")]), cas)
    recorded.complete("system", [], [], 1.0)
    recorded.close()
    replay = ReplayProvider(cas)
    assert replay.complete("system", [], [], 1.0).text == "hi"
    with pytest.raises(CassetteMismatch, match="exhausted"):
        replay.complete("system", [], [], 1.0)


def test_replay_does_not_call_the_provider_and_stale_aborts(tmp_path):
    from boday_agent.evals.cassettes import CassetteMismatch
    from boday_agent.evals.runner import run_suite

    cassettes = tmp_path / "cassettes"
    calls = {"n": 0}

    def factory():
        calls["n"] += 1
        return FakeProvider(list(DENTIST_SCRIPT))

    recorded = run_suite(
        [case()],
        factory,
        trials=1,
        concurrency=1,
        traces_dir=tmp_path / "traces",
        cassette_dir=cassettes,
        cassette_mode="record",
    )
    assert calls["n"] == 1 and recorded.results[0].grade.passed

    def boom():
        raise AssertionError("replay must not construct a provider")

    replayed = run_suite(
        [case()],
        boom,
        trials=1,
        concurrency=1,
        traces_dir=tmp_path / "replay-traces",
        cassette_dir=cassettes,
        cassette_mode="replay",
    )
    assert replayed.results[0].outcome == recorded.results[0].outcome
    assert recorded.stamp["mode"] == "record"
    assert replayed.stamp["mode"] == "replay"

    stale = cassettes / "move-dentist--t1.json"
    payload = json.loads(stale.read_text())
    payload["prompt_version"] = "000000000000"
    stale.write_text(json.dumps(payload))
    with pytest.raises(CassetteMismatch, match="re-record"):
        run_suite(
            [case()],
            boom,
            trials=1,
            concurrency=1,
            traces_dir=tmp_path / "stale-traces",
            cassette_dir=cassettes,
            cassette_mode="replay",
        )


def _baseline(tmp_path, rows):
    path = tmp_path / "base.json"
    path.write_text(json.dumps(rows))
    return path


def _row(case_id, trial, passed):
    return {"case_id": case_id, "trial": trial, "grade": {"passed": passed}}


class _Trial:
    def __init__(self, case_id, trial, passed):
        self.case_id = case_id
        self.trial = trial
        self.grade = Grade(passed, 0 if passed else None, "none", None, "")


def test_regression_flag_lists_trials_that_stopped_passing(tmp_path):
    from boday_agent.evals.cassettes import regressions_against

    baseline = _baseline(tmp_path, {"results": [_row("x", 1, True), _row("y", 1, False)]})
    problems = regressions_against(baseline, [_Trial("x", 1, False), _Trial("y", 1, True)])
    assert problems == ["x t1: passed in the baseline, fails now"]


def test_regression_is_checked_per_trial_even_when_the_case_was_flaky(tmp_path):
    from boday_agent.evals.cassettes import regressions_against

    rows = [_row("x", 1, True), _row("x", 2, False), _row("x", 3, True)]
    baseline = _baseline(tmp_path, {"results": rows})
    assert regressions_against(baseline, [_Trial("x", 1, False)]) == [
        "x t1: passed in the baseline, fails now"
    ]
    assert regressions_against(baseline, [_Trial("x", 1, True)]) == []


def test_trial_missing_from_baseline_is_a_problem(tmp_path):
    from boday_agent.evals.cassettes import regressions_against

    baseline = _baseline(tmp_path, {"results": [_row("y", 1, True)]})
    assert regressions_against(baseline, [_Trial("x", 1, True)]) == ["x t1: not in the baseline"]


def test_baseline_without_results_is_a_problem(tmp_path):
    from boday_agent.evals.cassettes import regressions_against

    baseline = _baseline(tmp_path, {"stamp": {}})
    assert regressions_against(baseline, [_Trial("x", 1, True)]) == ["baseline has no results"]


def _fake_suite(results):
    from boday_agent.evals.runner import SuiteRun

    def fake_run(cases, factory, **kwargs):
        return SuiteRun(
            stamp={"date": "2026-10-21", "model": "fake-1", "split": "dev"},
            results=results,
        )

    return fake_run


def _replay_args(tmp_path, baseline):
    case_file = tmp_path / "cases.txt"
    case_file.write_text("move-dentist-tomorrow\n")
    return [
        "run", "--replay", "--case-file", str(case_file), "--trials", "1",
        "--out", str(tmp_path / "out"), "--fail-on-regression", str(baseline),
    ]


def test_cli_exit_code_follows_the_regression_check(tmp_path, monkeypatch):
    from boday_agent.evals.cli import main
    from tests.evals.test_metrics import fail, pass_, suite_run

    baseline = _baseline(tmp_path, {"results": [_row("move-dentist-tomorrow", 1, True)]})
    passing = suite_run([("move-dentist-tomorrow", "should_act", "happy_path", [pass_()])])
    failing = suite_run(
        [("move-dentist-tomorrow", "should_act", "happy_path", [fail("wrong_field")])]
    )
    monkeypatch.setattr("boday_agent.evals.cli.run_suite", _fake_suite(passing.results))
    assert main(_replay_args(tmp_path, baseline)) == 0
    monkeypatch.setattr("boday_agent.evals.cli.run_suite", _fake_suite(failing.results))
    assert main(_replay_args(tmp_path, baseline)) == 1
    empty = _baseline(tmp_path, {"stamp": {}})
    monkeypatch.setattr("boday_agent.evals.cli.run_suite", _fake_suite(passing.results))
    assert main(_replay_args(tmp_path, empty)) == 1


def test_ci_case_file_matches_the_plan():
    path = CASES_DIR.parent / "ci_cases.txt"
    ids = [
        line.split("#", 1)[0].strip()
        for line in path.read_text().splitlines()
        if line.strip() and not line.lstrip().startswith("#")
    ]
    by_id = {item.id: item for item in load_cases()}
    missing = [item for item in ids if item not in by_id]
    assert missing == []
    counts = Counter(by_id[item].category for item in ids)
    assert all(by_id[item].split == "dev" for item in ids)
    assert counts == {
        "happy_path": 2,
        "dates": 1,
        "recurring": 1,
        "ambiguity": 1,
        "tool_failures": 1,
        "injection": 2,
        "multi_turn": 1,
        "refuse": 1,
    }
    assert len(ids) == 10


def _record_dentist(tmp_path):
    from boday_agent.evals.runner import run_suite

    cassettes = tmp_path / "cassettes"
    run_suite(
        [case()],
        lambda: FakeProvider(list(DENTIST_SCRIPT)),
        trials=1,
        concurrency=1,
        traces_dir=tmp_path / "traces",
        cassette_dir=cassettes,
        cassette_mode="record",
    )
    return cassettes


def _replay(tmp_path, cassettes):
    from boday_agent.evals.runner import run_suite

    def boom():
        raise AssertionError("replay must not construct a provider")

    return run_suite(
        [case()],
        boom,
        trials=1,
        concurrency=1,
        traces_dir=tmp_path / "replay-traces",
        cassette_dir=cassettes,
        cassette_mode="replay",
    )


def test_exhausted_cassette_aborts_the_replay_with_a_rerecord_message(tmp_path):
    from boday_agent.evals.cassettes import CassetteMismatch

    cassettes = _record_dentist(tmp_path)
    path = cassettes / "move-dentist--t1.json"
    payload = json.loads(path.read_text())
    payload["responses"] = payload["responses"][:-1]
    path.write_text(json.dumps(payload))
    with pytest.raises(CassetteMismatch, match=r"exhausted.*re-record with --record"):
        _replay(tmp_path, cassettes)


def test_missing_cassette_says_to_rerecord(tmp_path):
    from boday_agent.evals.cassettes import CassetteMismatch

    with pytest.raises(CassetteMismatch, match=r"missing.*re-record with --record"):
        _replay(tmp_path, tmp_path / "empty")
