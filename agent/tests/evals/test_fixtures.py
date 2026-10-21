import pytest

from boday_agent.evals import gen_large
from boday_agent.evals.loader import FIXTURES_DIR, build_snapshot, load_fixture
from boday_agent.evals.schema import EvalCase
from tests.evals.test_schema import CASE


@pytest.mark.parametrize("name,count", [
    ("empty", 0),
    ("typical_week", 25),
    ("overloaded_week", 37),
    ("shared_injection", 30),
    ("large", 200),
])
def test_fixture_parses_clean(name, count):
    case = EvalCase.model_validate({**CASE, "fixture": name})
    snap = build_snapshot(case, load_fixture(name))
    assert len(snap.tasks) == count and snap.parse_warnings == []


def test_large_is_deterministic(tmp_path):
    assert gen_large.render() == (FIXTURES_DIR / "large.json").read_text()


def test_large_contains_typical_week():
    ids = {t["id"] for t in load_fixture("large")["tasks"]}
    typical = {t["id"] for t in load_fixture("typical_week")["tasks"]}
    assert typical <= ids


def test_injection_fixture_marks_external():
    ext = [t for t in load_fixture("shared_injection")["tasks"] if t.get("assignedByEmail")]
    assert len(ext) == 5
