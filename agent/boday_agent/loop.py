from __future__ import annotations

import hashlib
import json
import time
from collections.abc import Callable
from datetime import UTC, datetime
from typing import Literal
from uuid import uuid4

from pydantic import BaseModel, Field

from boday_agent.domain.models import Snapshot
from boday_agent.pricing import cost_usd
from boday_agent.prompt import PROMPT_VERSION, SYSTEM_PROMPT, HistoryTurn, build_messages
from boday_agent.providers.base import (
    AssistantTurn,
    Message,
    Provider,
    ProviderError,
    ToolResultMsg,
    ToolResults,
)
from boday_agent.tools.context import RunContext
from boday_agent.tools.faults import FaultPlan
from boday_agent.tools.registry import execute, tool_schemas
from boday_agent.tools.result import ToolResult
from boday_agent.tracing import ModelCallEvent, ToolCallEvent, Trace, redact

Outcome = Literal["proposed", "answered", "asked", "refused", "failed"]


class LoopLimits(BaseModel):
    max_model_calls: int = 8
    max_tool_calls_per_step: int = 10
    timeout_s: float = 60.0
    local_timeout_s: float = 90.0


class AgentRequest(BaseModel):
    message: str
    history: list[HistoryTurn] = Field(default_factory=list)
    snapshot: Snapshot


class AgentResult(BaseModel):
    outcome: Outcome
    text: str
    changes: list[dict]
    question: str | None
    options: list[str]
    trace: Trace


def run_agent(
    request: AgentRequest,
    provider: Provider,
    *,
    limits: LoopLimits | None = None,
    faults: FaultPlan | None = None,
    id_gen: Callable[[], str] | None = None,
    selection_reason: str = "explicit",
    timer: Callable[[], float] = time.perf_counter,
    now_iso: str | None = None,
) -> AgentResult:
    limits = limits or LoopLimits()
    faults = faults or FaultPlan()
    gen = id_gen or (lambda: str(uuid4()))
    ctx = RunContext.create(request.snapshot, faults=faults, id_gen=gen)
    messages: list[Message] = build_messages(
        request.message, request.history, request.snapshot, ctx.clock
    )
    budget = limits.local_timeout_s if provider.is_local else limits.timeout_s
    schemas = tool_schemas()
    # Run ids stay unique even when id_gen is the shared counting generator
    # tests and evals use for task ids. Reusing it writes every run to new-1.json.
    trace = _new_trace(request, provider, str(uuid4()), selection_reason, now_iso)
    t0 = timer()

    def finish(
        outcome: Outcome,
        text: str,
        changes: list[dict],
        *,
        error: str | None = None,
        question: str | None = None,
        options: list[str] | None = None,
    ) -> AgentResult:
        if outcome in ("failed", "asked"):
            changes = []
            ctx.draft.clear()
        trace.finalize(outcome, error, (timer() - t0) * 1000)
        return AgentResult(
            outcome=outcome,
            text=text,
            changes=changes,
            question=question,
            options=options or [],
            trace=trace,
        )

    for step in range(1, limits.max_model_calls + 1):
        elapsed = timer() - t0
        if elapsed >= budget:
            return finish("failed", "timeout", [], error="timeout")
        try:
            response = provider.complete(
                SYSTEM_PROMPT,
                messages,
                schemas,
                timeout_s=max(0.0, budget - elapsed),
            )
        except ProviderError as exc:
            message = redact(str(exc))
            return finish("failed", message, [], error=message)
        except Exception as exc:
            message = redact(type(exc).__name__)
            return finish("failed", message, [], error=message)

        cost, known = cost_usd(response.model, response.usage)
        trace.events.append(
            ModelCallEvent(
                step=step,
                provider=provider.name,
                model=response.model,
                usage=response.usage,
                cost_usd=cost,
                price_known=known,
                latency_ms=response.latency_ms,
                stop_reason=response.stop_reason,
                text=response.text,
                tool_calls=list(response.tool_calls),
                raw=response.raw,
            )
        )
        messages.append(AssistantTurn(response=response))

        if response.stop_reason == "refusal":
            text = response.text or "I can't help with that."
            return finish("refused", text, [])
        if response.stop_reason == "max_tokens":
            return finish(
                "failed", "model output truncated", [], error="model output truncated"
            )
        if not response.tool_calls:
            return _finish_without_tools(ctx, response.text, finish)

        asked = _run_tools(ctx, trace, messages, response, step, limits)
        if asked and ctx.question is not None:
            return finish(
                "asked",
                ctx.question.question,
                [],
                question=ctx.question.question,
                options=list(ctx.question.options),
            )

    return finish("failed", "step limit reached", [], error="step limit reached")


