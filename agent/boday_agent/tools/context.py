from __future__ import annotations

from collections import Counter
from collections.abc import Callable
from dataclasses import dataclass, field
from typing import TYPE_CHECKING
from uuid import uuid4

from ..domain.clock import Clock
from ..domain.models import Snapshot, Task
from .faults import FaultPlan
from .result import ErrorCode, ToolError

if TYPE_CHECKING:
    from .changes import ProposedChange
    from .propose import AskUserArgs


@dataclass(frozen=True)
class Limits:
    max_changes: int = 25
    max_deletes: int = 3
    max_agenda_days: int = 14
    max_search_results: int = 20
    max_days_ahead: int = 365
    overload_threshold: int = 8
    recent_history_days: int = 14


def counting_ids(prefix: str = "new") -> Callable[[], str]:
    n = 0

    def gen() -> str:
        nonlocal n
        n += 1
        return f"{prefix}-{n}"

    return gen


@dataclass
class RunContext:
    snapshot: Snapshot
    clock: Clock
    limits: Limits
    faults: FaultPlan
    id_gen: Callable[[], str]
    seen_ids: set[str] = field(default_factory=set)
    draft: list[ProposedChange] = field(default_factory=list)
    question: AskUserArgs | None = None
    call_counts: Counter[str] = field(default_factory=Counter)

    @classmethod
    def create(
        cls,
        snapshot: Snapshot,
        limits: Limits | None = None,
        faults: FaultPlan | None = None,
        id_gen: Callable[[], str] | None = None,
    ) -> RunContext:
        return cls(
            snapshot=snapshot,
            clock=Clock.from_snapshot(snapshot),
            limits=limits or Limits(),
            faults=faults or FaultPlan(),
            id_gen=id_gen or (lambda: str(uuid4())),
        )

    def task(self, task_id: str) -> Task:
        for t in self.snapshot.tasks:
            if t.id == task_id:
                return t
        raise ToolError(ErrorCode.NOT_FOUND, f"No task with id '{task_id}'.")

    def require_seen(self, task_id: str) -> Task:
        t = self.task(task_id)
        if task_id not in self.seen_ids:
            raise ToolError(
                ErrorCode.UNSEEN_ID,
                f"Task '{task_id}' has not been looked up in this conversation.",
                "Call search_tasks or get_task first.",
            )
        return t

    def mark_seen(self, ids) -> None:
        self.seen_ids.update(ids)

    def add_change(self, change: ProposedChange) -> None:
        task_id = getattr(change, "task_id", None)
        if task_id is not None and any(getattr(c, "task_id", None) == task_id for c in self.draft):
            raise ToolError(
                ErrorCode.CONFLICTING_CHANGE,
                f"There is already a proposed change for task '{task_id}'.",
                "Combine edits for one task into a single change.",
            )
        if len(self.draft) >= self.limits.max_changes:
            raise ToolError(
                ErrorCode.LIMIT_EXCEEDED,
                f"A proposal can contain at most {self.limits.max_changes} changes.",
            )
        if change.op == "delete":
            deletes = sum(1 for c in self.draft if c.op == "delete")
            if deletes >= self.limits.max_deletes:
                raise ToolError(
                    ErrorCode.LIMIT_EXCEEDED,
                    f"A proposal can delete at most {self.limits.max_deletes} tasks.",
                )
        self.draft.append(change)

    def draft_payload(self) -> list[dict]:
        return [c.model_dump(by_alias=True, mode="json") for c in self.draft]
