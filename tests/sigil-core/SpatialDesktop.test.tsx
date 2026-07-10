/**
 * @vitest-environment jsdom
 */
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import {
  SpatialDesktop,
} from "sigil-core/react/SpatialDesktop";
import type { LayoutStore } from "sigil-core/layoutStore";
import type { Sigil } from "sigil-core";
import type { SpatialLayout } from "sigil-core/spatialLayout";

beforeAll(() => {
  vi.stubGlobal("ResizeObserver", class {
    observe() {}
    disconnect() {}
  });
});

afterEach(cleanup);

function sigil(name: string, children: Sigil[] = []): Sigil {
  return { name, language: "@Alpha meets @Beta.", affordances: [], invariants: [], children };
}

function renderDesktop() {
  const folder = sigil("Room", [sigil("Alpha"), sigil("Beta")]);
  const saved: SpatialLayout = {
    version: 1,
    icons: {
      Alpha: { x: 40, y: 50 },
      Beta: { x: 70, y: 90 },
    },
    scroll: { x: 12, y: 24, w: 320, h: 400, open: true },
  };
  const save = vi.fn<LayoutStore["save"]>().mockResolvedValue(undefined);
  const layoutStore: LayoutStore = {
    load: vi.fn().mockResolvedValue(saved),
    save,
  };

  render(
    <SpatialDesktop
      folder={folder}
      currentPath={[]}
      rootName="Room"
      mainRoot={folder}
      navigate={vi.fn()}
      layoutStore={layoutStore}
      dark={false}
      arrangeShortcut="Shift-Mod-f"
      arrangeShortcutLabel="Shift+Cmd+F"
    />,
  );

  return { folder, saved, save };
}

async function expectArrangementSaved(
  save: ReturnType<typeof vi.fn<LayoutStore["save"]>>,
  folder: Sigil,
  saved: SpatialLayout,
) {
  await waitFor(() => expect(save).toHaveBeenCalledOnce(), { timeout: 1200 });
  expect(save).toHaveBeenCalledWith(folder, [], {
    ...saved,
    icons: {},
  });
}

describe("SpatialDesktop Arrange affordance", () => {
  it("visibly arranges from sentence connections while preserving scroll state", async () => {
    const { folder, saved, save } = renderDesktop();
    const button = await screen.findByRole("button", { name: "Arrange Space" });

    expect(button.getAttribute("title")).toContain("Shift+Cmd+F");
    fireEvent.click(button);

    await expectArrangementSaved(save, folder, saved);
  });

  it("responds to Shift-Command-F", async () => {
    const { folder, saved, save } = renderDesktop();
    await screen.findByRole("button", { name: "Arrange Space" });

    fireEvent.keyDown(window, { key: "f", code: "KeyF", metaKey: true, shiftKey: true });

    await expectArrangementSaved(save, folder, saved);
  });
});
