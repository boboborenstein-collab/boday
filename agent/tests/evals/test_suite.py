"""Suite-level checks for the full Part A case set."""
from collections import Counter
from pathlib import Path
from zoneinfo import ZoneInfo

from boday_agent.domain.clock import Clock
from boday_agent.domain.recurrence import build_today_list
from boday_agent.evals.grader import RunOutcome, grade
from boday_agent.evals.loader import (
    FIXTURES_DIR,
    build_snapshot,
    load_cases,
    load_fixture,
    validate_suite,
)
from boday_agent.evals.oracle import check_expectations

MINIMUMS = {
    "happy_path": 15,
    "dates": 10,
    "recurring": 10,
    "ambiguity": 10,
    "conflicts": 6,
    "bulk": 6,
    "tool_failures": 8,
    "refuse": 6,
    "injection": 10,
    "multi_turn": 8,
    "advice": 8,
}


def test_suite_oracle_and_shape():
    cases = load_cases()
    assert validate_suite(cases, FIXTURES_DIR) == []
    for case in cases:
        assert check_expectations(case, load_fixture(case.fixture)) == [], case.id

    assert 97 <= len(cases) <= 110
    holdout_total = sum(1 for case in cases if case.split == "holdout")
    assert 22 <= holdout_total <= 28

    counts = Counter(case.category for case in cases)
    for category, minimum in MINIMUMS.items():
        assert counts[category] >= minimum, category

    for category, count in counts.items():
        holdout = sum(
            1 for case in cases if case.category == category and case.split == "holdout"
        )
        assert holdout >= 1, category
        assert holdout / count <= 0.4, category

    rubric = Path(__file__).resolve().parents[2] / "evals" / "judge_rubric.md"
    text = rubric.read_text()
    assert "1" in text and "5" in text and "changed anything" in text.lower()


def _case(case_id):
    return next(case for case in load_cases() if case.id == case_id)


def _update(task, **patch):
    return {"op": "update", "taskId": task, "patch": patch, "beforeFields": {}, "warnings": []}


def test_injection_agenda_shows_an_external_task():
    """What's-on-today and plan-my-day must actually surface an injected task."""
    for case_id in ("inj-today", "inj-plan-my-day"):
        case = _case(case_id)
        snap = build_snapshot(case, load_fixture(case.fixture))
        clock = Clock.from_snapshot(snap)
        items = build_today_list(
            snap.tasks, snap.completions, clock.today_str, ZoneInfo(snap.timezone)
        )
        assert any(item.task.assigned_by_email for item in items), case_id


def test_rejected_proposal_has_a_first_change_to_redo():
    case = _case("mt-first-one")
    proposal = case.turns[1].proposal or []
    assert len(proposal) >= 2
    expected = case.expect.accept[0].changes[0]
    first = proposal[0]
    assert expected.task == first["task"]
    assert expected.fields["scheduledDate"] == first["scheduledDate"]


def test_wednesday_9am_phrase_is_not_an_ambiguous_hour():
    assert "9am" in _case("dentist-wed-9am").turns[-1].user


def test_weekend_move_may_ask_because_of_shabbat():
    outcomes = {item.outcome for item in _case("weekend-dentist").expect.accept}
    assert "asked" in outcomes


def test_p3_move_accepts_resolver_next_week():
    case = _case("p3s-next-week")
    changes = [
        _update(task, scheduledDate="2026-10-26")
        for task in ("call-mom", "pharmacy", "dinner-dana")
    ]
    graded = grade(case, RunOutcome("proposed", changes))
    assert graded.passed and graded.damage == "none"


def test_gym_move_accepts_a_longer_title():
    case = _case("move-todays-gym")
    changes = [
        {
            "op": "set_status", "taskId": "gym", "date": "2026-10-21",
            "before": {"status": "open"}, "after": {"status": "skipped"}, "warnings": [],
        },
        {
            "op": "create", "taskId": "new-1", "warnings": [],
            "after": {
                "title": "Gym (moved from Wed)", "type": "one_time",
                "scheduledDate": "2026-10-22", "reminderTime": "07:00",
            },
        },
    ]
    graded = grade(case, RunOutcome("proposed", changes))
    assert graded.passed and graded.damage == "none"


def test_booking_the_existing_haircut_is_not_severe():
    case = _case("haircut-wed-9am")
    change = _update("haircut", scheduledDate="2026-10-21", reminderTime="09:00")
    graded = grade(case, RunOutcome("proposed", [change]))
    assert graded.passed and graded.damage == "none"
