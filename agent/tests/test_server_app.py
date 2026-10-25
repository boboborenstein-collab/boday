import inspect
import json
import logging
import os
import re
import socket
import subprocess
import sys
import time
from pathlib import Path

import httpx
import jwt
import pytest
from fastapi.testclient import TestClient

import boday_agent.server.app as app_module
from boday_agent.providers.base import ProviderError
from boday_agent.providers.fake import FakeProvider, fake_text, fake_tools
from boday_agent.server.app import create_app
from boday_agent.server.auth import TokenVerifier
from boday_agent.server.contract import error_body
from boday_agent.server.crypto import Encryptor
from boday_agent.server.traces import MemorySink
from boday_agent.tracing import Trace

KEY = b"k" * 32

# The HS256 test secret is shorter than PyJWT 2.15 prefers. The signature check is unchanged.
pytestmark = pytest.mark.filterwarnings("ignore::jwt.warnings.InsecureKeyLengthWarning")


def _config(**overrides):
    values = {
        "jwt_secret": "test-secret",
        "admin_email": "bobo.borenstein@gmail.com",
        "allowed_origins": ["http://localhost:5173"],
        "max_body_bytes": 4_194_304,
    }
    values.update(overrides)
    return app_module.ServerConfig(**values)


def _auth(sub="user-1", email="bobo.borenstein@gmail.com"):
    token = jwt.encode(
        {"sub": sub, "aud": "authenticated", "email": email, "exp": 9999999999},
        "test-secret",
        algorithm="HS256",
    )
    return {"Authorization": f"Bearer {token}"}


def _client(**overrides):
    encryptor = overrides.pop("encryptor", Encryptor(KEY))
    sink = overrides.pop("sink", MemorySink())
    app = create_app(
        _config(**overrides),
        sink=sink,
        encryptor=encryptor,
        resolve=lambda host: ["8.8.8.8"],
        verifier=TokenVerifier(hs256_secret="test-secret", jwks_get=None),
    )
    return TestClient(app)


def test_health_requires_a_jwt():
    client = _client()
    assert client.get("/health").status_code == 401
    assert client.get("/health").json() == error_body("UNAUTHORIZED", "Sign in required.")
    ok = client.get("/health", headers=_auth())
    assert ok.status_code == 200 and ok.json() == {"ok": True}


def test_cors_allowlist_and_body_cap():
    client = _client(allowed_origins=["http://localhost:5173"])
    preflight = client.options(
        "/health",
        headers={
            "Origin": "http://localhost:5173",
            "Access-Control-Request-Method": "POST",
            "Access-Control-Request-Headers": "authorization,content-type",
        },
    )
    assert preflight.status_code == 200
    assert preflight.headers["access-control-allow-origin"] == "http://localhost:5173"
    blocked = client.get("/health", headers={**_auth(), "Origin": "https://evil.example"})
    assert "access-control-allow-origin" not in blocked.headers
    too_big = client.post(
        "/encrypt",
        content=b'{"plaintext":"' + b"a" * 4_200_000 + b'"}',
        headers={
            **_auth(),
            "content-type": "application/json",
            "Origin": "http://localhost:5173",
        },
    )
    assert too_big.status_code == 413
    assert too_big.json()["error"]["code"] == "PAYLOAD_TOO_LARGE"
    assert too_big.headers["access-control-allow-origin"] == "http://localhost:5173"
    under = client.post(
        "/encrypt",
        content=b'{"plaintext":"' + b"a" * 3_000_000 + b'"}',
        headers={**_auth(), "content-type": "application/json"},
    )
    assert under.status_code == 400  # past the cap check; rejected by the 500-character rule


