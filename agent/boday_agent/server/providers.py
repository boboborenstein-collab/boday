from __future__ import annotations

import anthropic
import httpx

from boday_agent.providers.anthropic_provider import AnthropicProvider
from boday_agent.providers.auto import select_provider
from boday_agent.providers.base import Provider
from boday_agent.providers.openai_compat import OpenAICompatProvider
from boday_agent.server.contract import RunSettings
from boday_agent.server.crypto import DecryptError, Encryptor
from boday_agent.server.ssrf import UrlRejected, check_base_url, pinning_transport

_DEFAULT_MODEL = "claude-haiku-5-5"
_KEY_MESSAGE = "The saved API key could not be read. Save it again in Settings."
_URL_MESSAGE = "That URL can't be used."


class ProviderBuildError(Exception):
    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code
        self.message = message


def build_provider(
    settings: RunSettings,
    *,
    user_id: str,
    encryptor: Encryptor | None,
    anthropic_api_key: str | None,
    local_base_url: str | None,
    local_model: str | None,
    cf_access_client_id: str | None,
    cf_access_client_secret: str | None,
    resolve,
    transport_for_tests=None,
) -> tuple[Provider, str]:
    if settings.provider == "claude":
        plaintext = _plaintext(encryptor, settings.key_ciphertext, user_id)
        assert plaintext
        model = settings.model or _DEFAULT_MODEL
        return AnthropicProvider(model, api_key=plaintext), "explicit"
    if settings.provider == "custom":
        pinned = _pin(settings.base_url, resolve)
        plaintext = None
        if settings.key_ciphertext:
            plaintext = _plaintext(encryptor, settings.key_ciphertext, user_id)
            assert plaintext
        transport = transport_for_tests or pinning_transport(pinned)
        return (
            OpenAICompatProvider(
                pinned.base_url,
                settings.model or "",
                api_key=plaintext or None,
                is_local=False,
                transport=transport,
            ),
            "explicit",
        )
    if not local_base_url:
        return _fallback(anthropic_api_key), "auto: local unreachable (not configured)"
    try:
        pinned = check_base_url(local_base_url, resolve=resolve)
    except UrlRejected:
        return _fallback(anthropic_api_key), "auto: local unreachable (url rejected)"
    if transport_for_tests is not None:
        health_transport = transport_for_tests
        local_transport = transport_for_tests
    else:
        health_transport = pinning_transport(pinned)
        local_transport = pinning_transport(pinned)
    local = OpenAICompatProvider(
        local_base_url,
        local_model or "",
        api_key=None,
        is_local=True,
        extra_headers=_cf_headers(cf_access_client_id, cf_access_client_secret),
        transport=local_transport,
    )
    return select_provider(local, _fallback(anthropic_api_key), transport=health_transport)


def probe_connection(
    settings: RunSettings,
    *,
    user_id: str,
    encryptor: Encryptor | None,
    anthropic_api_key: str | None,
    local_base_url: str | None,
    local_model: str | None,
    cf_access_client_id: str | None,
    cf_access_client_secret: str | None,
    resolve,
    transport_for_tests=None,
    anthropic_client=None,
) -> dict:
    if settings.provider == "claude":
        plaintext = _plaintext(encryptor, settings.key_ciphertext, user_id)
        assert plaintext
        model = settings.model or _DEFAULT_MODEL
        client = anthropic_client or anthropic.Anthropic(api_key=plaintext, max_retries=0)
        try:
            client.models.list()
        except Exception:
            return _probe(False, "anthropic", model, "anthropic models endpoint failed")
        return _probe(True, "anthropic", model, "anthropic models endpoint ok")
    if settings.provider == "custom":
        pinned = _pin(settings.base_url, resolve)
        plaintext = None
        if settings.key_ciphertext:
            plaintext = _plaintext(encryptor, settings.key_ciphertext, user_id)
            assert plaintext
        headers = {"Authorization": f"Bearer {plaintext}"} if plaintext else {}
        transport = transport_for_tests or pinning_transport(pinned)
        response = _get(f"{pinned.base_url}/models", transport, headers, 5.0)
        model = settings.model or ""
        if response is None:
            return _probe(False, "openai_compat", model, "models endpoint unreachable")
        if response.status_code == 200:
            return _probe(True, "openai_compat", model, "models endpoint returned 200")
        return _probe(
            False,
            "openai_compat",
            model,
            f"models endpoint returned {response.status_code}",
        )
    if not local_base_url:
        return _probe(
            False,
            "anthropic",
            _DEFAULT_MODEL,
            "auto: local unreachable (not configured)",
        )
    try:
        pinned = check_base_url(local_base_url, resolve=resolve)
    except UrlRejected:
        return _probe(False, "anthropic", _DEFAULT_MODEL, "auto: local unreachable (url rejected)")
    transport = transport_for_tests or pinning_transport(pinned)
    response = _get(
        f"{pinned.base_url}/models",
        transport,
        _cf_headers(cf_access_client_id, cf_access_client_secret),
        2.0,
    )
    if response is not None and response.status_code == 200:
        return _probe(True, "openai_compat", local_model or "", "auto: local reachable")
    if response is None:
        detail = "auto: local unreachable"
    else:
        detail = f"auto: local unreachable (HTTP {response.status_code})"
    return _probe(False, "anthropic", _DEFAULT_MODEL, detail)


def _fallback(api_key: str | None) -> AnthropicProvider:
    return AnthropicProvider(_DEFAULT_MODEL, api_key=api_key)


def _pin(url: str | None, resolve):
    if not url:
        raise ProviderBuildError("URL_REJECTED", _URL_MESSAGE)
    try:
        return check_base_url(url, resolve=resolve)
    except UrlRejected:
        raise ProviderBuildError("URL_REJECTED", _URL_MESSAGE) from None


def _plaintext(encryptor: Encryptor | None, ciphertext: str | None, user_id: str) -> str:
    if encryptor is None or not ciphertext:
        raise ProviderBuildError("KEY_DECRYPT_FAILED", _KEY_MESSAGE)
    try:
        plaintext = encryptor.decrypt(ciphertext, user_id=user_id)
    except DecryptError:
        raise ProviderBuildError("KEY_DECRYPT_FAILED", _KEY_MESSAGE) from None
    assert plaintext
    return plaintext


def _cf_headers(client_id: str | None, client_secret: str | None) -> dict[str, str]:
    headers = {}
    if client_id:
        headers["CF-Access-Client-Id"] = client_id
    if client_secret:
        headers["CF-Access-Client-Secret"] = client_secret
    return headers


def _get(url: str, transport, headers: dict[str, str], timeout_s: float):
    try:
        with httpx.Client(
            transport=transport,
            timeout=timeout_s,
            follow_redirects=False,
        ) as client:
            return client.get(url, headers=headers)
    except Exception:
        return None


def _probe(ok: bool, provider: str, model: str, detail: str) -> dict:
    return {"ok": ok, "provider": provider, "model": model, "detail": detail}
