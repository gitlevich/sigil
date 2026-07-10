/**
 * @vitest-environment jsdom
 */
import { act, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ToastContext } from "../../src/hooks/useToast";
import { __updateTest, UPDATE_AFFORDANCE_LIFETIME_MS, useUpdate } from "../../src/hooks/useUpdate";

const tauri = vi.hoisted(() => ({
  check: vi.fn(),
  getVersion: vi.fn(),
  relaunch: vi.fn(),
}));

vi.mock("@tauri-apps/plugin-updater", () => ({ check: tauri.check }));
vi.mock("@tauri-apps/plugin-process", () => ({ relaunch: tauri.relaunch }));
vi.mock("@tauri-apps/api/app", () => ({ getVersion: tauri.getVersion }));

const addToast = vi.fn();

function wrapper({ children }: { children: ReactNode }) {
  return (
    <ToastContext.Provider value={{ toasts: [], addToast, removeToast: vi.fn() }}>
      {children}
    </ToastContext.Provider>
  );
}

function availableUpdate(version = "0.48.0") {
  return {
    version,
    downloadAndInstall: vi.fn().mockResolvedValue(undefined),
    close: vi.fn().mockResolvedValue(undefined),
  };
}

function githubRelease(version = "0.48.0") {
  return {
    ok: true,
    status: 200,
    json: vi.fn().mockResolvedValue({ tag_name: `v${version}` }),
  } as unknown as Response;
}

async function flushUpdateCheck() {
  await act(async () => {
    await Promise.resolve();
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(githubRelease()));
  tauri.getVersion.mockResolvedValue("0.47.5");
  tauri.relaunch.mockResolvedValue(undefined);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("useUpdate", () => {
  it("checks on launch and removes an available update after one minute", async () => {
    const update = availableUpdate();
    tauri.check.mockResolvedValue(update);

    const { result } = renderHook(() => useUpdate(), { wrapper });
    await flushUpdateCheck();

    expect(tauri.check).toHaveBeenCalledOnce();
    expect(result.current.affordance).toEqual({ version: "0.48.0" });

    act(() => {
      vi.advanceTimersByTime(UPDATE_AFFORDANCE_LIFETIME_MS - 1);
    });
    expect(result.current.affordance).not.toBeNull();

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(result.current.affordance).toBeNull();
    expect(update.close).toHaveBeenCalledOnce();
  });

  it("reports a manual check with no available update", async () => {
    vi.mocked(fetch).mockResolvedValue(githubRelease("0.47.5"));
    const { result } = renderHook(() => useUpdate(), { wrapper });
    await flushUpdateCheck();

    await act(async () => {
      await result.current.checkForUpdate(true);
    });

    expect(tauri.check).not.toHaveBeenCalled();
    expect(addToast).toHaveBeenCalledWith("Sigil is up to date.", "info");
  });

  it("installs only after invocation and relaunches Sigil", async () => {
    const update = availableUpdate("0.49.0");
    tauri.check.mockResolvedValue(update);
    const { result } = renderHook(() => useUpdate(), { wrapper });
    await flushUpdateCheck();

    expect(update.downloadAndInstall).not.toHaveBeenCalled();
    await act(async () => {
      await result.current.install();
    });

    expect(update.downloadAndInstall).toHaveBeenCalledOnce();
    expect(tauri.relaunch).toHaveBeenCalledOnce();
    expect(result.current.affordance).toBeNull();
    expect(update.close).toHaveBeenCalledOnce();
    expect(addToast).toHaveBeenCalledWith("Updating Sigil...", "info");
  });

  it("keeps launch failures quiet and reports manual failures", async () => {
    vi.mocked(fetch).mockRejectedValue(new Error("offline"));
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { result } = renderHook(() => useUpdate(), { wrapper });
    await flushUpdateCheck();

    expect(addToast).not.toHaveBeenCalled();
    await act(async () => {
      await result.current.checkForUpdate(true);
    });

    expect(addToast).toHaveBeenCalledWith("Sigil could not check for updates.", "error");
    consoleError.mockRestore();
  });

  it("distinguishes a newer release with a missing updater package", async () => {
    tauri.check.mockRejectedValue(new Error("HTTP 404"));
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { result } = renderHook(() => useUpdate(), { wrapper });
    await flushUpdateCheck();

    expect(addToast).not.toHaveBeenCalled();
    await act(async () => {
      await result.current.checkForUpdate(true);
    });

    expect(addToast).toHaveBeenCalledWith(
      "Sigil 0.48.0 is available, but its updater package could not be loaded.",
      "error",
    );
    consoleError.mockRestore();
  });
});

describe("update version comparison", () => {
  it("compares release versions numerically", () => {
    expect(__updateTest.compareVersions("0.48.0", "0.47.5")).toBeGreaterThan(0);
    expect(__updateTest.compareVersions("v1.0.0", "0.99.99")).toBeGreaterThan(0);
    expect(__updateTest.compareVersions("0.47.5", "0.47.5")).toBe(0);
  });
});
