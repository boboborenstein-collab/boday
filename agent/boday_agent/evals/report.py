"""Write a stamped results file and diff two runs."""
from __future__ import annotations

import json
import re
from pathlib import Path

from boday_agent.evals.metrics import Metrics, metrics_payload
from boday_agent.evals.runner import SuiteRun, suite_payload

_SCALARS = (
    "success_rate",
    "pass_all",
    "severe_damage_rate",
    "minor_damage_rate",
    "injection_attack_success",
    "over_asking",
    "guessing",
    "tool_calls_mean",
    "tool_error_recovery",
    "cost_per_request_mean",
    "latency_p50",
    "latency_p95",
    "tokens_mean",
    "advice_quality_mean",
    "judge_errors",
)


def write_report(
    run: SuiteRun,
    metrics: Metrics,
    out_dir: Path,
    *,
    calibration: dict | None = None,
) -> tuple[Path, Path]:
    out_dir.mkdir(parents=True, exist_ok=True)
    stem = f"{_date(run)}-{_slug(run)}-{_split(run)}"
    json_path = out_dir / f"{stem}.json"
    md_path = out_dir / f"{stem}.md"
    payload = suite_payload(run)
    payload["metrics"] = metrics_payload(metrics)
    if calibration is not None:
        payload["calibration"] = calibration
    json_path.write_text(json.dumps(payload, indent=2) + "\n")
    md_path.write_text(_markdown(run, metrics, calibration))
    return json_path, md_path


def compare(a: Path, b: Path) -> str:
    left = json.loads(Path(a).read_text())
    right = json.loads(Path(b).read_text())
    passed_a = _passed_all(left)
    passed_b = _passed_all(right)
    regressions = sorted(
        case_id
        for case_id, ok in passed_a.items()
        if ok and case_id in passed_b and not passed_b[case_id]
    )
    fixes = sorted(
        case_id
        for case_id, ok in passed_a.items()
        if not ok and passed_b.get(case_id)
    )
    lines = ["# Compare", "", "## Regressions", ""]
    lines.extend(f"- {case_id}" for case_id in regressions)
    if not regressions:
        lines.append("- none")
    lines.extend(["", "## Fixes", ""])
    lines.extend(f"- {case_id}" for case_id in fixes)
    if not fixes:
        lines.append("- none")
    lines.extend(
        [
            "",
            "## Metric deltas",
            "",
            "| Metric | A | B | Delta |",
            "| --- | --- | --- | --- |",
        ]
    )
    metrics_a = left.get("metrics") or {}
    metrics_b = right.get("metrics") or {}
    for name in _SCALARS:
        before = metrics_a.get(name)
        after = metrics_b.get(name)
        if before is None or after is None:
            continue
        before_f = float(before)
        after_f = float(after)
        lines.append(f"| {name} | {before_f:.3f} | {after_f:.3f} | {after_f - before_f:+.3f} |")
    lines.append("")
    return "\n".join(lines)


def _markdown(run: SuiteRun, metrics: Metrics, calibration: dict | None = None) -> str:
    lo, hi = metrics.success_ci
    rows = [
        ("Success rate", f"{metrics.success_rate:.3f} (95% CI {lo:.3f}–{hi:.3f})"),
        ("pass^k", f"{metrics.pass_all:.3f}"),
        ("Severe damage", f"{metrics.severe_damage_rate:.3f}"),
        ("Minor damage", f"{metrics.minor_damage_rate:.3f}"),
        ("Injection attack success", f"{metrics.injection_attack_success:.3f}"),
        ("Over-asking", f"{metrics.over_asking:.3f}"),
        ("Guessing", f"{metrics.guessing:.3f}"),
        ("Tool calls (mean)", f"{metrics.tool_calls_mean:.3f}"),
        ("Tool-error recovery", f"{metrics.tool_error_recovery:.3f}"),
        ("Cost / request", f"{metrics.cost_per_request_mean:.6f}"),
        ("Latency p50 ms", f"{metrics.latency_p50:.1f}"),
        ("Latency p95 ms", f"{metrics.latency_p95:.1f}"),
        ("Tokens (mean)", f"{metrics.tokens_mean:.1f}"),
    ]
    if metrics.advice_quality_mean is not None:
        text = f"{metrics.advice_quality_mean:.3f}"
        if calibration:
            text += (
                f"; exact {float(calibration['exact_agreement']):.3f},"
                f" within one {float(calibration['within_one_agreement']):.3f}"
            )
        rows.append(("Advice quality", text))
    lines = [
        f"# Eval report {_date(run)} {_slug(run)} {_split(run)}",
        "",
        "| Metric | Value |",
        "| --- | --- |",
    ]
    lines.extend(f"| {name} | {value} |" for name, value in rows)
    lines.extend(
        [
            "",
            "## By category",
            "",
            "| Category | Success | CI | n |",
            "| --- | --- | --- | --- |",
        ]
    )
    for category, row in metrics.by_category.items():
        clo, chi = row["ci"]
        lines.append(
            f"| {category} | {row['success_rate']:.3f} | {clo:.3f}–{chi:.3f} | {row['n']} |"
        )
    lines.extend(["", "## Failure types", ""])
    if metrics.failure_types:
        lines.extend(f"- {name}: {count}" for name, count in metrics.failure_types.items())
    else:
        lines.append("- none")
    lines.extend(["", "## Failed cases", ""])
    failed = [item for item in run.results if not item.grade.passed]
    if failed:
        lines.extend(f"- {item.case_id} trial {item.trial}: {item.trace_path}" for item in failed)
    else:
        lines.append("- none")
    lines.append("")
    return "\n".join(lines)


def _passed_all(payload: dict) -> dict[str, bool]:
    groups: dict[str, list[bool]] = {}
    for row in payload.get("results") or []:
        grade = row.get("grade") or {}
        groups.setdefault(row["case_id"], []).append(bool(grade.get("passed")))
    return {case_id: bool(flags) and all(flags) for case_id, flags in groups.items()}


def _date(run: SuiteRun) -> str:
    return str(run.stamp.get("date") or "undated")


def _split(run: SuiteRun) -> str:
    return str(run.stamp.get("split") or "all")


def _slug(run: SuiteRun) -> str:
    raw = str(run.stamp.get("model") or "model")
    slug = re.sub(r"[^A-Za-z0-9._-]+", "-", raw).strip("-")
    return slug or "model"
