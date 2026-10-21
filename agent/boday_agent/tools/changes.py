"""Proposed-change models. Camel-case serialized; patches, never rebuilt tasks."""
from __future__ import annotations

from typing import Annotated, Any, Literal

from pydantic import Field

from ..domain.models import CamelModel
from .result import ChangeWarning


class StatusSnapshot(CamelModel):
    status: Literal["open", "done", "skipped"]


class CreateChange(CamelModel):
    op: Literal["create"] = "create"
    task_id: str
    after: dict[str, Any]
    warnings: list[ChangeWarning] = Field(default_factory=list)


class UpdateChange(CamelModel):
    op: Literal["update"] = "update"
    task_id: str
    patch: dict[str, Any]  # camelCase task field -> new value (changed fields only)
    # Same keys as patch. null means the raw task held null OR the key was absent;
    # the payload does not preserve that difference.
    before_fields: dict[str, Any]
    warnings: list[ChangeWarning] = Field(default_factory=list)


class StatusChange(CamelModel):
    op: Literal["set_status"] = "set_status"
    task_id: str
    date: str | None = None
    before: StatusSnapshot
    after: StatusSnapshot
    # Set whenever the status before the change is done or skipped (undone, or a
    # done <-> skipped switch), so undo can restore what the change replaces.
    # Recurring: that occurrence's completion row exactly as received.
    # One-time: {"completedAt": raw value} when that key was present (value may
    # be null), or {} when the key was absent. Null when the status before is open.
    before_completion_raw: dict[str, Any] | None = None
    warnings: list[ChangeWarning] = Field(default_factory=list)


class DeleteChange(CamelModel):
    op: Literal["delete"] = "delete"
    task_id: str
    reason: str
    before_raw: dict[str, Any]
    before_completions_raw: list[dict[str, Any]] = Field(default_factory=list)
    warnings: list[ChangeWarning] = Field(default_factory=list)


ProposedChange = Annotated[
    CreateChange | UpdateChange | StatusChange | DeleteChange, Field(discriminator="op")
]
