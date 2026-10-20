from __future__ import annotations

import time
from collections.abc import Callable
from dataclasses import dataclass
from typing import Literal

from pydantic import BaseModel, ValidationError

from .context import RunContext
from .faults import post_fault_data, pre_fault_result
from .result import ErrorCode, ToolError, ToolResult


@dataclass
class ToolSpec:
    name: str
    description: str
    args_model: type[BaseModel]
    handler: Callable[[RunContext, BaseModel], dict]
    kind: Literal["read", "propose", "control"]


REGISTRY: dict[str, ToolSpec] = {}


def register(spec: ToolSpec) -> ToolSpec:
    REGISTRY[spec.name] = spec
    return spec


@dataclass
class ToolCallRecord:
    name: str
    args: dict
    result: ToolResult
    latency_ms: float
    injected_fault: str | None = None


def _first_error(exc: ValidationError) -> str:
    e = exc.errors()[0]
    loc = ".".join(str(p) for p in e["loc"])
    return f"{loc}: {e['msg']}" if loc else e["msg"]


def _run(ctx: RunContext, name: str, args: dict) -> tuple[ToolResult, str | None]:
    spec = REGISTRY.get(name)
    if spec is None:
        return ToolResult.failure(
            ErrorCode.INVALID_ARGS,
            f"Unknown tool '{name}'.",
            "Available tools: " + ", ".join(sorted(REGISTRY)),
        ), None
    ctx.call_counts[name] += 1
    fault = ctx.faults.find(name, ctx.call_counts[name])
    injected = fault.kind if fault else None
    pre = pre_fault_result(fault)
    if pre is not None:
        return pre, injected
    try:
        parsed = spec.args_model.model_validate(args)
    except ValidationError as exc:
        return ToolResult.failure(ErrorCode.INVALID_ARGS, _first_error(exc)), injected
    seen_before = set(ctx.seen_ids)
    try:
        data = spec.handler(ctx, parsed)
    except ToolError as exc:
        return ToolResult.failure(exc.code, exc.message, exc.hint), injected
    except Exception as exc:  # noqa: BLE001 - never leak internals to the model
        return ToolResult.failure(
            ErrorCode.TOOL_FAILURE, f"{name} failed unexpectedly ({type(exc).__name__})."
        ), injected
    rewritten = post_fault_data(fault, name, data)
    if fault is not None and fault.kind in ("empty", "truncated"):
        # The model only saw the rewritten data: hidden ids must not count as seen.
        ctx.seen_ids = seen_before | _ids_in(name, rewritten)
    return ToolResult.success(rewritten), injected


def _ids_in(name: str, data: dict) -> set[str]:
    if name == "search_tasks":
        rows = data.get("results", [])
    elif name == "get_agenda":
        rows = [i for d in data.get("days", []) for i in d.get("items", [])]
    else:
        rows = []
    return {r["id"] for r in rows if isinstance(r, dict) and "id" in r}


def execute(ctx: RunContext, name: str, args: dict) -> ToolCallRecord:
    start = time.perf_counter()
    result, injected = _run(ctx, name, args)
    return ToolCallRecord(
        name=name,
        args=args,
        result=result,
        latency_ms=(time.perf_counter() - start) * 1000,
        injected_fault=injected,
    )


def tool_schemas() -> list[dict]:
    return [
        {
            "name": s.name,
            "description": s.description,
            "input_schema": s.args_model.model_json_schema(),
        }
        for s in REGISTRY.values()
    ]
