import json
from pathlib import Path

import pytest
from pydantic import ValidationError

from boday_agent.server.contract import (
    EncryptRequest,
    FeedbackRequest,
    RunRequest,
    RunSettings,
    error_body,
    run_settings_error,
)


def test_run_request_parses_camel_case_contract():
    raw = json.loads(Path("tests/fixtures/api_contract_run.json").read_text())
    req = RunRequest.model_validate(raw)
    assert req.history[0].proposal_status == "applied"
    assert req.history[0].proposal[0]["beforeFields"] == {"scheduledDate": "2026-10-22"}
    assert req.settings.provider == "claude" and req.settings.model == "claude-haiku-5-5"
    assert req.snapshot["timezone"] == "America/New_York"
    with pytest.raises(ValidationError):
        RunRequest.model_validate({**raw, "snapshot": ["nope"]})
    with pytest.raises(ValidationError):
        RunRequest.model_validate({**raw, "message": ""})


def test_feedback_encrypt_and_settings_rules():
    fb = FeedbackRequest.model_validate(
        {"runId": "run-1", "event": "approve", "taskIds": []}
    )
    assert fb.run_id == "run-1" and fb.task_ids == []
    with pytest.raises(ValidationError):
        EncryptRequest.model_validate({"plaintext": ""})
    with pytest.raises(ValidationError):
        EncryptRequest.model_validate({"plaintext": "x" * 501})
    owner = RunSettings.model_validate(
        {"provider": "auto", "model": None, "baseUrl": None, "keyCiphertext": None}
    )
    assert run_settings_error(owner, is_owner=True) is None
    assert run_settings_error(owner, is_owner=False)[1] == "AUTO_OWNER_ONLY"
    claude = RunSettings.model_validate(
        {"provider": "claude", "model": None, "baseUrl": None, "keyCiphertext": None}
    )
    assert run_settings_error(claude, is_owner=True)[1] == "MODEL_NOT_CONFIGURED"
    custom = RunSettings.model_validate(
        {
            "provider": "custom",
            "model": "m",
            "baseUrl": "https://llm.example/v1",
            "keyCiphertext": None,
        }
    )
    assert run_settings_error(custom, is_owner=False) is None


def test_response_fixture_has_the_contract_keys():
    body = json.loads(Path("tests/fixtures/api_contract_response.json").read_text())
    assert set(body) == {
        "traceId",
        "outcome",
        "text",
        "changes",
        "question",
        "options",
        "parseWarnings",
    }
    assert error_body("UNAUTHORIZED", "Sign in required.") == {
        "error": {"code": "UNAUTHORIZED", "message": "Sign in required."}
    }
