import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ActionDeps } from "./workspace";
import type { Context } from "../tauri";

// Mock the tauri api module
vi.mock("../tauri", () => ({
  api: {
    createContext: vi.fn().mockResolvedValue({ path: "/mock/new-context" }),
    writeFile: vi.fn().mockResolvedValue(undefined),
    deleteFile: vi.fn().mockResolvedValue(undefined),
    readFile: vi.fn().mockResolvedValue(""),
    renameSigil: vi.fn().mockResolvedValue("1"),
    renameContext: vi.fn().mockResolvedValue("/mock/renamed"),
    moveSigil: vi.fn().mockResolvedValue("/mock/moved"),
    deleteContext: vi.fn().mockResolvedValue(undefined),
  },
}));

import { api } from "../tauri";
import * as actions from "./workspace";

function makeDeps(overrides?: Partial<ActionDeps>): ActionDeps {
  return {
    rootPath: "/mock/root",
    reload: vi.fn().mockResolvedValue(undefined),
    addToast: vi.fn(),
    ...overrides,
  };
}

function makeContext(overrides?: Partial<Context>): Context {
  return {
    name: "TestSigil",
    path: "/mock/root/TestSigil",
    domain_language: "# TestSigil\n\nSome content with #old-affordance reference.",
    children: [],
    affordances: [],
    invariants: [],
    is_imported: false,
    ...overrides,
  } as Context;
}

beforeEach(() => {
  vi.clearAllMocks();
});

// ── Precondition validation ──

describe("createSigil", () => {
  it("rejects empty name", async () => {
    const deps = makeDeps();
    await actions.createSigil(makeContext(), "  ", deps);
    expect(deps.addToast).toHaveBeenCalledWith("Sigil name cannot be empty", "error");
    expect(api.createContext).not.toHaveBeenCalled();
  });

  it("creates context and writes language.md on success", async () => {
    const deps = makeDeps();
    const ctx = makeContext({ domain_language: "---\nstatus: implemented\n---\n# Test" });
    await actions.createSigil(ctx, "NewChild", deps);
    expect(api.createContext).toHaveBeenCalledWith(ctx.path, "NewChild");
    expect(api.writeFile).toHaveBeenCalledWith(
      "/mock/new-context/language.md",
      expect.stringContaining("status: implemented"),
    );
    expect(deps.reload).toHaveBeenCalledWith("/mock/root");
  });

  it("inherits idea status when parent has no status", async () => {
    const deps = makeDeps();
    const ctx = makeContext({ domain_language: "# No frontmatter" });
    await actions.createSigil(ctx, "Child", deps);
    expect(api.writeFile).toHaveBeenCalledWith(
      "/mock/new-context/language.md",
      expect.stringContaining("status: idea"),
    );
  });

  it("converts camelCase name to Human Name", async () => {
    const deps = makeDeps();
    await actions.createSigil(makeContext(), "myNewSigil", deps);
    expect(api.writeFile).toHaveBeenCalledWith(
      "/mock/new-context/language.md",
      expect.stringContaining("# My New Sigil"),
    );
  });
});

describe("renameSigil", () => {
  it("rejects empty name", async () => {
    const deps = makeDeps();
    await actions.renameSigil("/mock/path", "", deps);
    expect(deps.addToast).toHaveBeenCalledWith("Sigil name cannot be empty", "error");
    expect(api.renameSigil).not.toHaveBeenCalled();
  });

  it("calls api and reloads on success", async () => {
    const deps = makeDeps();
    await actions.renameSigil("/mock/path", "NewName", deps);
    expect(api.renameSigil).toHaveBeenCalledWith("/mock/root", "/mock/path", "NewName");
    expect(deps.reload).toHaveBeenCalledWith("/mock/root");
  });
});

describe("renameContext", () => {
  it("skips when old and new names are identical", async () => {
    const deps = makeDeps();
    await actions.renameContext("/mock/path", "Same", "Same", deps);
    expect(api.renameContext).not.toHaveBeenCalled();
    expect(deps.reload).not.toHaveBeenCalled();
  });

  it("renames when names differ", async () => {
    const deps = makeDeps();
    await actions.renameContext("/mock/path", "Old", "New", deps);
    expect(api.renameContext).toHaveBeenCalledWith("/mock/root", "/mock/path", "New");
    expect(deps.reload).toHaveBeenCalledWith("/mock/root");
  });
});

