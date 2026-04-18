/**
 * Small glow the @user sees when the local @LeftHemisphere attempted
 * #increase-resolution.
 *
 * Three states rendered from `appState.resolutionIncrease`:
 *   rest      — invisible, zero footprint, no repaint.
 *   unserved  — orange flash for UNSERVED_FADE_MS (managed by the hook),
 *               no pulse: attempt made, no fallback configured.
 *   in-flight — fallback's accent color, slow sine pulse while the remote
 *               connection is live.
 *
 * Placement: left edge of the DP chat input, where attention already rests.
 */
import { useAppState } from "../../state/AppContext";
import { fallbackProvider } from "../../tauri";
import styles from "./IncreaseResolutionDot.module.css";

const PROVIDER_ACCENT: Record<string, string> = {
  anthropic: "#c0744a",
  openai: "#10a37f",
  local: "#7a5cbd",
  ollama: "#4a90e2",
};

const UNSERVED_COLOR = "#e08a3c";

export function IncreaseResolutionDot() {
  const app = useAppState();
  const state = app.resolutionIncrease;
  if (state === "rest") {
    return <span className={styles.slot} aria-hidden="true" />;
  }

  const color = state === "unserved"
    ? UNSERVED_COLOR
    : PROVIDER_ACCENT[fallbackProvider(app.settings)?.provider ?? ""] ?? UNSERVED_COLOR;

  const title = state === "unserved"
    ? "Local reached for more resolution — no higher-resolution model configured."
    : "Local is reaching for higher resolution.";

  return (
    <span
      className={`${styles.slot} ${state === "in-flight" ? styles.pulse : styles.unserved}`}
      style={{ background: color, color }}
      title={title}
      aria-label={title}
    />
  );
}
