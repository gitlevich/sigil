"""Structured reader for `.sigil` taxonomy trees.

A Sigil specification is stored as many small files, but it reads as one
taxonomy. This module loads the directory tree into a single structure that
preserves hierarchy, authored ordering, local text, and references.
"""

from __future__ import annotations

import json
import re
import sys
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any


PRIVATE_DIR_NAMES = {".private", ".sigil"}
IGNORED_FILE_NAMES = {".DS_Store"}
REFERENCE_RE = re.compile(r"(?<![A-Za-z0-9_])([@#!])([A-Za-z][A-Za-z0-9_-]*)")
FENCED_CODE_RE = re.compile(r"```.*?```", re.DOTALL)
INLINE_CODE_RE = re.compile(r"`[^`\n]*`")
ESCAPED_REFERENCE_RE = re.compile(r"'[@#!][^']*'")
DEFAULT_AGENT_MAX_CHARS = 64000


@dataclass(frozen=True)
class SigilSection:
    """Authored text attached to a Sigil node."""

    kind: str
    name: str
    path: str
    text: str
    folded: bool = False
    order_index: int | None = None


@dataclass
class SigilNode:
    """One directory in a Sigil taxonomy."""

    name: str
    path: str
    depth: int
    parent_path: str | None = None
    language: SigilSection | None = None
    affordances: list[SigilSection] = field(default_factory=list)
    invariants: list[SigilSection] = field(default_factory=list)
    notes: list[SigilSection] = field(default_factory=list)
    orders: dict[str, list[str]] = field(default_factory=dict)
    folded: dict[str, list[str]] = field(default_factory=dict)
    layout: dict[str, Any] | None = None
    children: list["SigilNode"] = field(default_factory=list)


@dataclass(frozen=True)
class SigilReference:
    """A reference found in a section, with resolved targets when known."""

    marker: str
    name: str
    source_path: str
    source_kind: str
    source_name: str
    targets: tuple[str, ...]


@dataclass
class SigilStructure:
    """A whole Sigil tree, flattened into one present structure."""

    source_path: str
    root: SigilNode
    nodes: list[SigilNode]
    references: list[SigilReference]

    @property
    def node_count(self) -> int:
        return len(self.nodes)

    @property
    def affordance_count(self) -> int:
        return sum(len(node.affordances) for node in self.nodes)

    @property
    def invariant_count(self) -> int:
        return sum(len(node.invariants) for node in self.nodes)

    @property
    def note_count(self) -> int:
        return sum(len(node.notes) for node in self.nodes)


def read_sigil_structure(sigil_dir: Path) -> SigilStructure:
    """Load a `.sigil` taxonomy as one topology-preserving structure."""

    root_path = Path(sigil_dir).resolve()
    if not root_path.is_dir():
        raise NotADirectoryError(f"Sigil path is not a directory: {root_path}")

    root = _read_node(root_path, root_path, depth=0, parent_path=None)
    nodes = _flatten_nodes(root)
    references = _resolve_references(root, nodes)
    return SigilStructure(
        source_path=root_path.as_posix(),
        root=root,
        nodes=nodes,
        references=references,
    )


def sigil_structure_to_dict(structure: SigilStructure) -> dict[str, Any]:
    """Return a deterministic JSON-ready representation."""

    return {
        "source_path": structure.source_path,
        "summary": {
            "nodes": structure.node_count,
            "affordances": structure.affordance_count,
            "invariants": structure.invariant_count,
            "notes": structure.note_count,
            "references": len(structure.references),
            "unresolved_references": sum(1 for ref in structure.references if not ref.targets),
        },
        "root": _node_to_dict(structure.root),
        "flat_nodes": [_node_summary(node) for node in structure.nodes],
        "references": [
            {
                "marker": ref.marker,
                "name": ref.name,
                "source_path": ref.source_path,
                "source_kind": ref.source_kind,
                "source_name": ref.source_name,
                "targets": list(ref.targets),
            }
            for ref in structure.references
        ],
    }


