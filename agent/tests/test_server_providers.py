import httpx
import pytest

from boday_agent.server.contract import RunSettings
from boday_agent.server.crypto import Encryptor
from boday_agent.server.providers import ProviderBuildError, build_provider, probe_connection


def _kw(**overrides):
    args = {
        "user_id": "u",
        "encryptor": None,
        "anthropic_api_key": None,
        "local_base_url": None,
        "local_model": None,
        "cf_access_client_id": None,
        "cf_access_client_secret": None,
        "resolve": lambda host: ["8.8.8.8"],
    }
    args.update(overrides)
    return args


def test_claude_uses_only_this_users_key():
    enc = Encryptor(b"k" * 32)
    settings = RunSettings(
        provider="claude",
        model="claude-sonnet-5-5",
        key_ciphertext=enc.encrypt("sk-ant-example", user_id="user-a"),
    )
    provider, reason = build_provider(
        settings,
        user_id="user-a",
        encryptor=enc,
        anthropic_api_key="server-key",
        local_base_url=None,
        local_model=None,
        cf_access_client_id=None,
        cf_access_client_secret=None,
        resolve=lambda h: [],
    )
    assert reason == "explicit"
    assert provider.model == "claude-sonnet-5-5"
    assert provider.client.api_key == "sk-ant-example"
    with pytest.raises(ProviderBuildError) as exc:
        build_provider(
            settings,
            user_id="user-b",
            encryptor=enc,
            anthropic_api_key="server-key",
            local_base_url=None,
            local_model=None,
            cf_access_client_id=None,
            cf_access_client_secret=None,
            resolve=lambda h: [],
        )
    assert exc.value.code == "KEY_DECRYPT_FAILED"


def test_custom_is_not_local_and_rejects_http():
    settings = RunSettings(provider="custom", model="m", base_url="http://llm.example/v1")
    with pytest.raises(ProviderBuildError) as exc:
        build_provider(settings, **_kw())
    assert exc.value.code == "URL_REJECTED"
    ok = RunSettings(provider="custom", model="m", base_url="https://llm.example/v1")
    provider, _reason = build_provider(ok, **_kw())
    assert provider.is_local is False and provider.model == "m"


def test_auto_checks_the_server_url_and_does_not_send_the_user_key():
    seen = {}

    def handler(request):
        seen["headers"] = dict(request.headers)
        seen["url"] = str(request.url)
        return httpx.Response(200, json={"data": []})

    settings = RunSettings(
        provider="auto",
        model="ignored",
        base_url="https://evil.example/v1",
        key_ciphertext="not-used",
    )
    provider, reason = build_provider(
        settings,
        user_id="owner",
        encryptor=None,
        anthropic_api_key="server-key",
        local_base_url="https://llm.example/v1",
        local_model="local-model",
        cf_access_client_id="cf-id",
        cf_access_client_secret="cf-secret",
        resolve=lambda h: ["8.8.8.8"],
        transport_for_tests=httpx.MockTransport(handler),
    )
    assert reason == "auto: local reachable"
    assert provider.is_local is True and provider.model == "local-model"
    assert seen["headers"].get("cf-access-client-id") == "cf-id"
    assert "authorization" not in {k.lower() for k in seen["headers"]}
    assert "evil.example" not in seen["url"]


def test_probe_never_posts_a_completion():
    calls = []

    def handler(request):
        calls.append((request.method, request.url.path))
        return httpx.Response(200, json={"data": []})

    settings = RunSettings(provider="custom", model="m", base_url="https://llm.example/v1")
    out = probe_connection(
        settings,
        transport_for_tests=httpx.MockTransport(handler),
        **_kw(),
    )
    assert out["ok"] is True and out["detail"] == "models endpoint returned 200"
    # {base}/models with base https://llm.example/v1. httpx reports the full path.
    assert calls == [("GET", "/v1/models")]


def test_auto_without_a_local_url_falls_back_to_anthropic():
    settings = RunSettings(provider="auto", model="ignored", base_url="https://evil.example/v1")
    provider, reason = build_provider(
        settings,
        **_kw(user_id="owner", anthropic_api_key="server-key"),
    )
    assert reason.startswith("auto: local unreachable")
    assert provider.model == "claude-haiku-5-5"
    assert provider.client.api_key == "server-key"
    assert provider.is_local is False


def test_claude_probe_lists_models_and_does_not_create_a_message():
    enc = Encryptor(b"k" * 32)
    settings = RunSettings(
        provider="claude",
        model=None,
        key_ciphertext=enc.encrypt("sk-ant-example", user_id="user-a"),
    )
    calls = []

    class _Models:
        def list(self):
            calls.append("list")
            return object()

    class _Messages:
        def create(self, **kwargs):
            calls.append("create")
            raise AssertionError("messages.create")

    class _Stub:
        def __init__(self):
            self.models = _Models()
            self.messages = _Messages()

    out = probe_connection(
        settings,
        anthropic_client=_Stub(),
        **_kw(
            user_id="user-a",
            encryptor=enc,
            anthropic_api_key="server-key",
            resolve=lambda h: [],
        ),
    )
    assert out == {
        "ok": True,
        "provider": "anthropic",
        "model": "claude-haiku-5-5",
        "detail": "anthropic models endpoint ok",
    }
    assert calls == ["list"]


def test_claude_probe_gives_up_after_10s(monkeypatch):
    # The SDK's default timeout is 600s, which would hold a thread-pool worker.
    import anthropic

    from boday_agent.server import providers

    real = anthropic.Anthropic
    made = []

    def spy(**kwargs):
        client = real(**kwargs)
        client.models.list = lambda: object()  # no network
        made.append(client)
        return client

    monkeypatch.setattr(providers.anthropic, "Anthropic", spy)
    enc = Encryptor(b"k" * 32)
    settings = RunSettings(
        provider="claude",
        key_ciphertext=enc.encrypt("sk-ant-example", user_id="user-a"),
    )
    out = probe_connection(settings, **_kw(user_id="user-a", encryptor=enc))
    assert out["ok"] is True
    assert made[0].timeout == 10.0 and made[0].max_retries == 0


def _auto_local(**overrides):
    settings = RunSettings(provider="auto", model="ignored")
    transport = httpx.MockTransport(lambda request: httpx.Response(200, json={"data": []}))
    return build_provider(
        settings,
        transport_for_tests=transport,
        **_kw(
            user_id="owner",
            anthropic_api_key="server-key",
            local_base_url="https://llm.example/v1",
            local_model="local-model",
            **overrides,
        ),
    )


def test_auto_local_turns_thinking_off_by_default():
    provider, _reason = _auto_local()
    assert provider.is_local is True
    assert provider.reasoning_effort == "none"


def test_auto_local_effort_is_configurable():
    provider, _reason = _auto_local(local_effort="low")
    assert provider.reasoning_effort == "low"
    provider, _reason = _auto_local(local_effort=None)
    assert provider.reasoning_effort is None
