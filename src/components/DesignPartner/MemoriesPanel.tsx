/**
 * MemoriesPanel — @Memory as nested sigils.
 *
 * Spec path: DesignPartner/BicameralMind/Memory
 *
 * A remembered @sigil contains what the DP remembers about it: its vocabulary,
 * its companions (the connectivity graph from consolidation), and its resolution
 * (weight). Companions are themselves remembered sigils — clicking one dives into
 * what the DP remembers about that one. This is Memory reflecting the nested
 * shape of the outside.
 *
 * Two sections:
 *   Paths — short-term traces, the initial trajectory-form before consolidation
 *   Spheres — long-term consolidated remembered sigils, with connectivity graph
 */
import { useState, useEffect } from "react";
import { useExperience } from "../../state/ExperienceContext";
import type { RememberedSigil, ShortTermTrace } from "sigil-core/memory";
import type { CoOccurrence } from "sigil-core/sigilSpace";
import styles from "./MemoriesPanel.module.css";

const MAX_DIVE_DEPTH = 4;

export function MemoriesPanel() {
  const { getMemory } = useExperience();
  const [shortTerm, setShortTerm] = useState<ShortTermTrace[]>([]);
  const [longTerm, setLongTerm] = useState<Map<string, RememberedSigil>>(new Map());

  useEffect(() => {
    const update = () => {
      const mem = getMemory();
      const byName = new Map<string, ShortTermTrace>();
      for (const t of mem.shortTerm) byName.set(t.name, t);
      setShortTerm([...byName.values()].sort((a, b) => b.timestamp - a.timestamp));
      setLongTerm(new Map(mem.longTerm));
    };
    update();
    const interval = setInterval(update, 2000);
    return () => clearInterval(interval);
  }, [getMemory]);

  const visibleLongTerm = [...longTerm.values()]
    .filter(r => r.weight >= 0.1)
    .sort((a, b) => b.weight - a.weight);

  const isEmpty = shortTerm.length === 0 && visibleLongTerm.length === 0;

  return (
    <div className={styles.container}>
      {isEmpty ? (
        <div className={styles.empty}>No memories yet. Edit sigils to build remembered positions.</div>
      ) : (
        <div className={styles.scroll}>
          <Section label="Paths" count={shortTerm.length} accent="short" hint="trajectories not yet a sphere">
            {shortTerm.map(t => (
              <TraceEntry key={t.name} trace={t} longTerm={longTerm} />
            ))}
          </Section>
          <Section label="Spheres" count={visibleLongTerm.length} accent="long" hint="consolidated, with companions">
            {visibleLongTerm.map(r => (
              <RememberedEntry key={r.name} entry={r} longTerm={longTerm} />
            ))}
          </Section>
        </div>
      )}
    </div>
  );
}

function Section({ label, count, accent, hint, children }: {
  label: string;
  count: number;
  accent: "short" | "long";
  hint: string;
  children: React.ReactNode;
}) {
  return (
    <div className={styles.section}>
      <div className={`${styles.sectionHeader} ${styles[accent]}`}>
        {label}
        {count > 0 && <span className={styles.count}>{count}</span>}
        <span className={styles.sectionHint}>{hint}</span>
      </div>
      {count === 0 ? (
        <div className={styles.sectionEmpty}>
          {accent === "short" ? "no fresh paths" : "no consolidated spheres"}
        </div>
      ) : (
        <div className={styles.entries}>{children}</div>
      )}
    </div>
  );
}

function TraceEntry({ trace, longTerm }: { trace: ShortTermTrace; longTerm: Map<string, RememberedSigil> }) {
  const [expanded, setExpanded] = useState(false);
  const timeStr = new Date(trace.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

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
          <Vocabulary affordances={trace.vocabulary.affordances} invariants={trace.vocabulary.invariants} />
          <Companions edges={trace.edges} longTerm={longTerm} visited={new Set([trace.name])} depth={1} />
        </div>
      )}
    </div>
  );
}

