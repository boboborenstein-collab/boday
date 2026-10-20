"""Suite-level checks. Part A5 enforces the six categories written so far;
categories with no cases yet are skipped until Task A6 fills them in.
"""
from collections import Counter

from boday_agent.evals.loader import FIXTURES_DIR, load_cases, load_fixture, validate_suite
from boday_agent.evals.oracle import check_expectations

# Global Constraints. Categories absent from the tree are skipped until A6.
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
PART1 = {
    "happy_path", "dates", "recurring", "ambiguity", "conflicts", "bulk",
}


def test_suite_oracle_and_shape():
    cases = load_cases()
    assert validate_suite(cases, FIXTURES_DIR) == []
    for case in cases:
        assert check_expectations(case, load_fixture(case.fixture)) == [], case.id

    counts = Counter(case.category for case in cases)
    for category, minimum in MINIMUMS.items():
        if category not in PART1 and counts[category] == 0:
            continue
        assert counts[category] >= minimum, category

    for category, count in counts.items():
        holdout = sum(
            1 for case in cases if case.category == category and case.split == "holdout"
        )
        assert holdout >= 1, category
        assert holdout / count <= 0.4, category
