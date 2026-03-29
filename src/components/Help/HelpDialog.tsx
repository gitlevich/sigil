import { useAppState, useAppDispatch } from "../../state/AppContext";
import { MarkdownPreview } from "../Editor/MarkdownPreview";
import styles from "./HelpDialog.module.css";

function SigilIcon({ size = 20 }: { size?: number }) {
  return (
    <svg viewBox="0 0 1024 1024" width={size} height={size} style={{ verticalAlign: "middle", opacity: 0.7 }}>
      <circle cx="512" cy="512" r="400" fill="none" stroke="currentColor" strokeWidth="48"/>
      <path d="M512,267 L757,512 L512,757 L267,512 Z" fill="none" stroke="currentColor" strokeWidth="48" strokeLinejoin="round"/>
      <circle cx="512" cy="512" r="30" fill="currentColor"/>
    </svg>
  );
}

const HELP_CONTENT = `# Sigil

A desktop tool for writing hierarchical domain language before you write code — and for giving an AI agent enough structured context to think alongside you.

## Who this is for

You're a software architect, technical lead, or senior engineer who believes that unclear domain language produces unclear systems. You think in bounded contexts. You decompose systems into contexts, each with its own ubiquitous language and its own boundary.

You also know that AI can be a powerful thinking partner — but only when it has real context. Not a chat window where you paste fragments. You want to give another intelligence your entire mental model of a system, structured the way you structured it, so it can reason about the whole and challenge the parts.

## What Sigil does

A sigil is a bounded context. It has a name, a boundary, and domain language written at its level of abstraction. Inside that boundary, it can contain up to five other sigils. The constraint is the point.

The sigil becomes the AI agent's context. When you navigate to a context, you and the agent are explicitly agreeing on the level of abstraction you're working at. Everything outside becomes periphery. The structure holds what neither of you needs to hold in mind.

### On disk

Each context is a directory containing:
- **language.md** — the domain language for this bounded context
- Up to 5 sub-context directories

Put it in git and it versions like code.

### Key features

- **Hierarchical editing** — navigate contexts, each with its own domain language
- **Vision statement** — a persistent reminder of the application's purpose
- **AI design partner** — chat with an AI that inhabits your entire sigil
- **Multi-window** — each sigil in its own window
- **Profiles** — switch between AI providers mid-conversation
- **Response style** — Laconic by default (a few sentences, conversation not report). Toggle D/L in the chat header for detailed mode
- **Export** — flatten to a single markdown document
- **Auto-save** — every edit writes to disk immediately

### Keyboard shortcuts

- **Cmd+N** — New window
- **Cmd+O** — Open sigil
- **Cmd+W** — Close window
- **Cmd+,** — Settings
- **Enter** — Send chat message (Shift+Enter for newline)
`;

export function HelpDialog() {
  const state = useAppState();
  const dispatch = useAppDispatch();

  if (!state.helpOpen) return null;

  return (
    <div className={styles.overlay} onClick={() => dispatch({ type: "SET_HELP_OPEN", open: false })}>
      <div className={styles.dialog} onClick={(e) => e.stopPropagation()}>
        <div className={styles.body}>
          <div style={{ display: "flex", justifyContent: "center", marginBottom: 8 }}>
            <SigilIcon size={32} />
          </div>
          <MarkdownPreview content={HELP_CONTENT} />
        </div>
        <div className={styles.footer}>
          <button
            className={styles.closeBtn}
            onClick={() => dispatch({ type: "SET_HELP_OPEN", open: false })}
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