def render_sigil_structure_markdown(structure: SigilStructure) -> str:
    """Render the structure as one Markdown field with outline and exact text."""

    lines: list[str] = [
        f"# Sigil Structure: {Path(structure.source_path).name}",
        "",
        f"Source: `{structure.source_path}`",
        "",
        "## Summary",
        "",
        f"- Nodes: {structure.node_count}",
        f"- Affordances: {structure.affordance_count}",
        f"- Invariants: {structure.invariant_count}",
        f"- Notes: {structure.note_count}",
        f"- References: {len(structure.references)}",
        f"- Unresolved references: {sum(1 for ref in structure.references if not ref.targets)}",
        "",
        "## Whole Tree",
        "",
    ]

    for node in structure.nodes:
        indent = "  " * node.depth
        marker = _node_marker(node)
        lines.append(f"{indent}- `{_display_path(node)}` {marker}")

    lines.extend(["", "## Flattened Structure", ""])
    refs_by_source = _references_by_source(structure.references)
    for node in structure.nodes:
        lines.extend(_render_node(node, refs_by_source))

    if structure.references:
        lines.extend(["", "## Reference Index", ""])
        for ref in structure.references:
            target = ", ".join(f"`{path}`" for path in ref.targets) if ref.targets else "unresolved"
            lines.append(
                f"- `{ref.source_path}` {ref.marker}{ref.name} -> {target}"
            )

    return "\n".join(lines).rstrip() + "\n"


def render_sigil_agent_context(
    structure: SigilStructure,
    *,
    focus: list[str] | None = None,
    max_chars: int | None = DEFAULT_AGENT_MAX_CHARS,
) -> str:
    """Render a bounded, agent-facing view of the Sigil field.

    The whole taxonomy remains present as outline. Exact authored language is
    expanded only around the current focus: matches, ancestors, and immediate
    children. This is the view intended for Codex context loading.
    """

    focus_terms = [term for term in (focus or []) if term.strip()]
    node_roles, ordered_paths = _agent_node_roles(structure, focus_terms)
    node_by_path = {node.path: node for node in structure.nodes}
    selected = [node_by_path[path] for path in ordered_paths if path in node_roles]
    selected_paths = {node.path for node in selected}
    refs_by_source = _references_by_source(structure.references)

    lines: list[str] = [
        f"# Sigil Field: {Path(structure.source_path).name}",
        "",
        f"Source: `{structure.source_path}`",
        f"Focus: {', '.join(focus_terms) if focus_terms else 'root'}",
        "",
        "## Counts",
        "",
        f"- Nodes: {structure.node_count}",
        f"- Affordances: {structure.affordance_count}",
        f"- Invariants: {structure.invariant_count}",
        f"- References: {len(structure.references)}",
        f"- Unresolved references: {sum(1 for ref in structure.references if not ref.targets)}",
        "",
        "## Expanded Resolution",
        "",
    ]

    for node in selected:
        lines.extend(_render_agent_node(node, refs_by_source, node_roles[node.path]))

    lines.extend(["", "## Whole Taxonomy", ""])

    for node in structure.nodes:
        indent = "  " * node.depth
        selected_marker = " *" if node.path in selected_paths else ""
        gloss = f" - {_node_gloss(node)}" if node.path in selected_paths else ""
        lines.append(
            f"{indent}- `{_display_path(node)}` {_node_marker(node)}"
            f"{selected_marker}{gloss}"
        )

    unresolved = [ref for ref in structure.references if not ref.targets]
    if unresolved:
        lines.extend(["", "## Unresolved Reference Hints", ""])
        for ref in unresolved[:30]:
            lines.append(f"- `{ref.source_path}` {ref.marker}{ref.name}")
        if len(unresolved) > 30:
            lines.append(f"- ... {len(unresolved) - 30} more")

    text = "\n".join(lines).rstrip() + "\n"
    if max_chars is not None and max_chars > 0 and len(text) > max_chars:
        return text[:max_chars].rstrip() + "\n\n[truncated: raise --max-chars or narrow --focus]\n"
    return text


