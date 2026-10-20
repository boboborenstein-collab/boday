"""Deterministic natural-language date/time resolver (no LLM calendar math)."""

from __future__ import annotations

import calendar
import re
from datetime import UTC, date, timedelta

from dateutil.relativedelta import relativedelta
from pydantic import BaseModel

from .clock import Clock

SUPPORTED_FORMS = (
    "Supported forms: today, tonight, tomorrow, day after tomorrow; "
    "<weekday>, this <weekday>, next <weekday>; next week; this weekend; "
    "end of (the) month; in N days/weeks/months (N = digits, one-twelve, or 'a'); "
    "YYYY-MM-DD, M/D, '<month> <day>', '<day> <month>'; "
    "times like '3pm', '3:30 pm', '17:45', 'at 9' (ambiguous), noon, morning, "
    "afternoon, evening; 'in N hours/minutes'. Dates and times can be combined, "
    "e.g. 'tomorrow at 3:30 pm'."
)

_WD = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]
_WEEKDAYS = {
    "monday": 0, "mon": 0, "tuesday": 1, "tue": 1, "tues": 1,
    "wednesday": 2, "wed": 2, "thursday": 3, "thu": 3, "thur": 3, "thurs": 3,
    "friday": 4, "fri": 4, "saturday": 5, "sat": 5, "sunday": 6, "sun": 6,
}
_MONTHS = {
    "january": 1, "jan": 1, "february": 2, "feb": 2, "march": 3, "mar": 3,
    "april": 4, "apr": 4, "may": 5, "june": 6, "jun": 6, "july": 7, "jul": 7,
    "august": 8, "aug": 8, "september": 9, "sep": 9, "sept": 9,
    "october": 10, "oct": 10, "november": 11, "nov": 11, "december": 12, "dec": 12,
}
_NUMS = {
    "a": 1, "an": 1, "one": 1, "two": 2, "three": 3, "four": 4, "five": 5,
    "six": 6, "seven": 7, "eight": 8, "nine": 9, "ten": 10, "eleven": 11, "twelve": 12,
}
_TIME_WORDS = {
    "noon": "12:00", "morning": "09:00", "afternoon": "14:00",
    "evening": "18:00", "tonight": "20:00",
}

_N = r"(\d+|a|an|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)"
_WD_RE = "(" + "|".join(sorted(_WEEKDAYS, key=len, reverse=True)) + ")"
_MO_RE = "(" + "|".join(sorted(_MONTHS, key=len, reverse=True)) + ")"
_ORD = r"(?:st|nd|rd|th)?"


class DateCandidate(BaseModel):
    date: str
    time: str | None
    weekday: str
    is_past: bool


class DateResolution(BaseModel):
    expression: str
    candidates: list[DateCandidate]
    ambiguous: bool


class UnparseableDate(ValueError):
    pass


def _num(s: str) -> int:
    return int(s) if s.isdigit() else _NUMS[s]


def _bad(expression: str) -> UnparseableDate:
    return UnparseableDate(f"Could not parse {expression!r}. {SUPPORTED_FORMS}")


def _hhmm(h: int, m: int) -> str:
    return f"{h:02d}:{m:02d}"


# ---------------------------------------------------------------- time part

_AT = r"(?:\bat\s+)?"
_TIME_RES = [
    ("ampm", re.compile(_AT + r"\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b")),
    ("colon", re.compile(_AT + r"\b(\d{1,2}):(\d{2})\b")),
    ("bare", re.compile(r"\bat\s+(\d{1,2})\b")),
    ("word", re.compile(_AT + r"\b(noon|morning|afternoon|evening|tonight)\b")),
]


def _extract_time(text: str, expression: str) -> tuple[str, list[str] | None]:
    """Remove a time part from text; return (remaining, time candidates)."""
    for kind, rx in _TIME_RES:
        m = rx.search(text)
        if not m:
            continue
        rest = (text[: m.start()] + " " + text[m.end():]).strip()
        if kind == "word":
            return rest, [_TIME_WORDS[m.group(1)]]
        h_raw = m.group(1)
        h = int(h_raw)
        if kind == "ampm":
            minute = int(m.group(2) or 0)
            if not 1 <= h <= 12 or minute > 59:
                raise _bad(expression)
            h24 = h % 12 + (12 if m.group(3) == "pm" else 0)
            return rest, [_hhmm(h24, minute)]
        minute = int(m.group(2)) if kind == "colon" else 0
        if h > 23 or minute > 59:
            raise _bad(expression)
        if h >= 13 or h_raw.startswith("0") and len(h_raw) > 1 or h == 0:
            return rest, [_hhmm(h, minute)]
        return rest, [_hhmm(h, minute), _hhmm((h + 12) % 24, minute)]
    return text, None


