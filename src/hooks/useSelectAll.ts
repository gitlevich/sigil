import { useEffect } from "react";

/**
 * Intercepts Cmd+A / Ctrl+A so that "Select All" is scoped to the
 * focused element (textarea, input, or CodeMirror editor) instead of
 * selecting the entire webview — which is the default Tauri/Cocoa
 * behavior when using PredefinedMenuItem::SelectAll.
 */
export function useSelectAll() {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.key !== "a") return;

      const el = document.activeElement;
      if (!el) return;

      // Textarea or input — native .select() scopes correctly
      if (el instanceof HTMLTextAreaElement || el instanceof HTMLInputElement) {
        e.preventDefault();
        el.select();
        return;
      }

      // CodeMirror — it handles Cmd+A internally, just prevent the
      // native menu from also firing a webview-wide selectAll
      if (el.closest(".cm-editor")) {
        // Don't preventDefault — let CodeMirror handle it
        return;
      }

      // Any other contenteditable
      if (el instanceof HTMLElement && el.isContentEditable) {
        e.preventDefault();
        const range = document.createRange();
        range.selectNodeContents(el);
        const sel = window.getSelection();
        sel?.removeAllRanges();
        sel?.addRange(range);
        return;
      }
    };

    // Use capture phase to intercept before the native menu action
    window.addEventListener("keydown", handler, true);
    return () => window.removeEventListener("keydown", handler, true);
  }, []);
}
