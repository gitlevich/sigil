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

    def test_repository_identity_ignores_transport(self):
        self.assertEqual(
            "github.com/gitlevich/sigilatlas",
            exporter.repository_identity("git@github.com:gitlevich/SigilAtlas.git"),
        )
        self.assertEqual(
            "github.com/gitlevich/sigilatlas",
            exporter.repository_identity("https://github.com/gitlevich/SigilAtlas.git"),
        )

    def test_is_codex_project_session_matches_root_and_descendant(self):
        root = self.write_jsonl(
            [
                {
                    "timestamp": "2026-03-09T00:00:00Z",
                    "type": "session_meta",
                    "payload": {"cwd": str(exporter.PROJECT_ROOT)},
                }
            ]
        )
        descendant = self.write_jsonl(
            [
                {
                    "timestamp": "2026-03-09T00:00:00Z",
                    "type": "session_meta",
                    "payload": {"cwd": str(exporter.PROJECT_ROOT / "src")},
                }
            ]
        )
        sibling = self.write_jsonl(
            [
                {
                    "timestamp": "2026-03-09T00:00:00Z",
                    "type": "session_meta",
                    "payload": {"cwd": f"{exporter.PROJECT_ROOT}-other"},
                }
            ]
        )

        self.assertTrue(exporter.is_codex_project_session(root))
        self.assertTrue(exporter.is_codex_project_session(descendant))
        self.assertFalse(exporter.is_codex_project_session(sibling))

    def test_is_codex_project_session_matches_external_worktree_by_repository(self):
        worktree = self.write_jsonl(
            [
                {
                    "timestamp": "2026-03-09T00:00:00Z",
                    "type": "session_meta",
                    "payload": {
                        "cwd": "/missing/codex/worktree/sigil",
                        "git": {
                            "repository_url": "git@github.com:gitlevich/sigil.git"
                        },
                    },
                }
            ]
        )
        self.patch_exporter_globals(
            PROJECT_REPOSITORY_IDENTITIES={"github.com/gitlevich/sigil"}
        )

        self.assertTrue(exporter.is_codex_project_session(worktree))

    def test_find_codex_session_files_includes_active_and_archived_sources(self):
        temp_root = Path(tempfile.mkdtemp())
        self.addCleanup(shutil.rmtree, temp_root, True)
        active_root = temp_root / "sessions"
        archived_root = temp_root / "archived_sessions"
        active_root.mkdir()
        archived_root.mkdir()

        payload = {
            "timestamp": "2026-03-09T00:00:00Z",
            "type": "session_meta",
            "payload": {"cwd": str(exporter.PROJECT_ROOT)},
        }
        active_file = active_root / "active.jsonl"
        archived_file = archived_root / "archived.jsonl"
        active_file.write_text(json.dumps(payload) + "\n", encoding="utf-8")
        archived_file.write_text(json.dumps(payload) + "\n", encoding="utf-8")

        self.patch_exporter_globals(
            CODEX_SESSION_ROOTS=(active_root, archived_root)
        )

        self.assertEqual(
            [active_file, archived_file], exporter.find_codex_session_files()
        )

    def test_markdown_filename_disambiguates_codex_session_collision(self):
        temp_root = Path(tempfile.mkdtemp())
        self.addCleanup(shutil.rmtree, temp_root, True)
        self.patch_exporter_globals(GENESIS_DIR=temp_root)
        meta = {
            "source": "codex",
            "session_id": "01a00b8e-first-session",
            "slug": "codex-01a00b8e",
            "first_timestamp": "2026-08-16T17:11:00Z",
        }
        legacy_path = temp_root / "2026-08-16_1711_codex-01a00b8e.md"
        legacy_path.write_text(
            "# Session\n**Session ID**: `01a00b8e-other-session`\n\n---\n",
            encoding="utf-8",
        )

        self.assertEqual(
            "2026-08-16_1711_codex-01a00b8e-first-session.md",
            exporter.markdown_filename(meta),
        )

        legacy_path.write_text(
            "# Session\n**Session ID**: `01a00b8e-first-session`\n\n---\n",
            encoding="utf-8",
        )
        self.assertEqual(legacy_path.name, exporter.markdown_filename(meta))

        collision_path = (
            temp_root / "2026-08-16_1711_codex-01a00b8e-other-session.md"
        )
        collision_path.write_text(
            "# Session\n**Session ID**: `01a00b8e-other-session`\n\n---\n",
            encoding="utf-8",
        )
        self.assertEqual(
            "2026-08-16_1711_codex-01a00b8e-first-session.md",
            exporter.markdown_filename(meta),
        )

    def test_find_claude_session_files_includes_descendants_and_ancestor_workspace(self):
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

        descendant_dir = claude_projects / f"-{exporter.project_slug(project_root)}-src"
        descendant_dir.mkdir(parents=True)
        descendant_file = descendant_dir / "descendant.jsonl"
        descendant_file.write_text("", encoding="utf-8")

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
            [exact_file, descendant_file, ancestor_file],
            exporter.find_claude_session_files(),
        )


if __name__ == "__main__":
    unittest.main()
