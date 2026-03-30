import { useState, useEffect, useCallback } from "react";
import { useAppDispatch, useDocument } from "../../state/AppContext";
import { api, Context } from "../../tauri";
import { useAutoSave } from "../../hooks/useAutoSave";
import styles from "./OntologyEditor.module.css";

interface OntologyNode {
  name: string;
  path: string[];
  depth: number;
  children: OntologyNode[];
}

function buildOntology(ctx: Context, path: string[], depth: number): OntologyNode {
  return {
    name: ctx.name,
    path,
    depth,
    children: ctx.children.map((c) => buildOntology(c, [...path, c.name], depth + 1)),
  };
}

function nodeMatches(node: OntologyNode, query: string): boolean {
  if (node.name.toLowerCase().includes(query)) return true;
  return node.children.some((c) => nodeMatches(c, query));
}

function parseDefinitions(content: string): Record<string, string> {
  const result: Record<string, string> = {};
  const sections = content.split(/^## /m);
  for (const section of sections.slice(1)) {
    const newline = section.indexOf("\n");
    if (newline === -1) continue;
    const name = section.slice(0, newline).trim();
    const body = section.slice(newline + 1).trim();
    result[name] = body;
  }
  return result;
}

function serializeDefinitions(defs: Record<string, string>): string {
  const entries = Object.entries(defs).filter(([, v]) => v.trim());
  if (entries.length === 0) return "";
  return entries.map(([k, v]) => `## ${k}\n\n${v.trim()}`).join("\n\n") + "\n";
}

function OntologyItem({
  node,
  currentPath,
  search,
  definitions,
  onNavigate,
  onDefinitionChange,
}: {
  node: OntologyNode;
  currentPath: string[];
  search: string;
  definitions: Record<string, string>;
  onNavigate: (path: string[]) => void;
  onDefinitionChange: (name: string, value: string) => void;
}) {
  const hasChildren = node.children.length > 0;
  const isActive = currentPath.join("/") === node.path.join("/");
  const forceExpand = search.length > 0 && node.children.some((c) => nodeMatches(c, search));
  const [expanded, setExpanded] = useState(true);
  const [defOpen, setDefOpen] = useState(false);
  const open = forceExpand || expanded;

  const visibleChildren = search
    ? node.children.filter((c) => nodeMatches(c, search))
    : node.children;

  return (
    <div className={styles.item} style={{ paddingLeft: `${node.depth * 14}px` }}>
      <div className={styles.row}>
        {hasChildren ? (
          <button
            className={styles.chevron}
            onClick={(e) => { e.stopPropagation(); setExpanded(!expanded); }}
          >
            {open ? "\u25BC" : "\u25B6"}
          </button>
        ) : (
          <span className={styles.chevronPlaceholder} />
        )}
        <span
          className={`${styles.term} ${isActive ? styles.active : ""}`}
          onClick={() => onNavigate(node.path)}
        >
          @{node.name}
        </span>
        <button
          className={`${styles.defBtn} ${defOpen ? styles.defBtnOpen : ""}`}
          title={defOpen ? "Hide definition" : "Show definition"}
          onClick={(e) => { e.stopPropagation(); setDefOpen(!defOpen); }}
        >
          ¶
        </button>
      </div>
      {defOpen && (
        <div className={styles.defArea} style={{ paddingLeft: `${14}px` }}>
          <textarea
            className={styles.defTextarea}
            value={definitions[node.name] ?? ""}
            placeholder="Definition..."
            onChange={(e) => onDefinitionChange(node.name, e.target.value)}
          />
        </div>
      )}
      {open && visibleChildren.map((child) => (
        <OntologyItem
          key={child.name}
          node={child}
          currentPath={currentPath}
          search={search}
          definitions={definitions}
          onNavigate={onNavigate}
          onDefinitionChange={onDefinitionChange}
        />
      ))}
    </div>
  );
}

export function OntologyEditor() {
  const doc = useDocument();
  const dispatch = useAppDispatch();
  const { save } = useAutoSave();
  const [search, setSearch] = useState("");
  const [definitions, setDefinitions] = useState<Record<string, string>>({});

  const ontologyPath = doc ? `${doc.sigil.root_path}/ontology.md` : "";

  useEffect(() => {
    if (!doc) return;
    api.readFile(`${doc.sigil.root_path}/ontology.md`)
      .then((text) => setDefinitions(parseDefinitions(text)))
      .catch(() => setDefinitions({}));
  }, [doc?.sigil.root_path]);

  const handleDefinitionChange = useCallback((name: string, value: string) => {
    setDefinitions((prev) => {
      const next = { ...prev, [name]: value };
      if (ontologyPath) save(ontologyPath, serializeDefinitions(next));
      return next;
    });
  }, [ontologyPath, save]);

  if (!doc) return null;

  const root = buildOntology(doc.sigil.root, [], 0);
  const query = search.toLowerCase().trim();

  const navigate = (path: string[]) => {
    dispatch({ type: "UPDATE_DOCUMENT", updates: { currentPath: path } });
  };

  const rootVisible = !query || nodeMatches(root, query);

  return (
    <div className={styles.container}>
      <div className={styles.toolbar}>
        <input
          className={styles.search}
          placeholder="Search ontology..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>
      <div className={styles.tree}>
        {rootVisible && (
          <>
            <div className={styles.row}>
              <span className={styles.chevronPlaceholder} />
              <span
                className={`${styles.term} ${doc.currentPath.length === 0 ? styles.active : ""}`}
                onClick={() => navigate([])}
              >
                @{root.name}
              </span>
            </div>
            {root.children
              .filter((c) => !query || nodeMatches(c, query))
              .map((child) => (
                <OntologyItem
                  key={child.name}
                  node={child}
                  currentPath={doc.currentPath}
                  search={query}
                  definitions={definitions}
                  onNavigate={navigate}
                  onDefinitionChange={handleDefinitionChange}
                />
              ))}
          </>
        )}
      </div>
    </div>
  );
}
