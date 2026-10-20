import pytest

from boday_agent.providers.base import ProviderError, Usage, UserText
from boday_agent.providers.fake import FakeProvider, fake_text, fake_tools


def test_usage_adds():
    assert Usage(input_tokens=1, output_tokens=2) + Usage(input_tokens=3, cache_read_tokens=4) == \
        Usage(input_tokens=4, output_tokens=2, cache_read_tokens=4)


def test_fake_provider_scripts_and_records():
    p = FakeProvider([fake_tools(("search_tasks", {"query": "dentist"})), fake_text("done")])
    r1 = p.complete("sys", [UserText(text="hi")], [], timeout_s=5)
    assert r1.stop_reason == "tool_use" and r1.tool_calls[0].name == "search_tasks"
    assert r1.tool_calls[0].id == "call-1"
    r2 = p.complete("sys", [UserText(text="hi")], [], timeout_s=5)
    assert r2.text == "done" and r2.stop_reason == "end_turn"
    assert len(p.calls) == 2
    with pytest.raises(AssertionError):
        p.complete("sys", [], [], timeout_s=5)


def test_fake_provider_raises_scripted_errors():
    p = FakeProvider([ProviderError("rate limited", retryable=True)])
    with pytest.raises(ProviderError):
        p.complete("sys", [], [], timeout_s=5)
