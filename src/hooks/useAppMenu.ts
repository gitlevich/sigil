import { useEffect, useRef } from "react";
import { Menu } from "@tauri-apps/api/menu/menu";
import { MenuItem } from "@tauri-apps/api/menu/menuItem";
import { Submenu } from "@tauri-apps/api/menu/submenu";
import { PredefinedMenuItem } from "@tauri-apps/api/menu/predefinedMenuItem";
import { open, save, ask, message } from "@tauri-apps/plugin-dialog";
import { api, openInNewWindow, toTauriAccelerator, DEFAULT_KEYBINDINGS } from "../tauri";
import { useAppDispatch, useAppState } from "../state/AppContext";
import { getCurrentWindow } from "@tauri-apps/api/window";

export function useAppMenu() {
  const dispatch = useAppDispatch();
  const state = useAppState();
  const stateRef = useRef(state);
  stateRef.current = state;

  useEffect(() => {
    buildMenu(dispatch, () => stateRef.current.document, () => stateRef.current.ui, () => stateRef.current.settings.keybindings || DEFAULT_KEYBINDINGS).catch(console.error);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}

async function buildMenu(
  dispatch: ReturnType<typeof useAppDispatch>,
  getDoc: () => ReturnType<typeof useAppState>["document"],
  getUI: () => ReturnType<typeof useAppState>["ui"],
  getKB: () => ReturnType<typeof useAppState>["settings"]["keybindings"],
) {
  // ── Sigil (app) menu ──
  const aboutItem = await MenuItem.new({
    text: "About Sigil...",
    action: () => {
      dispatch({ type: "SET_ABOUT_OPEN", open: true });
    },
  });

  const settingsItem = await MenuItem.new({
    text: "Settings...",
    accelerator: "CmdOrCtrl+,",
    action: () => {
      dispatch({ type: "SET_SETTINGS_OPEN", open: true });
    },
  });

  const appSubmenu = await Submenu.new({
    text: "Sigil",
    items: [
      aboutItem,
      await PredefinedMenuItem.new({ item: "Separator" }),
      settingsItem,
      await PredefinedMenuItem.new({ item: "Separator" }),
      await PredefinedMenuItem.new({ item: "Hide" }),
      await PredefinedMenuItem.new({ item: "HideOthers" }),
      await PredefinedMenuItem.new({ item: "ShowAll" }),
      await PredefinedMenuItem.new({ item: "Separator" }),
      await PredefinedMenuItem.new({ item: "Quit" }),
    ],
  });

  // ── File menu ──
  const recentDocs = await api.listRecentDocuments().catch(() => []);
  const recentItems: MenuItem[] = [];

  for (const doc of recentDocs.slice(0, 5)) {
    const item = await MenuItem.new({
      text: doc.name,
      action: () => openInNewWindow(doc.path),
    });
    recentItems.push(item);
  }

  const recentSubmenu = await Submenu.new({
    text: "Recent Sigils",
    items: recentItems.length > 0
      ? recentItems
      : [await MenuItem.new({ text: "No Recent Sigils", enabled: false })],
  });

  const newItem = await MenuItem.new({
    text: "New Window",
    accelerator: "CmdOrCtrl+N",
    action: () => openInNewWindow(""),
  });

  const openItem = await MenuItem.new({
    text: "Open Sigil...",
    accelerator: "CmdOrCtrl+O",
    action: async () => {
      const selected = await open({ directory: true, title: "Open sigil root directory" });
      if (selected) {
        openInNewWindow(selected as string);
      }
    },
  });

  const closeItem = await MenuItem.new({
    text: "Close Window",
    accelerator: "CmdOrCtrl+W",
    action: async () => {
      await getCurrentWindow().close();
    },
  });

  const kb = getKB();
  const exportItem = await MenuItem.new({
    text: "Export...",
    accelerator: toTauriAccelerator(kb["export"] || "Mod-e"),
    action: async () => {
      const doc = getDoc();
      if (!doc) return;
      const outputPath = await save({
        title: "Export sigil",
        defaultPath: `${doc.sigil.name}.md`,
        filters: [{ name: "Markdown", extensions: ["md"] }],
      });
      if (!outputPath) return;
      await api.exportSigil(doc.sigil.root_path, outputPath);
    },
  });

  const installOntologiesItem = await MenuItem.new({
    text: "Install Imported Ontologies...",
    action: async () => {
      const doc = getDoc();
      if (!doc) return;
      try {
        const statuses = await api.checkImportedOntologies(doc.sigil.root_path);
        const newOnes = statuses.filter(s => s.status === "new").map(s => s.name);
        const modified = statuses.filter(s => s.status === "modified").map(s => s.name);
        const current = statuses.filter(s => s.status === "current");

        if (newOnes.length === 0 && modified.length === 0) {
          await message("All imported ontologies are up to date.", { title: "Imported Ontologies" });
          return;
        }

        // Install new ones automatically
        if (newOnes.length > 0) {
          await api.installOntologies(doc.sigil.root_path, newOnes, false);
        }

        // Ask about modified ones
        for (const name of modified) {
          const overwrite = await ask(
            `"${name}" has been modified locally. Replace with the bundled version?`,
            { title: "Imported Ontologies", kind: "warning", okLabel: "Replace", cancelLabel: "Keep" },
          );
          if (overwrite) {
            await api.installOntologies(doc.sigil.root_path, [name], true);
          }
        }

        const installed = newOnes.length;
        const replaced = modified.length;
        const parts = [];
        if (installed > 0) parts.push(`${installed} installed`);
        if (replaced > 0) parts.push(`${replaced} checked`);
        if (current.length > 0) parts.push(`${current.length} up to date`);
        await message(parts.join(", ") + ".", { title: "Imported Ontologies" });

        // Trigger a sigil reload by emitting a no-op update
        dispatch({ type: "UPDATE_DOCUMENT", updates: {} });
      } catch (err) {
        await message(String(err), { title: "Error", kind: "error" });
      }
    },
  });

  const fileSubmenu = await Submenu.new({
    text: "File",
    items: [
      newItem,
      openItem,
      await PredefinedMenuItem.new({ item: "Separator" }),
      recentSubmenu,
      await PredefinedMenuItem.new({ item: "Separator" }),
      installOntologiesItem,
      exportItem,
      await PredefinedMenuItem.new({ item: "Separator" }),
      closeItem,
    ],
  });

  // ── Edit menu ──
  const editSubmenu = await Submenu.new({
    text: "Edit",
    items: [
      await PredefinedMenuItem.new({ item: "Undo" }),
      await PredefinedMenuItem.new({ item: "Redo" }),
      await PredefinedMenuItem.new({ item: "Separator" }),
      await PredefinedMenuItem.new({ item: "Cut" }),
      await PredefinedMenuItem.new({ item: "Copy" }),
      await PredefinedMenuItem.new({ item: "Paste" }),
      await PredefinedMenuItem.new({ item: "SelectAll" }),
      await PredefinedMenuItem.new({ item: "Separator" }),
      await MenuItem.new({
        text: "Rename Sigil...",
        accelerator: toTauriAccelerator(kb["rename-sigil"] || "Alt-Mod-r"),
        action: () => {
          const doc = getDoc();
          if (!doc) return;
          dispatch({ type: "UPDATE_DOCUMENT", updates: { renamingRequest: true, ontologyPanelOpen: true, ontologyPanelTab: "ontology" } });
        },
      }),
    ],
  });

  // ── Find menu ──
  const findReferencesItem = await MenuItem.new({
    text: "Find References",
    accelerator: toTauriAccelerator(kb["find-references"] || "Alt-Mod-f"),
    action: () => {
      const doc = getDoc();
      if (!doc) return;
      const root = doc.sigil.root;
      let ctx = root;
      for (const seg of doc.currentPath) {
        const child = ctx.children.find((c: { name: string }) => c.name === seg);
        if (!child) break;
        ctx = child;
      }
      dispatch({ type: "UPDATE_DOCUMENT", updates: { findReferencesName: ctx.name } });
    },
  });

  const findSubmenu = await Submenu.new({
    text: "Find",
    items: [findReferencesItem],
  });

  // ── View menu ──
  const wordWrapItem = await MenuItem.new({
    text: "Toggle Word Wrap",
    accelerator: toTauriAccelerator(kb["toggle-word-wrap"] || "Alt-z"),
    action: () => {
      const doc = getDoc();
      if (!doc) return;
      dispatch({ type: "UPDATE_DOCUMENT", updates: { wordWrap: !doc.wordWrap } });
    },
  });

  const zoomInItem = await MenuItem.new({
    text: "Zoom In",
    accelerator: "CmdOrCtrl+=",
    action: () => {
      const fs = getUI().fontSize || 16;
      dispatch({ type: "SET_UI", ui: { fontSize: Math.min(24, fs + 1) } });
    },
  });

  const zoomOutItem = await MenuItem.new({
    text: "Zoom Out",
    accelerator: "CmdOrCtrl+-",
    action: () => {
      const fs = getUI().fontSize || 16;
      dispatch({ type: "SET_UI", ui: { fontSize: Math.max(12, fs - 1) } });
    },
  });

  const zoomResetItem = await MenuItem.new({
    text: "Actual Size",
    accelerator: "CmdOrCtrl+0",
    action: () => {
      dispatch({ type: "SET_UI", ui: { fontSize: 16 } });
    },
  });

  const viewSubmenu = await Submenu.new({
    text: "View",
    items: [
      zoomInItem,
      zoomOutItem,
      zoomResetItem,
      await PredefinedMenuItem.new({ item: "Separator" }),
      wordWrapItem,
    ],
  });

  // ── Window menu ──
  const windowSubmenu = await Submenu.new({
    text: "Window",
    items: [
      await PredefinedMenuItem.new({ item: "Minimize" }),
      await PredefinedMenuItem.new({ item: "Maximize" }),
      await PredefinedMenuItem.new({ item: "Fullscreen" }),
      await PredefinedMenuItem.new({ item: "Separator" }),
      await PredefinedMenuItem.new({ item: "CloseWindow" }),
    ],
  });
  await windowSubmenu.setAsWindowsMenuForNSApp();

  // ── Help menu ──
  const helpItem = await MenuItem.new({
    text: "Sigil Help",
    action: () => {
      dispatch({ type: "SET_HELP_OPEN", open: true });
    },
  });

  const helpSubmenu = await Submenu.new({
    text: "Help",
    items: [helpItem],
  });
  await helpSubmenu.setAsHelpMenuForNSApp();

  const menu = await Menu.new({
    items: [appSubmenu, fileSubmenu, editSubmenu, findSubmenu, viewSubmenu, windowSubmenu, helpSubmenu],
  });

  await menu.setAsAppMenu();
}
