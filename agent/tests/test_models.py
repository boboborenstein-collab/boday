import pytest
from pydantic import ValidationError

from boday_agent.domain.clock import Clock
from boday_agent.domain.models import OneTimeTask, RecurringTask, Snapshot, Weekly

APP_JSON = {
    "tasks": [
        {"id": "a", "type": "one_time", "title": "Dentist", "priority": 2,
         "scheduledDate": "2026-10-22", "completed": False, "reminderTime": None,
         "createdAt": "2026-09-01T12:00:00Z", "someFutureField": 1},
        {"id": "b", "type": "recurring", "title": "Torah", "priority": 5,
         "recurrence": {"kind": "weekly", "daysOfWeek": [1, 3]},
         "startDate": "2026-09-01", "createdAt": "2026-09-01T12:00:00Z"},
    ],
    "completions": [{"id": "c", "taskId": "b", "completionDate": "2026-10-19",
                     "completedAt": "2026-10-19T12:00:00Z", "skipped": True}],
    "quietWindows": [{"start": "2026-10-23T17:52:00-04:00",
                      "end": "2026-10-24T18:51:00-04:00", "title": "Candle lighting"}],
    "now": "2026-10-20T09:00:00-04:00",
    "timezone": "America/New_York",
}

def test_parses_app_snapshot_with_extra_and_missing_fields():
    snap = Snapshot.from_app(APP_JSON)
    a, b = snap.tasks
    assert isinstance(a, OneTimeTask) and a.tags == [] and a.reminder_time is None
    assert isinstance(b, RecurringTask) and isinstance(b.recurrence, Weekly)
    assert b.recurrence.days_of_week == [1, 3] and b.priority == 5
    assert snap.completions[0].skipped is True

def test_dumps_camel_case_for_the_app():
    snap = Snapshot.from_app(APP_JSON)
    out = snap.tasks[0].model_dump(by_alias=True)
    assert out["scheduledDate"] == "2026-10-22" and "scheduled_date" not in out

def test_rejects_naive_now_and_bad_timezone():
    with pytest.raises(ValidationError):
        Snapshot.from_app({**APP_JSON, "now": "2026-10-20T09:00:00"})
    with pytest.raises(ValidationError):
        Snapshot.from_app({**APP_JSON, "timezone": "Mars/Base"})

def test_malformed_task_is_skipped_not_fatal():
    bad = {"id": "z", "type": "one_time", "title": "Bad", "priority": 9,
           "scheduledDate": "2026-10-22", "completed": False, "createdAt": "2026-09-01T12:00:00Z"}
    snap = Snapshot.from_app({**APP_JSON, "tasks": [*APP_JSON["tasks"], bad]})
    assert [t.id for t in snap.tasks] == ["a", "b"]
    assert len(snap.parse_warnings) == 1 and "'z'" in snap.parse_warnings[0]

def test_raw_task_json_is_kept_verbatim():
    snap = Snapshot.from_app(APP_JSON)
    assert snap.raw_tasks["a"] == APP_JSON["tasks"][0]  # incl. someFutureField, no defaults
    assert "raw_tasks" not in snap.model_dump()

def test_clock_today_is_local_not_utc():
    snap = Snapshot.from_app({**APP_JSON, "now": "2026-10-20T23:30:00-04:00"})
    clock = Clock.from_snapshot(snap)
    assert clock.today_str == "2026-10-20"

def test_raw_is_deep_copy_and_completions_and_windows_skip_bad_items():
    data = {**APP_JSON,
            "completions": [*APP_JSON["completions"], {"id": "bad"}, "junk"],
            "quietWindows": [*APP_JSON["quietWindows"], {"start": "nope"}]}
    snap = Snapshot.from_app(data)
    assert snap.raw_completions["c"] == APP_JSON["completions"][0]
    assert snap.raw_completions["c"] is not data["completions"][0]
    assert snap.raw_tasks["a"] is not data["tasks"][0]
    assert len(snap.completions) == 1 and len(snap.quiet_windows) == 1
    assert len(snap.parse_warnings) == 3
    assert any("'bad'" in w for w in snap.parse_warnings)


def _task(**over):
    base = {"id": "x", "type": "one_time", "title": "T", "priority": 2,
            "scheduledDate": "2026-10-22", "completed": False, "createdAt": "2026-09-01T12:00:00Z"}
    return {**base, **over}


def _rec(**over):
    base = {"id": "r", "type": "recurring", "title": "R", "priority": 2,
            "recurrence": {"kind": "daily"}, "startDate": "2026-09-01",
            "createdAt": "2026-09-01T12:00:00Z"}
    return {**base, **over}


def _snap_with(tasks=(), completions=()):
    return Snapshot.from_app({**APP_JSON, "tasks": list(tasks), "completions": list(completions)})


@pytest.mark.parametrize("item", [
    _task(scheduledDate="10/22/2026"),
    _task(scheduledDate="2026-02-30"),
    _rec(startDate=""),
    _rec(endDate="soon"),
    _task(completed=True, completedAt="yesterday"),
])
def test_bad_date_fields_skip_the_task_with_a_warning(item):
    snap = _snap_with([item])
    assert snap.tasks == [] and snap.raw_tasks == {}
    assert len(snap.parse_warnings) == 1 and f"'{item['id']}'" in snap.parse_warnings[0]


def test_bad_completion_date_is_skipped():
    snap = _snap_with([], [{"id": "c1", "taskId": "x", "completionDate": "10/19/2026",
                            "completedAt": "2026-10-19T12:00:00Z"}])
    assert snap.completions == [] and len(snap.parse_warnings) == 1


def test_valid_dates_parse_without_warnings():
    snap = _snap_with([_task(completed=True, completedAt="2026-10-19T14:00:00Z"),
                       _rec(endDate="2026-12-31")])
    assert len(snap.tasks) == 2 and snap.parse_warnings == []


def test_duplicate_task_and_completion_ids_keep_first():
    t1, t2 = _task(title="first"), _task(title="second")
    c = {"id": "c1", "taskId": "x", "completionDate": "2026-10-19",
         "completedAt": "2026-10-19T12:00:00Z"}
    snap = _snap_with([t1, t2], [c, {**c, "completionDate": "2026-10-18"}])
    assert [t.title for t in snap.tasks] == ["first"]
    assert snap.raw_tasks["x"]["title"] == "first"
    assert [x.completion_date for x in snap.completions] == ["2026-10-19"]
    assert "duplicate task id 'x'" in snap.parse_warnings
    assert "duplicate completion id 'c1'" in snap.parse_warnings


def test_shared_fixture_and_parity_fixture_parse_cleanly():
    import json
    from pathlib import Path

    from tests.conftest import fixture_app_dict
    assert Snapshot.from_app(fixture_app_dict()).parse_warnings == []
    fx = json.loads((Path(__file__).parent / "fixtures/recurrence_parity.json").read_text())
    snap = Snapshot.from_app({"tasks": fx["tasks"], "completions": fx["completions"],
                              "now": "2026-10-20T09:00:00-04:00", "timezone": fx["timezone"]})
    assert snap.parse_warnings == []
    assert len(snap.tasks) == len(fx["tasks"]) and len(snap.completions) == len(fx["completions"])
