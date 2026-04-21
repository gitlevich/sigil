/**
 * Visible trace of the attention currently spending cycles outside the
 * embedded local sidecar. Reads `appState.resolutionIncrease` which carries
 * tier + provider + label.
 *
 *   kind === "rest"       — invisible slot, zero repaint.
 *   kind === "unserved"   — brief orange fade (attempt made, no fallback).
 *   kind === "in-flight"  — pulse. Color depends on tier:
 *                           "local"  → orange (non-embedded local attention).
 *                           "remote" → provider accent (network call, money).
 *
 * Two render modes: `variant="dot"` places just the colored dot; `variant="inline"`
 * renders the dot plus a short label, suitable for the streaming "Thinking..."
 * indicator where the @user's attention already sits.
 */
import { useAppState } from "../../state/AppContext";
import styles from "./IncreaseResolutionDot.module.css";

const REMOTE_ACCENT: Record<string, string> = {
  anthropic: "#c0744a",
  openai: "#10a37f",
};

const LOCAL_TIER_COLOR = "#e8871a";  // saturated orange for local escalation
const UNSERVED_COLOR = "#e08a3c";    // muted orange for the unserved flash

interface Props {
  variant?: "dot" | "inline";
}

function colorFor(state: { kind: string; tier?: string; provider?: string }): string {
  if (state.kind === "unserved") return UNSERVED_COLOR;
  if (state.kind !== "in-flight") return UNSERVED_COLOR;
  if (state.tier === "local") return LOCAL_TIER_COLOR;
  return REMOTE_ACCENT[state.provider ?? ""] ?? UNSERVED_COLOR;
}

function titleFor(state: { kind: string; tier?: string; label?: string }): string {
  if (state.kind === "unserved") {
    return "Tried to escalate — no fallback model configured.";
  }
  if (state.kind === "in-flight") {
    if (state.tier === "local") {
      return `Local attention running${state.label ? ` (${state.label})` : ""}. No network cost.`;
    }
    return `Remote attention running${state.label ? ` (${state.label})` : ""}. You are spending.`;
  }
  return "";
}

function labelFor(state: { kind: string; tier?: string }): string {
  if (state.kind === "unserved") return "couldn't reach further";
  if (state.tier === "local") return "local attention";
  return "remote attention";
}

export function IncreaseResolutionDot({ variant = "dot" }: Props) {
  const app = useAppState();
  const state = app.resolutionIncrease;

  if (state.kind === "rest") {
    if (variant === "inline") return null;
    return <span className={styles.slot} aria-hidden="true" />;
  }

  const color = colorFor(state);
  const title = titleFor(state);
  const label = labelFor(state);

  const dot = (
    <span
      className={`${styles.slot} ${state.kind === "in-flight" ? styles.pulse : styles.unserved}`}
      style={{ background: color, color }}
      title={title}
      aria-label={title}
    />
  );

  if (variant === "inline") {
    return (
      <span className={styles.inline} style={{ color }}>
        {dot}
        <span className={styles.inlineLabel}>{label}</span>
      </span>
    );
  }
  return dot;
}
