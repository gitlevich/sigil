from __future__ import annotations

import sys
import tempfile
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
TOOLS = ROOT / "tools"
sys.path.insert(0, TOOLS.as_posix())

import read_sigil  # noqa: E402
from sigil_structure_reader import read_sigil_structure, render_sigil_agent_context  # noqa: E402


class SigilStructureReaderTests(unittest.TestCase):
    def test_read_sigil_defaults_to_project_specification(self) -> None:
        args = read_sigil.parse_args([])

        self.assertEqual(args.sigil_dir, ROOT / "specification.sigil")

    def test_reader_loads_tree_and_resolves_local_references(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp) / "sample.sigil"
            child = root / "Child"
            child.mkdir(parents=True)

            (root / "language.md").write_text(
                "# Root\n\nI see @Child, #act, and !stable.\n",
                encoding="utf-8",
            )
            (root / "affordance-act.md").write_text("to do the thing\n", encoding="utf-8")
            (root / "invariant-stable.md").write_text("because it must hold\n", encoding="utf-8")
            (child / "language.md").write_text("# Child\n\nI am here.\n", encoding="utf-8")

            structure = read_sigil_structure(root)
            output = render_sigil_agent_context(structure, focus=["Child"], max_chars=None)

        self.assertEqual(structure.node_count, 2)
        self.assertEqual(sum(1 for ref in structure.references if not ref.targets), 0)
        self.assertIn("### `Child` (match)", output)
        self.assertIn("#act -> `affordance-act.md`", output)


if __name__ == "__main__":
    unittest.main()
