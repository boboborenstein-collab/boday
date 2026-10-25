import gzip
import json
import socket
import time

import httpx
import pytest

from boday_agent.domain.models import Snapshot
from boday_agent.loop import AgentRequest, run_agent
from boday_agent.providers.base import ProviderError, UserText
from boday_agent.providers.openai_compat import OpenAICompatProvider
from boday_agent.server.ssrf import (
    CappedTransport,
    PinnedBackend,
    ResponseTooLarge,
    UrlRejected,
    check_base_url,
    pinning_transport,
)

PUBLIC = "8.8.8.8"  # a truly global address; resolve is stubbed, so no socket opens


def test_pins_a_public_https_host_and_a_public_ip_literal():
    pinned = check_base_url("https://llm.example/v1", resolve=lambda host: [PUBLIC])
    assert (pinned.ip, pinned.host, pinned.port, pinned.base_url) == (
        PUBLIC,
        "llm.example",
        443,
        "https://llm.example/v1",
    )
    pinned = check_base_url("https://llm.example:8443/v1/", resolve=lambda host: [PUBLIC])
    assert pinned.port == 8443 and pinned.base_url == "https://llm.example:8443/v1"
    pinned = check_base_url(
        f"https://{PUBLIC}/v1",
        resolve=lambda host: (_ for _ in ()).throw(AssertionError(host)),
    )
    assert pinned.ip == PUBLIC


@pytest.mark.parametrize(
    ("url", "ips"),
    [
        ("http://llm.example/v1", [PUBLIC]),
        ("ftp://llm.example/v1", [PUBLIC]),
        ("https://user:pass@llm.example/v1", [PUBLIC]),
        ("https://127.0.0.1/v1", None),
        ("https://10.0.0.8/v1", None),
        ("https://192.168.0.2/v1", None),
        ("https://172.16.5.5/v1", None),
        ("https://169.254.169.254/", None),
        ("https://100.64.0.1/v1", None),
        ("https://0.0.0.0/", None),
        ("https://224.0.0.1/", None),
        ("https://2130706433/", None),
        ("https://metadata.google.internal/", [PUBLIC]),
        ("https://localhost/v1", ["127.0.0.1"]),
        ("https://llm.example/v1", ["10.1.2.3"]),
        ("https://llm.example/v1", ["169.254.1.1"]),
        ("https://llm.example/v1", ["::1"]),
        ("https://llm.example/v1", ["fe80::1"]),
        ("https://llm.example/v1", ["fd00::1"]),
        ("https://llm.example/v1", ["::ffff:127.0.0.1"]),
        ("https://llm.example/v1", ["::ffff:169.254.169.254"]),
        ("https://llm.example/v1", ["64:ff9b::a00:1"]),
        ("https://llm.example/v1", ["64:ff9b::a9fe:a9fe"]),
        ("https://llm.example/v1", ["2002:a00:1::"]),
        ("https://llm.example/v1", ["::127.0.0.1"]),  # IPv4-compatible, ::/96
        ("https://llm.example/v1", ["::a9fe:a9fe"]),  # IPv4-compatible 169.254.169.254
        ("https://llm.example/v1", ["64:ff9b:1::808:808"]),  # local-use NAT64, /48
        ("https://llm.example/v1", ["203.0.113.10"]),
        ("https://llm.example/v1", ["198.18.0.1"]),
        ("https://llm.example/v1", ["240.0.0.1"]),
        ("https://llm.example/v1", [PUBLIC, "10.0.0.1"]),
        ("https://llm.example/v1", []),
    ],
)
def test_rejects(url, ips):
    def resolve(host):
        if ips is None:
            raise AssertionError(f"should not resolve {host}")
        return ips

    with pytest.raises(UrlRejected, match="url rejected"):
        check_base_url(url, resolve=resolve)


def test_slow_resolver_is_rejected():
    def slow(host):
        time.sleep(5)
        return ["8.8.8.8"]

    with pytest.raises(UrlRejected):
        check_base_url("https://llm.example/v1", resolve=slow, resolve_timeout_s=0.01)


def test_redirect_is_not_followed():
    calls = []

    def handler(request):
        calls.append(str(request.url))
        return httpx.Response(302, headers={"location": "http://169.254.169.254/"})

    provider = OpenAICompatProvider(
        "https://llm.example/v1",
        "m",
        is_local=False,
        transport=httpx.MockTransport(handler),
    )
    with pytest.raises(ProviderError):
        provider.complete("sys", [UserText(text="hi")], [], timeout_s=5)
    assert len(calls) == 1


