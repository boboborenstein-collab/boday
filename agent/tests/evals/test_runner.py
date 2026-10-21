"""Eval runner: fresh provider and snapshot per trial, then the grader."""
import json
from pathlib import Path

from boday_agent.evals.schema import EvalCase
from boday_agent.prompt import PROMPT_VERSION
from boday_agent.providers.base import AssistantTurn, UserText
from boday_agent.providers.fake import FakeProvider, fake_text, fake_tools
from tests.evals.test_schema import CASE

DENTIST_SCRIPT = [
    fake_tools(("search_tasks", {"query": "dentist"})),
    fake_tools(("resolve_date", {"expression": "tomorrow"})),
    fake_tools(
        (
            "propose_update_task",
            {"task_id": "dentist", "changes": {"scheduled_date": "2026-10-21"}},
        )
    ),
    fake_text("I'll move the dentist appointment to Wednesday."),
]


def case(**overrides) -> EvalCase:
    return EvalCase.model_validate({**CASE, **overrides})


def _texts(provider: FakeProvider) -> str:
    chunks: list[str] = []
    for _system, messages, _tools in provider.calls:
        for message in messages:
            if isinstance(message, AssistantTurn):
                chunks.append(message.response.text)
            elif isinstance(message, UserText):
                chunks.append(message.text)
    return "\n".join(chunks)


def test_runs_trials_and_grades(tmp_path):
    from boday_agent.evals.runner import run_suite

    run = run_suite(
        [case()],
        lambda: FakeProvider(DENTIST_SCRIPT),
        trials=3,
        concurrency=2,
        traces_dir=tmp_path,
    )
    assert [item.trial for item in run.results] == [1, 2, 3]
    assert all(item.grade.passed for item in run.results)
    assert all(Path(item.trace_path).exists() for item in run.results)
    assert run.stamp["prompt_version"] == PROMPT_VERSION


def test_git_dirty_is_sampled_before_traces_exist(tmp_path, monkeypatch):
    from boday_agent.evals import runner as runner_mod
    from boday_agent.evals.runner import run_suite

    traces = tmp_path / "traces"
    original = runner_mod._git_meta

    def wrapped():
        assert not any(traces.rglob("*.json"))
        return original()

    monkeypatch.setattr(runner_mod, "_git_meta", wrapped)
    run_suite(
        [case()],
        lambda: FakeProvider(list(DENTIST_SCRIPT)),
        trials=1,
        concurrency=1,
        traces_dir=traces,
    )


def test_one_trial_crash_does_not_stop_run(tmp_path):
    from boday_agent.evals.runner import run_suite

    scripts = iter([DENTIST_SCRIPT, [RuntimeError("boom")], DENTIST_SCRIPT])
    run = run_suite(
        [case()],
        lambda: FakeProvider(next(scripts)),
        trials=3,
        concurrency=1,
        traces_dir=tmp_path,
    )
    assert [item.outcome for item in run.results] == ["proposed", "failed", "proposed"]
    assert run.results[1].error
    assert not run.results[1].grade.passed


def test_history_and_faults_are_applied(tmp_path):
    from boday_agent.evals.runner import run_suite

    providers: list[FakeProvider] = []

    def factory() -> FakeProvider:
        provider = FakeProvider(list(DENTIST_SCRIPT))
        providers.append(provider)
        return provider

    history = case(
        id="history-dentist",
        category="multi_turn",
        turns=[
            {
                "assistant": "Moved dentist.",
                "proposal": [{"op": "update", "taskId": "dentist"}],
                "status": "applied",
            },
            {"user": "move my dentist to tomorrow"},
        ],
    )
    faulted = case(
        id="fault-dentist",
        category="tool_failures",
        faults=[{"tool": "search_tasks", "call": 1, "kind": "error"}],
    )
    run = run_suite([history, faulted], factory, trials=1, concurrency=1, traces_dir=tmp_path)
    assert "[proposal applied]" in _texts(providers[0])
    fault = next(item for item in run.results if item.case_id == "fault-dentist")
    trace = json.loads(Path(fault.trace_path).read_text())
    tool_calls = [event for event in trace["events"] if event["type"] == "tool_call"]
    assert tool_calls[0]["injected_fault"] == "error"


def test_run_subcommand_filters_cases_without_calling_provider(tmp_path, monkeypatch):
    from boday_agent.evals.cli import main
    from boday_agent.evals.runner import SuiteRun

    seen: dict = {}

    def fake_run(cases, factory, **kwargs):
        seen["ids"] = [item.id for item in cases]
        seen["trials"] = kwargs["trials"]
        assert callable(factory)
        return SuiteRun(
            stamp={
                "date": "2026-10-21",
                "model": "claude-haiku-5-5",
                "split": "dev",
                "prompt_version": "abc",
                "provider": {},
                "git_commit": "abc123",
                "git_dirty": False,
                "trials": kwargs["trials"],
                "case_count": len(cases),
            },
            results=[],
        )

    def boom(*_args, **_kwargs):
        raise AssertionError("provider constructed")

    monkeypatch.setattr("boday_agent.evals.cli.run_suite", fake_run)
    monkeypatch.setattr("boday_agent.evals.cli.make_provider", boom)
    code = main(
        [
            "run",
            "--provider",
            "anthropic",
            "--model",
            "claude-haiku-5-5",
            "--trials",
            "1",
            "--split",
            "dev",
            "--case",
            "move-dentist-tomorrow",
            "--out",
            str(tmp_path),
        ]
    )
    assert code == 0
    assert seen["ids"] == ["move-dentist-tomorrow"]
    assert seen["trials"] == 1
    assert list(tmp_path.glob("*.json"))