describe("moveSigil", () => {
  it("rejects move onto self", async () => {
    const deps = makeDeps();
    await actions.moveSigil("/mock/A", "/mock/A", deps);
    expect(deps.addToast).toHaveBeenCalledWith("Cannot move a sigil onto itself", "error");
    expect(api.moveSigil).not.toHaveBeenCalled();
  });

  it("rejects move under self", async () => {
    const deps = makeDeps();
    await actions.moveSigil("/mock/A", "/mock/A/B", deps);
    expect(deps.addToast).toHaveBeenCalledWith("Cannot move a sigil under itself", "error");
  });

  it("moves on valid paths", async () => {
    const deps = makeDeps();
    await actions.moveSigil("/mock/A", "/mock/B", deps);
    expect(api.moveSigil).toHaveBeenCalledWith("/mock/root", "/mock/A", "/mock/B");
    expect(deps.reload).toHaveBeenCalled();
  });
});

describe("deleteSigil", () => {
  it("deletes and reloads", async () => {
    const deps = makeDeps();
    await actions.deleteSigil("/mock/sigil", deps);
    expect(api.deleteContext).toHaveBeenCalledWith("/mock/sigil");
    expect(deps.reload).toHaveBeenCalled();
  });

  it("toasts on backend error", async () => {
    vi.mocked(api.deleteContext).mockRejectedValueOnce(new Error("Context does not exist"));
    const deps = makeDeps();
    await actions.deleteSigil("/mock/gone", deps);
    expect(deps.addToast).toHaveBeenCalledWith("Context does not exist", "error");
  });
});

// ── Property operations ──

describe("createAffordance", () => {
  it("rejects empty name", async () => {
    const deps = makeDeps();
    await actions.createAffordance(makeContext(), "", deps);
    expect(deps.addToast).toHaveBeenCalledWith("Affordance name cannot be empty", "error");
  });

  it("writes affordance file and reloads", async () => {
    const deps = makeDeps();
    const ctx = makeContext();
    await actions.createAffordance(ctx, "navigate", deps);
    expect(api.writeFile).toHaveBeenCalledWith(`${ctx.path}/affordance-navigate.md`, "");
    expect(deps.reload).toHaveBeenCalled();
  });
});

describe("createInvariant", () => {
  it("writes invariant file and reloads", async () => {
    const deps = makeDeps();
    const ctx = makeContext();
    await actions.createInvariant(ctx, "integrity", deps);
    expect(api.writeFile).toHaveBeenCalledWith(`${ctx.path}/invariant-integrity.md`, "");
    expect(deps.reload).toHaveBeenCalled();
  });
});

describe("renameProperty", () => {
  it("rejects identical names", async () => {
    const deps = makeDeps();
    await actions.renameProperty(makeContext(), "affordance", "same", "same", deps);
    expect(deps.addToast).toHaveBeenCalledWith(
      expect.stringContaining("identical"),
      "error",
    );
  });

  it("copies content, deletes old, updates language.md refs", async () => {
    vi.mocked(api.readFile).mockResolvedValueOnce("old content");
    const deps = makeDeps();
    const ctx = makeContext({
      domain_language: "I need #old-affordance and #other.",
    });
    await actions.renameProperty(ctx, "affordance", "old-affordance", "new-affordance", deps);

    expect(api.readFile).toHaveBeenCalledWith(`${ctx.path}/affordance-old-affordance.md`);
    expect(api.writeFile).toHaveBeenCalledWith(`${ctx.path}/affordance-new-affordance.md`, "old content");
    expect(api.deleteFile).toHaveBeenCalledWith(`${ctx.path}/affordance-old-affordance.md`);
    // Should update reference in language.md
    expect(api.writeFile).toHaveBeenCalledWith(
      `${ctx.path}/language.md`,
      "I need #new-affordance and #other.",
    );
    expect(deps.reload).toHaveBeenCalled();
  });

  it("skips language.md write when no refs changed", async () => {
    vi.mocked(api.readFile).mockResolvedValueOnce("");
    const deps = makeDeps();
    const ctx = makeContext({ domain_language: "No references here." });
    await actions.renameProperty(ctx, "invariant", "old", "new", deps);

    // writeFile called for the new invariant file, but NOT for language.md
    const writeCalls = vi.mocked(api.writeFile).mock.calls;
    expect(writeCalls).toHaveLength(1);
    expect(writeCalls[0][0]).toContain("invariant-new.md");
  });
});

describe("moveProperty", () => {
  it("rejects same source and target", async () => {
    const deps = makeDeps();
    await actions.moveProperty("/mock/A", {
      kind: "affordance",
      name: "test",
      content: "x",
      sourcePath: "/mock/A",
    }, deps);
    expect(deps.addToast).toHaveBeenCalledWith(
      expect.stringContaining("same sigil"),
      "error",
    );
  });

  it("writes to target and deletes from source", async () => {
    const deps = makeDeps();
    await actions.moveProperty("/mock/B", {
      kind: "invariant",
      name: "integrity",
      content: "must hold",
      sourcePath: "/mock/A",
    }, deps);
    expect(api.writeFile).toHaveBeenCalledWith("/mock/B/invariant-integrity.md", "must hold");
    expect(api.deleteFile).toHaveBeenCalledWith("/mock/A/invariant-integrity.md");
    expect(deps.reload).toHaveBeenCalled();
  });
});

