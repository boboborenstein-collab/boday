"""`boday-eval` command line. Part A ships `validate` only."""
from __future__ import annotations

import argparse
import sys

from boday_agent.evals.loader import (
    CASES_DIR,
    FIXTURES_DIR,
    load_cases,
    load_fixture,
    validate_suite,
)
from boday_agent.evals.oracle import check_expectations


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


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="boday-eval")
    sub = parser.add_subparsers(dest="command", required=True)
    sub.add_parser("validate", help="Check case files, fixtures, and expected answers")
    args = parser.parse_args(argv)
    if args.command == "validate":
        return _validate()
    return 2


if __name__ == "__main__":
    sys.exit(main())