def test_unexpected_exception_is_a_contract_500_with_cors(monkeypatch):
    client = _client(allowed_origins=["http://localhost:5173"])

    def boom(*args, **kwargs):
        raise RuntimeError("leaked sk-ant-example")

    monkeypatch.setattr(app_module.Encryptor, "encrypt", boom)
    res = client.post(
        "/encrypt",
        json={"plaintext": "x"},
        headers={**_auth(), "Origin": "http://localhost:5173"},
    )
    assert res.status_code == 500
    assert res.json() == error_body("INTERNAL_ERROR", "Something went wrong. Try again.")
    assert res.headers["access-control-allow-origin"] == "http://localhost:5173"
    assert "sk-ant-example" not in res.text and "RuntimeError" not in res.text


def test_every_route_handler_is_sync():
    app = create_app(
        _config(),
        sink=MemorySink(),
        encryptor=Encryptor(KEY),
        resolve=lambda host: ["8.8.8.8"],
    )
    paths = {"/health", "/encrypt", "/agent/run", "/feedback", "/agent/test"}
    endpoints = [route.endpoint for route in app.routes if getattr(route, "path", "") in paths]
    assert endpoints and not any(inspect.iscoroutinefunction(endpoint) for endpoint in endpoints)


def test_encrypt_returns_ciphertext_and_logs_no_plaintext(caplog):
    client = _client()
    res = client.post("/encrypt", json={"plaintext": "sk-ant-example"}, headers=_auth())
    assert res.status_code == 200
    token = res.json()["ciphertext"]
    assert "sk-ant-example" not in token
    assert "sk-ant-example" not in caplog.text
    assert Encryptor(KEY).decrypt(token, user_id="user-1") == "sk-ant-example"
    bad = client.post("/encrypt", json={"plaintext": ""}, headers=_auth())
    assert bad.status_code == 400
    assert bad.json() == error_body(
        "INVALID_REQUEST",
        "Check the message, snapshot, and model settings.",
    )
    assert "detail" not in bad.json()


def test_importing_the_app_registers_the_tools():
    # uvicorn imports the app, not the test conftest. The registry starts empty.
    code = (
        "import boday_agent.server.app\n"
        "from boday_agent.tools.registry import REGISTRY\n"
        "assert 'search_tasks' in REGISTRY and 'propose_update_task' in REGISTRY\n"
    )
    completed = subprocess.run([sys.executable, "-c", code], capture_output=True, text=True)
    assert completed.returncode == 0, completed.stderr


def test_encrypt_without_a_key_is_503():
    client = _client(encryptor=None)
    res = client.post("/encrypt", json={"plaintext": "sk-ant-example"}, headers=_auth())
    assert res.status_code == 503
    assert res.json()["error"]["code"] == "NOT_CONFIGURED"


def _run_body():
    return json.loads(Path("tests/fixtures/api_contract_run.json").read_text())


def _demo_snapshot():
    demo = json.loads(Path("examples/demo_snapshot.json").read_text())
    demo["now"] = "2026-10-21T18:00:00Z"
    return demo


def test_run_returns_the_draft_and_writes_a_trace(monkeypatch):
    sink = MemorySink()
    client = _client(sink=sink)
    body = _run_body()
    monkeypatch.setattr(
        app_module,
        "build_provider",
        lambda *a, **k: (
            FakeProvider(
                [
                    fake_tools(("search_tasks", {"query": "dentist"})),
                    fake_tools(
                        (
                            "propose_update_task",
                            {
                                "task_id": "dentist",
                                "changes": {"scheduled_date": "2026-10-21"},
                            },
                        )
                    ),
                    fake_text("Moved dentist to Wednesday."),
                ]
            ),
            "explicit",
        ),
    )
    body["snapshot"] = _demo_snapshot()
    res = client.post("/agent/run", json=body, headers=_auth())
    assert res.status_code == 200
    payload = res.json()
    assert payload["outcome"] == "proposed" and payload["changes"][0]["op"] == "update"
    assert payload["changes"][0]["patch"] == {"scheduledDate": "2026-10-21"}
    row = sink.rows[payload["traceId"]]
    assert row["user_id"] == "user-1"
    assert "snapshot_hash" in row["data"]["request"] and "tasks" not in row["data"]["request"]


