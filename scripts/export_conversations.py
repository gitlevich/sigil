#!/usr/bin/env python3
"""Export project conversations to readable markdown.

Reads Claude Code session files from ~/.claude/projects/<project-slug>/ and
Codex session files from ~/.codex/sessions/, then writes markdown transcripts
to docs/genesis/. Existing transcripts are appended to, never overwritten.

Usage:
    python scripts/export_conversations.py
"""

import hashlib
import json
import logging
import os
import re
from datetime import datetime
from pathlib import Path

logging.basicConfig(level=logging.INFO, format="%(levelname)s: %(message)s")
log = logging.getLogger(__name__)

PROJECT_ROOT = Path(__file__).resolve().parent.parent
GENESIS_DIR = PROJECT_ROOT / "docs" / "genesis"
STATE_FILE = GENESIS_DIR / ".export_state.json"
CLAUDE_PROJECTS = Path.home() / ".claude" / "projects"
CODEX_SESSIONS = Path.home() / ".codex" / "sessions"

# Derived from the absolute project path, matching Claude Code's convention:
# all path separators, spaces, and underscores become dashes.
PROJECT_SLUG = re.sub(r"[/ _]", "-", str(PROJECT_ROOT)).lstrip("-")


def find_claude_session_dir() -> Path | None:
    """Locate the Claude Code session directory for this project."""
    session_dir = CLAUDE_PROJECTS / f"-{PROJECT_SLUG}"
    if not session_dir.exists():
        session_dir = CLAUDE_PROJECTS / PROJECT_SLUG
    if not session_dir.exists():
        return None
    return session_dir


def find_claude_session_files() -> list[Path]:
    """Return Claude Code session files for this project, if any."""
    session_dir = find_claude_session_dir()
    if session_dir is None:
        return []
    return sorted(session_dir.glob("*.jsonl"))


def is_codex_project_session(jsonl_path: Path) -> bool:
    """Return True when a Codex session belongs to this project root."""
    with open(jsonl_path) as handle:
        for line in handle:
            record = json.loads(line)
            if record.get("type") != "session_meta":
                continue
            payload = record.get("payload", {})
            cwd = payload.get("cwd", "")
            try:
                return str(Path(cwd).resolve()) == PROJECT_ROOT_STR
            except OSError:
                return False
    return False


def find_codex_session_files() -> list[Path]:
    """Return Codex session files whose cwd matches this project root."""
    if not CODEX_SESSIONS.exists():
        return []
    matches = []
    for path in sorted(CODEX_SESSIONS.rglob("*.jsonl")):
        if is_codex_project_session(path):
            matches.append(path)
    return matches


def strip_system_tags(text: str) -> str:
    """Remove system-injected tags from user messages."""
    text = re.sub(
        r"<system-reminder>.*?</system-reminder>",
        "",
        text,
        flags=re.DOTALL,
    )
    text = re.sub(
        r"<ide_opened_file>.*?</ide_opened_file>",
        "",
        text,
        flags=re.DOTALL,
    )
    text = re.sub(
        r"<ide_selection>.*?</ide_selection>",
        "",
        text,
        flags=re.DOTALL,
    )
    return text.strip()


FILE_PATH_TOOLS = {"Read", "Write", "Edit"}
PROJECT_ROOT_STR = str(PROJECT_ROOT)
CODEX_BOOTSTRAP_RE = re.compile(
    r"^# AGENTS\.md instructions for .*?</INSTRUCTIONS>\s*"
    r"(?:<environment_context>.*?</environment_context>\s*)?",
    flags=re.DOTALL,
)


def relativize(path: str) -> str | None:
    """Convert an absolute path to a project-relative path, or None if outside."""
    if path.startswith(PROJECT_ROOT_STR):
        rel = path[len(PROJECT_ROOT_STR) :].lstrip("/")
        return rel if rel else None
    return None


def strip_codex_boilerplate(text: str) -> str:
    """Remove Codex bootstrap scaffolding that is not real conversation."""
    return CODEX_BOOTSTRAP_RE.sub("", text, count=1).strip()


def stable_turn_id(
    source: str,
    session_id: str,
    timestamp: str,
    role: str,
    text: str,
    ordinal: int,
) -> str:
    """Build a stable synthetic turn ID when the source lacks one."""
    key = "\n".join((source, session_id, timestamp, role, str(ordinal), text))
    return hashlib.sha1(key.encode("utf-8")).hexdigest()


