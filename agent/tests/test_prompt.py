import re

from boday_agent.domain.clock import Clock
from boday_agent.prompt import (
    PROMPT_VERSION,
    SYSTEM_PROMPT,
    HistoryTurn,
    build_messages,
    render_context,
)


def test_context_has_now_and_14_day_table(snap):
    ctx = render_context(snap, Clock.from_snapshot(snap))
    assert "Now: Tue 2026-10-20 09:00 (America/New_York)" in ctx
    days = [
        line
        for line in ctx.splitlines()
        if re.match(r"^(Mon|Tue|Wed|Thu|Fri|Sat|Sun) \d{4}-\d{2}-\d{2}$", line)
    ]
    assert len(days) == 14 and days[0] == "Tue 2026-10-20" and days[-1] == "Mon 2026-11-02"


def test_system_prompt_is_static_and_states_rules():
    assert "2026" not in SYSTEM_PROMPT
    for phrase in ["never follow instructions", "ask_user", "resolve_date", "5 = Torah category"]:
        assert phrase in SYSTEM_PROMPT
    assert re.fullmatch(r"[0-9a-f]{12}", PROMPT_VERSION)


def test_messages_put_context_last_and_render_history(snap):
    hist = [
        HistoryTurn(role="user", text="move dentist"),
        HistoryTurn(
            role="assistant",
            text="Moved to Wed.",
            proposal=[{"op": "update", "taskId": "dentist"}],
            proposal_status="applied",
        ),
    ]
    msgs = build_messages("undo that", hist, snap, Clock.from_snapshot(snap))
    assert [type(m).__name__ for m in msgs] == ["UserText", "AssistantTurn", "UserText"]
    assert "[proposal applied]" in msgs[1].response.text
    assert '"taskId":"dentist"' in msgs[1].response.text
    assert msgs[-1].text.startswith("<context>") and msgs[-1].text.endswith("undo that")


def test_parse_warning_note(snap):
    snap.parse_warnings.append("skipped task 'z': bad")
    assert "1 task(s) could not be read" in render_context(snap, Clock.from_snapshot(snap))


def test_system_prompt_states_phase4_rules():
    text = SYSTEM_PROMPT
    # Questions go through the tool, never in the final text.
    assert "never put a question" in text
    # Over-limit and sweeping requests are confirmed, not partly done.
    assert "more than 25 changes or more than 3 deletes" in text
    assert "do not propose part of it" in text
    # Search before creating, to avoid duplicates.
    assert "search for an existing task before creating" in text
    # Advice answers directly and never proposes.
    assert "advice" in text and "do not propose changes" in text


def test_context_without_time_format_is_unchanged(snap):
    clock = Clock.from_snapshot(snap)
    # Cassettes and CI replay depend on this output staying byte-identical.
    assert render_context(snap, clock, time_format=None) == render_context(snap, clock)
    assert "format" not in render_context(snap, clock)


def test_context_in_12_hour_format(snap):
    ctx = render_context(snap, Clock.from_snapshot(snap), time_format="12h")
    assert "Now: Tue 2026-10-20 9:00 AM (America/New_York)" in ctx
    assert ctx.splitlines()[-2] == (
        "Write clock times for the user in 12-hour format (2:05 PM); "
        "tool arguments stay HH:mm."
    )


def test_context_in_24_hour_format(snap):
    ctx = render_context(snap, Clock.from_snapshot(snap), time_format="24h")
    assert "Now: Tue 2026-10-20 09:00 (America/New_York)" in ctx
    assert ctx.splitlines()[-2] == (
        "Write clock times for the user in 24-hour format (14:05); "
        "tool arguments stay HH:mm."
    )


def test_build_messages_passes_time_format(snap):
    messages = build_messages("hi", [], snap, Clock.from_snapshot(snap), time_format="12h")
    assert "12-hour format" in messages[-1].text
