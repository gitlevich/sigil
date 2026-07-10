/** Match a browser keyboard event against a CodeMirror-style binding. */
export function matchesKeybinding(event: KeyboardEvent, binding: string): boolean {
  const parts = binding.split("-");
  const key = parts[parts.length - 1].toLowerCase();
  const modifiers = new Set(parts.slice(0, -1).map((part) => part.toLowerCase()));

  const needsControl = modifiers.has("ctrl");
  const needsCommand = modifiers.has("mod");
  const needsOption = modifiers.has("alt");
  const needsShift = modifiers.has("shift");

  if (needsControl && !event.ctrlKey) return false;
  if (!needsControl && !needsCommand && event.ctrlKey) return false;
  if (needsCommand && !(event.metaKey || event.ctrlKey)) return false;
  if (!needsCommand && event.metaKey) return false;
  if (needsOption && !event.altKey) return false;
  if (!needsOption && event.altKey) return false;
  if (needsShift && !event.shiftKey) return false;
  if (!needsShift && event.shiftKey) return false;

  // Option changes event.key on macOS, so physical identity remains the
  // reliable fallback for combinations such as Option-Command-[.
  const codeKey = event.code.replace(/^(Key|Digit)/, "").toLowerCase();
  const bracket = key === "[" ? "bracketleft" : key === "]" ? "bracketright" : null;
  return event.key.toLowerCase() === key
    || codeKey === key
    || (bracket !== null && event.code.toLowerCase() === bracket);
}
