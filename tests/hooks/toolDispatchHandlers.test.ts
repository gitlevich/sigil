import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Sigil } from "sigil-core";

/**
 * Harness for the dispatcher-tool handlers: the tauri layer is mocked so
 * each `events.onToolX` registration is captured, then tests invoke the
 * captured handler with a synthetic {request_id, payload} envelope and
 * assert on the workspace action / api side effects and the toolResult echo.
 */

const h = vi.hoisted(() => {
  const captured: Record<string, (req: { request_id: string; payload: Record<string, unknown> }) => Promise<void>> = {};
  const capture = (name: string) =>
    vi.fn((handler: (req: { request_id: string; payload: never }) => Promise<void>) => {
      captured[name] = handler as (req: { request_id: string; payload: Record<string, unknown> }) => Promise<void>;
      return Promise.resolve(() => {});
    });
  return { captured, capture };
});

vi.mock("../../src/tauri", () => ({
  api: {
    toolResult: vi.fn().mockResolvedValue(undefined),
    writeFile: vi.fn().mockResolvedValue(undefined),
    deleteFile: vi.fn().mockResolvedValue(undefined),
    readFile: vi.fn().mockResolvedValue(""),
    createSigil: vi.fn().mockResolvedValue({ path: "/ws/Parent/New" }),
  },
  events: {
    onToolDeleteSigil: h.capture("delete_sigil"),
    onToolRenameSigil: h.capture("rename_sigil"),
    onToolMoveSigil: h.capture("move_sigil"),
    onToolWriteSigil: h.capture("write_sigil"),
    onToolCreateSigil: h.capture("create_sigil"),
    onToolWriteAffordance: h.capture("write_affordance"),
    onToolDeleteAffordance: h.capture("delete_affordance"),
    onToolWriteInvariant: h.capture("write_invariant"),
    onToolDeleteInvariant: h.capture("delete_invariant"),
    onToolWriteVision: h.capture("write_vision"),
    onToolMarkPlacement: h.capture("mark_placement"),
    onToolCompileCheck: h.capture("compile_check"),
  },
}));

vi.mock("../../src/actions/workspace", () => ({
  deleteSigil: vi.fn().mockResolvedValue(undefined),
  renameSigil: vi.fn().mockResolvedValue(undefined),
  moveSigil: vi.fn().mockResolvedValue(undefined),
}));

import { api } from "../../src/tauri";
import * as actions from "../../src/actions/workspace";
import {
  registerToolDispatchHandlers,
  upsertFrontmatterField,
  compileCheckReport,
  type ToolDispatchDeps,
  type ToolWorkspaceView,
} from "../../src/hooks/toolDispatchHandlers";

function sigil(name: string, opts?: {
  language?: string;
  children?: Sigil[];
  isImported?: boolean;
}): Sigil {
  return {
    name,
    language: opts?.language ?? "",
    affordances: [],
    invariants: [],
    children: opts?.children ?? [],
    isImported: opts?.isImported,
  };
}

const actionDeps = { sentinel: true } as unknown as Parameters<typeof actions.deleteSigil>[1];

function workspaceView(root: Sigil | null, imported: Sigil | null = null): ToolWorkspaceView {
  return { spec: { rootPath: "/ws", root, importedOntologies: imported } };
}

function makeDeps(ws: ToolWorkspaceView): ToolDispatchDeps {
  return { getWorkspace: () => ws, getActionDeps: () => actionDeps };
}

const cleanTree = sigil("Root", {
  language: "See @Child.",
  children: [sigil("Child", { language: "Plain." })],
});

beforeEach(() => {
  vi.clearAllMocks();
  for (const key of Object.keys(h.captured)) delete h.captured[key];
  registerToolDispatchHandlers(makeDeps(workspaceView(cleanTree)));
});

describe("registerToolDispatchHandlers", () => {
  it("registers a listener for all twelve dispatcher tools", () => {
    expect(Object.keys(h.captured).sort()).toEqual([
      "compile_check", "create_sigil", "delete_affordance", "delete_invariant",
      "delete_sigil", "mark_placement", "move_sigil", "rename_sigil",
      "write_affordance", "write_invariant", "write_sigil", "write_vision",
    ]);
  });
});

