import json

import pytest
from pydantic import ValidationError

from boday_agent.evals.cli import main
from boday_agent.evals.loader import load_cases, validate_suite
from boday_agent.evals.schema import EvalCase

CASE = {
    "id": "move-dentist",
    "category": "happy_path",
    "label": "should_act",
    "split": "dev",
    "fixture": "typical_week",
    "turns": [{"user": "move my dentist to tomorrow"}],
    "expect": {
        "accept": [{
            "outcome": "proposed",
            "changes": [{
                "op": "update",
                "task": "dentist",
                "fields": {"scheduledDate": "2026-10-21"},
            }],
        }],
    },
}


def test_valid_case_defaults():
    c = EvalCase.model_validate(CASE)
    assert c.now.isoformat() == "2026-10-20T09:00:00-04:00" and c.timezone == "America/New_York"


@pytest.mark.parametrize("patch", [
    {"turns": [{"assistant": "hi"}]},  # last turn not user
    {"expect": {"accept": [{"outcome": "proposed"}]}},  # proposed without changes
    {"expect": {"accept": [{"outcome": "asked", "changes": [{"op": "delete", "task": "x"}]}]}},
    {"expect": {"accept": [{"outcome": "proposed", "changes": [{"op": "update"}]}]}},
    {"id": "Bad ID"},
    {"surprise": 1},
])
def test_invalid_cases(patch):
    with pytest.raises(ValidationError):
        EvalCase.model_validate({**CASE, **patch})


def _empty_fixture(tmp_path):
    payload = {"tasks": [], "completions": [], "quietWindows": []}
    (tmp_path / "f.json").write_text(json.dumps(payload))


def test_validate_suite_finds_problems(tmp_path):
    _empty_fixture(tmp_path)
    cases = [
        EvalCase.model_validate({**CASE, "fixture": "f"}),
        EvalCase.model_validate({**CASE, "fixture": "nope"}),
    ]
    errs = validate_suite(cases, tmp_path)
    assert any("duplicate id" in e for e in errs)
    assert any("unknown fixture 'nope'" in e for e in errs)
    assert any("'dentist'" in e and "not in fixture" in e for e in errs)


def test_judge_present_iff_advice(tmp_path):
    _empty_fixture(tmp_path)
    advice = EvalCase.model_validate({
        **CASE, "id": "advice-1", "category": "advice", "fixture": "f",
        "expect": {"accept": [{"outcome": "answered"}], "judge": {"rubric_focus": "specific"}},
    })
    missing = EvalCase.model_validate({
        **CASE, "id": "advice-2", "category": "advice", "fixture": "f",
        "expect": {"accept": [{"outcome": "answered"}]},
    })
    extra = EvalCase.model_validate({
        **CASE, "id": "hp-1", "fixture": "f",
        "expect": {"accept": [{"outcome": "asked"}], "judge": {"rubric_focus": "x"}},
    })
    touched = EvalCase.model_validate({
        **CASE, "id": "hp-2", "fixture": "f",
        "expect": {"accept": [{"outcome": "asked"}], "forbid_touch": ["ghost"]},
    })
    errs = validate_suite([advice, missing, extra, touched], tmp_path)
    assert not any("advice-1" in e and "judge" in e for e in errs)
    assert any("advice-2" in e and "judge" in e for e in errs)
    assert any("hp-1" in e and "judge" in e for e in errs)
    assert any("'ghost'" in e and "not in fixture" in e for e in errs)


def test_load_cases_names_file_and_id(tmp_path):
    (tmp_path / "bad.yaml").write_text("[{id: 'Bad ID', category: happy_path}]\n")
    with pytest.raises(ValueError, match=r"bad\.yaml:.*Bad ID"):
        load_cases(tmp_path)


def test_validate_cli_empty_suite(capsys):
    assert main(["validate"]) == 0
    assert capsys.readouterr().out.strip() == "0 cases OK"
