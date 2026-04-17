import { useEffect, useRef } from "react";
import { EditorState, StateEffect, RangeSetBuilder } from "@codemirror/state";
import { EditorView, ViewPlugin, ViewUpdate, Decoration, DecorationSet, WidgetType, keymap, lineNumbers } from "@codemirror/view";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { markdown } from "@codemirror/lang-markdown";
import * as Diff3 from "node-diff3";
import styles from "./ThreeWayMergeView.module.css";

const MINE_OPEN_RE = /^<{7}(\s.*)?$/;
const SEP_RE = /^={7}$/;
const THEIRS_CLOSE_RE = /^>{7}(\s.*)?$/;

interface ConflictBlock {
  openFrom: number;      // start of MINE_OPEN line
  openTo: number;        // end of MINE_OPEN line (before newline)
  sepFrom: number;
  sepTo: number;
  closeFrom: number;
  closeTo: number;
  mineText: string;      // lines between MINE_OPEN and SEP (joined with \n)
  theirsText: string;    // lines between SEP and THEIRS_CLOSE
  blockFrom: number;     // inclusive: start of MINE_OPEN line
  blockTo: number;       // exclusive: end of THEIRS_CLOSE line (includes trailing newline if present)
}

function findConflicts(doc: string): ConflictBlock[] {
  const blocks: ConflictBlock[] = [];
  const lines = doc.split("\n");
  let offset = 0;
  const offsets: number[] = [0];
  for (const line of lines) {
    offset += line.length + 1; // +1 for newline
    offsets.push(offset);
  }

  for (let i = 0; i < lines.length; i++) {
    if (!MINE_OPEN_RE.test(lines[i])) continue;
    // Find separator
    let sepIdx = -1;
    let closeIdx = -1;
    for (let j = i + 1; j < lines.length; j++) {
      if (SEP_RE.test(lines[j]) && sepIdx === -1) { sepIdx = j; continue; }
      if (THEIRS_CLOSE_RE.test(lines[j])) { closeIdx = j; break; }
      if (MINE_OPEN_RE.test(lines[j])) break; // malformed, stop
    }
    if (sepIdx === -1 || closeIdx === -1) continue;

    const openFrom = offsets[i];
    const openTo = offsets[i] + lines[i].length;
    const sepFrom = offsets[sepIdx];
    const sepTo = offsets[sepIdx] + lines[sepIdx].length;
    const closeFrom = offsets[closeIdx];
    const closeTo = offsets[closeIdx] + lines[closeIdx].length;
    const mineText = lines.slice(i + 1, sepIdx).join("\n");
    const theirsText = lines.slice(sepIdx + 1, closeIdx).join("\n");
    // Block spans from open's line start to the close's line end (not including the following newline).
    // We'll also consume the trailing newline after THEIRS_CLOSE when replacing, if present.
    const blockFrom = openFrom;
    const blockTo = closeIdx + 1 < lines.length ? offsets[closeIdx + 1] : closeTo;
    blocks.push({ openFrom, openTo, sepFrom, sepTo, closeFrom, closeTo, mineText, theirsText, blockFrom, blockTo });
    i = closeIdx;
  }
  return blocks;
}

class MergeControlsWidget extends WidgetType {
  constructor(
    readonly blockFrom: number,
    readonly blockTo: number,
    readonly mineText: string,
    readonly theirsText: string,
  ) { super(); }

  eq(other: MergeControlsWidget): boolean {
    return this.blockFrom === other.blockFrom
      && this.blockTo === other.blockTo
      && this.mineText === other.mineText
      && this.theirsText === other.theirsText;
  }

  toDOM(view: EditorView): HTMLElement {
    const wrap = document.createElement("div");
    wrap.className = styles.controls;
    const label = document.createElement("span");
    label.className = styles.label;
    label.textContent = "Conflict";
    const mine = document.createElement("button");
    mine.className = `${styles.btn} ${styles.btnMine}`;
    mine.textContent = "Mine";
    mine.onclick = (e) => { e.preventDefault(); this.apply(view, this.mineText); };
    const theirs = document.createElement("button");
    theirs.className = `${styles.btn} ${styles.btnTheirs}`;
    theirs.textContent = "Theirs";
    theirs.onclick = (e) => { e.preventDefault(); this.apply(view, this.theirsText); };
    wrap.append(label, mine, theirs);
    return wrap;
  }

  ignoreEvent(): boolean { return false; }

  private apply(view: EditorView, replacement: string): void {
    // The widget was decorated based on a doc snapshot. The doc may have changed
    // since: re-find this conflict block by matching the MINE_OPEN line content at
    // or near the remembered position. Fall back to nothing if we can't locate it.
    const doc = view.state.doc.toString();
    const blocks = findConflicts(doc);
    const match = blocks.find((b) => b.mineText === this.mineText && b.theirsText === this.theirsText);
    if (!match) return;
    const suffix = match.blockTo > 0 && doc[match.blockTo - 1] === "\n" ? "\n" : "";
    view.dispatch({
      changes: { from: match.blockFrom, to: match.blockTo, insert: replacement + suffix },
    });
  }
}

