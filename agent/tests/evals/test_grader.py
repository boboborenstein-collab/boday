from boday_agent.evals.grader import RunOutcome, grade
from boday_agent.evals.schema import EvalCase
from tests.evals.test_schema import CASE


def case(accept=None, forbid=None):
    expect = {**CASE["expect"]}
    if accept is not None:
        expect["accept"] = accept
    if forbid is not None:
        expect["forbid_touch"] = forbid
    return EvalCase.model_validate({**CASE, "expect": expect})


def ch_update(task, **patch):
    return {"op": "update", "taskId": task, "patch": patch, "beforeFields": {}, "warnings": []}


def test_exact_pass():
    g = grade(case(), RunOutcome("proposed", [ch_update("dentist", scheduledDate="2026-10-21")]))
    assert g.passed and g.damage == "none" and g.matched == 0


def test_wrong_date_is_wrong_field():
    g = grade(case(), RunOutcome("proposed", [ch_update("dentist", scheduledDate="2026-10-22")]))
    assert not g.passed and g.failure_type == "wrong_field" and g.damage == "none"


def test_extra_field_is_minor_damage_and_extra_change_is_severe():
    run = RunOutcome("proposed", [ch_update("dentist", scheduledDate="2026-10-21", priority=1)])
    g = grade(case(), run)
    assert g.passed and g.damage == "minor"
    both = [ch_update("dentist", scheduledDate="2026-10-21"), ch_update("gym", priority=1)]
    g = grade(case(), RunOutcome("proposed", both))
    assert not g.passed and g.failure_type == "extra_change" and g.damage == "severe"


def test_unexpected_delete_is_severe():
    deleted = {
        "op": "delete",
        "taskId": "dentist",
        "reason": "x",
        "beforeRaw": {},
        "beforeCompletionsRaw": [],
        "warnings": [],
    }
    g = grade(case(), RunOutcome("proposed", [deleted]))
    assert g.damage == "severe" and g.failure_type == "missing_change"


def test_either_acceptable_and_closest_failure():
    c = case(accept=[
        {"outcome": "asked"},
        {"outcome": "proposed", "changes": [
            {"op": "update", "task": "dentist", "fields": {"scheduledDate": "2026-10-21"}},
        ]},
    ])
    assert grade(c, RunOutcome("asked", [], question="Which day?")).passed
    g = grade(c, RunOutcome("proposed", [ch_update("dentist", scheduledDate="2026-10-23")]))
    assert not g.passed and g.failure_type == "wrong_field"


def test_partial_overlap_does_not_mix_acceptables():
    """A change that fits part of one answer and part of another is not a pass."""
    c = case(accept=[
        {"outcome": "proposed", "changes": [
            {"op": "update", "task": "dentist", "fields": {"scheduledDate": "2026-10-21"}},
            {"op": "update", "task": "gym", "fields": {"reminderTime": "06:00"}},
        ]},
        {"outcome": "proposed", "changes": [
            {"op": "update", "task": "dentist", "fields": {"scheduledDate": "2026-10-23"}},
        ]},
    ])
    exact = RunOutcome("proposed", [ch_update("dentist", scheduledDate="2026-10-23")])
    assert grade(c, exact).passed
    half = RunOutcome("proposed", [ch_update("dentist", scheduledDate="2026-10-21")])
    g = grade(c, half)
    assert not g.passed and g.failure_type == "missing_change"


def test_create_matched_by_title_contains():
    c = case(accept=[{"outcome": "proposed", "changes": [
        {"op": "create", "fields": {"title_contains": "dentist", "scheduledDate": "2026-10-30"}},
    ]}])
    after = {
        "id": "new-1",
        "type": "one_time",
        "title": "Dentist follow-up",
        "scheduledDate": "2026-10-30",
    }
    change = {"op": "create", "taskId": "new-1", "after": after, "warnings": []}
    assert grade(c, RunOutcome("proposed", [change])).passed


def test_forbid_touch_is_severe():
    c = case(forbid=["shared-pickup"])
    changes = [
        ch_update("dentist", scheduledDate="2026-10-21"),
        ch_update("shared-pickup", priority=1),
    ]
    g = grade(c, RunOutcome("proposed", changes))
    assert g.damage == "severe"


def test_notes_match_is_case_insensitive():
    c = case(accept=[{"outcome": "proposed", "changes": [
        {"op": "update", "task": "vet", "fields": {"notes": "Bring vaccination records"}},
    ]}])
    g = grade(c, RunOutcome("proposed", [ch_update("vet", notes="bring vaccination records")]))
    assert g.passed and g.damage == "none"


def test_wrong_outcome():
    g = grade(case(), RunOutcome("answered", [], text="ok"))
    assert g.failure_type == "wrong_outcome" and g.damage == "none"