def _new_trace(
    request: AgentRequest,
    provider: Provider,
    run_id: str,
    selection_reason: str,
    now_iso: str | None,
) -> Trace:
    payload = json.dumps(request.snapshot.model_dump(mode="json"), sort_keys=True)
    return Trace(
        run_id=run_id,
        started_at=now_iso or datetime.now(UTC).strftime("%Y-%m-%dT%H:%M:%SZ"),
        provider=provider.describe(),
        selection_reason=selection_reason,
        prompt_version=PROMPT_VERSION,
        request={
            "message": request.message,
            "history_length": len(request.history),
            "task_count": len(request.snapshot.tasks),
            "snapshot_hash": hashlib.sha256(payload.encode()).hexdigest(),
        },
        parse_warnings=list(request.snapshot.parse_warnings),
    )


def _finish_without_tools(ctx: RunContext, text: str, finish):
    if ctx.question is not None:
        return finish(
            "asked",
            ctx.question.question,
            [],
            question=ctx.question.question,
            options=list(ctx.question.options),
        )
    if ctx.draft:
        return finish("proposed", text, ctx.draft_payload())
    if text:
        return finish("answered", text, [])
    return finish("failed", "empty response", [], error="empty response")


def _run_tools(ctx, trace, messages, response, step: int, limits: LoopLimits) -> bool:
    results: list[ToolResultMsg] = []
    asked = False
    cap = limits.max_tool_calls_per_step
    for index, call in enumerate(response.tool_calls):
        if call.args is None:
            failure = ToolResult.failure(
                "INVALID_ARGS",
                f"tool arguments were not valid JSON: {call.raw_args}",
            )
            _record_skipped(trace, step, call, failure, results)
            continue
        if index >= cap:
            failure = ToolResult.failure(
                "INVALID_ARGS", f"too many tool calls in one step (max {cap})"
            )
            _record_skipped(trace, step, call, failure, results)
            continue
        record = execute(ctx, call.name, call.args)
        result = record.result
        results.append(
            ToolResultMsg(
                call_id=call.id,
                content=result.to_model_json(),
                is_error=not result.ok,
            )
        )
        trace.events.append(
            ToolCallEvent(
                step=step,
                name=call.name,
                args=call.args,
                ok=result.ok,
                error_code=None if result.error is None else str(result.error.code),
                result=result.model_dump(mode="json"),
                latency_ms=record.latency_ms,
                injected_fault=record.injected_fault,
            )
        )
        if call.name == "ask_user" and result.ok:
            asked = True
    messages.append(ToolResults(results=results))
    return asked


def _record_skipped(
    trace, step: int, call, failure: ToolResult, results: list[ToolResultMsg]
) -> None:
    results.append(
        ToolResultMsg(call_id=call.id, content=failure.to_model_json(), is_error=True)
    )
    trace.events.append(
        ToolCallEvent(
            step=step,
            name=call.name,
            args=call.args,
            ok=False,
            error_code="INVALID_ARGS",
            result=failure.model_dump(mode="json"),
            latency_ms=0.0,
            injected_fault=None,
        )
    )


__all__ = [
    "AgentRequest",
    "AgentResult",
    "LoopLimits",
    "Outcome",
    "run_agent",
]
