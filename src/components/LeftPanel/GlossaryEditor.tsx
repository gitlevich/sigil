import { useState, useEffect, useCallback } from "react";
import { useDocument } from "../../state/AppContext";
import { api, Context } from "../../tauri";
import { useAutoSave } from "../../hooks/useAutoSave";
import { MarkdownPreview } from "../Editor/MarkdownPreview";
import styles from "./GlossaryEditor.module.css";

/** Collect all sigil names from the tree, depth-first. */
function collectNames(ctx: Context, depth: number): { name: string; depth: number }[] {
  const result: { name: string; depth: number }[] = [];
  for (const child of [...ctx.children].sort((a, b) => a.name.localeCompare(b.name))) {
    result.push({ name: child.name, depth });
    result.push(...collectNames(child, depth + 1));
  }
  return result;
}

/** Generate a glossary markdown from the sigil tree. */
function generateGlossary(root: Context): string {
  const entries = collectNames(root, 0);
  return entries
    .map((e) => `${"#".repeat(e.depth + 2)} ${e.name}\n\n`)
    .join("");
}

/** Insert a new entry into existing glossary content in alphabetical order at top level. */
export function insertGlossaryEntry(content: string, name: string): string {
  const lines = content.split("\n");
  const entry = `## ${name}\n\n`;

  // Find the right alphabetical position among ## headers
  let insertIndex = lines.length;
  for (let i = 0; i < lines.length; i++) {
    const match = lines[i].match(/^## (.+)/);
    if (match && match[1].localeCompare(name) > 0) {
      insertIndex = i;
      break;
    }
  }

  lines.splice(insertIndex, 0, ...entry.split("\n"));
  return lines.join("\n");
}

export function GlossaryEditor() {
  const doc = useDocument();
  const { save } = useAutoSave();
  const [content, setContent] = useState("");
  const [search, setSearch] = useState("");
  const [mode, setMode] = useState<"edit" | "preview">("preview");
  const [loaded, setLoaded] = useState(false);

  const glossaryPath = doc ? `${doc.sigil.root_path}/glossary.md` : "";

  // Load glossary or auto-generate from tree
  useEffect(() => {
    if (!doc) return;
    const path = `${doc.sigil.root_path}/glossary.md`;
    api.readFile(path)
      .then((text) => {
        setContent(text);
        setLoaded(true);
      })
      .catch(() => {
        // File doesn't exist — generate from tree
        const generated = `# Glossary\n\n${generateGlossary(doc.sigil.root)}`;
        setContent(generated);
        api.writeFile(path, generated).catch(console.error);
        setLoaded(true);
      });
  }, [doc?.sigil.root_path]);

  const handleChange = useCallback((text: string) => {
    setContent(text);
    if (glossaryPath) save(glossaryPath, text);
  }, [glossaryPath, save]);

  if (!doc || !loaded) return null;

  // Filter content by search term — show only matching ## sections
  let displayContent = content;
  if (search.trim()) {
    const lines = content.split("\n");
    const filtered: string[] = [];
    let include = false;
    for (const line of lines) {
      if (line.startsWith("## ") || line.startsWith("### ") || line.startsWith("#### ")) {
        include = line.toLowerCase().includes(search.toLowerCase());
      }
      if (line.startsWith("# ") && !line.startsWith("## ")) {
        filtered.push(line);
        continue;
      }
      if (include) filtered.push(line);
    }
    displayContent = filtered.join("\n");
  }

  return (
    <div className={styles.container}>
      <div className={styles.toolbar}>
        <input
          className={styles.search}
          placeholder="Search glossary..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <button
          className={`${styles.modeBtn} ${mode === "edit" ? styles.active : ""}`}
          onClick={() => setMode("edit")}
        >
          Edit
        </button>
        <button
          className={`${styles.modeBtn} ${mode === "preview" ? styles.active : ""}`}
          onClick={() => setMode("preview")}
        >
          Preview
        </button>
      </div>

      <div className={styles.content}>
        {mode === "edit" ? (
          <textarea
            className={styles.textarea}
            value={search ? displayContent : content}
            onChange={(e) => {
              if (!search) handleChange(e.target.value);
            }}
            readOnly={!!search}
          />
        ) : (
          <div className={styles.previewArea}>
            {content ? (
              <MarkdownPreview content={search ? displayContent : content} />
            ) : (
              <p className={styles.placeholder}>
                No glossary yet. Switch to Edit to start defining terms.
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