describe("workspace-action handlers", () => {
  it("delete_sigil runs the action with live deps and echoes success", async () => {
    await h.captured.delete_sigil({ request_id: "r1", payload: { sigil_path: "Idea/Old", abs_path: "/ws/Idea/Old" } });
    expect(actions.deleteSigil).toHaveBeenCalledWith("/ws/Idea/Old", actionDeps);
    expect(api.toolResult).toHaveBeenCalledWith("r1", true, "Deleted @Idea/Old.");
  });

  it("delete_sigil echoes failure when the action throws", async () => {
    vi.mocked(actions.deleteSigil).mockRejectedValueOnce(new Error("refused"));
    await h.captured.delete_sigil({ request_id: "r2", payload: { sigil_path: "X", abs_path: "/ws/X" } });
    expect(api.toolResult).toHaveBeenCalledWith("r2", false, "refused");
  });

  it("rename_sigil passes the new name through", async () => {
    await h.captured.rename_sigil({ request_id: "r3", payload: { sigil_path: "Place", abs_path: "/ws/Place", new_name: "Sigil" } });
    expect(actions.renameSigil).toHaveBeenCalledWith("/ws/Place", "Sigil", actionDeps);
    expect(api.toolResult).toHaveBeenCalledWith("r3", true, "Renamed @Place to @Sigil.");
  });

  it("move_sigil passes source and destination", async () => {
    await h.captured.move_sigil({
      request_id: "r4",
      payload: { sigil_path: "A", abs_path: "/ws/A", new_parent_sigil_path: "B", new_parent_abs_path: "/ws/B" },
    });
    expect(actions.moveSigil).toHaveBeenCalledWith("/ws/A", "/ws/B", actionDeps);
    expect(api.toolResult).toHaveBeenCalledWith("r4", true, "Moved @A under @B.");
  });
});

describe("file-writing handlers", () => {
  it("write_sigil writes language.md under the sigil dir", async () => {
    await h.captured.write_sigil({ request_id: "r5", payload: { sigil_path: "Idea", abs_path: "/ws/Idea", content: "# Idea" } });
    expect(api.writeFile).toHaveBeenCalledWith("/ws/Idea/language.md", "# Idea");
    expect(api.toolResult).toHaveBeenCalledWith("r5", true, "Wrote @Idea.");
  });

  it("create_sigil creates then seeds language.md when content is given", async () => {
    await h.captured.create_sigil({
      request_id: "r6",
      payload: { parent_sigil_path: "Parent", parent_abs_path: "/ws/Parent", name: "New", content: "# New" },
    });
    expect(api.createSigil).toHaveBeenCalledWith("/ws/Parent", "New");
    expect(api.writeFile).toHaveBeenCalledWith("/ws/Parent/New/language.md", "# New");
    expect(api.toolResult).toHaveBeenCalledWith("r6", true, "Created @New under @Parent.");
  });

  it("create_sigil labels the root parent and skips the seed write without content", async () => {
    await h.captured.create_sigil({
      request_id: "r7",
      payload: { parent_sigil_path: "", parent_abs_path: "/ws", name: "Top", content: "" },
    });
    expect(api.writeFile).not.toHaveBeenCalled();
    expect(api.toolResult).toHaveBeenCalledWith("r7", true, "Created @Top under @(root).");
  });

  it("write_affordance and write_invariant address their property files", async () => {
    await h.captured.write_affordance({ request_id: "r8", payload: { sigil_path: "S", abs_path: "/ws/S", name: "note", content: "n" } });
    expect(api.writeFile).toHaveBeenCalledWith("/ws/S/affordance-note.md", "n");
    await h.captured.write_invariant({ request_id: "r9", payload: { sigil_path: "S", abs_path: "/ws/S", name: "wall", content: "w" } });
    expect(api.writeFile).toHaveBeenCalledWith("/ws/S/invariant-wall.md", "w");
  });

  it("delete_affordance and delete_invariant remove their property files", async () => {
    await h.captured.delete_affordance({ request_id: "r10", payload: { sigil_path: "S", abs_path: "/ws/S", name: "note" } });
    expect(api.deleteFile).toHaveBeenCalledWith("/ws/S/affordance-note.md");
    await h.captured.delete_invariant({ request_id: "r11", payload: { sigil_path: "S", abs_path: "/ws/S", name: "wall" } });
    expect(api.deleteFile).toHaveBeenCalledWith("/ws/S/invariant-wall.md");
  });

  it("write_vision writes at the workspace root from live state", async () => {
    await h.captured.write_vision({ request_id: "r12", payload: { content: "the vision" } });
    expect(api.writeFile).toHaveBeenCalledWith("/ws/vision.md", "the vision");
    expect(api.toolResult).toHaveBeenCalledWith("r12", true, "Wrote vision.md.");
  });

  it("mark_placement upserts frontmatter over the existing file", async () => {
    vi.mocked(api.readFile).mockResolvedValueOnce("---\nstatus: idea\n---\n\n# S\n");
    await h.captured.mark_placement({ request_id: "r13", payload: { sigil_path: "S", abs_path: "/ws/S", category: "core" } });
    expect(api.writeFile).toHaveBeenCalledWith("/ws/S/language.md", "---\nstatus: idea\nplacement: core\n---\n\n# S\n");
    expect(api.toolResult).toHaveBeenCalledWith("r13", true, "Marked @S placement as core.");
  });

  it("mark_placement starts from empty content when the read fails", async () => {
    vi.mocked(api.readFile).mockRejectedValueOnce(new Error("missing"));
    await h.captured.mark_placement({ request_id: "r14", payload: { sigil_path: "S", abs_path: "/ws/S", category: "rim" } });
    expect(api.writeFile).toHaveBeenCalledWith("/ws/S/language.md", "---\nplacement: rim\n---\n\n");
  });
});