function RememberedEntry({ entry, longTerm }: { entry: RememberedSigil; longTerm: Map<string, RememberedSigil> }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className={`${styles.entry} ${styles.longEntry}`}>
      <div className={styles.entryRow} onClick={() => setExpanded(!expanded)}>
        <span className={styles.expandIcon}>{expanded ? "\u25BC" : "\u25B6"}</span>
        <span className={styles.entryName}>{entry.name}</span>
        <ResolutionBar weight={entry.weight} />
        <VocabIcons affordances={entry.vocabulary.affordances} invariants={entry.vocabulary.invariants} />
      </div>
      {expanded && (
        <div className={styles.entryDetail}>
          <Vocabulary affordances={entry.vocabulary.affordances} invariants={entry.vocabulary.invariants} />
          <Companions edges={entry.edges} longTerm={longTerm} visited={new Set([entry.name])} depth={1} />
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

function Vocabulary({ affordances, invariants }: { affordances: string[]; invariants: string[] }) {
  if (affordances.length === 0 && invariants.length === 0) return null;
  return (
    <>
      {affordances.length > 0 && (
        <div className={styles.vocabLine}>
          <span className={styles.vocabLabel}>affordances</span>
          {affordances.map(a => <span key={a} className={styles.vocabTag}>#{a}</span>)}
        </div>
      )}
      {invariants.length > 0 && (
        <div className={styles.vocabLine}>
          <span className={styles.vocabLabel}>invariants</span>
          {invariants.map(i => <span key={i} className={styles.vocabTag}>!{i}</span>)}
        </div>
      )}
    </>
  );
}

function Companions({ edges, longTerm, visited, depth }: {
  edges: CoOccurrence[];
  longTerm: Map<string, RememberedSigil>;
  visited: Set<string>;
  depth: number;
}) {
  if (edges.length === 0) return null;
  const sorted = [...edges].sort((a, b) => b.count - a.count);
  return (
    <div className={styles.vocabLine}>
      <span className={styles.vocabLabel}>companions</span>
      <div className={styles.companions}>
        {sorted.map(e => (
          <CompanionEdge
            key={e.target}
            edge={e}
            longTerm={longTerm}
            visited={visited}
            depth={depth}
          />
        ))}
      </div>
    </div>
  );
}

function CompanionEdge({ edge, longTerm, visited, depth }: {
  edge: CoOccurrence;
  longTerm: Map<string, RememberedSigil>;
  visited: Set<string>;
  depth: number;
}) {
  const [expanded, setExpanded] = useState(false);
  const remembered = longTerm.get(edge.target);
  const alreadyVisited = visited.has(edge.target);
  const canDive = !!remembered && !alreadyVisited && depth < MAX_DIVE_DEPTH;

  const nextVisited = canDive ? new Set([...visited, edge.target]) : visited;

  return (
    <div className={styles.companion}>
      <span
        className={`${styles.companionHead} ${canDive ? styles.companionDivable : ""}`}
        onClick={canDive ? () => setExpanded((e) => !e) : undefined}
        title={alreadyVisited ? "already in this path" : (remembered ? "dive in" : "not yet a sphere")}
      >
        {canDive && <span className={styles.companionToggle}>{expanded ? "\u25BC" : "\u25B6"}</span>}
        <span className={styles.edgeTag}>@{edge.target}</span>
        <span className={styles.edgeCount}>({edge.count})</span>
      </span>
      {expanded && remembered && (
        <div className={styles.companionDetail}>
          <ResolutionBar weight={remembered.weight} />
          <Vocabulary
            affordances={remembered.vocabulary.affordances}
            invariants={remembered.vocabulary.invariants}
          />
          <Companions
            edges={remembered.edges}
            longTerm={longTerm}
            visited={nextVisited}
            depth={depth + 1}
          />
        </div>
      )}
    </div>
  );
}

function ResolutionBar({ weight }: { weight: number }) {
  const pct = Math.min(100, Math.max(0, (weight / 3.0) * 100));
  return (
    <span className={styles.weightBar} title={`resolution ${weight.toFixed(2)}`}>
      <span className={styles.weightFill} style={{ width: `${pct}%` }} />
    </span>
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
