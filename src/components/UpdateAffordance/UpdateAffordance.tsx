import styles from "./UpdateAffordance.module.css";

interface UpdateAffordanceProps {
  version: string;
  onInstall: () => void;
  onDismiss: () => void;
}

export function UpdateAffordance({
  version,
  onInstall,
  onDismiss,
}: UpdateAffordanceProps) {
  return (
    <aside className={styles.affordance} aria-live="polite" aria-label="Sigil update">
      <span>Sigil {version} is available.</span>
      <button type="button" onClick={onInstall}>
        Update
      </button>
      <button
        type="button"
        className={styles.dismiss}
        onClick={onDismiss}
        aria-label="Dismiss update"
      >
        Later
      </button>
    </aside>
  );
}
