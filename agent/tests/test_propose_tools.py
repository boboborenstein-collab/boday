# ruff: noqa: E501
from boday_agent.tools.context import RunContext, counting_ids
from boday_agent.tools.registry import execute, tool_schemas


def run(ctx, name, **args):
    return execute(ctx, name, args).result


def test_unseen_and_missing(ctx):
    assert run(ctx, "propose_update_task", task_id="dentist", changes={"priority": 1}).error.code == "UNSEEN_ID"
    assert run(ctx, "propose_update_task", task_id="zzz", changes={"priority": 1}).error.code == "NOT_FOUND"


def test_reschedule_dentist_with_clash_warning(seen_ctx):
    r = run(seen_ctx, "propose_update_task", task_id="dentist", changes={"scheduled_date": "2026-10-21"})
    assert r.ok and r.data["draft_size"] == 1
    ch = seen_ctx.draft_payload()[0]
    assert ch["op"] == "update" and ch["patch"] == {"scheduledDate": "2026-10-21"}
    assert ch["beforeFields"] == {"scheduledDate": "2026-10-22"}
    assert [w["code"] for w in ch["warnings"]] == ["TIME_CLASH"]  # standup 09:00 daily


def test_natural_language_date_rejected_with_hint(seen_ctx):
    r = run(seen_ctx, "propose_update_task", task_id="dentist", changes={"scheduled_date": "Oct 21"})
    assert r.error.code == "INVALID_ARGS" and "resolve_date" in r.error.message


def test_wrong_type_and_past_date(seen_ctx):
    assert run(seen_ctx, "propose_update_task", task_id="gym", changes={"scheduled_date": "2026-10-21"}).error.code == "WRONG_TASK_TYPE"
    assert run(seen_ctx, "propose_create_task", title="X", type="one_time", scheduled_date="2026-10-19").error.code == "INVALID_DATE"
    assert run(seen_ctx, "propose_create_task", title="X", type="one_time", scheduled_date="2027-10-21").error.code == "INVALID_DATE"


def test_reminder_null_clears_omitted_keeps(seen_ctx):
    run(seen_ctx, "propose_update_task", task_id="dentist", changes={"reminder_time": None})
    assert seen_ctx.draft_payload()[0]["patch"] == {"reminderTime": None}
    assert seen_ctx.draft_payload()[0]["beforeFields"] == {"reminderTime": "09:00"}
    run(seen_ctx, "propose_update_task", task_id="cafe", changes={"priority": 1})
    assert seen_ctx.draft_payload()[1]["patch"] == {"priority": 1}


def test_noop_update_rejected(seen_ctx):
    assert run(seen_ctx, "propose_update_task", task_id="dentist", changes={}).error.code == "INVALID_ARGS"
    assert run(seen_ctx, "propose_update_task", task_id="dentist", changes={"priority": 2}).error.code == "INVALID_ARGS"


def test_create_duplicate_and_quiet_window_warnings(seen_ctx):
    r = run(seen_ctx, "propose_create_task", title="call MOM", type="one_time", scheduled_date="2026-10-20")
    assert [w["code"] for w in r.data["warnings"]] == ["POSSIBLE_DUPLICATE"]
    r = run(seen_ctx, "propose_create_task", title="Dinner", type="one_time",
            scheduled_date="2026-10-23", reminder_time="19:00")
    assert [w["code"] for w in r.data["warnings"]] == ["QUIET_WINDOW"]


def test_recurring_status_rules(seen_ctx):
    assert run(seen_ctx, "propose_set_status", task_id="gym", status="skipped", date="2026-10-23").ok  # future skip ok
    assert run(seen_ctx, "propose_set_status", task_id="standup", status="done", date="2026-10-23").error.code == "INVALID_DATE"  # future done
    assert run(seen_ctx, "propose_set_status", task_id="gym", status="done", date="2026-10-22").error.code == "INVALID_DATE"  # Thu not an occurrence
    ch = seen_ctx.draft_payload()[0]
    assert ch["date"] == "2026-10-23" and ch["before"]["status"] == "open" and ch["after"]["status"] == "skipped"


