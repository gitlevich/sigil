<p align="center">
  <img src="icon.svg" width="128" height="128" alt="Sigil">
</p>

<h1 align="center">Sigil</h1>

A desktop tool for writing hierarchical domain language before you write code — and for giving an AI agent enough structured context to think alongside you.

## Who this is for

You're a software architect, technical lead, or senior engineer who believes that unclear domain language produces unclear systems. You've seen projects where the team started coding before anyone agreed on what the system actually is — and you've watched the slow, expensive reckoning that follows.

You think in bounded contexts. You decompose problems into domains, sub-domains, and features, each with their own language and their own boundaries. You know that a specification that tries to hold everything at once holds nothing well. You want a tool that mirrors how you think: one level of abstraction at a time, with hard limits that force clarity instead of allowing sprawl.

You also know that AI can be a powerful thinking partner — but only when it has real context. Not a chat window where you paste fragments. Not a copilot guessing from the file you happen to have open. You want to give another intelligence your entire mental model of a system, structured the way you structured it, so it can reason about the whole and challenge the parts.

You don't need a wiki, a Notion page, or a shared Google Doc. Those tools let you write anything anywhere, which is precisely the problem. You need structure that pushes back — that tells you "if you need a sixth sub-context, your abstraction is wrong."

## What Sigil does

A sigil is a structured representation of how you think about a system. It's a tree of bounded contexts, each with its own domain language and technical decisions, constrained to five sub-contexts per level. The constraint is the point. It forces you to find the right abstractions rather than accumulate the wrong ones.

The sigil becomes the AI agent's context. The entire tree — vision, domain language, technical decisions at every level — is what the agent sees when you talk to it. It inhabits your mental model of the system.

But the structure does something more fundamental than just providing context. When you navigate to a context — say, Auth — you and the agent are explicitly agreeing on the level of abstraction you're working at. Everything outside that context becomes periphery. You don't think about Billing while you're defining Auth's language. The agent doesn't either. You both give full attention to the bounded problem in front of you, because the hierarchy has already handled the separation. The periphery isn't lost — it's held by the structure so neither of you has to hold it in mind.

This is how attention works. Not by seeing everything at once, but by knowing what to ignore. The tree of contexts is a mutual contract between you and the agent about what matters right now.

A context can address its siblings — the other contexts that share the same containing sigil. You can use a neighbor's name in your domain language to describe how you relate to it: `focus.slice` means you're addressing Focus's public affordance from within your own context. These cross-references are highlighted in the editor, making the local language of the containing sigil visible as you write. You can't reach inside a sibling. You can only address it by name and use what it exposes. If you find yourself wanting to reference something deeper, that's a signal the boundary needs work.

A sigil lives on your file system as a directory hierarchy — plain directories and markdown files. No proprietary format, no database, no lock-in. Put it in git and it versions like code.

Each context contains:
- `language.md` — the domain language for this bounded context
- `technical.md` — architectural choices and constraints (optional, inherits from parent)
- Up to 5 sub-context directories, each with its own `language.md`

**Core features:**

- **Hierarchical editing** — navigate a tree of contexts, each with its own domain language and technical decisions. Technical decisions inherit downward unless overridden.
- **Vision statement** — a persistent reminder of what the application is for, visible from any depth in the tree. Prevents drift.
- **AI review** — a built-in chat panel where an AI agent inhabits your entire sigil and reviews it for coherence, gaps, contradictions, and implementation readiness. Supports Anthropic and OpenAI.
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
