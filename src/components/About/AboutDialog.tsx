import { useAppState, useAppDispatch } from "../../state/AppContext";
import styles from "./AboutDialog.module.css";

export function AboutDialog() {
  const state = useAppState();
  const dispatch = useAppDispatch();

  if (!state.aboutOpen) return null;

  return (
    <div className={styles.overlay} onClick={() => dispatch({ type: "SET_ABOUT_OPEN", open: false })}>
      <div className={styles.dialog} onClick={(e) => e.stopPropagation()}>
        <h1 className={styles.title}>Sigil</h1>
        <p className={styles.version}>Version 0</p>

        <div className={styles.body}>
          <p>
            A structured representation of how you think about a system.
            Each sigil is a tree of bounded contexts, each with its own domain
            language and technical decisions. The hard limit of five sub-contexts
            per level forces you to find the right abstractions.
          </p>
          <p>
            When you talk to the AI agent, it sees the entire sigil. It inhabits
            your mental model. You and the agent agree on the level of abstraction
            to focus on, and the structure holds everything else so neither of
            you has to.
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
