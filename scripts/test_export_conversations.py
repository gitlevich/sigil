#!/usr/bin/env python3

import json
import shutil
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import export_conversations as exporter


class ExportConversationsTests(unittest.TestCase):
    def patch_exporter_globals(self, **updates) -> None:
        original = {}
        for key, value in updates.items():
            original[key] = getattr(exporter, key)
            setattr(exporter, key, value)

        def restore() -> None:
            for key, value in original.items():
                setattr(exporter, key, value)

        self.addCleanup(restore)

    def write_jsonl(self, rows: list[dict]) -> Path:
        tmpdir = tempfile.TemporaryDirectory()
        self.addCleanup(tmpdir.cleanup)
        path = Path(tmpdir.name) / "session.jsonl"
        with open(path, "w") as handle:
            for row in rows:
                json.dump(row, handle)
                handle.write("\n")
        return path

    def test_extract_claude_turns_keeps_text_and_file_refs(self):
        path = self.write_jsonl(
            [
                {
                    "type": "user",
                    "uuid": "u1",
                    "timestamp": "2026-03-09T00:00:00Z",
                    "message": {
                        "content": [
                            {
                                "type": "tool_use",
                                "name": "Read",
                                "input": {
                                    "file_path": str(exporter.PROJECT_ROOT / "src" / "App.tsx")
                                },
                            },
                            {"type": "text", "text": "hello"},
                        ]
                    },
                },
                {
                    "type": "assistant",
                    "uuid": "a1",
                    "timestamp": "2026-03-09T00:00:01Z",
                    "message": {"content": [{"type": "text", "text": "world"}]},
                },
            ]
        )

        turns = exporter.extract_claude_turns(path)

        self.assertEqual(["hello", "world"], [turn["text"] for turn in turns])
        self.assertEqual(["src/App.tsx"], turns[0]["files"])
        self.assertEqual("u1", turns[0]["id"])
        self.assertEqual("a1", turns[1]["id"])

    def test_extract_codex_turns_ignores_developer_and_keeps_user_assistant(self):
        path = self.write_jsonl(
            [
                {
                    "timestamp": "2026-03-09T00:00:00Z",
                    "type": "session_meta",
                    "payload": {
                        "id": "codex-session-id",
                        "timestamp": "2026-03-09T00:00:00Z",
                        "cwd": str(exporter.PROJECT_ROOT),
                    },
                },
                {
                    "timestamp": "2026-03-09T00:00:01Z",
                    "type": "response_item",
                    "payload": {
                        "type": "message",
                        "role": "developer",
                        "content": [{"type": "input_text", "text": "ignore me"}],
                    },
                },
                {
                    "timestamp": "2026-03-09T00:00:02Z",
                    "type": "response_item",
                    "payload": {
                        "type": "message",
                        "role": "user",
                        "content": [{"type": "input_text", "text": "user text"}],
                    },
                },
                {
                    "timestamp": "2026-03-09T00:00:03Z",
                    "type": "response_item",
                    "payload": {
                        "type": "message",
                        "role": "assistant",
                        "content": [{"type": "output_text", "text": "assistant text"}],
                    },
                },
            ]
        )

        turns = exporter.extract_codex_turns(path)

        self.assertEqual(["user", "assistant"], [turn["role"] for turn in turns])
        self.assertEqual(
            ["user text", "assistant text"],
            [turn["text"] for turn in turns],
        )
        self.assertTrue(all(turn["id"] for turn in turns))

    def test_strip_codex_boilerplate_drops_agents_bootstrap(self):
        text = f"""# AGENTS.md instructions for {exporter.PROJECT_ROOT}

<INSTRUCTIONS>
repo rules
</INSTRUCTIONS>

<environment_context>
cwd info
</environment_context>
"""

        self.assertEqual("", exporter.strip_codex_boilerplate(text))

    def test_strip_codex_boilerplate_keeps_real_user_text_after_bootstrap(self):
        text = f"""# AGENTS.md instructions for {exporter.PROJECT_ROOT}

<INSTRUCTIONS>
repo rules
</INSTRUCTIONS>

<environment_context>
cwd info
</environment_context>

Real user request.
"""

        self.assertEqual(
            "Real user request.",
            exporter.strip_codex_boilerplate(text),
        )

    def test_is_codex_project_session_matches_by_cwd(self):
        matching = self.write_jsonl(
            [
                {
                    "timestamp": "2026-03-09T00:00:00Z",
                    "type": "session_meta",
                    "payload": {"cwd": str(exporter.PROJECT_ROOT)},
                }
            ]
        )
        non_matching = self.write_jsonl(
            [
                {
                    "timestamp": "2026-03-09T00:00:00Z",
                    "type": "session_meta",
                    "payload": {"cwd": "/tmp/not-this-project"},
                }
            ]
        )

        self.assertTrue(exporter.is_codex_project_session(matching))
        self.assertFalse(exporter.is_codex_project_session(non_matching))

    def test_find_claude_session_files_includes_ancestor_workspace_with_project_memory(self):
        temp_root = Path(tempfile.mkdtemp(dir=Path.home()))
        self.addCleanup(shutil.rmtree, temp_root, True)

        workspace = temp_root / "workspace"
        project_root = workspace / "sigil"
        project_root.mkdir(parents=True)

        claude_projects = temp_root / "claude-projects"

        exact_dir = claude_projects / f"-{exporter.project_slug(project_root)}"
        exact_dir.mkdir(parents=True)
        exact_file = exact_dir / "exact.jsonl"
        exact_file.write_text("", encoding="utf-8")

        ancestor_dir = claude_projects / f"-{exporter.project_slug(workspace)}"
        (ancestor_dir / "memory").mkdir(parents=True)
        (ancestor_dir / "memory" / "project_sigil.md").write_text("", encoding="utf-8")
        ancestor_file = ancestor_dir / "ancestor.jsonl"
        ancestor_file.write_text("", encoding="utf-8")

        unrelated_dir = claude_projects / "-unrelated"
        unrelated_dir.mkdir(parents=True)
        (unrelated_dir / "ignored.jsonl").write_text("", encoding="utf-8")

        self.patch_exporter_globals(
            PROJECT_ROOT=project_root,
            PROJECT_ROOT_STR=str(project_root),
            PROJECT_SLUG=exporter.project_slug(project_root),
            CLAUDE_PROJECTS=claude_projects,
        )

        self.assertEqual(
            [exact_file, ancestor_file],
            exporter.find_claude_session_files(),
        )


if __name__ == "__main__":
    unittest.main()
