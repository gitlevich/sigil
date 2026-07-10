import { useCallback, useEffect, useRef, useState } from "react";
import { getVersion } from "@tauri-apps/api/app";
import { relaunch } from "@tauri-apps/plugin-process";
import { check, type Update } from "@tauri-apps/plugin-updater";
import { useToast } from "./useToast";

export const UPDATE_AFFORDANCE_LIFETIME_MS = 60_000;
const LATEST_RELEASE_URL = "https://api.github.com/repos/gitlevich/sigil/releases/latest";

export interface UpdateAffordanceState {
  version: string;
}

function parseVersion(version: string): [number, number, number] | null {
  const match = version.match(/^v?(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/);
  if (!match) return null;
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

function compareVersions(left: string, right: string): number {
  const leftParts = parseVersion(left);
  const rightParts = parseVersion(right);
  if (!leftParts || !rightParts) throw new Error(`Invalid release version: ${left} or ${right}`);

  for (let index = 0; index < leftParts.length; index += 1) {
    if (leftParts[index] !== rightParts[index]) {
      return leftParts[index] - rightParts[index];
    }
  }
  return 0;
}

async function latestPublishedVersion(): Promise<string> {
  const response = await fetch(LATEST_RELEASE_URL, {
    headers: { Accept: "application/vnd.github+json" },
    cache: "no-store",
  });
  if (!response.ok) throw new Error(`GitHub release check failed with HTTP ${response.status}`);

  const release = await response.json() as { tag_name?: unknown };
  if (typeof release.tag_name !== "string" || !parseVersion(release.tag_name)) {
    throw new Error("GitHub latest release has no valid version tag");
  }
  return release.tag_name.replace(/^v/, "");
}

export function useUpdate() {
  const { addToast } = useToast();
  const [affordance, setAffordance] = useState<UpdateAffordanceState | null>(null);
  const availableUpdate = useRef<Update | null>(null);
  const dismissTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const checking = useRef(false);
  const installing = useRef(false);
  const checkedOnLaunch = useRef(false);
  const mounted = useRef(false);

  const clearDismissTimer = useCallback(() => {
    if (dismissTimer.current !== null) {
      clearTimeout(dismissTimer.current);
      dismissTimer.current = null;
    }
  }, []);

  const releaseUpdate = useCallback(() => {
    const update = availableUpdate.current;
    availableUpdate.current = null;
    if (update) {
      void update.close().catch((error) => {
        console.error("Failed to release updater resource:", error);
      });
    }
  }, []);

  const dismiss = useCallback(() => {
    clearDismissTimer();
    setAffordance(null);
    releaseUpdate();
  }, [clearDismissTimer, releaseUpdate]);

  const present = useCallback((update: Update) => {
    clearDismissTimer();
    releaseUpdate();
    availableUpdate.current = update;
    setAffordance({ version: update.version });
    dismissTimer.current = setTimeout(() => {
      dismissTimer.current = null;
      setAffordance(null);
      releaseUpdate();
    }, UPDATE_AFFORDANCE_LIFETIME_MS);
  }, [clearDismissTimer, releaseUpdate]);

  const checkForUpdate = useCallback(async (reportResult = false) => {
    if (installing.current) {
      if (reportResult) addToast("Sigil is already updating.", "info");
      return;
    }

    if (checking.current) {
      if (reportResult) addToast("Sigil is already checking for updates.", "info");
      return;
    }

    checking.current = true;
    let publishedVersion: string | null = null;
    try {
      const [currentVersion, latestVersion] = await Promise.all([
        getVersion(),
        latestPublishedVersion(),
      ]);
      publishedVersion = latestVersion;
      if (compareVersions(latestVersion, currentVersion) <= 0) {
        if (reportResult) addToast("Sigil is up to date.", "info");
        return;
      }

      const update = await check();
      if (update) {
        if (mounted.current) {
          present(update);
        } else {
          await update.close();
        }
      } else if (reportResult) {
        addToast("Sigil is up to date.", "info");
      }
    } catch (error) {
      console.error("Update check failed:", error);
      if (reportResult) {
        addToast(
          publishedVersion
            ? `Sigil ${publishedVersion} is available, but its updater package could not be loaded.`
            : "Sigil could not check for updates.",
          "error",
        );
      }
    } finally {
      checking.current = false;
    }
  }, [addToast, present]);

  const install = useCallback(async () => {
    const update = availableUpdate.current;
    if (!update || installing.current) return;

    installing.current = true;
    clearDismissTimer();
    setAffordance(null);
    addToast("Updating Sigil...", "info");
    try {
      await update.downloadAndInstall();
      await relaunch();
      releaseUpdate();
    } catch (error) {
      console.error("Update installation failed:", error);
      releaseUpdate();
      addToast("Sigil could not install the update. Try again from Help.", "error");
    } finally {
      installing.current = false;
    }
  }, [addToast, clearDismissTimer, releaseUpdate]);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      clearDismissTimer();
      releaseUpdate();
    };
  }, [clearDismissTimer, releaseUpdate]);

  useEffect(() => {
    if (checkedOnLaunch.current) return;
    checkedOnLaunch.current = true;
    void checkForUpdate();
  }, [checkForUpdate]);

  return { affordance, checkForUpdate, install, dismiss };
}

export const __updateTest = { compareVersions, parseVersion };
