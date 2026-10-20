from boday_agent.loop import AgentRequest, run_agent
from boday_agent.providers.base import ProviderError
from boday_agent.providers.fake import FakeProvider, fake_text, fake_tools
from boday_agent.tools.context import counting_ids
from boday_agent.tools.faults import Fault, FaultPlan


def run(script, msg="move my dentist to tomorrow", **kw):
    return run_agent(
        AgentRequest(message=msg, snapshot=kw.pop("snapshot")),
        FakeProvider(script),
        id_gen=counting_ids(),
        **kw,
    )


def test_happy_path_proposes(snap):
    r = run(
        [
            fake_tools(("search_tasks", {"query": "dentist"})),
            fake_tools(("resolve_date", {"expression": "tomorrow"})),
            fake_tools(
                (
                    "propose_update_task",
                    {"task_id": "dentist", "changes": {"scheduled_date": "2026-10-21"}},
                )
            ),
            fake_text("I'll move Dentist appt to Wednesday."),
        ],
        snapshot=snap,
    )
    assert r.outcome == "proposed" and r.changes[0]["patch"] == {"scheduledDate": "2026-10-21"}
    assert r.trace.totals["model_calls"] == 4 and r.trace.totals["tool_calls"] == 3


def test_answer_only(snap):
    r = run(
        [
            fake_tools(("get_agenda", {"start_date": "2026-10-23", "end_date": "2026-10-23"})),
            fake_text("Friday you have Gym and the Café meeting."),
        ],
        msg="what's on friday?",
        snapshot=snap,
    )
    assert r.outcome == "answered" and r.changes == []


def test_ask_after_propose_discards_draft(snap):
    r = run(
        [
            fake_tools(("search_tasks", {"query": "call mom"})),
            fake_tools(
                ("propose_update_task", {"task_id": "call-mom-1", "changes": {"priority": 1}}),
                (
                    "ask_user",
                    {
                        "question": "Which call?",
                        "options": ["Call mom", "Call Mom about Thanksgiving"],
                    },
                ),
            ),
        ],
        snapshot=snap,
    )
    assert r.outcome == "asked" and r.changes == [] and r.question == "Which call?"
    assert len(r.options) == 2


def test_step_cap_fails_closed(snap):
    script = [fake_tools(("search_tasks", {"query": "x"}))] * 8
    r = run(script, snapshot=snap)
    assert r.outcome == "failed" and r.changes == [] and r.trace.error == "step limit reached"


def test_bad_json_args_become_invalid_args(snap):
    bad = fake_tools(("search_tasks", {}))
    bad.tool_calls[0].args = None
    bad.tool_calls[0].raw_args = "{query: dentist"
    r = run([bad, fake_text("Sorry.")], snapshot=snap)
    ev = [e for e in r.trace.events if e.type == "tool_call"][0]
    assert ev.ok is False and ev.error_code == "INVALID_ARGS" and r.outcome == "answered"


def test_too_many_tool_calls_in_one_step(snap):
    many = fake_tools(*[("search_tasks", {"query": f"q{i}"}) for i in range(11)])
    r = run([many, fake_text("ok")], snapshot=snap)
    evs = [e for e in r.trace.events if e.type == "tool_call"]
    assert len(evs) == 11 and evs[-1].error_code == "INVALID_ARGS" and all(e.ok for e in evs[:10])


def test_empty_response_fails(snap):
    assert run([fake_text("")], snapshot=snap).outcome == "failed"


def test_refusal_and_truncation(snap):
    refusal = fake_text("")
    refusal.stop_reason = "refusal"
    assert run([refusal], snapshot=snap).outcome == "refused"
    trunc = fake_text("partial")
    trunc.stop_reason = "max_tokens"
    assert run([trunc], snapshot=snap).outcome == "failed"


def test_provider_error_fails_and_is_redacted(snap):
    r = run([ProviderError("401 invalid key sk-ant-secret1", retryable=False)], snapshot=snap)
    assert r.outcome == "failed" and "sk-ant-secret1" not in (r.trace.error or "")


def test_timeout(snap):
    ticks = iter([0.0, 0.0, 61.0, 61.0])
    r = run(
        [fake_tools(("search_tasks", {"query": "x"})), fake_text("never")],
        snapshot=snap,
        timer=lambda: next(ticks),
    )
    assert r.outcome == "failed" and r.trace.error == "timeout"


def test_injected_fault_recorded(snap):
    r = run(
        [
            fake_tools(("search_tasks", {"query": "dentist"})),
            fake_text("Search is down, try again."),
        ],
        snapshot=snap,
        faults=FaultPlan(faults=[Fault(tool="search_tasks", call=1, kind="error")]),
    )
    ev = [e for e in r.trace.events if e.type == "tool_call"][0]
    assert ev.injected_fault == "error" and r.outcome == "answered" and r.changes == []
