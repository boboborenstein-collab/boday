"""Pydantic schema for eval cases. Unknown fields are rejected."""
from __future__ import annotations

from datetime import datetime
from typing import Any, Literal

from pydantic import AwareDatetime, BaseModel, ConfigDict, Field, model_validator

from boday_agent.tools.faults import Fault

Category = Literal[
    "happy_path",
    "dates",
    "recurring",
    "ambiguity",
    "conflicts",
    "bulk",
    "tool_failures",
    "refuse",
    "injection",
    "multi_turn",
    "advice",
]
Label = Literal["should_act", "should_ask", "either"]
Split = Literal["dev", "holdout"]
Outcome = Literal["proposed", "answered", "asked", "refused", "failed"]
ChangeOp = Literal["create", "update", "set_status", "delete"]
ProposalStatus = Literal["pending", "approved", "rejected", "applied", "undone"]

_DEFAULT_NOW = datetime.fromisoformat("2026-10-20T09:00:00-04:00")


class _Strict(BaseModel):
    model_config = ConfigDict(extra="forbid")


class UserTurn(_Strict):
    user: str


class AssistantTurnSpec(_Strict):
    assistant: str
    proposal: list[dict[str, Any]] | None = None
    status: ProposalStatus | None = None


Turn = UserTurn | AssistantTurnSpec


class ExpectedChange(_Strict):
    op: ChangeOp
    task: str | None = None
    fields: dict[str, Any] = Field(default_factory=dict)

    @model_validator(mode="after")
    def _task_required(self) -> ExpectedChange:
        if self.op != "create" and not self.task:
            raise ValueError("task is required unless op is create")
        return self


class Acceptable(_Strict):
    outcome: Outcome
    changes: list[ExpectedChange] = Field(default_factory=list)

    @model_validator(mode="after")
    def _changes_match_outcome(self) -> Acceptable:
        if self.outcome == "proposed" and len(self.changes) < 1:
            raise ValueError("proposed requires at least one change")
        if self.outcome != "proposed" and self.changes:
            raise ValueError("only a proposed outcome may include changes")
        return self


class JudgeSpec(_Strict):
    rubric_focus: str


class Expect(_Strict):
    accept: list[Acceptable] = Field(min_length=1)
    forbid_touch: list[str] = Field(default_factory=list)
    judge: JudgeSpec | None = None


class EvalCase(_Strict):
    id: str = Field(pattern=r"^[a-z0-9][a-z0-9-]*$")
    category: Category
    label: Label
    split: Split
    fixture: str
    now: AwareDatetime = _DEFAULT_NOW
    timezone: str = "America/New_York"
    turns: list[Turn] = Field(min_length=1)
    expect: Expect
    faults: list[Fault] = Field(default_factory=list)
    notes: str | None = None

    @model_validator(mode="after")
    def _last_turn_is_user(self) -> EvalCase:
        if not isinstance(self.turns[-1], UserTurn):
            raise ValueError("last turn must be a user turn")
        return self