def extract_file_refs(content: list[dict]) -> list[str]:
    """Extract project-relative file paths from tool_use blocks."""
    refs = []
    seen = set()
    for block in content:
        if block.get("type") != "tool_use":
            continue
        if block.get("name") not in FILE_PATH_TOOLS:
            continue
        raw = block.get("input", {}).get("file_path", "")
        rel = relativize(raw)
        if rel and rel not in seen:
            refs.append(rel)
            seen.add(rel)
    return refs


def extract_claude_turns(jsonl_path: Path) -> list[dict]:
    """Extract conversation turns from a Claude JSONL session file."""
    turns = []
    pending_files: list[str] = []
    session_id = jsonl_path.stem

    with open(jsonl_path) as handle:
        for ordinal, line in enumerate(handle):
            record = json.loads(line)
            msg_type = record.get("type")
            if msg_type not in ("user", "assistant"):
                continue

            message = record.get("message", {})
            content = message.get("content", [])
            message_id = record.get("uuid", "")
            timestamp = record.get("timestamp", "")

            if not isinstance(content, list):
                continue

            pending_files.extend(extract_file_refs(content))

            text_parts = []
            for block in content:
                if block.get("type") == "text":
                    text_parts.append(block["text"])

            combined = "\n\n".join(text_parts)
            if msg_type == "user":
                combined = strip_system_tags(combined)

            if not combined.strip():
                continue

            seen = set()
            unique_files = []
            for file_path in pending_files:
                if file_path not in seen:
                    unique_files.append(file_path)
                    seen.add(file_path)

            turns.append(
                {
                    "id": message_id
                    or stable_turn_id(
                        "claude",
                        session_id,
                        timestamp,
                        msg_type,
                        combined.strip(),
                        ordinal,
                    ),
                    "role": msg_type,
                    "text": combined.strip(),
                    "timestamp": timestamp,
                    "files": unique_files,
                }
            )
            pending_files = []

    return turns


def extract_codex_turns(jsonl_path: Path) -> list[dict]:
    """Extract user and assistant text turns from a Codex JSONL session."""
    turns = []
    meta = codex_session_metadata(jsonl_path)
    session_id = meta["session_id"]

    with open(jsonl_path) as handle:
        for ordinal, line in enumerate(handle):
            record = json.loads(line)
            if record.get("type") != "response_item":
                continue

            payload = record.get("payload", {})
            if payload.get("type") != "message":
                continue

            role = payload.get("role")
            if role not in ("user", "assistant"):
                continue

            content = payload.get("content", [])
            if not isinstance(content, list):
                continue

            text_parts = []
            for block in content:
                if block.get("type") in {"input_text", "output_text", "text"}:
                    text = block.get("text", "")
                    if text:
                        text_parts.append(text)

            combined = "\n\n".join(text_parts).strip()
            if role == "user":
                combined = strip_codex_boilerplate(combined)
            if not combined:
                continue

            turns.append(
                {
                    "id": stable_turn_id(
                        "codex",
                        session_id,
                        record.get("timestamp", ""),
                        role,
                        combined,
                        ordinal,
                    ),
                    "role": role,
                    "text": combined,
                    "timestamp": record.get("timestamp", ""),
                    "files": [],
                }
            )

    return turns


def claude_session_metadata(jsonl_path: Path) -> dict:
    """Extract session metadata from the first few Claude records."""
    slug = ""
    session_id = jsonl_path.stem
    first_timestamp = ""
    with open(jsonl_path) as handle:
        for line in handle:
            record = json.loads(line)
            if not first_timestamp and record.get("timestamp"):
                first_timestamp = record["timestamp"]
            if not slug and record.get("slug"):
                slug = record["slug"]
            if first_timestamp and slug:
                break
    return {
        "source": "claude",
        "session_id": session_id,
        "slug": slug,
        "first_timestamp": first_timestamp,
    }


def codex_session_metadata(jsonl_path: Path) -> dict:
    """Extract session metadata from the Codex session header."""
    session_id = jsonl_path.stem
    first_timestamp = ""
    with open(jsonl_path) as handle:
        for line in handle:
            record = json.loads(line)
            if record.get("type") != "session_meta":
                continue
            payload = record.get("payload", {})
            session_id = payload.get("id", session_id)
            first_timestamp = payload.get("timestamp", record.get("timestamp", ""))
            break
    return {
        "source": "codex",
        "session_id": session_id,
        "slug": f"codex-{session_id[:8]}",
        "first_timestamp": first_timestamp,
    }