def write_sigil_structure(
    sigil_dir: Path,
    output_path: Path | None,
    *,
    output_format: str = "markdown",
    focus: list[str] | None = None,
    max_chars: int | None = DEFAULT_AGENT_MAX_CHARS,
) -> str:
    """Read and serialize a Sigil structure.

    Returns the serialized text. When `output_path` is present, also writes it.
    """

    structure = read_sigil_structure(sigil_dir)
    if output_format == "json":
        text = json.dumps(sigil_structure_to_dict(structure), indent=2, sort_keys=True) + "\n"
    elif output_format == "markdown":
        text = render_sigil_structure_markdown(structure)
    elif output_format == "agent":
        text = render_sigil_agent_context(structure, focus=focus, max_chars=max_chars)
    else:
        raise ValueError(f"Unsupported Sigil structure format: {output_format}")

    if output_path is not None:
        Path(output_path).write_text(text, encoding="utf-8")
    return text


def emit_sigil_structure(
    sigil_dir: Path,
    output_path: Path | None,
    *,
    output_format: str = "markdown",
    focus: list[str] | None = None,
    max_chars: int | None = DEFAULT_AGENT_MAX_CHARS,
) -> None:
    """CLI helper that writes the structure to a file or stdout."""

    text = write_sigil_structure(
        sigil_dir,
        output_path,
        output_format=output_format,
        focus=focus,
        max_chars=max_chars,
    )
    if output_path is None:
        sys.stdout.write(text)


def _read_node(root_path: Path, path: Path, *, depth: int, parent_path: str | None) -> SigilNode:
    rel_path = _relative_path(root_path, path)
    node = SigilNode(
        name=path.name,
        path=rel_path,
        depth=depth,
        parent_path=parent_path,
    )

    section_files: list[Path] = []
    child_dirs: list[Path] = []
    for entry in path.iterdir():
        if entry.name in IGNORED_FILE_NAMES:
            continue
        if entry.is_dir() and entry.name not in PRIVATE_DIR_NAMES:
            child_dirs.append(entry)
        elif entry.is_file() and _is_structural_file(entry.name):
            section_files.append(entry)

    child_dirs.sort(key=lambda child: child.name.casefold())
    section_files.sort(key=lambda file_path: file_path.name.casefold())

    node.orders = _read_orders(section_files)
    node.folded = _read_folded(section_files)
    node.layout = _read_layout(path / "spatial.layout.json")

    sections = [_read_section(root_path, file_path, node) for file_path in section_files]
    sections = [section for section in sections if section is not None]

    node.language = next((section for section in sections if section.kind == "language"), None)
    node.affordances = _sort_sections(
        [section for section in sections if section.kind == "affordance"],
        node.orders.get("affordance", []),
        set(node.folded.get("affordance", [])),
    )
    node.invariants = _sort_sections(
        [section for section in sections if section.kind == "invariant"],
        node.orders.get("invariant", []),
        set(node.folded.get("invariant", [])),
    )
    node.notes = sorted(
        [section for section in sections if section.kind == "note"],
        key=lambda section: (section.path.casefold(), section.name.casefold()),
    )

    node.children = [
        _read_node(root_path, child, depth=depth + 1, parent_path=node.path)
        for child in child_dirs
    ]
    return node


def _read_section(root_path: Path, path: Path, node: SigilNode) -> SigilSection | None:
    kind, name = _classify_section_file(path.name)
    if kind is None:
        return None
    text = path.read_text(encoding="utf-8")
    return SigilSection(
        kind=kind,
        name=name,
        path=_relative_path(root_path, path),
        text=text.rstrip(),
        folded=name in node.folded.get(kind, []),
    )


def _classify_section_file(filename: str) -> tuple[str | None, str]:
    if filename == "language.md":
        return "language", "language"
    if filename.startswith("affordance-") and filename.endswith(".md"):
        return "affordance", filename.removeprefix("affordance-").removesuffix(".md")
    if filename.startswith("invariant-") and filename.endswith(".md"):
        return "invariant", filename.removeprefix("invariant-").removesuffix(".md")
    if filename.endswith(".md"):
        return "note", filename.removesuffix(".md")
    return None, ""


