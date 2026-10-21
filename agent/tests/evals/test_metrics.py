"""Metrics over a suite run, plus the results report and its diff."""
from boday_agent.evals.grader import Grade
from boday_agent.evals.runner import SuiteRun, TrialResult


def outcome(name, *, passed=False, damage="none", failure_type=None, accepts_asked=False):
    # accepts_asked means the case lists `asked` as an acceptable outcome, so the
    # grader would pass an asked trial. The metric reads that off grade.passed.
    if accepts_asked:
        passed = True
        failure_type = None
    return {
        "outcome": name,
        "grade": Grade(
            passed=passed,
            matched=0 if passed else None,
            damage=damage,
            failure_type=failure_type,
            details="",
        ),
    }


def pass_():
    # A passing trial that is neither a guess nor an over-ask.
    return outcome("answered", passed=True)


def fail(failure_type):
    return outcome("proposed", passed=False, failure_type=failure_type)


def suite_run(rows):
    results = []
    for case_id, label, category, trials in rows:
        for number, trial in enumerate(trials, start=1):
            results.append(
                TrialResult(
                    case_id=case_id,
                    category=category,
                    label=label,
                    split="dev",
                    trial=number,
                    outcome=trial["outcome"],
                    grade=trial["grade"],
                    tool_calls=2,
                    tool_errors=0,
                    input_tokens=10,
                    output_tokens=4,
                    cost_usd=0.01,
                    latency_ms=100.0,
                    trace_path=f"traces/{case_id}-t{number}.json",
                    answer_text="",
                )
            )
    return SuiteRun(
        stamp={
            "date": "2026-10-21",
            "model": "fake-1",
            "split": "dev",
            "prompt_version": "abc123abc123",
            "provider": {"provider": "fake", "model": "fake-1"},
            "git_commit": "abc1234",
            "git_dirty": False,
            "trials": 3,
            "case_count": len(rows),
        },
        results=results,
    )


def test_wilson_known_value():
    from boday_agent.evals.metrics import wilson

    lo, hi = wilson(8, 10)
    assert round(lo, 3) == 0.490 and round(hi, 3) == 0.943


def test_metrics_worst_of_trials_and_rates():
    from boday_agent.evals.metrics import compute_metrics

    run = suite_run(
        [
            ("a", "should_act", "happy_path", [pass_(), pass_(), fail("wrong_field")]),
            (
                "b",
                "should_ask",
                "ambiguity",
                [outcome("proposed", damage="severe"), pass_(), pass_()],
            ),
            ("c", "should_act", "injection", [pass_(), pass_(), pass_()]),
        ]
    )
    metrics = compute_metrics(run)
    assert round(metrics.success_rate, 3) == round(7 / 9, 3)
    assert metrics.pass_all == 1 / 3
    assert metrics.severe_damage_rate == 1 / 3
    assert metrics.guessing == 1 / 3
    assert metrics.injection_attack_success == 0.0


def test_allowed_ask_is_not_over_asking():
    from boday_agent.evals.metrics import compute_metrics

    allowed = suite_run(
        [("d", "should_act", "conflicts", [outcome("asked", passed=True, accepts_asked=True)] * 3)]
    )
    assert compute_metrics(allowed).over_asking == 0.0
    refused = suite_run(
        [
            (
                "e",
                "should_act",
                "conflicts",
                [outcome("asked", passed=False, failure_type="wrong_outcome")] * 3,
            )
        ]
    )
    assert compute_metrics(refused).over_asking == 1.0


def test_injection_attack_counts_severe_damage():
    from boday_agent.evals.metrics import compute_metrics

    run = suite_run(
        [
            (
                "hit",
                "should_act",
                "injection",
                [outcome("proposed", damage="severe", failure_type="extra_change")],
            ),
            ("miss", "should_act", "injection", [pass_()]),
        ]
    )
    assert compute_metrics(run).injection_attack_success == 0.5


def test_failed_limits_are_not_counted_as_wrong_outcome():
    from boday_agent.evals.metrics import compute_metrics

    def failed(case_id, error):
        return TrialResult(
            case_id=case_id,
            category="happy_path",
            label="should_act",
            split="dev",
            trial=1,
            outcome="failed",
            grade=Grade(False, None, "none", "wrong_outcome", ""),
            tool_calls=0,
            tool_errors=0,
            input_tokens=0,
            output_tokens=0,
            cost_usd=0.0,
            latency_ms=0.0,
            trace_path="",
            answer_text="",
            error=error,
        )

    run = SuiteRun(
        stamp={"date": "2026-10-21", "model": "fake-1", "split": "dev"},
        results=[failed("cap", "step limit reached"), failed("slow", "timeout")],
    )
    types = compute_metrics(run).failure_types
    assert types.get("step_cap") == 1
    assert types.get("timeout") == 1
    assert "wrong_outcome" not in types


def test_second_report_does_not_overwrite_the_first(tmp_path):
    from boday_agent.evals.metrics import compute_metrics
    from boday_agent.evals.report import write_report

    first = suite_run([("keep-me", "should_act", "happy_path", [pass_()])])
    second = suite_run([("other", "should_act", "happy_path", [pass_()])])
    path_a, _md_a = write_report(first, compute_metrics(first), tmp_path)
    path_b, _md_b = write_report(second, compute_metrics(second), tmp_path)
    assert path_a != path_b
    assert "keep-me" in path_a.read_text()
    assert "other" in path_b.read_text()


def test_compare_lists_regressions(tmp_path):
    from boday_agent.evals.metrics import compute_metrics
    from boday_agent.evals.report import compare, write_report

    before = suite_run([("x", "should_act", "happy_path", [pass_(), pass_()])])
    after = suite_run([("x", "should_act", "happy_path", [pass_(), fail("wrong_field")])])
    path_a, _md_a = write_report(before, compute_metrics(before), tmp_path / "a")
    path_b, _md_b = write_report(after, compute_metrics(after), tmp_path / "b")
    text = compare(path_a, path_b)
    regressions = text.split("## Regressions", 1)[1].split("##", 1)[0]
    assert "x" in regressions


def test_rates_with_nothing_to_measure_are_none_and_shown_as_na(tmp_path):
    from boday_agent.evals.metrics import compute_metrics
    from boday_agent.evals.report import write_report

    run = suite_run([("a", "should_act", "happy_path", [pass_()])])
    m = compute_metrics(run)
    assert m.injection_attack_success is None
    assert m.guessing is None
    assert m.tool_error_recovery is None
    assert m.over_asking == 0.0
    _json, md = write_report(run, m, tmp_path)
    text = md.read_text()
    assert "| Guessing | n/a |" in text
    assert "| Injection attack success | n/a |" in text
    assert "| Tool-error recovery | n/a |" in text
    assert "| Over-asking | 0.000 |" in text
