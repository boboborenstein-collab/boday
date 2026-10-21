"""`boday-eval` command line."""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

from boday_agent.cli import _headers, make_provider
from boday_agent.evals.judge import (
    default_client,
    export_ratings,
    import_ratings,
    load_calibration,
    score_advice,
)
from boday_agent.evals.loader import (
    CASES_DIR,
    FIXTURES_DIR,
    load_cases,
    load_fixture,
    validate_suite,
)
from boday_agent.evals.metrics import compute_metrics
from boday_agent.evals.oracle import check_expectations
from boday_agent.evals.report import compare, write_report
from boday_agent.evals.runner import run_suite

RESULTS_DIR = CASES_DIR.parent / "results"


def _validate() -> int:
    try:
        cases = load_cases(CASES_DIR)
    except ValueError as exc:
        print(exc)
        return 1
    errors = validate_suite(cases, FIXTURES_DIR)
    for case in cases:
        if not (FIXTURES_DIR / f"{case.fixture}.json").is_file():
            continue
        try:
            fixture = load_fixture(case.fixture)
        except (OSError, ValueError) as exc:
            errors.append(f"{case.id}: {exc}")
            continue
        errors.extend(check_expectations(case, fixture))
    if errors:
        for error in errors:
            print(error)
        return 1
    print(f"{len(cases)} cases OK")
    return 0


def _provider_args(args: argparse.Namespace) -> argparse.Namespace:
    return argparse.Namespace(
        provider=args.provider,
        model=args.model,
        base_url=args.base_url,
        api_key_env=None,
        header=args.header,
        effort=args.effort,
    )


def _filter_cases(cases, args: argparse.Namespace):
    if args.split != "all":
        cases = [case for case in cases if case.split == args.split]
    if args.case:
        wanted = list(dict.fromkeys(args.case))
        found = {case.id for case in cases}
        missing = [item for item in wanted if item not in found]
        if missing:
            print("unknown case: " + ", ".join(missing))
            return None
        chosen = set(wanted)
        cases = [case for case in cases if case.id in chosen]
    if args.category:
        allowed = set(args.category)
        cases = [case for case in cases if case.category in allowed]
    return cases


def _run(args: argparse.Namespace) -> int:
    if not args.provider:
        print("--provider is required", file=sys.stderr)
        return 2
    if args.provider in ("openai", "auto") and not args.base_url:
        print("--base-url is required for provider " + args.provider, file=sys.stderr)
        return 2
    if args.provider in ("openai", "auto") and not args.model:
        print("--model is required for provider " + args.provider, file=sys.stderr)
        return 2
    try:
        _headers(args.header or [])
    except ValueError as exc:
        print(exc, file=sys.stderr)
        return 2
    try:
        cases = load_cases(CASES_DIR)
    except ValueError as exc:
        print(exc)
        return 1
    selected = _filter_cases(cases, args)
    if selected is None:
        return 1
    if not selected:
        print("no cases matched")
        return 1
    out = Path(args.out) if args.out else RESULTS_DIR

    def factory():
        # A fresh client per trial. Construction waits until the trial runs.
        provider, _reason = make_provider(_provider_args(args))
        return provider

    run = run_suite(
        selected,
        factory,
        traces_dir=out / "traces",
        trials=args.trials,
        concurrency=args.concurrency,
        selection_reason="explicit",
    )
    if args.judge:
        score_advice(run, selected, default_client())
    json_path, md_path = write_report(
        run, compute_metrics(run), out, calibration=load_calibration()
    )
    print(json_path)
    print(md_path)
    return 0


def _calibrate(args: argparse.Namespace) -> int:
    if args.export and args.import_csv:
        print("pass only one of --export or --import", file=sys.stderr)
        return 2
    if args.export:
        count = export_ratings(Path(args.export[0]), Path(args.export[1]))
        print(f"wrote {count} advice rows to {args.export[1]}")
        return 0
    if args.import_csv:
        result = import_ratings(Path(args.import_csv[0]), Path(args.import_csv[1]))
        exact = result["exact_agreement"]
        within = result["within_one_agreement"]
        state = "calibrated" if result["calibrated"] else "not calibrated"
        print(f"exact {exact:.3f}, within one {within:.3f} ({result['n']} rows, {state})")
        return 0
    print("pass --export or --import", file=sys.stderr)
    return 2


def _report(args: argparse.Namespace) -> int:
    text = compare(Path(args.compare[0]), Path(args.compare[1]))
    print(text)
    return 0


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="boday-eval")
    sub = parser.add_subparsers(dest="command", required=True)
    sub.add_parser("validate", help="Check case files, fixtures, and expected answers")
    run = sub.add_parser("run", help="Run cases and write the JSON and markdown report")
    run.add_argument("--provider", choices=["anthropic", "openai", "auto"])
    run.add_argument("--model", default=None)
    run.add_argument("--base-url", default=None)
    run.add_argument("--header", action="append", default=None)
    run.add_argument("--effort", default=None)
    run.add_argument("--trials", type=int, default=3)
    run.add_argument("--split", choices=["dev", "holdout", "all"], default="all")
    run.add_argument("--case", action="append", default=None)
    run.add_argument("--category", action="append", default=None)
    run.add_argument("--concurrency", type=int, default=4)
    run.add_argument("--out", default=None)
    run.add_argument("--judge", action="store_true", help="Score advice answers")
    report = sub.add_parser("report", help="Compare two result JSON files")
    report.add_argument("--compare", nargs=2, metavar=("A", "B"), required=True)
    calibrate = sub.add_parser("calibrate", help="Export or import owner ratings of the judge")
    calibrate.add_argument("--export", nargs=2, metavar=("RESULTS.json", "OUT.csv"))
    calibrate.add_argument(
        "--import", dest="import_csv", nargs=2, metavar=("RATED.csv", "RESULTS.json")
    )
    return parser


def main(argv: list[str] | None = None) -> int:
    args = _parser().parse_args(argv)
    if args.command == "validate":
        return _validate()
    if args.command == "run":
        return _run(args)
    if args.command == "report":
        return _report(args)
    if args.command == "calibrate":
        return _calibrate(args)
    return 2


if __name__ == "__main__":
    sys.exit(main())