def _is_structural_file(filename: str) -> bool:
    return (
        filename.endswith(".md")
        or filename.endswith(".order")
        or filename.endswith(".folded")
        or filename == "spatial.layout.json"
    )


def _read_orders(files: list[Path]) -> dict[str, list[str]]:
    orders: dict[str, list[str]] = {}
    for file_path in files:
        if not file_path.name.endswith(".order"):
            continue
        kind = file_path.name.removesuffix(".order")
        orders[kind] = _read_name_list(file_path)
    return orders


def _read_folded(files: list[Path]) -> dict[str, list[str]]:
    folded: dict[str, list[str]] = {}
    for file_path in files:
        if not file_path.name.endswith(".folded"):
            continue
        kind = file_path.name.removesuffix(".folded")
        folded[kind] = _read_name_list(file_path)
    return folded


def _read_name_list(path: Path) -> list[str]:
    text = path.read_text(encoding="utf-8").strip()
    if not text:
        return []
    try:
        value = json.loads(text)
    except json.JSONDecodeError:
        return [line.strip() for line in text.splitlines() if line.strip()]
    if isinstance(value, list):
        return [str(item) for item in value]
    return []


def _read_layout(path: Path) -> dict[str, Any] | None:
    if not path.is_file():
        return None
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return {"unparsed": path.read_text(encoding="utf-8").rstrip()}
    return value if isinstance(value, dict) else {"value": value}


def _sort_sections(
    sections: list[SigilSection],
    ordered_names: list[str],
    folded_names: set[str],
) -> list[SigilSection]:
    order_index = {_normal_order_name(name): index for index, name in enumerate(ordered_names)}
    unordered_start = len(order_index)

    def sort_key(section: SigilSection) -> tuple[int, str]:
        normalized = _normal_order_name(section.name)
        return (order_index.get(normalized, unordered_start), section.name.casefold())

    ordered = []
    for section in sorted(sections, key=sort_key):
        normalized = _normal_order_name(section.name)
        index = order_index.get(normalized)
        ordered.append(
            SigilSection(
                kind=section.kind,
                name=section.name,
                path=section.path,
                text=section.text,
                folded=section.name in folded_names or normalized in {_normal_order_name(name) for name in folded_names},
                order_index=index,
            )
        )
    return ordered


def _normal_order_name(name: str) -> str:
    return name.strip().lower()


def _flatten_nodes(root: SigilNode) -> list[SigilNode]:
    nodes: list[SigilNode] = []

    def visit(node: SigilNode) -> None:
        nodes.append(node)
        for child in node.children:
            visit(child)

    visit(root)
    return nodes


def _resolve_references(root: SigilNode, nodes: list[SigilNode]) -> list[SigilReference]:
    node_by_path = {node.path: node for node in nodes}
    node_index = _build_node_index(nodes)
    affordance_index = _build_section_index(nodes, "affordance")
    invariant_index = _build_section_index(nodes, "invariant")
    references: list[SigilReference] = []

    for node in nodes:
        for section in _node_sections(node):
            for marker, name in REFERENCE_RE.findall(_reference_text(section.text)):
                if marker == "@":
                    targets = _resolve_node_targets(name, node, root, node_by_path, node_index)
                elif marker == "#":
                    targets = _resolve_section_targets(name, node, node_by_path, affordance_index)
                else:
                    targets = _resolve_section_targets(name, node, node_by_path, invariant_index)
                references.append(
                    SigilReference(
                        marker=marker,
                        name=name,
                        source_path=section.path,
                        source_kind=section.kind,
                        source_name=section.name,
                        targets=tuple(targets),
                    )
                )
    return references


def _reference_text(text: str) -> str:
    without_fences = FENCED_CODE_RE.sub("", text)
    without_inline_code = INLINE_CODE_RE.sub("", without_fences)
    return ESCAPED_REFERENCE_RE.sub("", without_inline_code)


