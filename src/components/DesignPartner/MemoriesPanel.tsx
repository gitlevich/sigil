/**
 * MemoriesPanel — two-layer memory tree.
 *
 * Top: short-term traces (recent, amber accent)
 * Bottom: long-term entries (consolidated, blue accent)
 * Read-only tree view matching the OntologyTree visual style.
 */
import { useState, useEffect } from "react";
import { useExperience } from "../../state/ExperienceContext";
import type { RememberedSigil, ShortTermTrace } from "sigil-core/memory";
import styles from "./MemoriesPanel.module.css";

export function MemoriesPanel() {
  const { getMemory } = useExperience();
  const [shortTerm, setShortTerm] = useState<ShortTermTrace[]>([]);
  const [longTerm, setLongTerm] = useState<RememberedSigil[]>([]);

  useEffect(() => {
    const update = () => {
      const mem = getMemory();
      // Deduplicate short-term by name, keep most recent
      const byName = new Map<string, ShortTermTrace>();
      for (const t of mem.shortTerm) byName.set(t.name, t);
      setShortTerm([...byName.values()].sort((a, b) => b.timestamp - a.timestamp));
      setLongTerm(
        [...mem.longTerm.values()]
          .filter(r => r.weight >= 0.1)
          .sort((a, b) => b.weight - a.weight),
      );
    };
    update();
    const interval = setInterval(update, 2000);
    return () => clearInterval(interval);
  }, [getMemory]);

  const isEmpty = shortTerm.length === 0 && longTerm.length === 0;

  return (
    <div className={styles.container}>
      {isEmpty ? (
        <div className={styles.empty}>No memories yet. Edit sigils to build remembered positions.</div>
      ) : (
        <div className={styles.scroll}>
          <Section label="Short-term" count={shortTerm.length} accent="short">
            {shortTerm.map(t => (
              <TraceEntry key={t.name} trace={t} />
            ))}
          </Section>
          <Section label="Long-term" count={longTerm.length} accent="long">
            {longTerm.map(r => (
              <RememberedEntry key={r.name} entry={r} />
            ))}
          </Section>
        </div>
      )}
    </div>
  );
}

function Section({ label, count, accent, children }: {
  label: string;
  count: number;
  accent: "short" | "long";
  children: React.ReactNode;
}) {
  return (
    <div className={styles.section}>
      <div className={`${styles.sectionHeader} ${styles[accent]}`}>
        {label}
        {count > 0 && <span className={styles.count}>{count}</span>}
      </div>
      {count === 0 ? (
        <div className={styles.sectionEmpty}>
          {accent === "short" ? "No recent traces" : "No consolidated memories"}
        </div>
      ) : (
        <div className={styles.entries}>{children}</div>
      )}
    </div>
  );
}

