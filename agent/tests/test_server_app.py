import inspect

import jwt
import pytest
from fastapi.testclient import TestClient

import boday_agent.server.app as app_module
from boday_agent.server.app import create_app
from boday_agent.server.auth import TokenVerifier
from boday_agent.server.contract import error_body
from boday_agent.server.crypto import Encryptor
from boday_agent.server.traces import MemorySink

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


def test_encrypt_without_a_key_is_503():
    client = _client(encryptor=None)
    res = client.post("/encrypt", json={"plaintext": "sk-ant-example"}, headers=_auth())
    assert res.status_code == 503
    assert res.json()["error"]["code"] == "NOT_CONFIGURED"