def _build_node_index(nodes: list[SigilNode]) -> dict[str, list[SigilNode]]:
    index: dict[str, list[SigilNode]] = {}
    for node in nodes:
        for name in _node_index_names(node):
            for key in _name_keys(name):
                index.setdefault(key, []).append(node)
    return index


def _node_index_names(node: SigilNode) -> list[str]:
    names = [node.name]
    if node.path == "." and node.name.endswith(".sigil"):
        names.append(node.name.removesuffix(".sigil"))
    return names


def _build_section_index(nodes: list[SigilNode], kind: str) -> dict[str, list[SigilSection]]:
    index: dict[str, list[SigilSection]] = {}
    for node in nodes:
        sections = node.affordances if kind == "affordance" else node.invariants
        for section in sections:
            for key in _name_keys(section.name):
                index.setdefault(key, []).append(section)
    return index


def _resolve_node_targets(
    name: str,
    source_node: SigilNode,
    root: SigilNode,
    node_by_path: dict[str, SigilNode],
    node_index: dict[str, list[SigilNode]],
) -> list[str]:
    scoped_paths = _node_scope_paths(source_node, root, node_by_path)
    matches = _matches_by_name(name, node_index)
    return _prefer_scoped_paths([node.path for node in matches], scoped_paths)


def _resolve_section_targets(
    name: str,
    source_node: SigilNode,
    node_by_path: dict[str, SigilNode],
    section_index: dict[str, list[SigilSection]],
) -> list[str]:
    scoped_paths = _section_scope_paths(source_node, node_by_path)
    matches = _matches_by_name(name, section_index)
    section_paths = [section.path for section in matches]
    return _prefer_scoped_paths(section_paths, scoped_paths)


def _matches_by_name(name: str, index: dict[str, list[Any]]) -> list[Any]:
    matches: list[Any] = []
    seen: set[int] = set()
    for key in _name_keys(name):
        for item in index.get(key, []):
            item_id = id(item)
            if item_id not in seen:
                matches.append(item)
                seen.add(item_id)
    return matches


def _node_scope_paths(
    source_node: SigilNode,
    root: SigilNode,
    node_by_path: dict[str, SigilNode],
) -> list[str]:
    paths: list[str] = []
    for node in _ancestor_chain(source_node, node_by_path):
        paths.append(node.path)
        paths.extend(child.path for child in node.children)
    libs = next((child for child in root.children if _name_keys(child.name) & {"libs", "lib"}), None)
    if libs is not None:
        paths.extend(node.path for node in _flatten_nodes(libs))
    paths.extend(node_by_path)
    return _dedupe(paths)


def _section_scope_paths(source_node: SigilNode, node_by_path: dict[str, SigilNode]) -> list[str]:
    paths: list[str] = []
    for node in _ancestor_chain(source_node, node_by_path):
        paths.extend(section.path for section in node.affordances)
        paths.extend(section.path for section in node.invariants)
    return _dedupe(paths)


def _ancestor_chain(source_node: SigilNode, node_by_path: dict[str, SigilNode]) -> list[SigilNode]:
    chain: list[SigilNode] = []
    current: SigilNode | None = source_node
    while current is not None:
        chain.append(current)
        current = node_by_path.get(current.parent_path) if current.parent_path is not None else None
    return chain


def _prefer_scoped_paths(paths: list[str], scope_order: list[str]) -> list[str]:
    if not paths:
        return []
    scoped = [path for path in scope_order if path in paths]
    return scoped if scoped else _dedupe(paths)


def _name_keys(name: str) -> set[str]:
    words = _name_words(name)
    base = "-".join(words)
    compact = "".join(words)
    keys = {base, compact}
    for value in list(keys):
        keys.update(_singular_keys(value))
    return {key for key in keys if key}


def _name_words(name: str) -> list[str]:
    spaced = re.sub(r"(?<=[a-z0-9])(?=[A-Z])", " ", name)
    spaced = re.sub(r"[^A-Za-z0-9]+", " ", spaced)
    return [part.lower() for part in spaced.split() if part]


