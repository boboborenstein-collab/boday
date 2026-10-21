from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field, model_validator

from .result import ErrorCode, ToolResult

FaultKind = Literal["error", "timeout", "empty", "truncated"]
LIST_TOOLS = frozenset({"search_tasks", "get_agenda"})


class Fault(BaseModel):
    tool: str
    call: int  # 1-based, per tool; FaultPlan rejects values below 1
    kind: FaultKind


class FaultPlan(BaseModel):
    faults: list[Fault] = Field(default_factory=list)

    @model_validator(mode="after")
    def _check(self) -> FaultPlan:
        for f in self.faults:
            if f.call < 1:
                raise ValueError(f"fault call must be >= 1, got {f.call}")
            if f.kind in ("empty", "truncated") and f.tool not in LIST_TOOLS:
                raise ValueError(f"fault '{f.kind}' is only allowed for {sorted(LIST_TOOLS)}")
        return self

    def find(self, tool: str, call: int) -> Fault | None:
        for f in self.faults:
            if f.tool == tool and f.call == call:
                return f
        return None


def pre_fault_result(fault: Fault | None) -> ToolResult | None:
    """Failure to return instead of running the handler (error / timeout)."""
    if fault is None:
        return None
    if fault.kind == "error":
        return ToolResult.failure(ErrorCode.TOOL_FAILURE, "upstream error")
    if fault.kind == "timeout":
        return ToolResult.failure(ErrorCode.TOOL_FAILURE, "timed out")
    return None


def post_fault_data(fault: Fault | None, tool: str, data: dict) -> dict:
    """Rewrite handler output for empty / truncated faults."""
    if fault is None or fault.kind not in ("empty", "truncated"):
        return data
    if tool == "search_tasks":
        if fault.kind == "empty":
            return {**data, "results": [], "total": 0, "truncated": False}
        return {**data, "results": data.get("results", [])[:1], "truncated": True}
    # get_agenda
    days = data.get("days", [])
    if fault.kind == "empty":
        return {
            **data,
            "days": [{**d, "items": [], "total": 0, "truncated": False} for d in days],
        }
    return {**data, "days": days[:1], "truncated": True}