def test_one_time_status_rules(seen_ctx):
    assert run(seen_ctx, "propose_set_status", task_id="dentist", status="skipped").error.code == "WRONG_TASK_TYPE"
    execute(seen_ctx, "get_task", {"task_id": "report"})
    assert run(seen_ctx, "propose_set_status", task_id="report", status="done").error.code == "INVALID_ARGS"


def test_delete_carries_completions_and_external_warning(seen_ctx):
    r = run(seen_ctx, "propose_delete_task", task_id="shared", reason="user asked")
    assert [w["code"] for w in r.data["warnings"]] == ["EXTERNAL_TASK"]
    run(seen_ctx, "propose_delete_task", task_id="gym", reason="user asked")
    d = seen_ctx.draft_payload()[1]
    assert d["beforeRaw"] == seen_ctx.snapshot.raw_tasks["gym"]
    assert [c["id"] for c in d["beforeCompletionsRaw"]] == ["c-gym-1019"]


def test_unknown_app_fields_survive_in_payload(snap_with_future_field):
    ctx = RunContext.create(snap_with_future_field, id_gen=counting_ids())
    execute(ctx, "get_task", {"task_id": "future"})
    run(ctx, "propose_update_task", task_id="future", changes={"priority": 1})
    assert "someFutureField" not in ctx.draft_payload()[0]["patch"]
    ctx2 = RunContext.create(snap_with_future_field, id_gen=counting_ids())
    execute(ctx2, "get_task", {"task_id": "future"})
    run(ctx2, "propose_delete_task", task_id="future", reason="x")
    assert ctx2.draft_payload()[0]["beforeRaw"]["someFutureField"] == {"x": 1}


def test_create_recurring_every_other_tuesday(seen_ctx):
    r = run(seen_ctx, "propose_create_task", title="Team sync", type="recurring",
            recurrence={"kind": "everyNDays", "n": 14}, start_date="2026-10-27")
    after = seen_ctx.draft_payload()[0]["after"]
    assert r.ok and after["recurrence"] == {"kind": "everyNDays", "n": 14}
    assert after["startDate"] == "2026-10-27" and after["id"] == "new-1"
    assert "tags" not in after and "excludeFromStats" not in after


def test_create_recurring_defaults_and_shape_errors(seen_ctx):
    run(seen_ctx, "propose_create_task", title="Read", type="recurring", recurrence={"kind": "daily"})
    assert seen_ctx.draft_payload()[0]["after"]["startDate"] == "2026-10-20"
    assert run(seen_ctx, "propose_create_task", title="X", type="recurring", recurrence={"kind": "daily"},
               scheduled_date="2026-10-21").error.code == "INVALID_ARGS"
    assert run(seen_ctx, "propose_create_task", title="X", type="one_time", scheduled_date="2026-10-21",
               recurrence={"kind": "daily"}).error.code == "INVALID_ARGS"


def test_update_recurrence_and_end_date(seen_ctx):
    run(seen_ctx, "propose_update_task", task_id="gym",
        changes={"recurrence": {"kind": "weekly", "days_of_week": [2, 4]}})
    ch = seen_ctx.draft_payload()[0]
    assert ch["patch"] == {"recurrence": {"kind": "weekly", "daysOfWeek": [2, 4]}}
    assert ch["beforeFields"] == {"recurrence": {"kind": "weekly", "daysOfWeek": [1, 3, 5]}}
    run(seen_ctx, "propose_update_task", task_id="standup", changes={"end_date": "2026-12-31"})
    assert seen_ctx.draft_payload()[1]["beforeFields"] == {"endDate": None}
    assert run(seen_ctx, "propose_update_task", task_id="dentist",
               changes={"end_date": "2026-12-31"}).error.code == "WRONG_TASK_TYPE"
    assert run(seen_ctx, "propose_update_task", task_id="cafe",
               changes={"scheduled_date": "2026-10-01"}).error.code == "INVALID_DATE"


