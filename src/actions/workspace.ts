/**
 * Workspace Actions — well-specified persistence operations.
 *
 * Invariant: !integrity — every persistence operation validates preconditions,
 * reports errors visibly, and guarantees postconditions (reload).
 *
 * Affordance: #well-specified-actions — each action is defined in terms of
 * pre-conditions, the operation, post-conditions, and error handling.
 */

import { api, Context } from "../tauri";

// ── Dependencies injected by callers ──

export interface ActionDeps {
  rootPath: string;
  reload: (rootPath: string) => Promise<unknown>;
  addToast: (message: string, type?: "error" | "info") => void;
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
  operation: () => Promise<void>,
  options: { reloadAfter?: boolean } = {},
): Promise<void> {
  const { reloadAfter = true } = options;
  try {
    await operation();
    if (reloadAfter) {
      await deps.reload(deps.rootPath);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    deps.addToast(message, "error");
  }
}

// ── Sigil operations ──

/**
 * Create a new sigil as a child of the given context.
 *
 * Pre: name is non-empty.
 * Op: createContext + write language.md with inherited status.
 * Post: reload tree.
 * Error: toast.
 */
export async function createSigil(
  ctx: Context,
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
    const parentStatusMatch = ctx.domain_language?.match(/^---[\s\S]*?^status:\s*(\S+)/m);
    const parentStatus = parentStatusMatch?.[1] ?? "idea";
    const newCtx = await api.createContext(ctx.path, dirName);
    await api.writeFile(`${newCtx.path}/language.md`, `---\nstatus: ${parentStatus}\n---\n\n# ${humanName}\n`);
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
): Promise<void> {
  await execute(deps, async () => {
    requireNonEmpty(newName, "Sigil name");
    await api.renameSigil(deps.rootPath, targetPath, newName);
  });
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
  });
}

// ── Property operations (affordances & invariants) ──

/**
 * Create a new affordance on the current context.
 *
 * Pre: name non-empty.
 * Op: write empty affordance-{name}.md.
 * Post: reload tree.
 * Error: toast.
 */
export async function createAffordance(
  ctx: Context,
  name: string,
  deps: ActionDeps,
): Promise<void> {
  await execute(deps, async () => {
    requireNonEmpty(name, "Affordance name");
    await api.writeFile(`${ctx.path}/affordance-${name}.md`, "");
  });
}

/**
 * Create a new invariant on the current context.
 *
 * Pre: name non-empty.
 * Op: write empty invariant-{name}.md.
 * Post: reload tree.
 * Error: toast.
 */
export async function createInvariant(
  ctx: Context,
  name: string,
  deps: ActionDeps,
): Promise<void> {
  await execute(deps, async () => {
    requireNonEmpty(name, "Invariant name");
    await api.writeFile(`${ctx.path}/invariant-${name}.md`, "");
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
  ctx: Context,
  kind: "affordance" | "invariant",
  oldName: string,
  newName: string,
  deps: ActionDeps,
): Promise<void> {
  await execute(deps, async () => {
    requireNonEmpty(newName, "Property name");
    requireDifferent(oldName, newName, "Property rename");
    const prefix = kind === "affordance" ? "affordance" : "invariant";
    const oldPath = `${ctx.path}/${prefix}-${oldName}.md`;
    const newPath = `${ctx.path}/${prefix}-${newName}.md`;
    const oldContent = await api.readFile(oldPath).catch(() => "");
    await api.writeFile(newPath, oldContent);
    await api.deleteFile(oldPath);

    // Update references in language.md
    const refChar = kind === "affordance" ? "#" : "!";
    const lang = ctx.domain_language;
    const updated = lang.replace(
      new RegExp(`\\${refChar}${oldName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?=[^a-zA-Z0-9_-]|$)`, "g"),
      `${refChar}${newName}`,
    );
    if (updated !== lang) {
      await api.writeFile(`${ctx.path}/language.md`, updated);
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
 * Op: update status in language.md for ctx and all children.
 * Post: reload tree.
 * Error: toast.
 */
export async function updateStatus(
  ctx: Context,
  newValue: string,
  deps: ActionDeps,
): Promise<void> {
  await execute(deps, async () => {
    requireNonEmpty(newValue, "Status value");
    const statusPattern = /^(status:\s*)\S+$/m;
    const forceStatus = async (c: Context) => {
      const lang = c.domain_language || "";
      if (statusPattern.test(lang)) {
        await api.writeFile(`${c.path}/language.md`, lang.replace(statusPattern, `$1${newValue}`));
      } else if (lang.startsWith("---")) {
        await api.writeFile(`${c.path}/language.md`, lang.replace(/^---/, `---\nstatus: ${newValue}`));
      } else {
        await api.writeFile(`${c.path}/language.md`, `---\nstatus: ${newValue}\n---\n${lang}`);
      }
      for (const child of c.children) await forceStatus(child);
    };
    await forceStatus(ctx);
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
 * Create a context (directory) as child of parentPath.
 *
 * Pre: name non-empty (backend validates 5-child limit).
 * Op: api.createContext.
 * Post: reload tree.
 * Error: toast.
 */
export async function createContext(
  parentPath: string,
  name: string,
  deps: ActionDeps,
): Promise<void> {
  await execute(deps, async () => {
    requireNonEmpty(name, "Context name");
    await api.createContext(parentPath, name);
  });
}