def _singular_keys(value: str) -> set[str]:
    if len(value) <= 3:
        return set()
    if value.endswith("ies"):
        return {f"{value[:-3]}y"}
    if value.endswith("s"):
        return {value[:-1]}
    return set()


def _dedupe(values: list[str]) -> list[str]:
    out: list[str] = []
    seen: set[str] = set()
    for value in values:
        if value in seen:
            continue
        out.append(value)
        seen.add(value)
    return out


def _node_sections(node: SigilNode) -> list[SigilSection]:
    sections: list[SigilSection] = []
    if node.language is not None:
        sections.append(node.language)
    sections.extend(node.affordances)
    sections.extend(node.invariants)
    sections.extend(node.notes)
    return sections


def _agent_node_roles(structure: SigilStructure, focus_terms: list[str]) -> tuple[dict[str, str], list[str]]:
    node_by_path = {node.path: node for node in structure.nodes}
    roles: dict[str, str] = {structure.root.path: "root"}
    ordered_paths: list[str] = []

    if focus_terms:
        matches = _focus_matches(structure, focus_terms)
    else:
        matches = []
        ordered_paths.append(structure.root.path)
        for child in structure.root.children:
            roles.setdefault(child.path, "child")
            ordered_paths.append(child.path)

    for node in matches:
        roles[node.path] = "match"
        ordered_paths.append(node.path)
        ancestors = [
            ancestor for ancestor in reversed(_ancestor_chain(node, node_by_path))
            if ancestor.path != node.path
        ]
        for ancestor in ancestors:
            roles.setdefault(ancestor.path, "ancestor")
            ordered_paths.append(ancestor.path)
        for child in node.children:
            roles.setdefault(child.path, "child")
            ordered_paths.append(child.path)

    return roles, _dedupe(ordered_paths)


def _focus_matches(structure: SigilStructure, focus_terms: list[str]) -> list[SigilNode]:
    exact_path_matches = _exact_path_focus_matches(structure, focus_terms)
    if exact_path_matches:
        return exact_path_matches

    exact_name_matches = _exact_name_focus_matches(structure, focus_terms)
    if exact_name_matches:
        return exact_name_matches

    return [
        node for node in structure.nodes
        if _node_matches_focus(node, focus_terms)
    ]


def _exact_path_focus_matches(structure: SigilStructure, focus_terms: list[str]) -> list[SigilNode]:
    root_name = Path(structure.source_path).name
    matches: list[SigilNode] = []
    for term in focus_terms:
        focus_key = _path_focus_key(term)
        for node in structure.nodes:
            if focus_key in _node_path_focus_keys(node, root_name):
                matches.append(node)
    return _dedupe_nodes(matches)


def _exact_name_focus_matches(structure: SigilStructure, focus_terms: list[str]) -> list[SigilNode]:
    focus_keys = set().union(*(_name_keys(term) for term in focus_terms))
    return [
        node for node in structure.nodes
        if _name_keys(node.name) & focus_keys
    ]


def _path_focus_key(value: str) -> str:
    cleaned = value.strip().strip("`").replace("\\", "/")
    while cleaned.startswith("./"):
        cleaned = cleaned[2:]
    return cleaned.strip("/").casefold()


def _node_path_focus_keys(node: SigilNode, root_name: str) -> set[str]:
    if node.path == ".":
        keys = {root_name, root_name.removesuffix(".sigil"), "."}
    else:
        keys = {
            node.path,
            f"{root_name}/{node.path}",
            f"{root_name.removesuffix('.sigil')}/{node.path}",
        }
    return {_path_focus_key(key) for key in keys}


def _dedupe_nodes(nodes: list[SigilNode]) -> list[SigilNode]:
    out: list[SigilNode] = []
    seen: set[str] = set()
    for node in nodes:
        if node.path in seen:
            continue
        out.append(node)
        seen.add(node.path)
    return out


