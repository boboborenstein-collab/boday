"""Aggregate a suite run. Judge scores stay out of the success rate."""
from __future__ import annotations

import math
from dataclasses import asdict, dataclass

from boday_agent.evals.runner import SuiteRun, TrialResult

_DAMAGE = {"none": 0, "minor": 1, "severe": 2}


@dataclass
class Metrics:
    success_rate: float
    success_ci: tuple[float, float]
    pass_all: float
    pass_all_ci: tuple[float, float]
    severe_damage_rate: float
    minor_damage_rate: float
    injection_attack_success: float
    over_asking: float
    guessing: float
    tool_calls_mean: float
    tool_error_recovery: float
    cost_per_request_mean: float
    latency_p50: float
    latency_p95: float
    tokens_mean: float
    by_category: dict[str, dict]
    failure_types: dict[str, int]
    advice_quality_mean: float | None = None
    judge_errors: int = 0


def wilson(successes: int, n: int, z: float = 1.96) -> tuple[float, float]:
    """Wilson score interval. An empty sample has no interval."""
    if n <= 0:
        return (0.0, 0.0)
    proportion = successes / n
    z2 = z * z
    denom = 1 + z2 / n
    center = (proportion + z2 / (2 * n)) / denom
    margin = z * math.sqrt(proportion * (1 - proportion) / n + z2 / (4 * n * n)) / denom
    return (center - margin, center + margin)


def compute_metrics(run: SuiteRun) -> Metrics:
    results = list(run.results)
    by_case = _by_case(results)
    successes = sum(1 for item in results if item.grade.passed)
    n_trials = len(results)
    n_cases = len(by_case)
    all_passed = sum(1 for trials in by_case.values() if all(item.grade.passed for item in trials))
    worst = {case_id: _worst(trials) for case_id, trials in by_case.items()}
    injection = [
        case_id for case_id, trials in by_case.items() if trials[0].category == "injection"
    ]
    attacked = [
        case_id
        for case_id in injection
        if any(item.grade.damage == "severe" for item in by_case[case_id])
    ]
    should_act = [item for item in results if item.label == "should_act"]
    should_ask = [item for item in results if item.label == "should_ask"]
    # An asked trial the case accepts is a pass. See the B2 ledger ruling.
    over_ask = [
        item for item in should_act if item.outcome == "asked" and not item.grade.passed
    ]
    guesses = [item for item in should_ask if item.outcome == "proposed"]
    errored = [item for item in results if item.tool_errors >= 1]
    recovered = [item for item in errored if item.grade.passed]
    failures: dict[str, int] = {}
    for item in results:
        name = _failure_name(item)
        if not name:
            continue
        failures[name] = failures.get(name, 0) + 1
    scores = [item.judge_score for item in results if item.judge_score is not None]
    return Metrics(
        success_rate=_rate(successes, n_trials),
        success_ci=wilson(successes, n_trials),
        pass_all=_rate(all_passed, n_cases),
        pass_all_ci=wilson(all_passed, n_cases),
        severe_damage_rate=_rate(
            sum(1 for damage in worst.values() if damage == "severe"), n_cases
        ),
        minor_damage_rate=_rate(sum(1 for damage in worst.values() if damage == "minor"), n_cases),
        injection_attack_success=_rate(len(attacked), len(injection)),
        over_asking=_rate(len(over_ask), len(should_act)),
        guessing=_rate(len(guesses), len(should_ask)),
        tool_calls_mean=_mean([item.tool_calls for item in results]),
        tool_error_recovery=_rate(len(recovered), len(errored)),
        cost_per_request_mean=_mean([item.cost_usd for item in results]),
        latency_p50=_percentile([item.latency_ms for item in results], 0.50),
        latency_p95=_percentile([item.latency_ms for item in results], 0.95),
        tokens_mean=_mean([item.input_tokens + item.output_tokens for item in results]),
        by_category=_categories(results),
        failure_types=dict(sorted(failures.items(), key=lambda item: (-item[1], item[0]))),
        advice_quality_mean=(sum(scores) / len(scores)) if scores else None,
        judge_errors=sum(1 for item in results if item.judge_error),
    )


def metrics_payload(metrics: Metrics) -> dict:
    payload = asdict(metrics)
    payload["success_ci"] = list(metrics.success_ci)
    payload["pass_all_ci"] = list(metrics.pass_all_ci)
    for row in payload["by_category"].values():
        row["ci"] = list(row["ci"])
    return payload


def _failure_name(item: TrialResult) -> str | None:
    """Spec §5 counts step-cap and timeout apart from a wrong outcome."""
    if item.grade.passed:
        return None
    if item.outcome == "failed":
        error = item.error or ""
        if error == "timeout":
            return "timeout"
        if error == "step limit reached":
            return "step_cap"
        if item.grade.failure_type == "wrong_outcome":
            return "model_error"
    return item.grade.failure_type


def _by_case(results: list[TrialResult]) -> dict[str, list[TrialResult]]:
    groups: dict[str, list[TrialResult]] = {}
    for item in results:
        groups.setdefault(item.case_id, []).append(item)
    return groups


def _worst(trials: list[TrialResult]) -> str:
    return max((item.grade.damage for item in trials), key=lambda name: _DAMAGE[name])


def _categories(results: list[TrialResult]) -> dict[str, dict]:
    grouped: dict[str, list[TrialResult]] = {}
    for item in results:
        grouped.setdefault(item.category, []).append(item)
    out: dict[str, dict] = {}
    for category in sorted(grouped):
        trials = grouped[category]
        successes = sum(1 for item in trials if item.grade.passed)
        out[category] = {
            "success_rate": _rate(successes, len(trials)),
            "ci": wilson(successes, len(trials)),
            "n": len(trials),
        }
    return out


def _rate(hits: int, total: int) -> float:
    if total <= 0:
        return 0.0
    return hits / total


def _mean(values: list[float]) -> float:
    if not values:
        return 0.0
    return sum(values) / len(values)


def _percentile(values: list[float], fraction: float) -> float:
    if not values:
        return 0.0
    ordered = sorted(values)
    if len(ordered) == 1:
        return float(ordered[0])
    rank = fraction * (len(ordered) - 1)
    low = math.floor(rank)
    high = math.ceil(rank)
    if low == high:
        return float(ordered[low])
    weight = rank - low
    return float(ordered[low] * (1 - weight) + ordered[high] * weight)
