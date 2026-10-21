"""Pydantic mirror of the app's TypeScript task types (src/types.ts)."""
from __future__ import annotations

import copy
import re
from datetime import date, datetime
from typing import Annotated, Any, Literal
from zoneinfo import ZoneInfo

from pydantic import (
    AwareDatetime,
    BaseModel,
    ConfigDict,
    Field,
    TypeAdapter,
    ValidationError,
    field_validator,
)
from pydantic.alias_generators import to_camel


class CamelModel(BaseModel):
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True, extra="ignore")


_YMD = re.compile(r"^\d{4}-\d{2}-\d{2}$")


def _check_ymd(v: str | None) -> str | None:
    if v is None:
        return v
    if not _YMD.match(v):
        raise ValueError(f"must look like yyyy-MM-dd, got {v!r}")
    try:
        date.fromisoformat(v)
    except ValueError:
        raise ValueError(f"{v!r} is not a real date") from None
    return v


def _check_iso_datetime(v: str | None) -> str | None:
    if v is None:
        return v
    try:
        datetime.fromisoformat(v)
    except ValueError:
        raise ValueError(f"{v!r} is not an ISO datetime") from None
    return v


class Daily(CamelModel):
    kind: Literal["daily"] = "daily"


class Weekly(CamelModel):
    kind: Literal["weekly"] = "weekly"
    days_of_week: list[int]  # 0 = Sunday ... 6 = Saturday


class EveryNDays(CamelModel):
    kind: Literal["everyNDays"] = "everyNDays"
    n: int


class Monthly(CamelModel):
    kind: Literal["monthly"] = "monthly"
    date_of_month: int


Recurrence = Annotated[Daily | Weekly | EveryNDays | Monthly, Field(discriminator="kind")]


class Subtask(CamelModel):
    id: str
    title: str
    done: bool


class BaseTask(CamelModel):
    id: str
    title: str
    notes: str | None = None
    priority: int = Field(ge=1, le=5)  # 5 = Torah category
    tags: list[str] = Field(default_factory=list)
    subtasks: list[Subtask] = Field(default_factory=list)
    assigned_by_email: str | None = None
    assigned_from_task_id: str | None = None
    reminder_time: str | None = None
    renudge_minutes: int | None = None
    exclude_from_stats: bool = False
    created_at: str


class OneTimeTask(BaseTask):
    type: Literal["one_time"] = "one_time"
    scheduled_date: str
    completed: bool
    completed_at: str | None = None

    @field_validator("scheduled_date")
    @classmethod
    def _v_date(cls, v: str) -> str:
        return _check_ymd(v)  # type: ignore[return-value]

    @field_validator("completed_at")
    @classmethod
    def _v_completed_at(cls, v: str | None) -> str | None:
        return _check_iso_datetime(v)


class RecurringTask(BaseTask):
    type: Literal["recurring"] = "recurring"
    recurrence: Recurrence
    start_date: str
    end_date: str | None = None

    @field_validator("start_date", "end_date")
    @classmethod
    def _v_dates(cls, v: str | None) -> str | None:
        return _check_ymd(v)


Task = Annotated[OneTimeTask | RecurringTask, Field(discriminator="type")]


class TaskCompletion(CamelModel):
    id: str
    task_id: str
    completion_date: str
    completed_at: str
    skipped: bool = False

    @field_validator("completion_date")
    @classmethod
    def _v_date(cls, v: str) -> str:
        return _check_ymd(v)  # type: ignore[return-value]


class QuietWindow(CamelModel):
    start: AwareDatetime
    end: AwareDatetime
    title: str


_TASK = TypeAdapter(Task)


def _label(item: Any, index: int) -> str:
    if isinstance(item, dict) and isinstance(item.get("id"), str):
        return item["id"]
    return str(index)


def _first_error(exc: ValidationError) -> str:
    e = exc.errors()[0]
    loc = ".".join(str(p) for p in e["loc"])
    return f"{loc}: {e['msg']}" if loc else e["msg"]


class Snapshot(CamelModel):
    tasks: list[Task]
    completions: list[TaskCompletion] = Field(default_factory=list)
    quiet_windows: list[QuietWindow] = Field(default_factory=list)
    now: AwareDatetime
    timezone: str
    raw_tasks: dict[str, dict] = Field(default_factory=dict, exclude=True)
    raw_completions: dict[str, dict] = Field(default_factory=dict, exclude=True)
    parse_warnings: list[str] = Field(default_factory=list, exclude=True)

    @field_validator("timezone")
    @classmethod
    def _valid_zone(cls, v: str) -> str:
        try:
            ZoneInfo(v)
        except Exception as exc:
            raise ValueError(f"unknown IANA timezone: {v!r}") from exc
        return v

    @classmethod
    def from_app(cls, data: dict) -> Snapshot:
        if not isinstance(data, dict):
            TypeAdapter(dict).validate_python(data)
        # Strict top-level fields: raises ValidationError on bad now/timezone.
        head = cls(tasks=[], now=data.get("now"), timezone=data.get("timezone"))  # type: ignore[arg-type]

        warnings: list[str] = []
        tasks: list[Any] = []
        completions: list[TaskCompletion] = []
        windows: list[QuietWindow] = []
        raw_tasks: dict[str, dict] = {}
        raw_completions: dict[str, dict] = {}

        def each(key: str) -> list:
            v = data.get(key) or []
            return v if isinstance(v, list) else []

        for i, item in enumerate(each("tasks")):
            try:
                task = _TASK.validate_python(item)
                if task.id in raw_tasks:
                    warnings.append(f"duplicate task id '{task.id}'")
                    continue
                tasks.append(task)
                raw_tasks[task.id] = copy.deepcopy(item)
            except ValidationError as exc:
                warnings.append(f"skipped task '{_label(item, i)}': {_first_error(exc)}")
        for i, item in enumerate(each("completions")):
            try:
                c = TaskCompletion.model_validate(item)
                if c.id in raw_completions:
                    warnings.append(f"duplicate completion id '{c.id}'")
                    continue
                completions.append(c)
                raw_completions[c.id] = copy.deepcopy(item)
            except ValidationError as exc:
                warnings.append(f"skipped completion '{_label(item, i)}': {_first_error(exc)}")
        for i, item in enumerate(each("quietWindows")):
            try:
                windows.append(QuietWindow.model_validate(item))
            except ValidationError as exc:
                warnings.append(f"skipped quiet window '{_label(item, i)}': {_first_error(exc)}")

        return cls(
            tasks=tasks,
            completions=completions,
            quiet_windows=windows,
            now=head.now,
            timezone=head.timezone,
            raw_tasks=raw_tasks,
            raw_completions=raw_completions,
            parse_warnings=warnings,
        )


__all__ = [
    "Daily", "Weekly", "EveryNDays", "Monthly", "Recurrence", "Subtask", "OneTimeTask",
    "RecurringTask", "Task", "TaskCompletion", "QuietWindow", "Snapshot",
]