def _node_matches_focus(node: SigilNode, focus_terms: list[str]) -> bool:
    haystack = "\n".join([
        node.name,
        node.path,
        *[
            f"{section.kind} {section.name} {section.text}"
            for section in _node_sections(node)
        ],
    ]).casefold()
    return any(term.casefold() in haystack for term in focus_terms)


def _node_gloss(node: SigilNode) -> str:
    if node.language is None:
        return ""
    return _excerpt(node.language.text, limit=180)


def _excerpt(text: str, *, limit: int) -> str:
    stripped = _strip_frontmatter(text)
    stripped = re.sub(r"^#+\s*", "", stripped, flags=re.MULTILINE)
    stripped = re.sub(r"\s+", " ", stripped).strip()
    if len(stripped) <= limit:
        return stripped
    return stripped[: max(limit - 3, 0)].rstrip() + "..."


def _strip_frontmatter(text: str) -> str:
    if not text.startswith("---"):
        return text
    parts = text.split("---", 2)
    return parts[2].lstrip() if len(parts) == 3 else text


def _render_agent_node(
    node: SigilNode,
    refs_by_source: dict[str, list[SigilReference]],
    role: str,
) -> list[str]:
    lines = [f"### `{_display_path(node)}` ({role})", ""]
    lines.append(f"Parent: `{node.parent_path}`" if node.parent_path is not None else "Parent: none")
    children = ", ".join(f"`{child.name}`" for child in node.children) or "none"
    lines.append(f"Children: {children}")
    if node.layout is not None:
        lines.append(f"Layout: {_layout_summary(node.layout)}")
    lines.append("")

    if node.language is not None:
        lines.extend(_render_agent_section("Language", node.language, refs_by_source))
    if role != "match":
        if node.affordances:
            lines.append("Affordances: " + ", ".join(f"#{section.name}" for section in node.affordances))
        if node.invariants:
            lines.append("Invariants: " + ", ".join(f"!{section.name}" for section in node.invariants))
        if node.notes:
            lines.append("Notes: " + ", ".join(section.name for section in node.notes))
        if lines[-1] != "":
            lines.append("")
        return lines

    for section in node.affordances:
        lines.extend(_render_agent_section(f"#{section.name}", section, refs_by_source))
    for section in node.invariants:
        lines.extend(_render_agent_section(f"!{section.name}", section, refs_by_source))
    for section in node.notes:
        lines.extend(_render_agent_section(section.name, section, refs_by_source))
    return lines


def _layout_summary(layout: dict[str, Any]) -> str:
    version = layout.get("version")
    icons = layout.get("icons")
    icon_count = len(icons) if isinstance(icons, dict) else 0
    parts = []
    if version is not None:
        parts.append(f"version {version}")
    if icon_count:
        parts.append(f"{icon_count} icons")
    if "scroll" in layout:
        parts.append("scroll")
    return ", ".join(parts) if parts else "present"


def _render_agent_section(
    title: str,
    section: SigilSection,
    refs_by_source: dict[str, list[SigilReference]],
) -> list[str]:
    folded = " folded" if section.folded else ""
    order = f" order={section.order_index}" if section.order_index is not None else ""
    lines = [f"#### {title}{folded}{order}", "", "```text", section.text, "```", ""]
    refs = refs_by_source.get(section.path, [])
    if refs:
        lines.append("References: " + _format_agent_references(refs))
        lines.append("")
    return lines


def _format_agent_references(refs: list[SigilReference], max_refs: int = 14) -> str:
    items: list[str] = []
    seen: set[tuple[str, str, tuple[str, ...]]] = set()
    for ref in refs:
        key = (ref.marker, ref.name, ref.targets)
        if key in seen:
            continue
        seen.add(key)
        target = ", ".join(f"`{path}`" for path in ref.targets[:3]) if ref.targets else "unresolved"
        if len(ref.targets) > 3:
            target += f", +{len(ref.targets) - 3}"
        items.append(f"{ref.marker}{ref.name} -> {target}")
    shown = items[:max_refs]
    if len(items) > max_refs:
        shown.append(f"+{len(items) - max_refs} more")
    return "; ".join(shown)