def _auto_run(tmp_path, monkeypatch, chosen):
    from boday_agent.evals.cli import main
    from boday_agent.evals.runner import SuiteRun

    made: list[tuple[str, str | None]] = []
    seen: dict = {}

    def fake_make(args):
        made.append((args.provider, args.model))
        if args.provider == "auto":
            return chosen, "auto: picked once"
        return FakeProvider([], name=chosen.name, model=chosen.model), "explicit"

    def fake_run(cases, factory, **kwargs):
        seen["providers"] = [factory().name for _ in range(3)]
        seen["reason"] = kwargs["selection_reason"]
        return SuiteRun(stamp={"date": "2026-10-21", "model": "m", "split": "dev"}, results=[])

    monkeypatch.setattr("boday_agent.evals.cli.make_provider", fake_make)
    monkeypatch.setattr("boday_agent.evals.cli.run_suite", fake_run)
    code = main(
        [
            "run", "--provider", "auto", "--base-url", "http://localhost:11434/v1",
            "--model", "local-30b", "--case", "move-dentist-tomorrow", "--trials", "3",
            "--out", str(tmp_path),
        ]
    )
    assert code == 0
    return made, seen


def test_auto_provider_is_chosen_once_per_run_local(tmp_path, monkeypatch):
    local = FakeProvider([], name="openai_compat", model="local-30b", is_local=True)
    made, seen = _auto_run(tmp_path, monkeypatch, local)
    assert made == [("auto", "local-30b")] + [("openai", "local-30b")] * 3
    assert seen["providers"] == ["openai_compat"] * 3
    assert seen["reason"] == "auto: picked once"


def test_auto_provider_is_chosen_once_per_run_fallback(tmp_path, monkeypatch):
    fallback = FakeProvider([], name="anthropic", model="claude-haiku-5-5")
    made, seen = _auto_run(tmp_path, monkeypatch, fallback)
    assert made == [("auto", "local-30b")] + [("anthropic", "claude-haiku-5-5")] * 3
    assert seen["reason"] == "auto: picked once"


def test_stamp_records_the_selection_reason(tmp_path):
    from boday_agent.evals.runner import run_suite

    run = run_suite(
        [case()],
        lambda: FakeProvider(list(DENTIST_SCRIPT)),
        trials=1,
        concurrency=1,
        traces_dir=tmp_path,
        selection_reason="auto: local reachable",
    )
    assert run.stamp["selection_reason"] == "auto: local reachable"


def _git(root, *args):
    import subprocess

    subprocess.run(["git", *args], cwd=root, check=True, capture_output=True)


def test_git_dirty_ignores_untracked_files(tmp_path, monkeypatch):
    from boday_agent.evals import runner as runner_mod

    _git(tmp_path, "init", "-q")
    (tmp_path / "tracked.txt").write_text("a\n")
    _git(tmp_path, "add", "tracked.txt")
    _git(tmp_path, "-c", "user.name=t", "-c", "user.email=t@t", "commit", "-qm", "init")
    monkeypatch.setattr(runner_mod, "_REPO_ROOT", tmp_path)
    (tmp_path / "untracked-results.json").write_text("{}")
    assert runner_mod._git_meta()[1] is False
    (tmp_path / "tracked.txt").write_text("b\n")
    assert runner_mod._git_meta()[1] is True


def test_eval_traces_are_gitignored():
    import subprocess

    from boday_agent.evals.runner import _REPO_ROOT

    probe = "agent/evals/results/traces/2026-10-21/trace.json"
    result = subprocess.run(["git", "check-ignore", "-q", probe], cwd=_REPO_ROOT, check=False)
    assert result.returncode == 0


def test_split_defaults_to_dev_so_holdout_is_not_spent(tmp_path, monkeypatch):
    from boday_agent.evals.cli import main
    from boday_agent.evals.runner import SuiteRun

    seen: dict = {}

    def fake_run(cases, factory, **kwargs):
        seen["splits"] = {item.split for item in cases}
        return SuiteRun(stamp={"date": "2026-10-21", "model": "m", "split": "dev"}, results=[])

    monkeypatch.setattr("boday_agent.evals.cli.run_suite", fake_run)
    code = main(
        ["run", "--provider", "anthropic", "--category", "happy_path", "--out", str(tmp_path)]
    )
    assert code == 0
    assert seen["splits"] == {"dev"}