def test_provider_failure_is_http_200_and_fail_closed(monkeypatch):
    sink = MemorySink()
    client = _client(sink=sink)
    body = _run_body()
    fake = FakeProvider([ProviderError("bad key sk-ant-example", retryable=False)])
    monkeypatch.setattr(app_module, "build_provider", lambda *a, **k: (fake, "explicit"))
    res = client.post("/agent/run", json=body, headers=_auth())
    assert res.status_code == 200
    assert res.json()["outcome"] == "failed" and res.json()["changes"] == []
    assert "sk-ant-example" not in res.text
    blob = json.dumps(sink.rows[res.json()["traceId"]])
    assert "sk-ant-example" not in blob


def test_non_owner_auto_does_not_build_a_provider(monkeypatch):
    sink = MemorySink()
    client = _client(sink=sink)
    body = _run_body()

    def boom(*args, **kwargs):
        raise AssertionError("provider built")

    monkeypatch.setattr(app_module, "build_provider", boom)
    auto = {
        **body,
        "settings": {"provider": "auto", "model": None, "baseUrl": None, "keyCiphertext": None},
    }
    res = client.post("/agent/run", json=auto, headers=_auth(email="friend@example.com"))
    assert res.status_code == 403 and res.json()["error"]["code"] == "AUTO_OWNER_ONLY"
    assert sink.rows == {}


def test_snapshot_must_be_an_object_and_a_bad_task_is_a_warning(monkeypatch):
    sink = MemorySink()
    client = _client(sink=sink)
    body = _run_body()
    res = client.post("/agent/run", json={**body, "snapshot": []}, headers=_auth())
    assert res.status_code == 400 and res.json()["error"]["code"] == "INVALID_REQUEST"
    warned = {**body, "snapshot": {**body["snapshot"], "tasks": [{"id": "bad"}]}}
    monkeypatch.setattr(
        app_module,
        "build_provider",
        lambda *a, **k: (FakeProvider([fake_text("Nothing to change.")]), "explicit"),
    )
    res = client.post("/agent/run", json=warned, headers=_auth())
    assert res.status_code == 200 and res.json()["outcome"] == "answered"
    assert any(item.startswith("skipped task 'bad'") for item in res.json()["parseWarnings"])


def test_trace_write_failure_returns_no_changes(monkeypatch):
    body = _run_body()

    class DeadSink(MemorySink):
        def write(self, trace, user_id):
            raise OSError("dsn=postgres://agent_tracer:secret@db.example/postgres")

    client = _client(sink=DeadSink())
    monkeypatch.setattr(
        app_module,
        "build_provider",
        lambda *a, **k: (FakeProvider([fake_text("Moved it.")]), "explicit"),
    )
    res = client.post("/agent/run", json=body, headers=_auth())
    assert res.status_code == 500
    assert res.json() == error_body("TRACE_WRITE_FAILED", "Could not record the trace.")
    assert "changes" not in res.json() and "secret" not in res.text and "postgres" not in res.text


def test_asked_returns_no_changes(monkeypatch):
    sink = MemorySink()
    client = _client(sink=sink)
    body = _run_body()
    monkeypatch.setattr(
        app_module,
        "build_provider",
        lambda *a, **k: (
            FakeProvider(
                [
                    fake_tools(
                        ("ask_user", {"question": "Which one?", "options": ["Dentist", "Doctor"]})
                    ),
                ]
            ),
            "explicit",
        ),
    )
    res = client.post("/agent/run", json=body, headers=_auth())
    assert res.status_code == 200
    assert res.json()["outcome"] == "asked" and res.json()["changes"] == []
    assert res.json()["question"] == "Which one?" and res.json()["options"] == ["Dentist", "Doctor"]