describe("updateStatus", () => {
  it("rejects empty status", async () => {
    const deps = makeDeps();
    await actions.updateStatus(makeContext(), "  ", deps);
    expect(deps.addToast).toHaveBeenCalledWith("Status value cannot be empty", "error");
  });

  it("updates status in frontmatter", async () => {
    const deps = makeDeps();
    const ctx = makeContext({
      domain_language: "---\nstatus: idea\n---\n# Test",
      children: [],
    });
    await actions.updateStatus(ctx, "implemented", deps);
    expect(api.writeFile).toHaveBeenCalledWith(
      `${ctx.path}/language.md`,
      "---\nstatus: implemented\n---\n# Test",
    );
  });

  it("recursively updates children", async () => {
    const deps = makeDeps();
    const child = makeContext({
      name: "Child",
      path: "/mock/root/TestSigil/Child",
      domain_language: "---\nstatus: idea\n---\n# Child",
      children: [],
    });
    const ctx = makeContext({
      domain_language: "---\nstatus: idea\n---\n# Parent",
      children: [child],
    });
    await actions.updateStatus(ctx, "implemented", deps);
    const writeCalls = vi.mocked(api.writeFile).mock.calls;
    expect(writeCalls).toHaveLength(2);
    expect(writeCalls[0][0]).toBe(`${ctx.path}/language.md`);
    expect(writeCalls[1][0]).toBe(`${child.path}/language.md`);
  });
});

// ── Property editor file operations ──

describe("savePropertyContent", () => {
  it("writes file without reload", async () => {
    const deps = makeDeps();
    await actions.savePropertyContent("/mock/sigil", "affordance", "test", "content", deps);
    expect(api.writeFile).toHaveBeenCalledWith("/mock/sigil/affordance-test.md", "content");
    expect(deps.reload).not.toHaveBeenCalled();
  });
});

describe("commitPropertyName", () => {
  it("deletes old and writes new", async () => {
    const deps = makeDeps();
    await actions.commitPropertyName("/mock/sigil", "affordance", "old", "new", "content", deps);
    expect(api.deleteFile).toHaveBeenCalledWith("/mock/sigil/affordance-old.md");
    expect(api.writeFile).toHaveBeenCalledWith("/mock/sigil/affordance-new.md", "content");
    expect(deps.reload).toHaveBeenCalled();
  });

  it("skips delete when oldName is empty (new property)", async () => {
    const deps = makeDeps();
    await actions.commitPropertyName("/mock/sigil", "invariant", "", "fresh", "x", deps);
    expect(api.deleteFile).not.toHaveBeenCalled();
    expect(api.writeFile).toHaveBeenCalledWith("/mock/sigil/invariant-fresh.md", "x");
  });
});

describe("deleteProperty", () => {
  it("deletes file and reloads", async () => {
    const deps = makeDeps();
    await actions.deleteProperty("/mock/sigil", "affordance", "test", deps);
    expect(api.deleteFile).toHaveBeenCalledWith("/mock/sigil/affordance-test.md");
    expect(deps.reload).toHaveBeenCalled();
  });

  it("skips delete when name is empty", async () => {
    const deps = makeDeps();
    await actions.deleteProperty("/mock/sigil", "affordance", "", deps);
    expect(api.deleteFile).not.toHaveBeenCalled();
  });
});

describe("createContext", () => {
  it("rejects empty name", async () => {
    const deps = makeDeps();
    await actions.createContext("/mock/parent", "", deps);
    expect(deps.addToast).toHaveBeenCalledWith("Context name cannot be empty", "error");
    expect(api.createContext).not.toHaveBeenCalled();
  });

  it("creates and reloads", async () => {
    const deps = makeDeps();
    await actions.createContext("/mock/parent", "NewChild", deps);
    expect(api.createContext).toHaveBeenCalledWith("/mock/parent", "NewChild");
    expect(deps.reload).toHaveBeenCalled();
  });
});

// ── Error propagation ──

describe("error handling", () => {
  it("toasts backend errors instead of throwing", async () => {
    vi.mocked(api.renameSigil).mockRejectedValueOnce(new Error("already exists"));
    const deps = makeDeps();
    await actions.renameSigil("/mock/path", "Duplicate", deps);
    expect(deps.addToast).toHaveBeenCalledWith("already exists", "error");
    // Should not throw
  });

  it("toasts non-Error values", async () => {
    vi.mocked(api.createContext).mockRejectedValueOnce("string error");
    const deps = makeDeps();
    await actions.createContext("/mock/parent", "Test", deps);
    expect(deps.addToast).toHaveBeenCalledWith("string error", "error");
  });
});
