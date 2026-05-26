import type { Text } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";

export interface TextRange {
  from: number;
  to: number;
}

export function activeLineDeletionRange(doc: Text, pos: number): TextRange {
  const line = doc.lineAt(pos);
  if (line.to < doc.length) return { from: line.from, to: line.to + 1 };
  if (line.from > 0) return { from: line.from - 1, to: line.to };
  return { from: line.from, to: line.to };
}

export function deleteActiveLine(view: EditorView): boolean {
  const pos = view.state.selection.main.head;
  view.dispatch({ changes: activeLineDeletionRange(view.state.doc, pos) });
  return true;
}