def test_null_before_field_survives_the_response(monkeypatch):
    sink = MemorySink()
    client = _client(sink=sink)
    body = _run_body()
    monkeypatch.setattr(
        app_module,
        "build_provider",
        lambda *a, **k: (
            FakeProvider(
                [
                    fake_tools(("search_tasks", {"query": "standup"})),
                    fake_tools(
                        (
                            "propose_update_task",
                            {"task_id": "standup", "changes": {"end_date": "2026-12-31"}},
                        )
                    ),
                    fake_text("Ends on Dec 31."),
                ]
            ),
            "explicit",
        ),
    )
    res = client.post("/agent/run", json={**body, "snapshot": _demo_snapshot()}, headers=_auth())
    change = res.json()["changes"][0]
    assert change["patch"] == {"endDate": "2026-12-31"}
    assert "endDate" in change["beforeFields"] and change["beforeFields"]["endDate"] is None


def test_other_users_ciphertext_is_rejected(caplog):
    sink = MemorySink()
    client = _client(sink=sink)
    body = _run_body()
    enc = Encryptor(KEY)
    stolen = {
        **body,
        "settings": {
            "provider": "claude",
            "model": "claude-haiku-5-5",
            "baseUrl": None,
            "keyCiphertext": enc.encrypt("sk-ant-example", user_id="user-1"),
        },
    }
    res = client.post(
        "/agent/run",
        json=stolen,
        headers=_auth(sub="user-2", email="friend@example.com"),
    )
    assert res.status_code == 400 and res.json()["error"]["code"] == "KEY_DECRYPT_FAILED"
    assert "sk-ant-example" not in caplog.text and sink.rows == {}


def _trace(run_id):
    return Trace(
        run_id=run_id,
        started_at="2026-10-21T18:00:00Z",
        provider={},
        selection_reason="explicit",
        prompt_version="abc",
        request={},
    )


def test_feedback_appends_for_the_owner_only():
    sink = MemorySink()
    sink.write(_trace("run-1"), "user-1")
    client = _client(sink=sink)
    res = client.post(
        "/feedback",
        json={"runId": "run-1", "event": "approve", "taskIds": ["dentist"]},
        headers=_auth(),
    )
    assert res.status_code == 200 and res.json() == {"ok": True}
    saved = sink.rows["run-1"]["data"]["feedback"][0]
    assert saved["event"] == "approve"
    assert saved["taskIds"] == ["dentist"]
    assert re.fullmatch(r"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z", saved["at"])
    other = client.post(
        "/feedback",
        json={"runId": "run-1", "event": "undo", "taskIds": ["dentist"]},
        headers=_auth(sub="user-2", email="friend@example.com"),
    )
    assert other.status_code == 404 and other.json()["error"]["message"] == "Trace not found."
    assert [item["event"] for item in sink.rows["run-1"]["data"]["feedback"]] == ["approve"]
    missing = client.post(
        "/feedback",
        json={"runId": "nope", "event": "reject", "taskIds": []},
        headers=_auth(),
    )
    assert missing.status_code == 404


def test_agent_test_reports_the_mac_without_a_trace(monkeypatch):
    sink = MemorySink()
    client = _client(sink=sink)
    monkeypatch.setattr(
        app_module,
        "probe_connection",
        lambda *a, **k: {
            "ok": False,
            "provider": "anthropic",
            "model": "claude-haiku-5-5",
            "detail": "auto: local unreachable (not configured)",
        },
    )
    body = {
        "settings": {"provider": "auto", "model": None, "baseUrl": None, "keyCiphertext": None}
    }
    res = client.post("/agent/test", json=body, headers=_auth())
    assert res.status_code == 200 and res.json()["ok"] is False
    assert sink.rows == {}
    forbidden = client.post("/agent/test", json=body, headers=_auth(email="friend@example.com"))
    assert forbidden.status_code == 403


def test_request_log_line_names_the_user(caplog):
    caplog.set_level(logging.INFO, logger="boday_agent.server")
    client = _client()
    assert client.get("/health", headers=_auth(sub="user-7")).status_code == 200
    lines = [r.getMessage() for r in caplog.records if r.name == "boday_agent.server"]
    assert "GET /health 200 user-7" in lines


