import { useEffect, useState } from "react";
import { getVersion } from "@tauri-apps/api/app";
import { useAppState, useAppDispatch } from "../../state/AppContext";
import styles from "./AboutDialog.module.css";

export function AboutDialog() {
  const state = useAppState();
  const dispatch = useAppDispatch();
  const [version, setVersion] = useState("");

  useEffect(() => {
    if (state.aboutOpen) getVersion().then(setVersion).catch(() => {});
  }, [state.aboutOpen]);

  if (!state.aboutOpen) return null;

  return (
    <div className={styles.overlay} onClick={() => dispatch({ type: "SET_ABOUT_OPEN", open: false })}>
      <div className={styles.dialog} onClick={(e) => e.stopPropagation()}>
        <h1 className={styles.title}>Sigil</h1>
        <p className={styles.version}>Version {version}</p>

        <div className={styles.body}>
          <p>
            A structured representation of how you think about a system.
            A sigil is a bounded context: a named scope with its own domain
            language, affordances — what can be done in it — and invariants —
            what must hold in it. Sigils nest, up to five per level, and the
            nesting makes the tree. The constraint forces you to find the
            right abstractions.
          </p>
          <p>
            When you talk to the design partner, it sees the whole tree. It
            inhabits your mental model. You and the partner agree on the level
            of abstraction to focus on, and the structure holds everything
            else so neither of you has to.
          </p>
        </div>

        <a
          className={styles.contactBtn}
          href="mailto:vlad@sigilengineering.com?subject=Sigil"
          onClick={(e) => {
            e.preventDefault();
            window.open("mailto:vlad@sigilengineering.com?subject=Sigil");
          }}
        >
          Get in touch
        </a>

        <button
          className={styles.closeBtn}
          onClick={() => dispatch({ type: "SET_ABOUT_OPEN", open: false })}
        >
          Close
        </button>
      </div>
    </div>
  );
}