# ---------------------------------------------------------------- date part


def _coming(today: date, wd: int) -> date:
    """Next occurrence of weekday strictly after today."""
    return today + timedelta(days=(wd - today.weekday() - 1) % 7 + 1)


def _yearless(today: date, month: int, day: int, expression: str) -> list[date]:
    try:
        this_year = date(today.year, month, day)
    except ValueError:
        raise _bad(expression) from None
    if this_year >= today:
        return [this_year]
    try:
        return [date(today.year + 1, month, day), this_year]
    except ValueError:
        return [this_year]


def _resolve_date(text: str, today: date, expression: str) -> list[date]:
    t = text.strip()
    if t in ("today", "tonight"):
        return [today]
    if t == "tomorrow":
        return [today + timedelta(days=1)]
    if t == "day after tomorrow":
        return [today + timedelta(days=2)]
    if t == "next week":
        return [_coming(today, 0)]
    if t == "this weekend":
        return [today] if today.weekday() >= 5 else [_coming(today, 5)]
    if re.fullmatch(r"end of (?:the )?month", t):
        return [today.replace(day=calendar.monthrange(today.year, today.month)[1])]

    m = re.fullmatch(r"(?:(this|next)\s+)?" + _WD_RE, t)
    if m:
        wd = _WEEKDAYS[m.group(2)]
        coming = _coming(today, wd)
        if m.group(1) == "next":
            if coming < _coming(today, 0):
                return [coming, coming + timedelta(days=7)]
            return [coming]
        if wd == today.weekday():
            return [today, today + timedelta(days=7)]
        return [coming]

    m = re.fullmatch(r"in\s+" + _N + r"\s+(day|week|month)s?", t)
    if m:
        n = _num(m.group(1))
        unit = m.group(2)
        delta = {"day": relativedelta(days=n), "week": relativedelta(weeks=n),
                 "month": relativedelta(months=n)}[unit]
        return [today + delta]

    m = re.fullmatch(r"(\d{4})-(\d{2})-(\d{2})", t)
    if m:
        try:
            return [date(int(m.group(1)), int(m.group(2)), int(m.group(3)))]
        except ValueError:
            raise _bad(expression) from None

    m = re.fullmatch(r"(\d{1,2})/(\d{1,2})", t)
    if m:
        return _yearless(today, int(m.group(1)), int(m.group(2)), expression)

    m = re.fullmatch(_MO_RE + r"\.?\s+(\d{1,2})" + _ORD, t)
    if m:
        return _yearless(today, _MONTHS[m.group(1)], int(m.group(2)), expression)

    m = re.fullmatch(r"(\d{1,2})" + _ORD + r"\s+(?:of\s+)?" + _MO_RE + r"\.?", t)
    if m:
        return _yearless(today, _MONTHS[m.group(2)], int(m.group(1)), expression)

    raise _bad(expression)


def _candidate(d: date, time: str | None, today: date) -> DateCandidate:
    return DateCandidate(
        date=d.isoformat(), time=time, weekday=_WD[d.weekday()], is_past=d < today
    )


def resolve(expression: str, clock: Clock) -> DateResolution:
    try:
        return _resolve(expression, clock)
    except UnparseableDate:
        raise
    except (OverflowError, ValueError):  # date arithmetic out of range, e.g. "in 99999999 days"
        raise _bad(expression) from None


def _resolve(expression: str, clock: Clock) -> DateResolution:
    text = re.sub(r"[,]", " ", expression.lower())
    text = re.sub(r"\s+", " ", text).strip()
    today = clock.today
    if not text:
        raise _bad(expression)

    m = re.fullmatch(r"in\s+" + _N + r"\s+(hour|minute)s?", text)
    if m:
        n = _num(m.group(1))
        delta = timedelta(hours=n) if m.group(2) == "hour" else timedelta(minutes=n)
        target = (clock.now.astimezone(UTC) + delta).astimezone(clock.tz)
        cand = _candidate(target.date(), _hhmm(target.hour, target.minute), today)
        return DateResolution(expression=expression, candidates=[cand], ambiguous=False)

    rest, times = _extract_time(text, expression)
    rest = re.sub(r"^(?:on|at)\s+", "", rest).strip()
    if rest:
        dates = _resolve_date(rest, today, expression)
    elif times is not None:
        dates = [today]
    else:
        raise _bad(expression)

    cands = [_candidate(d, t, today) for d in dates for t in (times or [None])]
    return DateResolution(
        expression=expression, candidates=cands, ambiguous=len(cands) > 1
    )
