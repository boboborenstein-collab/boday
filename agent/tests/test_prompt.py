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
