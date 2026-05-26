/**
 * Workspace Actions — well-specified persistence operations.
 *
 * Invariant: !integrity — every persistence operation validates preconditions,
 * reports errors visibly, and guarantees postconditions (reload).
 *
 * Affordance: #well-specified-actions — each action is defined in terms of
 * pre-conditions, the operation, post-conditions, and error handling.
 */

import { api, SigilFolder } from "../tauri";

// ── Dependencies injected by callers ──

export interface ActionDeps {
  rootPath: string;
  reload: (rootPath?: string) => Promise<unknown>;
  addToast: (message: string, type?: "error" | "info") => void;
  /**
   * Hand back a legible receipt after a mutation — the Workspace's
   * #confirmation affordance per !every-mutation-confirmed.
   * Optional because some contexts may not want visible feedback.
   */
  confirm?: (summary: string) => void;
}

export interface RenameSigilResult {
  oldName: string;
  newName: string;
  oldPath: string;
  newPath: string;
  filesUpdated: number;
}

export interface RenameSigilOptions {
  reloadAfter?: boolean;
}

// ── Precondition helpers ──

function requireNonEmpty(value: string, label: string): string {
  const trimmed = value.trim();
  if (!trimmed) throw new PreconditionError(`${label} cannot be empty`);
  return trimmed;
}

function requireDifferent(oldValue: string, newValue: string, label: string): void {
  if (oldValue === newValue) throw new PreconditionError(`${label}: old and new names are identical`);
}

class PreconditionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PreconditionError";
  }
}

// ── Action wrapper — enforces the contract ──

async function execute(
  deps: ActionDeps,
  operation: () => Promise<string | void>,
  options: { reloadAfter?: boolean } = {},
): Promise<void> {
  const { reloadAfter = true } = options;
  try {
    const summary = await operation();
    if (reloadAfter) {
      await deps.reload(deps.rootPath);
    }
    if (typeof summary === "string" && summary.length > 0) {
      deps.confirm?.(summary);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes("no longer exists")) {
      await deps.reload(deps.rootPath).catch(() => undefined);
    }
    deps.addToast(message, "error");
  }
}

// ── Sigil operations ──

/**
 * Create a new sigil as a child of the given sigil folder.
 *
 * Pre: name is non-empty.
 * Op: createSigil + write language.md with inherited status.
 * Post: reload tree.
 * Error: toast.
 */
