from datetime import datetime
from zoneinfo import ZoneInfo

import pytest

from boday_agent.domain.clock import Clock
from boday_agent.domain.dates import UnparseableDate, resolve

NY = ZoneInfo("America/New_York")
TUE = Clock(datetime(2026, 10, 20, 9, 0, tzinfo=NY), NY)
SAT = Clock(datetime(2026, 10, 24, 9, 0, tzinfo=NY), NY)

def one(expr, clock=TUE):
    r = resolve(expr, clock)
    assert not r.ambiguous and len(r.candidates) == 1, r
    c = r.candidates[0]
    return (c.date, c.time)

@pytest.mark.parametrize("expr,expected", [
    ("today", ("2026-10-20", None)),
    ("tomorrow", ("2026-10-21", None)),
    ("day after tomorrow", ("2026-10-22", None)),
    ("friday", ("2026-10-23", None)),
    ("next week", ("2026-10-26", None)),
    ("this weekend", ("2026-10-24", None)),
    ("end of month", ("2026-10-31", None)),
    ("in 2 days", ("2026-10-22", None)),
    ("in 3 weeks", ("2026-11-10", None)),
    ("in a month", ("2026-11-20", None)),
    ("oct 25", ("2026-10-25", None)),
    ("October 25th at 3pm", ("2026-10-25", "15:00")),
    ("10/25", ("2026-10-25", None)),
    ("2026-12-01", ("2026-12-01", None)),
    ("tomorrow at 3:30 pm", ("2026-10-21", "15:30")),
    ("friday noon", ("2026-10-23", "12:00")),
    ("tonight", ("2026-10-20", "20:00")),
    ("tomorrow morning", ("2026-10-21", "09:00")),
    ("at 17:45", ("2026-10-20", "17:45")),
    ("in 90 minutes", ("2026-10-20", "10:30")),
])
def test_unambiguous(expr, expected):
    assert one(expr) == expected

def test_same_weekday_is_ambiguous():
    r = resolve("tuesday", TUE)
    assert r.ambiguous and [c.date for c in r.candidates] == ["2026-10-20", "2026-10-27"]

def test_next_weekday_within_this_week_is_ambiguous():
    r = resolve("next friday", TUE)
    assert r.ambiguous and [c.date for c in r.candidates] == ["2026-10-23", "2026-10-30"]

def test_next_weekday_already_next_week_is_not():
    assert one("next monday", SAT) == ("2026-10-26", None)

def test_past_date_without_year_prefers_next_year():
    r = resolve("oct 1", TUE)
    assert r.ambiguous and [(c.date, c.is_past) for c in r.candidates] == [
        ("2027-10-01", False), ("2026-10-01", True)]

def test_bare_hour_is_ambiguous():
    r = resolve("friday at 9", TUE)
    assert r.ambiguous and [(c.date, c.time) for c in r.candidates] == [
        ("2026-10-23", "09:00"), ("2026-10-23", "21:00")]
    assert resolve("at 9:30", TUE).ambiguous
    assert one("at 09:30") == ("2026-10-20", "09:30")

def test_relative_hours_across_dst_end():
    late = Clock(datetime(2026, 10, 31, 23, 30, tzinfo=NY), NY)
    assert one("in 3 hours", late) == ("2026-11-01", "01:30")

@pytest.mark.parametrize("expr", ["blorp", "13pm", "the 45th"])
def test_unparseable(expr):
    with pytest.raises(UnparseableDate):
        resolve(expr, TUE)


def test_this_weekend_on_saturday_is_today():
    assert one("this weekend", SAT) == ("2026-10-24", None)


def test_combined_ambiguity_is_date_major():
    r = resolve("tuesday at 9", TUE)
    assert r.ambiguous and [(c.date, c.time) for c in r.candidates] == [
        ("2026-10-20", "09:00"), ("2026-10-20", "21:00"),
        ("2026-10-27", "09:00"), ("2026-10-27", "21:00")]


def test_month_clamps_and_next_monday_on_monday():
    jan31 = Clock(datetime(2026, 1, 31, 9, 0, tzinfo=NY), NY)
    assert one("in 1 month", jan31) == ("2026-02-28", None)
    mon = Clock(datetime(2026, 10, 19, 9, 0, tzinfo=NY), NY)
    assert one("next week", mon) == ("2026-10-26", None)


def test_unparseable_message_lists_forms():
    with pytest.raises(UnparseableDate, match="Supported forms"):
        resolve("blorp", TUE)


@pytest.mark.parametrize("expr", ["in 99999999 days", "in 99999999 weeks", "in 99999999 months",
                                  "in 99999999 hours", "in 99999999999 minutes"])
def test_huge_offsets_are_unparseable_not_crashes(expr):
    with pytest.raises(UnparseableDate):
        resolve(expr, TUE)


def test_this_weekend_on_sunday_is_today():
    sun = Clock(datetime(2026, 10, 25, 9, 0, tzinfo=NY), NY)
    assert one("this weekend", sun) == ("2026-10-25", None)


def test_relative_hours_across_spring_forward():
    # 2026-03-08 02:00 does not exist in America/New_York; clocks jump to 03:00.
    spring = Clock(datetime(2026, 3, 8, 1, 30, tzinfo=NY), NY)
    assert one("in 1 hour", spring) == ("2026-03-08", "03:30")
    assert one("in 30 minutes", spring) == ("2026-03-08", "03:00")


@pytest.mark.parametrize("expr", ["2026-02-30", "feb 30", "February 30"])
def test_february_30_is_unparseable(expr):
    with pytest.raises(UnparseableDate):
        resolve(expr, TUE)


def test_twelve_am_pm_and_bare_twelve():
    assert one("friday at 12am") == ("2026-10-23", "00:00")
    assert one("friday at 12pm") == ("2026-10-23", "12:00")
    assert one("12am") == ("2026-10-20", "00:00")
    r = resolve("at 12", TUE)
    assert r.ambiguous and [(c.date, c.time) for c in r.candidates] == [
        ("2026-10-20", "12:00"), ("2026-10-20", "00:00")]


@pytest.mark.parametrize("expr,day", [
    ("monday", "2026-10-26"),
    ("wednesday", "2026-10-21"),
    ("thursday", "2026-10-22"),
    ("saturday", "2026-10-24"),
    ("sunday", "2026-10-25"),
    ("mon", "2026-10-26"),
    ("wed", "2026-10-21"),
    ("thu", "2026-10-22"),
    ("sat", "2026-10-24"),
    ("sun", "2026-10-25"),
])
def test_weekday_names_beyond_tuesday(expr, day):
    assert one(expr) == (day, None)
