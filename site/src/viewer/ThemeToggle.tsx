import { useViewerState, useViewerDispatch } from "./ViewerState";

export function ThemeToggle() {
  const { theme } = useViewerState();
  const dispatch = useViewerDispatch();

  const toggle = () => {
    const next = theme === "dark" ? "light" : "dark";
    localStorage.setItem("sigil-viewer-theme", next);
    dispatch({ type: "SET_THEME", theme: next });
  };

  return (
    <button
      onClick={toggle}
      style={{
        background: "none",
        border: "1px solid var(--border)",
        borderRadius: 4,
        color: "var(--text-secondary)",
        cursor: "pointer",
        padding: "4px 8px",
        fontSize: "0.8rem",
      }}
      title={`Switch to ${theme === "dark" ? "light" : "dark"} theme`}
    >
      {theme === "dark" ? "Light" : "Dark"}
    </button>
  );
}
