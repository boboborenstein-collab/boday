"""Run eval cases through the agent loop and grade each trial."""
from __future__ import annotations

import subprocess
import threading
from collections.abc import Callable
from concurrent.futures import ThreadPoolExecutor
from dataclasses import asdict, dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import boday_agent.tools  # noqa: F401  (registers tools for the loop)
from boday_agent.evals.cassettes import (
    CASSETTES_DIR,
    CassetteMismatch,
    RecordingProvider,
    ReplayProvider,
    cassette_path,
)
from boday_agent.evals.grader import Grade, RunOutcome, grade
from boday_agent.evals.loader import build_snapshot, load_fixture
from boday_agent.evals.schema import AssistantTurnSpec, EvalCase, UserTurn
from boday_agent.loop import AgentRequest, run_agent
from boday_agent.prompt import PROMPT_VERSION, HistoryTurn
from boday_agent.tools.context import counting_ids
from boday_agent.tools.faults import FaultPlan
from boday_agent.tracing import FileSink

_REPO_ROOT = Path(__file__).resolve().parents[3]


@dataclass
class TrialResult:
    case_id: str
    category: str
    label: str
    split: str
    trial: int
    outcome: str
    grade: Grade
    tool_calls: int
    tool_errors: int
    input_tokens: int
    output_tokens: int
    cost_usd: float
    latency_ms: float
    trace_path: str
    answer_text: str
    error: str | None = None
    judge_score: int | None = None
    judge_error: str | None = None


@dataclass
class SuiteRun:
    stamp: dict
    results: list[TrialResult]


def suite_payload(run: SuiteRun) -> dict:
    return {"stamp": run.stamp, "results": [asdict(item) for item in run.results]}


def run_suite(
    cases: list[EvalCase],
    provider_factory: Callable[[], Any],
    *,
    traces_dir: Path,
    trials: int = 3,
    concurrency: int = 4,
    selection_reason: str = "explicit",
    cassette_dir: Path | None = None,
    cassette_mode: str = "live",
) -> SuiteRun:
    """One fresh provider and snapshot per (case, trial). Results sorted by case, trial."""
    if cassette_mode not in {"live", "record", "replay"}:
        raise ValueError(f"unknown cassette mode {cassette_mode!r}")
    directory = cassette_dir or CASSETTES_DIR
    commit, dirty = _git_meta()
    jobs = [(case, trial) for case in cases for trial in range(1, trials + 1)]
    describes: dict[tuple[str, int], tuple[dict, str]] = {}
    lock = threading.Lock()
    sink = FileSink(traces_dir)

    def one(case: EvalCase, trial: int) -> TrialResult:
        provider = None
        try:
            provider = _open_provider(provider_factory, cassette_mode, directory, case, trial)
            described = provider.describe()
            model = str(getattr(provider, "model", "") or described.get("model", ""))
            with lock:
                describes[(case.id, trial)] = (described, model)
            snapshot = build_snapshot(case, load_fixture(case.fixture))
            result = run_agent(
                AgentRequest(
                    message=_message(case),
                    history=_history(case),
                    snapshot=snapshot,
                ),
                provider,
                faults=FaultPlan(faults=list(case.faults)),
                id_gen=counting_ids(),
                selection_reason=selection_reason,
                now_iso=case.now.isoformat(),
            )
            path = sink.write(result.trace)
            totals = result.trace.totals
            return _from_result(case, trial, result, str(path), totals)
        except CassetteMismatch:
            raise
        except Exception as exc:  # noqa: BLE001 - one trial must not stop the suite
            return _crashed(case, trial, exc)
        finally:
            if cassette_mode == "record" and provider is not None:
                provider.close()

    results: list[TrialResult] = []
    workers = max(1, concurrency)
    with ThreadPoolExecutor(max_workers=workers) as pool:
        futures = [pool.submit(one, case, trial) for case, trial in jobs]
        for future in futures:
            results.append(future.result())
    results.sort(key=lambda item: (item.case_id, item.trial))
    stamp = _stamp(cases, trials, describes, commit, dirty, cassette_mode)
    stamp["selection_reason"] = selection_reason
    return SuiteRun(stamp=stamp, results=results)