def test_undone_on_recurring(seen_ctx):
    assert run(seen_ctx, "propose_set_status", task_id="gym", status="undone", date="2026-10-19").ok
    ch = seen_ctx.draft_payload()[0]
    assert (ch["before"]["status"], ch["after"]["status"]) == ("done", "open")


def test_update_warnings_on_reminder_change(seen_ctx):
    r = run(seen_ctx, "propose_update_task", task_id="cafe", changes={"reminder_time": "09:00"})
    assert [w["code"] for w in r.data["warnings"]] == ["TIME_CLASH"]   # standup 09:00 on Fri 10-23
    r = run(seen_ctx, "propose_update_task", task_id="shared", changes={"priority": 1})
    assert [w["code"] for w in r.data["warnings"]] == ["EXTERNAL_TASK"]


def test_priority_description_explains_torah():
    s = {t["name"]: t for t in tool_schemas()}["propose_create_task"]
    assert "5 = Torah category, not a lower priority" in s["input_schema"]["properties"]["priority"]["description"]


def test_delete_limit(seen_ctx):
    for tid in ["shared", "gym", "cafe"]:
        assert run(seen_ctx, "propose_delete_task", task_id=tid, reason="x").ok
    assert run(seen_ctx, "propose_delete_task", task_id="taxes", reason="x").error.code == "LIMIT_EXCEEDED"


def test_change_limit(seen_ctx):
    for i in range(25):
        assert run(seen_ctx, "propose_create_task", title=f"T{i}", type="one_time", scheduled_date="2026-11-01").ok
    assert run(seen_ctx, "propose_create_task", title="T26", type="one_time", scheduled_date="2026-11-01").error.code == "LIMIT_EXCEEDED"


def test_conflicting_change(seen_ctx):
    run(seen_ctx, "propose_update_task", task_id="cafe", changes={"priority": 1})
    assert run(seen_ctx, "propose_delete_task", task_id="cafe", reason="x").error.code == "CONFLICTING_CHANGE"


def test_ask_user(ctx):
    assert run(ctx, "ask_user", question="Which call?", options=["Call mom", "Call Mom about Thanksgiving"]).ok
    assert ctx.question.question == "Which call?"


def codes(r):
    return [w["code"] for w in r.data["warnings"]]


def test_recurring_quiet_window_warnings(seen_ctx):
    r = run(seen_ctx, "propose_create_task", title="Fri thing", type="recurring",
            recurrence={"kind": "weekly", "days_of_week": [5]}, reminder_time="19:00")
    assert codes(r) == ["QUIET_WINDOW"]
    assert "QUIET_WINDOW" in codes(run(seen_ctx, "propose_update_task", task_id="gym", changes={"reminder_time": "19:00"}))


def test_gym_early_reminder_no_quiet(seen_ctx):
    r = run(seen_ctx, "propose_update_task", task_id="gym", changes={"reminder_time": "06:00"})
    assert r.ok and "QUIET_WINDOW" not in codes(r)


def test_skip_beyond_horizon_rejected(seen_ctx):
    assert run(seen_ctx, "propose_set_status", task_id="standup", status="skipped", date="2027-10-21").error.code == "INVALID_DATE"


def test_created_at_is_utc_millis_z(seen_ctx):
    run(seen_ctx, "propose_create_task", title="X", type="one_time", scheduled_date="2026-10-21")
    assert seen_ctx.draft_payload()[0]["after"]["createdAt"] == "2026-10-20T13:00:00.000Z"


def test_conflicting_change_hint_is_actionable(seen_ctx):
    run(seen_ctx, "propose_update_task", task_id="cafe", changes={"priority": 1})
    err = run(seen_ctx, "propose_delete_task", task_id="cafe", reason="x").error
    assert err.hint == (
        "This task already has a change in this proposal and cannot be changed again in the "
        "same proposal. Propose what you can and tell the user what's left."
    )
