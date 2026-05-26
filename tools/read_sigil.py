#!/usr/bin/env python3
"""Codex extension for reading Sigils.

Loads a `.sigil` directory as one simultaneous taxonomy field. The default
output is bounded and intended for Codex context, not for end-user export.
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parent.parent
TOOLS_ROOT = REPO_ROOT / "tools"
sys.path.insert(0, TOOLS_ROOT.as_posix())

from sigil_structure_reader import emit_sigil_structure  # noqa: E402


def parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Read a .sigil as an agent-facing structure field.")
    parser.add_argument(
        "sigil_dir",
        nargs="?",
        type=Path,
        default=REPO_ROOT / "specification.sigil",
        help="Path to a .sigil directory; defaults to this repo's specification sigil",
    )
    parser.add_argument(
        "--focus",
        action="append",
        default=[],
        help="Expand exact text around matching node paths, names, or authored text",
    )
    parser.add_argument(
        "--format",
        choices=("agent", "markdown", "json"),
        default="agent",
        help="Output format",
    )
    parser.add_argument(
        "--max-chars",
        type=int,
        default=64000,
        help="Maximum characters for agent output; use 0 for unbounded",
    )
    parser.add_argument("--output", type=Path, help="Write output to this file")
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(sys.argv[1:] if argv is None else argv)
    emit_sigil_structure(
        args.sigil_dir,
        args.output,
        output_format=args.format,
        focus=args.focus,
        max_chars=None if args.max_chars == 0 else args.max_chars,
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