export async function createSigil(
  folder: SigilFolder,
  name: string,
  deps: ActionDeps,
): Promise<void> {
  const humanName = name
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .replace(/[-_]+/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .trim();
  const dirName = humanName.replace(/\s+/g, "");

  await execute(deps, async () => {
    requireNonEmpty(dirName, "Sigil name");
    const parentStatusMatch = folder.language?.match(/^---[\s\S]*?^status:\s*(\S+)/m);
    const parentStatus = parentStatusMatch?.[1] ?? "idea";
    const newFolder = await api.createSigil(folder.path, dirName);
    await api.writeFile(`${newFolder.path}/language.md`, `---\nstatus: ${parentStatus}\n---\n\n# ${humanName}\n`);
    return `Created @${dirName}.`;
  });
}

/**
 * Rename a sigil and update all references across the spec.
 *
 * Pre: newName non-empty, target exists.
 * Op: api.renameSigil (handles reference updates).
 * Post: reload tree.
 * Error: toast.
 */
export async function renameSigil(
  targetPath: string,
  newName: string,
  deps: ActionDeps,
  options: RenameSigilOptions = {},
): Promise<RenameSigilResult | null> {
  let renameResult: RenameSigilResult | null = null;
  await execute(deps, async () => {
    requireNonEmpty(newName, "Sigil name");
    const result = await api.renameSigil(deps.rootPath, targetPath, newName);
    // Rust returns a JSON string: { new_path, files_updated }
    let filesUpdated = 0;
    let parsedResult: RenameSigilResult | null = null;
    try {
      const parsed = JSON.parse(result);
      if (typeof parsed?.files_updated === "number") filesUpdated = parsed.files_updated;
      parsedResult = {
        oldName: typeof parsed?.old_name === "string" ? parsed.old_name : targetPath.split("/").pop() ?? "",
        newName: typeof parsed?.new_name === "string" ? parsed.new_name : newName,
        oldPath: typeof parsed?.old_path === "string" ? parsed.old_path : targetPath,
        newPath: typeof parsed?.new_path === "string" ? parsed.new_path : result,
        filesUpdated,
      };
    } catch {
      // Older returns are just the new path; that's fine — we just omit the count.
      parsedResult = {
        oldName: targetPath.split("/").pop() ?? "",
        newName,
        oldPath: targetPath,
        newPath: result,
        filesUpdated,
      };
    }
    renameResult = parsedResult;
    return filesUpdated > 0
      ? `Renamed to @${newName}; updated ${filesUpdated} reference${filesUpdated === 1 ? "" : "s"}.`
      : `Renamed to @${newName}.`;
  }, { reloadAfter: options.reloadAfter ?? true });
  return renameResult;
}

/**
 * Rename a context (directory only, no cross-spec reference update).
 *
 * Pre: newName non-empty, differs from old.
 * Op: api.renameContext.
 * Post: reload tree.
 * Error: toast.
 */
export async function renameContext(
  contextPath: string,
  oldName: string,
  newName: string,
  deps: ActionDeps,
): Promise<void> {
  const trimmed = requireNonEmpty(newName, "Name");
  if (trimmed === oldName) return;

  await execute(deps, async () => {
    await api.renameContext(deps.rootPath, contextPath, trimmed);
  });
}

/**
 * Move a sigil under a new parent.
 *
 * Pre: source and target differ, target is not under source.
 * Op: api.moveSigil.
 * Post: reload tree.
 * Error: toast.
 */
export async function moveSigil(
  sourcePath: string,
  targetPath: string,
  deps: ActionDeps,
): Promise<void> {
  await execute(deps, async () => {
    if (sourcePath === targetPath) throw new PreconditionError("Cannot move a sigil onto itself");
    if (targetPath.startsWith(sourcePath + "/")) throw new PreconditionError("Cannot move a sigil under itself");
    await api.moveSigil(deps.rootPath, sourcePath, targetPath);
    const name = sourcePath.split("/").pop() ?? sourcePath;
    return `Moved @${name}.`;
  });
}

/**
 * Delete a sigil and all its contents.
 *
 * Pre: path exists (backend validates).
 * Op: api.deleteContext.
 * Post: reload tree.
 * Error: toast.
 */
export async function deleteSigil(
  path: string,
  deps: ActionDeps,
): Promise<void> {
  await execute(deps, async () => {
    await api.deleteContext(path);
    const name = path.split("/").pop() ?? path;
    return `Deleted @${name}.`;
  });
}

// ── Property operations (affordances & invariants) ──

/**
 * Create a new affordance on the current sigil folder.
 *
 * Pre: name non-empty.
 * Op: write empty affordance-{name}.md.
 * Post: reload tree.
 * Error: toast.
 */
export async function createAffordance(
  folder: SigilFolder,
  name: string,
  deps: ActionDeps,
): Promise<void> {
  await execute(deps, async () => {
    requireNonEmpty(name, "Affordance name");
    await api.writeFile(`${folder.path}/affordance-${name}.md`, "");
    return `Added #${name} to @${folder.name}.`;
  });
}

/**
 * Create a new invariant on the current sigil folder.
 *
 * Pre: name non-empty.
 * Op: write empty invariant-{name}.md.
 * Post: reload tree.
 * Error: toast.
 */
export async function createInvariant(
  folder: SigilFolder,
  name: string,
  deps: ActionDeps,
): Promise<void> {
  await execute(deps, async () => {
    requireNonEmpty(name, "Invariant name");
    await api.writeFile(`${folder.path}/invariant-${name}.md`, "");
    return `Added !${name} to @${folder.name}.`;
  });
}

/**
 * Rename a property (affordance or invariant) and update language.md references.
 *
 * Pre: names differ, both non-empty.
 * Op: read old content, write new file, delete old, update refs in language.md.
 * Post: reload tree.
 * Error: toast.
 */
export async function renameProperty(
  folder: SigilFolder,
  kind: "affordance" | "invariant",
  oldName: string,
  newName: string,
  deps: ActionDeps,
): Promise<void> {
  await execute(deps, async () => {
    requireNonEmpty(newName, "Property name");
    requireDifferent(oldName, newName, "Property rename");
    const prefix = kind === "affordance" ? "affordance" : "invariant";
    const oldPath = `${folder.path}/${prefix}-${oldName}.md`;
    const newPath = `${folder.path}/${prefix}-${newName}.md`;
    const oldContent = await api.readFile(oldPath).catch(() => "");
    await api.writeFile(newPath, oldContent);
    await api.deleteFile(oldPath);

    // Update references in language.md
    const refChar = kind === "affordance" ? "#" : "!";
    const lang = folder.language;
    const updated = lang.replace(
      new RegExp(`\\${refChar}${oldName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?=[^a-zA-Z0-9_-]|$)`, "g"),
      `${refChar}${newName}`,
    );
    if (updated !== lang) {
      await api.writeFile(`${folder.path}/language.md`, updated);
    }
  });
}

/**
 * Move a property (affordance/invariant) from one sigil to another.
 *
 * Pre: source and target differ.
 * Op: write to target, delete from source.
 * Post: reload tree.
 * Error: toast.
 */
export async function moveProperty(
  targetFsPath: string,
  source: { kind: "affordance" | "invariant"; name: string; content: string; sourcePath: string },
  deps: ActionDeps,
): Promise<void> {
  await execute(deps, async () => {
    if (source.sourcePath === targetFsPath) throw new PreconditionError("Source and target are the same sigil");
    await api.writeFile(`${targetFsPath}/${source.kind}-${source.name}.md`, source.content);
    await api.deleteFile(`${source.sourcePath}/${source.kind}-${source.name}.md`);
  });
}

/**
 * Update status frontmatter recursively on a sigil and all descendants.
 *
 * Pre: newValue non-empty.
 * Op: update status in language.md for folder and all children.
 * Post: reload tree.
 * Error: toast.
 */
export async function updateStatus(
  folder: SigilFolder,
  newValue: string,
  deps: ActionDeps,
): Promise<void> {
  await execute(deps, async () => {
    requireNonEmpty(newValue, "Status value");
    const statusPattern = /^(status:\s*)\S+$/m;
    const forceStatus = async (f: SigilFolder) => {
      const lang = f.language || "";
      if (statusPattern.test(lang)) {
        await api.writeFile(`${f.path}/language.md`, lang.replace(statusPattern, `$1${newValue}`));
      } else if (lang.startsWith("---")) {
        await api.writeFile(`${f.path}/language.md`, lang.replace(/^---/, `---\nstatus: ${newValue}`));
      } else {
        await api.writeFile(`${f.path}/language.md`, `---\nstatus: ${newValue}\n---\n${lang}`);
      }
      for (const child of f.children) await forceStatus(child);
    };
    await forceStatus(folder);
  });
}

// ── Property editor file operations ──

/**
 * Save property content (debounced by caller).
 *
 * Pre: name non-empty.
 * Op: write file.
 * Post: none (no reload — content saves are frequent).
 * Error: toast.
 */
export async function savePropertyContent(
  sigilPath: string,
  prefix: string,
  name: string,
  content: string,
  deps: ActionDeps,
): Promise<void> {
  await execute(deps, async () => {
    await api.writeFile(`${sigilPath}/${prefix}-${name}.md`, content);
  }, { reloadAfter: false });
}

/**
 * Save property display order.
 *
 * Op: write order JSON file.
 * Post: none (UI-only metadata).
 * Error: toast.
 */
export async function savePropertyOrder(
  sigilPath: string,
  prefix: string,
  names: string[],
  deps: ActionDeps,
): Promise<void> {
  await execute(deps, async () => {
    await api.writeFile(`${sigilPath}/${prefix}.order`, JSON.stringify(names));
  }, { reloadAfter: false });
}

/**
 * Save property fold state.
 *
 * Op: write fold JSON file.
 * Post: none (UI-only metadata).
 * Error: toast.
 */
export async function savePropertyFold(
  sigilPath: string,
  prefix: string,
  folded: string[],
  deps: ActionDeps,
): Promise<void> {
  await execute(deps, async () => {
    await api.writeFile(`${sigilPath}/${prefix}.folded`, JSON.stringify(folded));
  }, { reloadAfter: false });
}

/**
 * Commit a property name change (rename file on disk).
 *
 * Pre: newName non-empty.
 * Op: delete old file (if exists), write new file.
 * Post: reload tree.
 * Error: toast.
 */
export async function commitPropertyName(
  sigilPath: string,
  prefix: string,
  oldName: string,
  newName: string,
  content: string,
  deps: ActionDeps,
): Promise<void> {
  await execute(deps, async () => {
    const slugged = requireNonEmpty(newName, "Property name");
    if (oldName) {
      await api.deleteFile(`${sigilPath}/${prefix}-${oldName}.md`);
    }
    await api.writeFile(`${sigilPath}/${prefix}-${slugged}.md`, content);
  });
}

/**
 * Delete a property file.
 *
 * Pre: name non-empty.
 * Op: delete file.
 * Post: reload tree.
 * Error: toast.
 */
export async function deleteProperty(
  sigilPath: string,
  prefix: string,
  name: string,
  deps: ActionDeps,
): Promise<void> {
  await execute(deps, async () => {
    if (name) {
      await api.deleteFile(`${sigilPath}/${prefix}-${name}.md`);
    }
  });
}

/**
 * Create a sigil (directory) as child of parentPath.
 *
 * Pre: name non-empty (backend validates 5-child limit).
 * Op: api.createSigil.
 * Post: reload tree.
 * Error: toast.
 */
export async function createChildSigil(
  parentPath: string,
  name: string,
  deps: ActionDeps,
): Promise<void> {
  await execute(deps, async () => {
    requireNonEmpty(name, "Sigil name");
    await api.createSigil(parentPath, name);
  });
}
