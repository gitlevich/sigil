import { useEffect } from "react";
import { Menu } from "@tauri-apps/api/menu/menu";
import { MenuItem } from "@tauri-apps/api/menu/menuItem";
import { Submenu } from "@tauri-apps/api/menu/submenu";
import { PredefinedMenuItem } from "@tauri-apps/api/menu/predefinedMenuItem";
import { open } from "@tauri-apps/plugin-dialog";
import { api, openInNewWindow } from "../tauri";
import { useAppDispatch } from "../state/AppContext";
import { getCurrentWindow } from "@tauri-apps/api/window";

export function useAppMenu() {
  const dispatch = useAppDispatch();

  useEffect(() => {
    buildMenu(dispatch).catch(console.error);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}

async function buildMenu(dispatch: ReturnType<typeof useAppDispatch>) {
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

  const newItem = await MenuItem.new({
    text: "New Window",
    accelerator: "CmdOrCtrl+N",
    action: () => {
      openInNewWindow("");
    },
  });

  const closeItem = await MenuItem.new({
    text: "Close Window",
    accelerator: "CmdOrCtrl+W",
    action: async () => {
      await getCurrentWindow().close();
    },
  });

  const settingsItem = await MenuItem.new({
    text: "Settings...",
    accelerator: "CmdOrCtrl+,",
    action: () => {
      dispatch({ type: "SET_SETTINGS_OPEN", open: true });
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
      settingsItem,
      await PredefinedMenuItem.new({ item: "Separator" }),
      closeItem,
    ],
  });

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

  const menu = await Menu.new({
    items: [fileSubmenu, editSubmenu, windowSubmenu],
  });

  await menu.setAsAppMenu();
}