function TraceEntry({ trace }: { trace: ShortTermTrace }) {
  const [expanded, setExpanded] = useState(false);
  const time = new Date(trace.timestamp);
  const timeStr = time.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

  return (
    <div className={`${styles.entry} ${styles.shortEntry}`}>
      <div className={styles.entryRow} onClick={() => setExpanded(!expanded)}>
        <span className={styles.expandIcon}>{expanded ? "\u25BC" : "\u25B6"}</span>
        <span className={styles.entryName}>{trace.name}</span>
        <span className={styles.entryTime}>{timeStr}</span>
        <VocabIcons affordances={trace.vocabulary.affordances} invariants={trace.vocabulary.invariants} />
      </div>
      {expanded && (
        <div className={styles.entryDetail}>
          {trace.vocabulary.affordances.length > 0 && (
            <div className={styles.vocabLine}>
              <span className={styles.vocabLabel}>affordances</span>
              {trace.vocabulary.affordances.map(a => (
                <span key={a} className={styles.vocabTag}>#{a}</span>
              ))}
            </div>
          )}
          {trace.vocabulary.invariants.length > 0 && (
            <div className={styles.vocabLine}>
              <span className={styles.vocabLabel}>invariants</span>
              {trace.vocabulary.invariants.map(i => (
                <span key={i} className={styles.vocabTag}>!{i}</span>
              ))}
            </div>
          )}
          {trace.edges.length > 0 && (
            <div className={styles.vocabLine}>
              <span className={styles.vocabLabel}>co-occurs</span>
              {trace.edges.slice(0, 8).map(e => (
                <span key={e.target} className={styles.edgeTag}>@{e.target} ({e.count})</span>
              ))}
              {trace.edges.length > 8 && <span className={styles.more}>+{trace.edges.length - 8}</span>}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function RememberedEntry({ entry }: { entry: RememberedSigil }) {
  const [expanded, setExpanded] = useState(false);
  const weightPct = Math.min(100, Math.round((entry.weight / 3.0) * 100));

  return (
    <div className={`${styles.entry} ${styles.longEntry}`}>
      <div className={styles.entryRow} onClick={() => setExpanded(!expanded)}>
        <span className={styles.expandIcon}>{expanded ? "\u25BC" : "\u25B6"}</span>
        <span className={styles.entryName}>{entry.name}</span>
        <span className={styles.weightBar}>
          <span className={styles.weightFill} style={{ width: `${weightPct}%` }} />
        </span>
        <span className={styles.weightLabel}>{entry.weight.toFixed(1)}</span>
        <VocabIcons affordances={entry.vocabulary.affordances} invariants={entry.vocabulary.invariants} />
      </div>
      {expanded && (
        <div className={styles.entryDetail}>
          {entry.vocabulary.affordances.length > 0 && (
            <div className={styles.vocabLine}>
              <span className={styles.vocabLabel}>affordances</span>
              {entry.vocabulary.affordances.map(a => (
                <span key={a} className={styles.vocabTag}>#{a}</span>
              ))}
            </div>
          )}
          {entry.vocabulary.invariants.length > 0 && (
            <div className={styles.vocabLine}>
              <span className={styles.vocabLabel}>invariants</span>
              {entry.vocabulary.invariants.map(i => (
                <span key={i} className={styles.vocabTag}>!{i}</span>
              ))}
            </div>
          )}
          {entry.edges.length > 0 && (
            <div className={styles.vocabLine}>
              <span className={styles.vocabLabel}>co-occurs</span>
              {entry.edges.slice(0, 8).map(e => (
                <span key={e.target} className={styles.edgeTag}>@{e.target} ({e.count})</span>
              ))}
              {entry.edges.length > 8 && <span className={styles.more}>+{entry.edges.length - 8}</span>}
            </div>
          )}
          <div className={styles.meta}>
            remembered {new Date(entry.createdAt).toLocaleDateString()}
            {" \u00b7 "}
            reinforced {new Date(entry.lastReinforced).toLocaleDateString()}
          </div>
        </div>
      )}
    </div>
  );
}

function VocabIcons({ affordances, invariants }: { affordances: string[]; invariants: string[] }) {
  if (affordances.length === 0 && invariants.length === 0) return null;
  return (
    <span className={styles.vocabIcons}>
      {invariants.map(name => (
        <span key={`i-${name}`} className={styles.iconWrap} title={`!${name}`}>
          <svg width="6" height="11" viewBox="0 0 6 13">
            <line x1="3" y1="1" x2="3" y2="12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            <circle cx="3" cy="4.5" r="2" fill="#f40009" />
          </svg>
        </span>
      ))}
      {affordances.map(name => (
        <span key={`a-${name}`} className={styles.iconWrap} title={`#${name}`}>
          <svg width="10" height="10" viewBox="0 0 14 14">
            <rect x="2" y="2" width="4" height="10" rx="1" fill="none" stroke="currentColor" strokeWidth="1.2" />
            <path d="M6 7 L11 7 L12 9" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </span>
      ))}
    </span>
  );
}
