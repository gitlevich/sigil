import { useEffect } from "react";
import { Menu } from "@tauri-apps/api/menu/menu";
import { MenuItem } from "@tauri-apps/api/menu/menuItem";
import { Submenu } from "@tauri-apps/api/menu/submenu";
import { PredefinedMenuItem } from "@tauri-apps/api/menu/predefinedMenuItem";
import { open, save } from "@tauri-apps/plugin-dialog";
import { api, openInNewWindow } from "../tauri";
import { useAppDispatch, useAppState } from "../state/AppContext";
import { getCurrentWindow } from "@tauri-apps/api/window";

export function useAppMenu() {
  const dispatch = useAppDispatch();
  const state = useAppState();

  useEffect(() => {
    buildMenu(dispatch, () => state.document, () => state.ui).catch(console.error);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}

async function buildMenu(
  dispatch: ReturnType<typeof useAppDispatch>,
  getDoc: () => ReturnType<typeof useAppState>["document"],
  getUI: () => ReturnType<typeof useAppState>["ui"],
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

  const exportItem = await MenuItem.new({
    text: "Export...",
    accelerator: "CmdOrCtrl+E",
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

  const fileSubmenu = await Submenu.new({
    text: "File",
    items: [
      newItem,
      openItem,
      await PredefinedMenuItem.new({ item: "Separator" }),
      recentSubmenu,
      await PredefinedMenuItem.new({ item: "Separator" }),
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
    ],
  });

  // ── View menu ──
  const wordWrapItem = await MenuItem.new({
    text: "Toggle Word Wrap",
    accelerator: "Alt+Z",
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
    items: [appSubmenu, fileSubmenu, editSubmenu, viewSubmenu, windowSubmenu, helpSubmenu],
  });

  await menu.setAsAppMenu();
}
