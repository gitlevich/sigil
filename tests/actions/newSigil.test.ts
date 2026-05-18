import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/plugin-dialog", () => ({
  save: vi.fn(),
  message: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../../src/tauri", () => ({
  api: {
    scaffoldSigil: vi.fn().mockResolvedValue(undefined),
  },
  openInNewWindow: vi.fn(),
}));

import { save, message } from "@tauri-apps/plugin-dialog";
import { api, openInNewWindow } from "../../src/tauri";
import {
  chooseNewSigilPath,
  createNewSigil,
  createNewSigilFromMenu,
  ensureSigilExtension,
} from "../../src/actions/newSigil";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("ensureSigilExtension", () => {
  it("adds the .sigil extension when missing", () => {
    expect(ensureSigilExtension("/tmp/MySpec")).toBe("/tmp/MySpec.sigil");
  });

  it("preserves existing .sigil extension case-insensitively", () => {
    expect(ensureSigilExtension("/tmp/MySpec.SIGIL")).toBe("/tmp/MySpec.SIGIL");
  });
});

describe("chooseNewSigilPath", () => {
  it("uses a save picker so the user can choose location and name", async () => {
    vi.mocked(save).mockResolvedValueOnce("/tmp/NewSpec");

    await expect(chooseNewSigilPath()).resolves.toBe("/tmp/NewSpec.sigil");
    expect(save).toHaveBeenCalledWith({
      title: "New Sigil",
      defaultPath: "Untitled.sigil",
      filters: [{ name: "Sigil", extensions: ["sigil"] }],
    });
  });

  it("returns null when the picker is canceled", async () => {
    vi.mocked(save).mockResolvedValueOnce(null);

    await expect(chooseNewSigilPath()).resolves.toBeNull();
  });
});

describe("createNewSigil", () => {
  it("scaffolds the normalized sigil directory", async () => {
    await expect(createNewSigil("/tmp/NewSpec")).resolves.toBe("/tmp/NewSpec.sigil");

    expect(api.scaffoldSigil).toHaveBeenCalledWith("/tmp/NewSpec.sigil");
  });
});

describe("createNewSigilFromMenu", () => {
  it("creates the sigil and opens it in a new window", async () => {
    vi.mocked(save).mockResolvedValueOnce("/tmp/NewSpec.sigil");

    await createNewSigilFromMenu();

    expect(api.scaffoldSigil).toHaveBeenCalledWith("/tmp/NewSpec.sigil");
    expect(openInNewWindow).toHaveBeenCalledWith("/tmp/NewSpec.sigil");
  });

  it("shows an error when scaffolding fails", async () => {
    vi.mocked(save).mockResolvedValueOnce("/tmp/NewSpec.sigil");
    vi.mocked(api.scaffoldSigil).mockRejectedValueOnce(new Error("already exists"));

    await createNewSigilFromMenu();

    expect(openInNewWindow).not.toHaveBeenCalled();
    expect(message).toHaveBeenCalledWith("already exists", {
      title: "Cannot create sigil",
      kind: "error",
    });
  });
});