describe("compile_check handler", () => {
  it("reports all-resolve over the live tree", async () => {
    await h.captured.compile_check({ request_id: "c1", payload: { path: "" } });
    expect(api.toolResult).toHaveBeenCalledWith("c1", true, "compile-check: 1 references checked — all resolve");
  });

  it("reports unresolved references with file, line, and reason", async () => {
    const broken = sigil("Root", { children: [sigil("Idea", { language: "Uses @Ghost." })] });
    registerToolDispatchHandlers(makeDeps(workspaceView(broken)));
    await h.captured.compile_check({ request_id: "c2", payload: { path: "" } });
    const message = vi.mocked(api.toolResult).mock.calls.at(-1)![2];
    expect(message).toContain("Idea/language.md");
    expect(message).toContain("1: @Ghost  — unresolved sigil");
    expect(message).toContain("1 references checked, 1 unresolved, 1 file(s) with errors");
  });

  it("fails the tool call for an unknown scope path", async () => {
    await h.captured.compile_check({ request_id: "c3", payload: { path: "Nope" } });
    expect(api.toolResult).toHaveBeenCalledWith("c3", false, "No sigil at path: Nope");
  });

  it("fails the tool call when no tree is loaded", async () => {
    registerToolDispatchHandlers(makeDeps(workspaceView(null)));
    await h.captured.compile_check({ request_id: "c4", payload: { path: "" } });
    expect(api.toolResult).toHaveBeenCalledWith("c4", false, "No sigil tree loaded");
  });
});

describe("compileCheckReport", () => {
  it("scopes the walk to a subtree while resolving against the whole tree", () => {
    const tree = sigil("Root", {
      language: "Root uses @Missing.",
      children: [sigil("Clean", { language: "See @Neighbor." }), sigil("Neighbor")],
    });
    const report = compileCheckReport(workspaceView(tree), "Clean");
    expect(report).toBe("compile-check: 1 references checked — all resolve");
  });

  it("mounts imported ontologies so Libs references resolve", () => {
    const tree = sigil("Root", { language: "Uses @Concept." });
    const libs = sigil("Libs", { children: [sigil("Concept")] });
    const report = compileCheckReport(workspaceView(tree, libs), "");
    expect(report).toBe("compile-check: 1 references checked — all resolve");
  });
});

describe("upsertFrontmatterField", () => {
  it("synthesizes frontmatter when absent", () => {
    expect(upsertFrontmatterField("# Body\n", "placement", "core"))
      .toBe("---\nplacement: core\n---\n\n# Body\n");
  });

  it("replaces an existing key in place", () => {
    expect(upsertFrontmatterField("---\nplacement: rim\nstatus: idea\n---\n\nBody", "placement", "core"))
      .toBe("---\nplacement: core\nstatus: idea\n---\n\nBody");
  });

  it("appends a new key to an existing block", () => {
    expect(upsertFrontmatterField("---\nstatus: idea\n---\n\nBody", "placement", "core"))
      .toBe("---\nstatus: idea\nplacement: core\n---\n\nBody");
  });
});
