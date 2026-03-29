# Sigil

A desktop tool for writing hierarchical domain language before you write code.

## Who this is for

You're a software architect, technical lead, or senior engineer who believes that unclear domain language produces unclear systems. You've seen projects where the team started coding before anyone agreed on what the system actually is — and you've watched the slow, expensive reckoning that follows.

You think in bounded contexts. You decompose problems into domains, sub-domains, and features, each with their own language and their own boundaries. You know that a specification that tries to hold everything at once holds nothing well. You want a tool that mirrors how you think: one level of abstraction at a time, with hard limits that force clarity instead of allowing sprawl.

You don't need a wiki, a Notion page, or a shared Google Doc. Those tools let you write anything anywhere, which is precisely the problem. You need structure that pushes back — that tells you "if you need a sixth sub-context, your abstraction is wrong."

## What Sigil does

Sigil is a domain language editor organized as a tree of bounded contexts. Each context has a name, a domain language document written in markdown, optional technical decisions, and up to five sub-contexts. The hard limit of five is the point. It enforces the cognitive discipline that keeps domain models coherent as they grow.

A sigil lives on your file system as a directory hierarchy — plain directories and markdown files. No proprietary format, no database, no lock-in. Put it in git and it versions like code.

Each context contains:
- `language.md` — the domain language for this bounded context
- `technical.md` — architectural choices and constraints (optional, inherits from parent)
- Up to 5 sub-context directories, each with its own `language.md`

**Core features:**

- **Hierarchical editing** — navigate a tree of contexts, each with its own domain language and technical decisions. Technical decisions inherit downward unless overridden.
- **Vision statement** — a persistent reminder of what the application is for, visible from any depth in the tree. Prevents drift.
- **AI review** — a built-in chat panel where an AI agent reviews your entire sigil for coherence, gaps, contradictions, and implementation readiness. Supports Anthropic and OpenAI.
- **Multi-window** — each sigil opens in its own native window. Compare two sigils side by side.
- **Export** — flatten the entire tree into a single markdown document for handoff or review.
- **Auto-save** — every edit writes to disk immediately. No save button, no lost work.
- **Light and dark themes** — follows your system preference or set manually.

## Technology

Tauri 2 desktop application. Rust backend for file system operations and AI API streaming. React + TypeScript frontend with CodeMirror 6 for markdown editing. macOS first.

## Getting started

```bash
npm install
npm run tauri dev
```

Requires Rust and Node.js. See the [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/) for platform-specific setup.

## Building for distribution

```bash
npm run tauri build
```

Produces a `.dmg` installer in `src-tauri/target/release/bundle/dmg/`.

## License

MIT
