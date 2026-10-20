from __future__ import annotations

from enum import StrEnum
from typing import Literal

from pydantic import BaseModel


class ErrorCode(StrEnum):
    NOT_FOUND = "NOT_FOUND"
    UNSEEN_ID = "UNSEEN_ID"
    INVALID_ARGS = "INVALID_ARGS"
    WRONG_TASK_TYPE = "WRONG_TASK_TYPE"
    INVALID_DATE = "INVALID_DATE"
    LIMIT_EXCEEDED = "LIMIT_EXCEEDED"
    CONFLICTING_CHANGE = "CONFLICTING_CHANGE"
    TOOL_FAILURE = "TOOL_FAILURE"


class ToolError(Exception):
    def __init__(self, code: ErrorCode, message: str, hint: str | None = None):
        super().__init__(message)
        self.code = code
        self.message = message
        self.hint = hint


class ToolErrorInfo(BaseModel):
    code: ErrorCode
    message: str
    hint: str | None = None


class ToolResult(BaseModel):
    ok: bool
    data: dict | None = None
    error: ToolErrorInfo | None = None

    @classmethod
    def success(cls, data: dict | None = None) -> ToolResult:
        return cls(ok=True, data=data if data is not None else {})

    @classmethod
    def failure(cls, code: ErrorCode, message: str, hint: str | None = None) -> ToolResult:
        return cls(ok=False, error=ToolErrorInfo(code=code, message=message, hint=hint))

    def to_model_json(self) -> str:
        return self.model_dump_json(exclude_none=True)


class ChangeWarning(BaseModel):
    code: Literal["POSSIBLE_DUPLICATE", "TIME_CLASH", "QUIET_WINDOW", "EXTERNAL_TASK"]
    message: str
