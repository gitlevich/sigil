/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { useExternalAiBridge, __externalAiBridgeTest } from "../../src/hooks/useExternalAiBridge";
import { WorkspaceProvider } from "../../src/state/WorkspaceContext";
import { ChatProvider, type ChatState } from "../../src/state/ChatContext";
import type { Idea } from "../../src/tauri";
import { api, events } from "../../src/tauri";

const mocks = vi.hoisted(() => ({
  bridgeHandler: null as ((message: any) => void) | null,
}));

vi.mock("../../src/tauri", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/tauri")>();
  return {
    ...actual,
    api: {
      ...actual.api,
      registerExternalAiBridge: vi.fn().mockResolvedValue({
        protocol: "sigil-external-ai-jsonl-v1",
        host: "127.0.0.1",
        port: 3000,
        token: "token",
        rootPath: "/tmp/test.sigil",
        pid: 1,
      }),
      unregisterExternalAiBridge: vi.fn().mockResolvedValue(undefined),
      externalAiBridgeAck: vi.fn().mockResolvedValue(undefined),
      externalAiBridgeComplete: vi.fn().mockResolvedValue(undefined),
    },
    events: {
      ...actual.events,
      onExternalAiBridgeMessage: vi.fn((handler: (message: any) => void) => {
        mocks.bridgeHandler = handler;
        return Promise.resolve(() => {
          mocks.bridgeHandler = null;
        });
      }),
    },
  };
});

const spec: Idea = {
  name: "Test",
  rootPath: "/tmp/test.sigil",
  vision: "",
  root: {
    name: "Test",
    path: "/tmp/test.sigil",
    language: "",
    affordances: [],
    invariants: [],
    children: [],
    images: [],
  },
};

function wrapper(initialChat?: Partial<ChatState>) {
  return function Providers({ children }: { children: ReactNode }) {
    return (
      <WorkspaceProvider spec={spec}>
        <ChatProvider initial={initialChat}>{children}</ChatProvider>
      </WorkspaceProvider>
    );
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.bridgeHandler = null;
});

describe("useExternalAiBridge", () => {
  it("registers the workspace and unregisters on unmount", async () => {
    const sendMessage = vi.fn().mockResolvedValue("ok");
    const { unmount } = renderHook(() => useExternalAiBridge(sendMessage), {
      wrapper: wrapper(),
    });

    await waitFor(() => {
      expect(api.registerExternalAiBridge).toHaveBeenCalledWith("/tmp/test.sigil");
    });

    unmount();

    await waitFor(() => {
      expect(api.unregisterExternalAiBridge).toHaveBeenCalledWith("/tmp/test.sigil");
    });
  });

  it("acks and sends an external turn through the current chat", async () => {
    const sendMessage = vi.fn().mockResolvedValue("Design Partner response");
    renderHook(() => useExternalAiBridge(sendMessage), {
      wrapper: wrapper(),
    });
    await waitFor(() => expect(events.onExternalAiBridgeMessage).toHaveBeenCalled());

    await act(async () => {
      mocks.bridgeHandler?.({
        requestId: "request-1",
        rootPath: "/tmp/test.sigil",
        message: "Can you hear Codex?",
        currentPath: ["DesignPartner"],
      });
    });

    await waitFor(() => {
      expect(api.externalAiBridgeAck).toHaveBeenCalledWith(
        "request-1",
        true,
        "Accepted by Sigil and sent to the current Design Partner chat.",
      );
      expect(sendMessage).toHaveBeenCalledWith(
        "External AI says:\n\nCan you hear Codex?\n\nExternal AI context: DesignPartner",
      );
      expect(api.externalAiBridgeComplete).toHaveBeenCalledWith(
        "request-1",
        true,
        "Design Partner response",
      );
    });
  });

  it("rejects external turns while the current chat is streaming", async () => {
    const sendMessage = vi.fn().mockResolvedValue("ignored");
    renderHook(() => useExternalAiBridge(sendMessage), {
      wrapper: wrapper({ chatStreaming: true }),
    });
    await waitFor(() => expect(events.onExternalAiBridgeMessage).toHaveBeenCalled());

    await act(async () => {
      mocks.bridgeHandler?.({
        requestId: "request-2",
        rootPath: "/tmp/test.sigil",
        message: "Busy?",
      });
    });

    await waitFor(() => {
      expect(api.externalAiBridgeAck).toHaveBeenCalledWith(
        "request-2",
        false,
        "Current Design Partner chat is busy.",
      );
      expect(api.externalAiBridgeComplete).toHaveBeenCalledWith(
        "request-2",
        false,
        "Current Design Partner chat is busy.",
      );
      expect(sendMessage).not.toHaveBeenCalled();
    });
  });

  it("formats bridge chat messages", () => {
    expect(__externalAiBridgeTest.bridgeChatMessage({
      requestId: "request-3",
      rootPath: "/tmp/test.sigil",
      message: "Hello",
    })).toBe("External AI says:\n\nHello");
  });

  it("matches bridge root paths with trailing slash differences", () => {
    expect(__externalAiBridgeTest.sameBridgeRootPath(
      "/tmp/test.sigil/",
      "/tmp/test.sigil",
    )).toBe(true);
  });
});
