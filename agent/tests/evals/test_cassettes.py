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


def test_regression_flag_lists_cases_that_stopped_passing(tmp_path):
    from boday_agent.evals.cassettes import regressions_against

    baseline = tmp_path / "base.json"
    baseline.write_text(
        json.dumps(
            {
                "results": [
                    {"case_id": "x", "grade": {"passed": True}},
                    {"case_id": "y", "grade": {"passed": False}},
                ]
            }
        )
    )

    class Trial:
        def __init__(self, case_id, passed):
            self.case_id = case_id
            self.grade = Grade(passed, 0 if passed else None, "none", None, "")

    assert regressions_against(baseline, [Trial("x", False), Trial("y", True)]) == ["x"]


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
