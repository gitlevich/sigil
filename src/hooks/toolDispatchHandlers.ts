import { api, events } from "../tauri";
import type { UnlistenFn } from "@tauri-apps/api/event";
import * as actions from "../actions/workspace";
import type { ActionDeps } from "../actions/workspace";
import { compileCheck, formatCompileResult } from "./useCompileCheck";
import type { Sigil } from "sigil-core";

/**
 * Dispatcher-tool handlers: Bicameron's mutating tools don't touch the
 * filesystem directly — the Rust side emits a `tool:{name}` event, these
 * handlers run the same workspace action a user click would, and echo the
 * outcome back via api.toolResult. Extracted from useChatStream so the
 * handler behavior is testable without standing up the whole chat hook.
 */

/** The slice of workspace state the dispatcher handlers read. */
export interface ToolWorkspaceView {
  spec: {
    rootPath: string;
    root: Sigil | null;
    importedOntologies?: Sigil | null;
  };
}

export interface ToolDispatchDeps {
  /** Latest workspace state — a getter so handlers never read a stale render. */
  getWorkspace: () => ToolWorkspaceView;
  /** Latest ActionDeps for workspace actions (reload, toasts, selection). */
  getActionDeps: () => ActionDeps;
}

/**
 * Upsert a `key: value` field into a markdown frontmatter block. If none is
 * absent, one is created. If the key exists, its value is replaced; otherwise
 * the key is appended to the end of the existing block. The body below the
 * frontmatter is untouched.
 *
 * Used by the mark_placement tool to set `placement: <category>` on a sigil's
 * language.md without disturbing its narrative or other metadata.
 */
export function upsertFrontmatterField(content: string, key: string, value: string): string {
  const fmMatch = content.match(/^---\n([\s\S]*?)\n---\n?/);
  if (!fmMatch) {
    // No frontmatter — synthesize one.
    return `---\n${key}: ${value}\n---\n\n${content}`;
  }
  const fmBody = fmMatch[1];
  const after = content.slice(fmMatch[0].length);
  const lineRe = new RegExp(`^${key}:\\s*.*$`, "m");
  const newFmBody = lineRe.test(fmBody)
    ? fmBody.replace(lineRe, `${key}: ${value}`)
    : `${fmBody}\n${key}: ${value}`;
  return `---\n${newFmBody}\n---\n${after.startsWith("\n") ? "" : "\n"}${after}`;
}

/**
 * Compile the in-memory sigil tree exactly as the compile panel does and
 * render the compiler's text report. `path` optionally scopes the walk to a
 * subtree; resolution always uses the whole tree. Throws when the tree is
 * not loaded or the path names no sigil — the caller reports that as a tool
 * failure.
 */
export function compileCheckReport(ws: ToolWorkspaceView, path: string): string {
  const root = ws.spec.root;
  if (!root) throw new Error("No sigil tree loaded");
  // Mirror useCompileCheck: mount imported ontologies as a child so
  // references into Libs resolve during the walk.
  const imported = ws.spec.importedOntologies ?? null;
  const checkRoot: Sigil = imported
    ? { ...root, children: [...root.children, { ...imported, isImported: true }] }
    : root;
  const segments = path.split("/").filter((s) => s.length > 0);
  let node: Sigil = checkRoot;
  for (const seg of segments) {
    const child = node.children.find((c) => c.name === seg);
    if (!child) throw new Error(`No sigil at path: ${path}`);
    node = child;
  }
  return formatCompileResult(compileCheck(checkRoot, segments));
}

/** Run one dispatcher request: execute, echo the outcome via api.toolResult. */
async function handleTool(
  request_id: string,
  label: string,
  run: () => Promise<string>,
): Promise<void> {
  console.info(`[${label}] dispatched`);
  try {
    const message = await run();
    await api.toolResult(request_id, true, message);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await api.toolResult(request_id, false, msg);
  }
}

/**
 * Register every dispatcher-tool listener. Returns the unlisten promises;
 * the caller owns cleanup. navigate is NOT here — it round-trips through
 * workspace navigation state and stays with the chat hook.
 */