const conflictsPlugin = ViewPlugin.fromClass(class {
  decorations: DecorationSet;
  constructor(view: EditorView) { this.decorations = this.build(view); }
  update(update: ViewUpdate) {
    if (update.docChanged || update.viewportChanged) this.decorations = this.build(update.view);
  }
  build(view: EditorView): DecorationSet {
    const builder = new RangeSetBuilder<Decoration>();
    const doc = view.state.doc.toString();
    const blocks = findConflicts(doc);
    for (const b of blocks) {
      // Line decorations for the three marker lines and the mine/theirs line ranges.
      builder.add(b.openFrom, b.openFrom, Decoration.line({ class: styles.markerLine }));
      // Mine lines
      if (b.openTo + 1 < b.sepFrom) {
        const mineStart = b.openFrom + (view.state.doc.lineAt(b.openFrom).to - b.openFrom) + 1; // first line after MINE_OPEN
        const mineEnd = b.sepFrom;
        let pos = mineStart;
        while (pos < mineEnd) {
          const line = view.state.doc.lineAt(pos);
          builder.add(line.from, line.from, Decoration.line({ class: styles.mineLine }));
          pos = line.to + 1;
        }
      }
      builder.add(b.sepFrom, b.sepFrom, Decoration.line({ class: styles.markerLine }));
      // Theirs lines
      if (b.sepTo + 1 < b.closeFrom) {
        const theirsStart = b.sepTo + 1;
        const theirsEnd = b.closeFrom;
        let pos = theirsStart;
        while (pos < theirsEnd) {
          const line = view.state.doc.lineAt(pos);
          builder.add(line.from, line.from, Decoration.line({ class: styles.theirsLine }));
          pos = line.to + 1;
        }
      }
      builder.add(b.closeFrom, b.closeFrom, Decoration.line({ class: styles.markerLine }));
      // Widget after the close line with Mine / Theirs buttons.
      builder.add(b.closeTo, b.closeTo, Decoration.widget({
        widget: new MergeControlsWidget(b.blockFrom, b.blockTo, b.mineText, b.theirsText),
        side: 1,
        block: true,
      }));
    }
    return builder.finish();
  }
}, { decorations: (v) => v.decorations });

export interface ThreeWayMergeViewProps {
  base: string;
  mine: string;
  theirs: string;
  onContentChange: (text: string, hasConflicts: boolean) => void;
}

export function ThreeWayMergeView({ base, mine, theirs, onContentChange }: ThreeWayMergeViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const onContentChangeRef = useRef(onContentChange);
  onContentChangeRef.current = onContentChange;

  useEffect(() => {
    if (!containerRef.current) return;

    // Compute the initial merged text with conflict markers.
    const a = mine.split("\n");
    const o = base.split("\n");
    const b = theirs.split("\n");
    const result = Diff3.merge(a, o, b);
    const initialDoc = result.result.join("\n");

    const updateListener = EditorView.updateListener.of((update) => {
      if (!update.docChanged) return;
      const doc = update.state.doc.toString();
      const hasConflicts = findConflicts(doc).length > 0;
      onContentChangeRef.current(doc, hasConflicts);
    });

    const view = new EditorView({
      state: EditorState.create({
        doc: initialDoc,
        extensions: [
          lineNumbers(),
          history(),
          keymap.of([...defaultKeymap, ...historyKeymap]),
          markdown(),
          conflictsPlugin,
          updateListener,
          EditorView.theme({
            "&": { height: "100%" },
            ".cm-scroller": { overflow: "auto", fontFamily: "'SF Mono', 'Fira Code', monospace" },
          }),
        ],
      }),
      parent: containerRef.current,
    });
    viewRef.current = view;

    // Initial callback so the parent knows the starting hasConflicts state.
    const initialHas = findConflicts(initialDoc).length > 0;
    onContentChangeRef.current(initialDoc, initialHas);

    return () => { view.destroy(); viewRef.current = null; };
  }, [base, mine, theirs]);

  return (
    <div className={styles.container}>
      <div ref={containerRef} className={styles.editor} />
    </div>
  );
}

// Utility: take-all helpers for parent-side bulk buttons.
export function takeAllOneSide(view: EditorView | null, side: "mine" | "theirs"): void {
  if (!view) return;
  const doc = view.state.doc.toString();
  const blocks = findConflicts(doc);
  if (blocks.length === 0) return;
  // Apply replacements from bottom to top so earlier positions stay valid.
  const effects: StateEffect<unknown>[] = [];
  const changes = [...blocks].reverse().map((b) => {
    const text = side === "mine" ? b.mineText : b.theirsText;
    const suffix = b.blockTo > 0 && doc[b.blockTo - 1] === "\n" ? "\n" : "";
    return { from: b.blockFrom, to: b.blockTo, insert: text + suffix };
  });
  view.dispatch({ changes, effects });
}