def _open_provider(factory, mode: str, directory: Path, case: EvalCase, trial: int):
    if mode == "replay":
        return ReplayProvider(cassette_path(directory, case.id, trial))
    provider = factory()
    if mode == "record":
        return RecordingProvider(provider, cassette_path(directory, case.id, trial))
    return provider


def _from_result(case: EvalCase, trial: int, result, trace_path: str, totals: dict) -> TrialResult:
    graded = grade(
        case,
        RunOutcome(result.outcome, list(result.changes), result.question, result.text),
    )
    return TrialResult(
        case_id=case.id,
        category=case.category,
        label=case.label,
        split=case.split,
        trial=trial,
        outcome=result.outcome,
        grade=graded,
        tool_calls=int(totals.get("tool_calls", 0)),
        tool_errors=int(totals.get("tool_errors", 0)),
        input_tokens=int(totals.get("input_tokens", 0)),
        output_tokens=int(totals.get("output_tokens", 0)),
        cost_usd=float(totals.get("cost_usd", 0.0)),
        latency_ms=float(totals.get("latency_ms", 0.0)),
        trace_path=trace_path,
        answer_text=result.text,
        error=result.trace.error,
    )


def _crashed(case: EvalCase, trial: int, exc: Exception) -> TrialResult:
    message = str(exc) or type(exc).__name__
    graded = grade(case, RunOutcome("failed", [], text=message))
    return TrialResult(
        case_id=case.id,
        category=case.category,
        label=case.label,
        split=case.split,
        trial=trial,
        outcome="failed",
        grade=graded,
        tool_calls=0,
        tool_errors=0,
        input_tokens=0,
        output_tokens=0,
        cost_usd=0.0,
        latency_ms=0.0,
        trace_path="",
        answer_text="",
        error=message,
    )


def _message(case: EvalCase) -> str:
    last = case.turns[-1]
    if not isinstance(last, UserTurn):
        raise ValueError(f"{case.id}: last turn must be a user turn")
    return last.user


def _history(case: EvalCase) -> list[HistoryTurn]:
    history: list[HistoryTurn] = []
    for turn in case.turns[:-1]:
        if isinstance(turn, UserTurn):
            history.append(HistoryTurn(role="user", text=turn.user))
            continue
        if isinstance(turn, AssistantTurnSpec):
            history.append(
                HistoryTurn(
                    role="assistant",
                    text=turn.assistant,
                    proposal=turn.proposal,
                    proposal_status=turn.status,
                )
            )
    return history


def _stamp(
    cases: list[EvalCase],
    trials: int,
    describes: dict,
    commit: str,
    dirty: bool,
    mode: str,
) -> dict:
    described: dict = {}
    model = ""
    if describes:
        described, model = describes[min(describes)]
    splits = {case.split for case in cases}
    split = next(iter(splits)) if len(splits) == 1 else "all"
    return {
        "git_commit": commit,
        "git_dirty": dirty,
        "provider": described,
        "model": model,
        "prompt_version": PROMPT_VERSION,
        "trials": trials,
        "split": split,
        "date": datetime.now(UTC).date().isoformat(),
        "case_count": len(cases),
        "mode": mode,
    }


def _git_meta() -> tuple[str, bool]:
    def run(*args: str) -> subprocess.CompletedProcess[str]:
        return subprocess.run(
            ["git", *args],
            cwd=_REPO_ROOT,
            capture_output=True,
            text=True,
            check=False,
        )

    commit = run("rev-parse", "HEAD")
    dirty = run("status", "--porcelain", "--untracked-files=no")
    sha = commit.stdout.strip() if commit.returncode == 0 else "unknown"
    return sha, bool(dirty.stdout.strip())
