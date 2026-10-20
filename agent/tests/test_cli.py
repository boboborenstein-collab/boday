import json
from pathlib import Path
from types import SimpleNamespace

from boday_agent import cli
from boday_agent.providers.fake import FakeProvider, fake_text, fake_tools

EXAMPLE = Path(__file__).resolve().parents[1] / "examples" / "demo_snapshot.json"


def test_cli_prints_result_and_writes_trace(tmp_path, monkeypatch, capsys):
    monkeypatch.setattr(
        cli,
        "make_provider",
        lambda args: (
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
                    fake_text("Moving it to Wednesday."),
                ]
            ),
            "explicit",
        ),
    )
    code = cli.main(
        ["move dentist to tomorrow", "--snapshot", str(EXAMPLE), "--traces-dir", str(tmp_path)]
    )
    out = json.loads(capsys.readouterr().out)
    assert code == 0 and out["outcome"] == "proposed" and Path(out["trace_path"]).exists()


def test_auto_does_not_forward_the_api_key(monkeypatch):
    monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-ant-owner-secret")
    captured = {}
    constructed = []

    def fake_select(local, fallback, **kwargs):
        captured["local"] = local
        captured["fallback"] = fallback
        return fallback, "auto: test"

    def fake_anthropic(model, **kwargs):
        constructed.append(kwargs.get("api_key"))
        return SimpleNamespace(model=model, api_key=kwargs.get("api_key"))

    monkeypatch.setattr(cli, "select_provider", fake_select)
    monkeypatch.setattr(cli, "AnthropicProvider", fake_anthropic)
    args = SimpleNamespace(
        provider="auto",
        model="qwen",
        base_url="http://mac/v1",
        api_key_env="ANTHROPIC_API_KEY",
        header=["CF-Access-Client-Id: id"],
        effort=None,
    )
    cli.make_provider(args)
    assert captured["local"].api_key is None
    assert "sk-ant-owner-secret" not in json.dumps(captured["local"].headers())
    assert constructed == [None]


def test_cli_bad_snapshot_exit_2(tmp_path):
    assert cli.main(["x", "--snapshot", str(tmp_path / "missing.json")]) == 2