def _relative_path(root_path: Path, path: Path) -> str:
    rel = path.relative_to(root_path)
    return "." if rel == Path(".") else rel.as_posix()


def _node_to_dict(node: SigilNode) -> dict[str, Any]:
    return {
        "name": node.name,
        "path": node.path,
        "depth": node.depth,
        "parent_path": node.parent_path,
        "language": _section_to_dict(node.language),
        "affordances": [_section_to_dict(section) for section in node.affordances],
        "invariants": [_section_to_dict(section) for section in node.invariants],
        "notes": [_section_to_dict(section) for section in node.notes],
        "orders": node.orders,
        "folded": node.folded,
        "layout": node.layout,
        "children": [_node_to_dict(child) for child in node.children],
    }


def _node_summary(node: SigilNode) -> dict[str, Any]:
    return {
        "name": node.name,
        "path": node.path,
        "depth": node.depth,
        "parent_path": node.parent_path,
        "has_language": node.language is not None,
        "affordances": [section.name for section in node.affordances],
        "invariants": [section.name for section in node.invariants],
        "notes": [section.name for section in node.notes],
        "children": [child.name for child in node.children],
    }


def _section_to_dict(section: SigilSection | None) -> dict[str, Any] | None:
    if section is None:
        return None
    return {
        "kind": section.kind,
        "name": section.name,
        "path": section.path,
        "text": section.text,
        "folded": section.folded,
        "order_index": section.order_index,
    }


def _node_marker(node: SigilNode) -> str:
    parts = []
    if node.language is not None:
        parts.append("L")
    if node.affordances:
        parts.append(f"A{len(node.affordances)}")
    if node.invariants:
        parts.append(f"I{len(node.invariants)}")
    if node.notes:
        parts.append(f"N{len(node.notes)}")
    if node.children:
        parts.append(f"C{len(node.children)}")
    return "[" + " ".join(parts) + "]" if parts else "[]"


def _display_path(node: SigilNode) -> str:
    return node.path if node.path != "." else node.name


def _references_by_source(references: list[SigilReference]) -> dict[str, list[SigilReference]]:
    refs: dict[str, list[SigilReference]] = {}
    for ref in references:
        refs.setdefault(ref.source_path, []).append(ref)
    return refs


def _render_node(
    node: SigilNode,
    refs_by_source: dict[str, list[SigilReference]],
) -> list[str]:
    lines = [f"### `{_display_path(node)}`", ""]
    children = ", ".join(f"`{child.name}`" for child in node.children) or "none"
    lines.append(f"Children: {children}")
    if node.layout is not None:
        lines.append(f"Layout: `{json.dumps(node.layout, sort_keys=True)}`")
    lines.append("")

    if node.language is not None:
        lines.extend(_render_section("Language", node.language, refs_by_source))
    if node.affordances:
        lines.append("Affordances:")
        lines.append("")
        for section in node.affordances:
            lines.extend(_render_section(f"#{section.name}", section, refs_by_source))
    if node.invariants:
        lines.append("Invariants:")
        lines.append("")
        for section in node.invariants:
            lines.extend(_render_section(f"!{section.name}", section, refs_by_source))
    if node.notes:
        lines.append("Notes:")
        lines.append("")
        for section in node.notes:
            lines.extend(_render_section(section.name, section, refs_by_source))
    return lines


def _render_section(
    title: str,
    section: SigilSection,
    refs_by_source: dict[str, list[SigilReference]],
) -> list[str]:
    folded = " folded" if section.folded else ""
    lines = [f"#### {title}{folded}", ""]
    if section.text:
        lines.extend(["```text", section.text, "```", ""])
    else:
        lines.extend(["```text", "", "```", ""])
    refs = refs_by_source.get(section.path, [])
    if refs:
        lines.append(
            "References: "
            + "; ".join(
                f"{ref.marker}{ref.name} -> "
                + (", ".join(f"`{target}`" for target in ref.targets) if ref.targets else "unresolved")
                for ref in refs
            )
        )
        lines.append("")
    return lines