def test_transport_connects_to_the_pinned_ip(monkeypatch):
    seen = {}

    def fake_create_connection(address, *args, **kwargs):
        seen["address"] = address
        raise OSError("stop")

    monkeypatch.setattr(socket, "create_connection", fake_create_connection)
    pinned = check_base_url("https://llm.example/v1", resolve=lambda host: [PUBLIC])
    transport = pinning_transport(pinned)
    with httpx.Client(transport=transport, follow_redirects=False) as client:
        with pytest.raises(httpx.HTTPError):
            client.get("https://llm.example/v1/models")
    assert seen["address"][0] == PUBLIC
    assert seen["address"][0] != "llm.example"


def test_one_transport_serves_every_model_call_of_a_run(monkeypatch):
    seen = []

    def fake_create_connection(address, *args, **kwargs):
        seen.append(address[0])
        raise OSError("stop")

    monkeypatch.setattr(socket, "create_connection", fake_create_connection)
    pinned = check_base_url("https://llm.example/v1", resolve=lambda host: [PUBLIC])
    provider = OpenAICompatProvider(
        pinned.base_url,
        "m",
        is_local=False,
        transport=pinning_transport(pinned),
        sleep=lambda s: None,
    )
    for _ in range(2):
        with pytest.raises(ProviderError):
            provider.complete("sys", [UserText(text="hi")], [], timeout_s=5)
    assert len(seen) >= 2 and set(seen) == {PUBLIC}


def test_response_body_is_capped():
    big = b"x" * 64
    capped = CappedTransport(
        httpx.MockTransport(lambda r: httpx.Response(200, content=big)),
        max_bytes=10,
    )
    with httpx.Client(transport=capped) as client:
        with pytest.raises(ResponseTooLarge, match="response too large"):
            client.get("https://llm.example/v1/models")

    def chunked(request):
        return httpx.Response(
            200,
            stream=httpx.ByteStream(big),
            headers={"transfer-encoding": "chunked"},
        )

    chunked_cap = CappedTransport(httpx.MockTransport(chunked), max_bytes=10)
    with httpx.Client(transport=chunked_cap) as client:
        with pytest.raises(ResponseTooLarge):
            client.get("https://llm.example/v1/models")
    ok = CappedTransport(
        httpx.MockTransport(lambda r: httpx.Response(200, json={"data": []})),
        max_bytes=1000,
    )
    with httpx.Client(transport=ok) as client:
        assert client.get("https://llm.example/v1/models").json() == {"data": []}


def test_gzip_body_is_rejected_before_it_expands():
    raw = b"x" * 200_000
    compressed = gzip.compress(raw)
    assert len(compressed) < 1_000

    def handler(request):
        return httpx.Response(
            200,
            content=compressed,
            headers={"content-encoding": "gzip"},
        )

    capped = CappedTransport(httpx.MockTransport(handler), max_bytes=10_000)
    with httpx.Client(transport=capped) as client:
        with pytest.raises(ResponseTooLarge, match="response too large"):
            client.get("https://llm.example/v1/models")


def test_gzip_bomb_fails_the_run_closed():
    payload = json.dumps(
        {
            "choices": [
                {
                    "message": {"content": "x" * 200_000},
                    "finish_reason": "stop",
                }
            ]
        }
    ).encode()
    compressed = gzip.compress(payload)
    assert len(compressed) < 10_000

    def handler(request):
        return httpx.Response(
            200,
            content=compressed,
            headers={"content-encoding": "gzip"},
        )

    provider = OpenAICompatProvider(
        "https://llm.example/v1",
        "m",
        is_local=False,
        transport=CappedTransport(httpx.MockTransport(handler), max_bytes=10_000),
        sleep=lambda seconds: None,
    )
    snapshot = Snapshot.from_app(
        {
            "tasks": [],
            "completions": [],
            "quietWindows": [],
            "now": "2026-10-21T18:00:00Z",
            "timezone": "America/New_York",
        }
    )
    result = run_agent(
        AgentRequest(message="what is on today", snapshot=snapshot),
        provider,
    )
    assert result.outcome == "failed"
    assert result.changes == []
    assert "x" * 100 not in result.text


def test_backend_refuses_a_different_host():
    pinned = check_base_url("https://llm.example/v1", resolve=lambda host: [PUBLIC])
    with pytest.raises(UrlRejected):
        PinnedBackend(pinned).connect_tcp("evil.example", 443)


def test_pins_an_ipv4_address_when_dns_returns_both_families():
    # Cloud Run has no IPv6 egress by default, so an AAAA-first answer must not win.
    v6 = "2606:4700:4700::1111"
    pinned = check_base_url("https://llm.example/v1", resolve=lambda host: [v6, PUBLIC])
    assert pinned.ip == PUBLIC
    pinned = check_base_url("https://llm.example/v1", resolve=lambda host: [v6])
    assert pinned.ip == v6
    with pytest.raises(UrlRejected):
        check_base_url("https://llm.example/v1", resolve=lambda host: [PUBLIC, "fd00::1"])
