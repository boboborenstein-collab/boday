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
    # One response more than the cap, so an off-by-one in either direction shows up.
    provider = FakeProvider([fake_tools(("search_tasks", {"query": "x"}))] * 9)
    r = run_agent(AgentRequest(message="x", snapshot=snap), provider, id_gen=counting_ids())
    assert r.outcome == "failed" and r.changes == [] and r.trace.error == "step limit reached"
    assert r.trace.totals["model_calls"] == 8 and len(provider.calls) == 8


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


class SlowProvider(FakeProvider):
    """Each model call advances a shared clock, independent of how often the loop reads it."""

    def __init__(self, script, clock, seconds_per_call, **kw):
        super().__init__(script, **kw)
        self.clock = clock
        self.seconds_per_call = seconds_per_call

    def complete(self, system, messages, tools, timeout_s):
        self.clock["t"] += self.seconds_per_call
        return super().complete(system, messages, tools, timeout_s)


def run_slow(snap, script, seconds_per_call, **kw):
    clock = {"t": 0.0}
    provider = SlowProvider(script, clock, seconds_per_call, **kw)
    r = run_agent(
        AgentRequest(message="x", snapshot=snap),
        provider,
        id_gen=counting_ids(),
        timer=lambda: clock["t"],
    )
    return r, provider


def test_timeout_is_checked_before_each_model_call(snap):
    r, provider = run_slow(
        snap, [fake_tools(("search_tasks", {"query": "x"})), fake_text("never")], 61.0
    )
    assert r.outcome == "failed" and r.trace.error == "timeout" and r.changes == []
    assert len(provider.calls) == 1


def test_provider_gets_the_remaining_budget(snap):
    script = [fake_tools(("search_tasks", {"query": "x"})), fake_text("ok")]
    r, provider = run_slow(snap, script, 45.0)
    assert r.outcome == "answered" and provider.timeouts == [60.0, 15.0]
    _, local = run_slow(snap, [fake_text("ok")], 1.0, is_local=True)
    assert local.timeouts == [90.0]


def test_unseen_id_is_rejected_without_a_read(snap):
    r = run(
        [
            fake_tools(("propose_delete_task", {"task_id": "dentist", "reason": "x"})),
            fake_text("I need to look that up first."),
        ],
        snapshot=snap,
    )
    ev = [e for e in r.trace.events if e.type == "tool_call"][0]
    assert ev.ok is False and ev.error_code == "UNSEEN_ID"
    assert r.outcome == "answered" and r.changes == []


def test_refusal_after_a_draft_returns_no_changes(snap):
    refusal = fake_text("I won't do that.")
    refusal.stop_reason = "refusal"
    r = run(
        [
            fake_tools(("search_tasks", {"query": "dentist"})),
            fake_tools(("propose_update_task", {"task_id": "dentist", "changes": {"priority": 1}})),
            refusal,
        ],
        snapshot=snap,
    )
    assert r.outcome == "refused" and r.changes == []


def test_delete_limit_holds_through_the_loop(snap):
    ids = ["dentist", "call-mom-1", "call-mom-2", "taxes"]
    deletes = [("propose_delete_task", {"task_id": i, "reason": "cleanup"}) for i in ids]
    r = run(
        [fake_tools(("search_tasks", {})), fake_tools(*deletes), fake_text("Deleting three.")],
        snapshot=snap,
    )
    evs = [e for e in r.trace.events if e.type == "tool_call"][1:]
    assert [e.ok for e in evs] == [True, True, True, False]
    assert evs[-1].error_code == "LIMIT_EXCEEDED"
    assert r.outcome == "proposed" and len(r.changes) == 3


def test_change_limit_holds_through_the_loop(snap):
    creates = [
        ("propose_create_task",
         {"title": f"Errand {i}", "type": "one_time", "scheduled_date": "2026-10-28"})
        for i in range(26)
    ]
    r = run(
        [
            fake_tools(*creates[:10]),
            fake_tools(*creates[10:20]),
            fake_tools(*creates[20:]),
            fake_text("Added them."),
        ],
        snapshot=snap,
    )
    evs = [e for e in r.trace.events if e.type == "tool_call"]
    assert all(e.ok for e in evs[:25]) and evs[25].error_code == "LIMIT_EXCEEDED"
    assert r.outcome == "proposed" and len(r.changes) == 25


def test_run_ids_do_not_share_the_counting_generator(snap):
    first = run([fake_text("ok")], snapshot=snap)
    second = run([fake_text("ok again")], snapshot=snap)
    assert first.trace.run_id != second.trace.run_id
    assert first.trace.run_id != "new-1"


def test_unexpected_exception_fails_closed(snap):
    r = run([RuntimeError("boom sk-ant-secret1")], snapshot=snap)
    assert r.outcome == "failed" and r.changes == []
    assert "sk-ant-secret1" not in (r.trace.error or "")
    assert r.trace.outcome == "failed"


def test_bad_json_is_shown_back_to_the_model(snap):
    bad = fake_tools(("search_tasks", {}))
    bad.tool_calls[0].args = None
    bad.tool_calls[0].raw_args = "{query: dentist"
    provider = FakeProvider([bad, fake_text("Sorry.")])
    run_agent(
        AgentRequest(message="move dentist", snapshot=snap),
        provider,
        id_gen=counting_ids(),
    )
    tool_turn = next(m for m in provider.calls[-1][1] if type(m).__name__ == "ToolResults")
    assert "{query: dentist" in tool_turn.results[0].content


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
