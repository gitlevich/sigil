import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ActionDeps } from "./workspace";
import type { SigilFolder } from "../tauri";

vi.mock("../tauri", () => ({
  api: {
    createContext: vi.fn().mockResolvedValue({ path: "/mock/new" }),
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
  return { rootPath: "/mock/root", reload: vi.fn().mockResolvedValue(undefined), addToast: vi.fn(), ...overrides };
}

function makeContext(overrides?: Partial<SigilFolder>): SigilFolder {
  return {
    name: "TestSigil", path: "/mock/root/TestSigil",
    language: "# TestSigil\n\nContent.", children: [],
    affordances: [], invariants: [], isImported: false,
    images: [], ...overrides,
  } as SigilFolder;
}

beforeEach(() => vi.clearAllMocks());

describe("savePropertyOrder", () => {
  it("writes order JSON without reload", async () => {
    const deps = makeDeps();
    await actions.savePropertyOrder("/mock/sigil", "affordance", ["a", "b", "c"], deps);
    expect(api.writeFile).toHaveBeenCalledWith("/mock/sigil/affordance.order", '["a","b","c"]');
    expect(deps.reload).not.toHaveBeenCalled();
  });

  it("writes empty array", async () => {
    const deps = makeDeps();
    await actions.savePropertyOrder("/mock/sigil", "invariant", [], deps);
    expect(api.writeFile).toHaveBeenCalledWith("/mock/sigil/invariant.order", "[]");
  });
});

describe("savePropertyFold", () => {
  it("writes fold JSON without reload", async () => {
    const deps = makeDeps();
    await actions.savePropertyFold("/mock/sigil", "affordance", ["navigate", "render"], deps);
    expect(api.writeFile).toHaveBeenCalledWith("/mock/sigil/affordance.folded", '["navigate","render"]');
    expect(deps.reload).not.toHaveBeenCalled();
  });
});

describe("updateStatus additional branches", () => {
  it("inserts status after opening --- when no status key", async () => {
    const deps = makeDeps();
    const ctx = makeContext({ language: "---\ntitle: Hello\n---\n# Content", children: [] });
    await actions.updateStatus(ctx, "active", deps);
    expect(api.writeFile).toHaveBeenCalledWith(
      `${ctx.path}/language.md`,
      "---\nstatus: active\ntitle: Hello\n---\n# Content",
    );
  });

  it("prepends full frontmatter block when no --- exists", async () => {
    const deps = makeDeps();
    const ctx = makeContext({ language: "# Just content", children: [] });
    await actions.updateStatus(ctx, "done", deps);
    expect(api.writeFile).toHaveBeenCalledWith(
      `${ctx.path}/language.md`,
      "---\nstatus: done\n---\n# Just content",
    );
  });

  it("prepends frontmatter to empty language", async () => {
    const deps = makeDeps();
    const ctx = makeContext({ language: "", children: [] });
    await actions.updateStatus(ctx, "active", deps);
    expect(api.writeFile).toHaveBeenCalledWith(
      `${ctx.path}/language.md`,
      "---\nstatus: active\n---\n",
    );
  });
});

describe("renameContext validation", () => {
  it("throws on empty new name", async () => {
    const deps = makeDeps();
    await expect(actions.renameContext("/mock/path", "Old", "  ", deps)).rejects.toThrow("cannot be empty");
    expect(api.renameContext).not.toHaveBeenCalled();
  });

  it("no-ops when new name equals old name", async () => {
    const deps = makeDeps();
    await actions.renameContext("/mock/path", "Same", "Same", deps);
    expect(api.renameContext).not.toHaveBeenCalled();
  });
});
