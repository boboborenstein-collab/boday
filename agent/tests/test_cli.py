import json
from pathlib import Path

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


def test_cli_bad_snapshot_exit_2(tmp_path):
    assert cli.main(["x", "--snapshot", str(tmp_path / "missing.json")]) == 2
