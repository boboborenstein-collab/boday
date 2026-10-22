from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

_AUTO_OWNER_ONLY = "Auto is only available on the owner's account."
_MODEL_NOT_CONFIGURED = "Connect a model to enable BoDay AI."


def error_body(code: str, message: str) -> dict:
    return {"error": {"code": code, "message": message}}


class HistoryItem(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    role: Literal["user", "assistant"]
    text: str = Field(max_length=4000)
    proposal: list[dict] | None = None
    proposal_status: Literal["pending", "approved", "rejected", "applied", "undone"] | None = (
        Field(default=None, alias="proposalStatus")
    )


class RunSettings(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra="ignore")

    provider: Literal["auto", "claude", "custom"]
    model: str | None = None
    base_url: str | None = Field(default=None, alias="baseUrl")
    key_ciphertext: str | None = Field(default=None, alias="keyCiphertext")


class RunRequest(BaseModel):
    message: str = Field(min_length=1, max_length=4000)
    history: list[HistoryItem]
    snapshot: dict
    settings: RunSettings

    @field_validator("snapshot", mode="before")
    @classmethod
    def _snapshot_is_object(cls, value: object) -> object:
        if not isinstance(value, dict):
            raise ValueError("snapshot must be an object")
        return value


class FeedbackRequest(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    run_id: str = Field(alias="runId")
    event: Literal["approve", "reject", "undo"]
    task_ids: list[str] = Field(alias="taskIds")


class EncryptRequest(BaseModel):
    plaintext: str = Field(min_length=1, max_length=500)


def run_settings_error(settings: RunSettings, *, is_owner: bool) -> tuple[int, str, str] | None:
    if settings.provider == "auto":
        if not is_owner:
            return (403, "AUTO_OWNER_ONLY", _AUTO_OWNER_ONLY)
        return None
    if settings.provider == "claude" and not settings.key_ciphertext:
        return (403, "MODEL_NOT_CONFIGURED", _MODEL_NOT_CONFIGURED)
    if settings.provider == "custom" and (not settings.base_url or not settings.model):
        return (403, "MODEL_NOT_CONFIGURED", _MODEL_NOT_CONFIGURED)
    return None
