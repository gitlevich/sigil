/**
 * GlobalStatusBar — full-width tray of ambient indicators along the bottom of
 * the window. Lives outside the three-pane row, so its lights are visible no
 * matter where the @user's attention sits.
 *
 * Right-side tray hosts indicator lights (currently #increase-resolution).
 * Left side is reserved for future global status text. Each light wraps in a
 * slot that shows a what-is-this / how-to-use tooltip on hover, separate from
 * the light's own state-specific title.
 */
import { IncreaseResolutionDot } from "../DesignPartner/IncreaseResolutionDot";
import styles from "./GlobalStatusBar.module.css";

const REMOTE_TIP =
  "Remote model indicator.\n" +
  "Lights when DP escalates from the local model to a more capable remote one.\n" +
  "Off: local only, no cost.\n" +
  "Pulsing: remote call in flight (you are spending).\n" +
  "Brief flash: tried to escalate but no fallback model is configured.\n" +
  "Configure the fallback in Settings.";

export function GlobalStatusBar() {
  return (
    <div className={styles.bar} role="status" aria-label="Global status">
      <div className={styles.left} />
      <div className={styles.tray} aria-label="Indicator lights">
        <span className={styles.slot} aria-label={REMOTE_TIP}>
          <IncreaseResolutionDot />
          <span className={styles.tooltip} role="tooltip">{REMOTE_TIP}</span>
        </span>
      </div>
    </div>
  );
}
