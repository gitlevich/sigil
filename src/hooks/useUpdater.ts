import { useEffect } from "react";
import { check } from "@tauri-apps/plugin-updater";
import { ask } from "@tauri-apps/plugin-dialog";

export function useUpdater() {
  useEffect(() => {
    checkForUpdate().catch(console.error);
  }, []);
}

async function checkForUpdate() {
  try {
    const update = await check();
    if (!update) return;

    const yes = await ask(
      `Sigil ${update.version} is available. Update now?`,
      { title: "Update Available", kind: "info", okLabel: "Update", cancelLabel: "Later" }
    );

    if (yes) {
      await update.downloadAndInstall();
      // The app will restart automatically after install
    }
  } catch (err) {
    // Silently ignore update check failures (offline, no releases yet, etc.)
    console.error("Update check failed:", err);
  }
}