export function registerToolDispatchHandlers(deps: ToolDispatchDeps): Promise<UnlistenFn>[] {
  return [
    events.onToolDeleteSigil(({ request_id, payload }) =>
      handleTool(request_id, "tool:delete_sigil", async () => {
        await actions.deleteSigil(payload.abs_path, deps.getActionDeps());
        return `Deleted @${payload.sigil_path}.`;
      })),

    events.onToolRenameSigil(({ request_id, payload }) =>
      handleTool(request_id, "tool:rename_sigil", async () => {
        await actions.renameSigil(payload.abs_path, payload.new_name, deps.getActionDeps());
        return `Renamed @${payload.sigil_path} to @${payload.new_name}.`;
      })),

    events.onToolMoveSigil(({ request_id, payload }) =>
      handleTool(request_id, "tool:move_sigil", async () => {
        await actions.moveSigil(payload.abs_path, payload.new_parent_abs_path, deps.getActionDeps());
        return `Moved @${payload.sigil_path} under @${payload.new_parent_sigil_path}.`;
      })),

    events.onToolWriteSigil(({ request_id, payload }) =>
      handleTool(request_id, "tool:write_sigil", async () => {
        await api.writeFile(`${payload.abs_path}/language.md`, payload.content);
        return `Wrote @${payload.sigil_path}.`;
      })),

    events.onToolCreateSigil(({ request_id, payload }) =>
      handleTool(request_id, "tool:create_sigil", async () => {
        const newFolder = await api.createSigil(payload.parent_abs_path, payload.name);
        if (payload.content) {
          await api.writeFile(`${newFolder.path}/language.md`, payload.content);
        }
        return `Created @${payload.name} under @${payload.parent_sigil_path || "(root)"}.`;
      })),

    events.onToolWriteAffordance(({ request_id, payload }) =>
      handleTool(request_id, "tool:write_affordance", async () => {
        await api.writeFile(`${payload.abs_path}/affordance-${payload.name}.md`, payload.content);
        return `Wrote #${payload.name} on @${payload.sigil_path}.`;
      })),

    events.onToolDeleteAffordance(({ request_id, payload }) =>
      handleTool(request_id, "tool:delete_affordance", async () => {
        await api.deleteFile(`${payload.abs_path}/affordance-${payload.name}.md`);
        return `Deleted #${payload.name} from @${payload.sigil_path}.`;
      })),

    events.onToolWriteInvariant(({ request_id, payload }) =>
      handleTool(request_id, "tool:write_invariant", async () => {
        await api.writeFile(`${payload.abs_path}/invariant-${payload.name}.md`, payload.content);
        return `Wrote !${payload.name} on @${payload.sigil_path}.`;
      })),

    events.onToolDeleteInvariant(({ request_id, payload }) =>
      handleTool(request_id, "tool:delete_invariant", async () => {
        await api.deleteFile(`${payload.abs_path}/invariant-${payload.name}.md`);
        return `Deleted !${payload.name} from @${payload.sigil_path}.`;
      })),

    events.onToolWriteVision(({ request_id, payload }) =>
      handleTool(request_id, "tool:write_vision", async () => {
        const ws = deps.getWorkspace();
        await api.writeFile(`${ws.spec.rootPath}/vision.md`, payload.content);
        return `Wrote vision.md.`;
      })),

    events.onToolMarkPlacement(({ request_id, payload }) =>
      handleTool(request_id, "tool:mark_placement", async () => {
        const langPath = `${payload.abs_path}/language.md`;
        const existing = await api.readFile(langPath).catch(() => "");
        const updated = upsertFrontmatterField(existing, "placement", payload.category);
        await api.writeFile(langPath, updated);
        return `Marked @${payload.sigil_path} placement as ${payload.category}.`;
      })),

    // tool:compile_check reuses the exact frontend compiler the compile
    // panel renders — tool parity: B verifies his edits with the same
    // diagnostics the @user reads.
    events.onToolCompileCheck(({ request_id, payload }) =>
      handleTool(request_id, "tool:compile_check", async () =>
        compileCheckReport(deps.getWorkspace(), payload.path))),
  ];
}
