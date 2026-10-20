"""Suite-level checks for the full Part A case set."""
from collections import Counter
from pathlib import Path

from boday_agent.evals.loader import FIXTURES_DIR, load_cases, load_fixture, validate_suite
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
