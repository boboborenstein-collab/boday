import httpx

from boday_agent.providers.auto import select_provider
from boday_agent.providers.fake import FakeProvider
from boday_agent.providers.openai_compat import OpenAICompatProvider


def _local():
    return OpenAICompatProvider(
        "http://mac/v1",
        "qwen",
        extra_headers={"CF-Access-Client-Id": "id", "CF-Access-Client-Secret": "secret"},
    )


def test_auto_picks_local_when_healthy():
    def handler(req):
        assert str(req.url) == "http://mac/v1/models"
        assert req.headers["CF-Access-Client-Id"] == "id"
        assert req.extensions["timeout"]["read"] == 2.0
        return httpx.Response(200, json={"data": []})

    local = _local()
    fallback = FakeProvider([])
    chosen, reason = select_provider(local, fallback, transport=httpx.MockTransport(handler))
    assert chosen is local and reason == "auto: local reachable"


def test_auto_falls_back_on_timeout():
    def handler(req):
        raise httpx.ReadTimeout("slow", request=req)

    local = _local()
    fallback = FakeProvider([])
    chosen, reason = select_provider(local, fallback, transport=httpx.MockTransport(handler))
    assert chosen is fallback and reason.startswith("auto: local unreachable")
    assert "secret" not in reason


def test_auto_falls_back_on_non_200():
    def handler(req):
        return httpx.Response(502)

    local = _local()
    fallback = FakeProvider([])
    chosen, reason = select_provider(local, fallback, transport=httpx.MockTransport(handler))
    assert chosen is fallback and reason.startswith("auto: local unreachable")
    assert "502" in reason
