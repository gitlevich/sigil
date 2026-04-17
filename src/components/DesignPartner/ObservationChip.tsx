/**
 * ObservationChip — a quiet surface for the DP's frame-tick observations.
 *
 * Appears in the corner when the DP notices something, stays for a few
 * seconds, then fades. Click to dismiss early. If ignored, it dissipates
 * on its own — the observation persists in the Experience panel regardless.
 */
import { useEffect, useState } from "react";
import styles from "./ObservationChip.module.css";

const DISPLAY_MS = 12_000;

export interface Observation {
  id: number;
  text: string;
  exploration: boolean;
}

interface ObservationChipProps {
  observation: Observation | null;
  onDismiss: () => void;
}

export function ObservationChip({ observation, onDismiss }: ObservationChipProps) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!observation) {
      setVisible(false);
      return;
    }
    setVisible(true);
    const t = setTimeout(() => {
      setVisible(false);
      const t2 = setTimeout(onDismiss, 400);
      return () => clearTimeout(t2);
    }, DISPLAY_MS);
    return () => clearTimeout(t);
  }, [observation?.id, onDismiss]);

  if (!observation) return null;

  return (
    <div
      className={`${styles.chip} ${visible ? styles.visible : styles.hidden} ${observation.exploration ? styles.exploring : ""}`}
      onClick={onDismiss}
      role="status"
      aria-live="polite"
    >
      <span className={styles.dot} aria-hidden />
      <span className={styles.text}>{observation.text}</span>
    </div>
  );
}
