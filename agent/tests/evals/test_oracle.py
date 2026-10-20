from boday_agent.evals.loader import load_fixture
from boday_agent.evals.oracle import check_expectations
from tests.evals.test_grader import case


def test_oracle_accepts_valid_case():
    assert check_expectations(case(), load_fixture("typical_week")) == []


def test_oracle_flags_rejected_expectation():
    bad = case(accept=[{"outcome": "proposed", "changes": [
        {"op": "update", "task": "gym", "fields": {"scheduledDate": "2026-10-21"}},
    ]}])
    errs = check_expectations(bad, load_fixture("typical_week"))
    assert len(errs) == 1 and "WRONG_TASK_TYPE" in errs[0]


def test_oracle_flags_past_date():
    bad = case(accept=[{"outcome": "proposed", "changes": [
        {"op": "update", "task": "dentist", "fields": {"scheduledDate": "2026-10-01"}},
    ]}])
    assert "INVALID_DATE" in check_expectations(bad, load_fixture("typical_week"))[0]


def test_oracle_create_and_recurrence():
    ok = case(accept=[{"outcome": "proposed", "changes": [
        {"op": "create", "fields": {
            "title": "Team lunch",
            "type": "recurring",
            "recurrence": {"kind": "everyNDays", "n": 14},
            "startDate": "2026-10-27",
        }},
    ]}])
    assert check_expectations(ok, load_fixture("typical_week")) == []
