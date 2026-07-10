import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(new URL("../../src/hooks/useAppMenu.ts", import.meta.url), "utf8");

function menuBlock(name: string, nextSection: string): string {
  const match = source.match(new RegExp(`const ${name} = await Submenu\\.new\\({[\\s\\S]*?\\n  \\}\\);\\n\\n  // ── ${nextSection} menu ──`));
  if (!match) throw new Error(`Missing ${name}`);
  return match[0];
}

describe("useAppMenu placement", () => {
  it("keeps reload from disk in File rather than View", () => {
    const fileMenu = menuBlock("fileSubmenu", "Edit");
    const viewMenu = menuBlock("viewSubmenu", "Window");

    expect(fileMenu).toContain("reloadFromDiskItem");
    expect(viewMenu).not.toContain("reloadFromDiskItem");
    expect(source).toContain('text: "Reload Sigil From Disk"');
  });

  it("places update checks under Settings in the Sigil menu", () => {
    const appMenu = menuBlock("appSubmenu", "File");
    const helpMenu = source.slice(source.indexOf("// ── Help menu ──"));
    const updateItem = source.slice(
      source.indexOf("const checkForUpdatesItem"),
      source.indexOf("const appSubmenu"),
    );

    expect(updateItem).toContain('text: "Check for Updates..."');
    expect(updateItem).toContain("void checkForUpdate(true)");
    expect(appMenu.indexOf("settingsItem")).toBeLessThan(appMenu.indexOf("checkForUpdatesItem"));
    expect(helpMenu).not.toContain('text: "Check for Updates..."');
    expect(helpMenu).toContain("setAsHelpMenuForNSApp");
  });
});