def test_request_log_line_shows_under_uvicorn_default_logging(tmp_path):
    # uvicorn configures only its own loggers; the root logger stays at WARNING.
    with socket.socket() as probe:
        probe.bind(("127.0.0.1", 0))
        port = probe.getsockname()[1]
    env = {**os.environ, "SUPABASE_JWT_SECRET": "test-secret"}
    for name in ("AGENT_TRACES_DSN", "SUPABASE_JWKS_URL"):
        env.pop(name, None)
    err = (tmp_path / "stderr.txt").open("w+")
    proc = subprocess.Popen(
        [sys.executable, "-m", "uvicorn", "--factory",
         "boday_agent.server.app:app_from_env", "--port", str(port)],
        stdout=subprocess.DEVNULL, stderr=err, env=env,
    )
    try:
        deadline = time.monotonic() + 20
        while True:
            try:
                status = httpx.get(f"http://127.0.0.1:{port}/health", timeout=1).status_code
                break
            except httpx.TransportError:
                assert time.monotonic() < deadline, "uvicorn did not start"
                time.sleep(0.2)
        assert status == 401
    finally:
        proc.terminate()
        proc.wait(timeout=10)
    err.seek(0)
    assert re.search(r"GET /health 401 -", err.read())


@pytest.mark.parametrize("where", ["message", "history"])
def test_a_nul_in_the_text_is_400_before_any_model_call(monkeypatch, where):
    # Postgres jsonb cannot store \u0000, so the trace write would fail after the paid run.
    def boom(*args, **kwargs):
        raise AssertionError("provider built")

    monkeypatch.setattr(app_module, "build_provider", boom)
    body = _run_body()
    if where == "message":
        body["message"] = "move it\x00"
    else:
        body["history"] = [{"role": "user", "text": "hi\x00"}]
    res = _client().post("/agent/run", json=body, headers=_auth())
    assert res.status_code == 400
    assert res.json() == error_body(
        "INVALID_REQUEST",
        "Check the message, snapshot, and model settings.",
    )


def test_unknown_path_and_method_are_route_not_found():
    client = _client(allowed_origins=["http://localhost:5173"])
    origin = {"Origin": "http://localhost:5173"}
    expected = error_body("ROUTE_NOT_FOUND", "Something went wrong. Try again.")

    missing = client.get("/nope", headers=origin)
    assert missing.status_code == 404
    assert missing.json() == expected
    assert "detail" not in missing.json()
    assert missing.headers["access-control-allow-origin"] == "http://localhost:5173"

    wrong = client.get("/agent/run", headers=origin)
    assert wrong.status_code == 405
    assert wrong.json() == expected
    assert "detail" not in wrong.json()
    assert wrong.headers["access-control-allow-origin"] == "http://localhost:5173"

    doubled = client.post(
        "//agent/run",
        content=b"{}",
        headers={**origin, "content-type": "application/json"},
    )
    assert doubled.status_code == 404
    assert doubled.json() == expected
    assert "detail" not in doubled.json()
    assert doubled.headers["access-control-allow-origin"] == "http://localhost:5173"


def test_an_http_exception_does_not_return_a_detail_body():
    from starlette.exceptions import HTTPException

    app = create_app(
        _config(allowed_origins=["http://localhost:5173"]),
        sink=MemorySink(),
        encryptor=Encryptor(KEY),
        resolve=lambda host: ["8.8.8.8"],
        verifier=TokenVerifier(hs256_secret="test-secret", jwks_get=None),
    )

    @app.get("/probe-http-exception")
    def probe_http_exception():
        raise HTTPException(status_code=400, detail="leaked sk-ant-example")

    client = TestClient(app)
    res = client.get(
        "/probe-http-exception",
        headers={"Origin": "http://localhost:5173"},
    )
    assert res.status_code == 400
    assert "detail" not in res.json()
    assert "sk-ant-example" not in res.text
    assert res.json() == error_body(
        "INVALID_REQUEST",
        "Check the message, snapshot, and model settings.",
    )
    assert res.headers["access-control-allow-origin"] == "http://localhost:5173"