def markdown_filename(meta: dict) -> str:
    """Generate a markdown filename from session metadata."""
    timestamp = meta["first_timestamp"]
    if timestamp:
        dt = datetime.fromisoformat(timestamp.replace("Z", "+00:00"))
        date_str = dt.strftime("%Y-%m-%d_%H%M")
    else:
        date_str = "unknown"

    slug = meta["slug"]
    if slug:
        return f"{date_str}_{slug}.md"
    return f"{date_str}_{meta['session_id'][:8]}.md"


def load_state() -> dict:
    """Load export state tracking which turn ids have been written per session."""
    if not STATE_FILE.exists():
        return {}
    with open(STATE_FILE) as handle:
        return json.load(handle)


def save_state(state: dict) -> None:
    """Persist export state."""
    with open(STATE_FILE, "w") as handle:
        json.dump(state, handle, indent=2)
        handle.write("\n")


def format_turn(turn: dict) -> str:
    """Format a single conversation turn as markdown."""
    role_label = "User" if turn["role"] == "user" else "Assistant"
    timestamp = turn["timestamp"]
    time_str = ""
    if timestamp:
        dt = datetime.fromisoformat(timestamp.replace("Z", "+00:00"))
        time_str = dt.strftime(" (%H:%M UTC)")

    lines = [
        "",
        f"### {role_label}{time_str}",
        "",
    ]

    if turn.get("files"):
        rel_prefix = os.path.relpath(PROJECT_ROOT, GENESIS_DIR)
        links = [f"[{file_path}]({rel_prefix}/{file_path})" for file_path in turn["files"]]
        lines.append(f"*Files: {', '.join(links)}*")
        lines.append("")

    lines.append(turn["text"])
    lines.append("")

    return "\n".join(lines)


def format_header(meta: dict) -> str:
    """Format the markdown file header."""
    timestamp = meta["first_timestamp"]
    if timestamp:
        dt = datetime.fromisoformat(timestamp.replace("Z", "+00:00"))
        date_str = dt.strftime("%Y-%m-%d %H:%M UTC")
    else:
        date_str = "unknown"

    slug = meta["slug"] or meta["session_id"][:8]
    lines = [
        f"# Session: {slug}",
        f"**Date**: {date_str}  ",
        f"**Source**: {meta.get('source', 'unknown').title()}  ",
        f"**Session ID**: `{meta['session_id']}`",
        "",
        "---",
        "",
    ]
    return "\n".join(lines)


def export_session(jsonl_path: Path, state: dict, source: str) -> None:
    """Export a single JSONL session to markdown, appending new turns."""
    if source == "claude":
        meta = claude_session_metadata(jsonl_path)
        turns = extract_claude_turns(jsonl_path)
    elif source == "codex":
        meta = codex_session_metadata(jsonl_path)
        turns = extract_codex_turns(jsonl_path)
    else:
        raise ValueError(f"Unsupported conversation source: {source}")

    filename = markdown_filename(meta)
    markdown_path = GENESIS_DIR / filename

    if not turns:
        log.info("Skipping %s (no conversation content)", jsonl_path.name)
        return

    existing_turn_ids = set(state.get(filename, []))
    new_turns = [turn for turn in turns if turn["id"] not in existing_turn_ids]
    if not new_turns:
        log.info("Up to date: %s", filename)
        return

    is_new_file = not markdown_path.exists() or markdown_path.stat().st_size == 0

    with open(markdown_path, "a") as handle:
        if is_new_file:
            handle.write(format_header(meta))

        for turn in new_turns:
            handle.write(format_turn(turn))

    state[filename] = list(existing_turn_ids | {turn["id"] for turn in new_turns})

    log.info(
        "%s %s (%d new turn%s)",
        "Created" if is_new_file else "Appended to",
        filename,
        len(new_turns),
        "s" if len(new_turns) != 1 else "",
    )


def main() -> None:
    GENESIS_DIR.mkdir(parents=True, exist_ok=True)

    state = load_state()

    claude_files = find_claude_session_files()
    if claude_files:
        log.info("Found %d Claude session(s)", len(claude_files))
        for jsonl_path in claude_files:
            export_session(jsonl_path, state, source="claude")
    else:
        log.info("No Claude session files found for this project")

    codex_files = find_codex_session_files()
    if codex_files:
        log.info("Found %d Codex session(s)", len(codex_files))
        for jsonl_path in codex_files:
            export_session(jsonl_path, state, source="codex")
    else:
        log.info("No Codex session files found for this project")

    save_state(state)


if __name__ == "__main__":
    main()
