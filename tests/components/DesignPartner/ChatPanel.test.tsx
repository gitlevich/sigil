/**
 * @vitest-environment jsdom
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { api, type Idea } from "../../../src/tauri";
import { AppProvider } from "../../../src/state/AppContext";
import { ChatProvider, type ChatState } from "../../../src/state/ChatContext";
import { ChatStreamProvider } from "../../../src/state/ChatStreamContext";
import { LayoutProvider } from "../../../src/state/LayoutContext";
import { WorkspaceProvider } from "../../../src/state/WorkspaceContext";
import { ChatPanel } from "../../../src/components/DesignPartner/ChatPanel";

vi.mock("@tauri-apps/plugin-clipboard-manager", () => ({
  writeText: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@tauri-apps/plugin-dialog", () => ({
  open: vi.fn().mockResolvedValue(null),
}));

vi.mock("../../../src/tauri", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../src/tauri")>();
  return {
    ...actual,
    api: {
      ...actual.api,
      listChats: vi.fn().mockResolvedValue([]),
      readChat: vi.fn().mockResolvedValue({ id: "chat-1", name: "Chat 1", messages: [] }),
      readChatDraft: vi.fn().mockResolvedValue({ content: "", attachments: [], updatedAt: 0 }),
      writeChatDraft: vi.fn().mockResolvedValue(undefined),
      deleteChat: vi.fn().mockResolvedValue(undefined),
      renameChat: vi.fn().mockResolvedValue(undefined),
      forkChat: vi.fn().mockResolvedValue({
        id: "chat-2",
        name: "Chat 1 1",
        message_count: 0,
        last_modified: 1,
      }),
      saveChatAttachmentFromPath: vi.fn().mockResolvedValue({
        path: "/tmp/test.sigil/.private/chats/attachments/chat-1/field.png",
        mime_type: "image/png",
      }),
      saveChatAttachmentFromBytes: vi.fn(),
      readImageBase64: vi.fn().mockResolvedValue("data:image/png;base64,ZmFrZQ=="),
      cancelChat: vi.fn().mockResolvedValue(undefined),
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

function Providers({
  children,
  initialChat,
  sendMessage = vi.fn().mockResolvedValue(""),
}: {
  children: ReactNode;
  initialChat?: Partial<ChatState>;
  sendMessage?: (message: string) => Promise<string>;
}) {
  return (
    <AppProvider>
      <WorkspaceProvider spec={spec}>
        <LayoutProvider initial={{ designPartnerPanelOpen: true }}>
          <ChatProvider
            initial={{
              activeChatId: "chat-1",
              chats: [{ id: "chat-1", name: "Chat 1", message_count: 0, last_modified: 1 }],
              ...initialChat,
            }}
          >
            <ChatStreamProvider handle={{ sendMessage }}>
              {children}
            </ChatStreamProvider>
          </ChatProvider>
        </LayoutProvider>
      </WorkspaceProvider>
    </AppProvider>
  );
}

function renderChatPanel(options?: {
  initialChat?: Partial<ChatState>;
  sendMessage?: (message: string) => Promise<string>;
}) {
  return render(
    <Providers initialChat={options?.initialChat} sendMessage={options?.sendMessage}>
      <ChatPanel />
    </Providers>,
  );
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  Element.prototype.scrollIntoView = vi.fn();
});

afterEach(() => {
  cleanup();
});

describe("ChatPanel composer", () => {
  it("uses the compact icon-only send control from SigilAtlas", () => {
    const { container, getByRole, queryByTitle } = renderChatPanel();
    const send = getByRole("button", { name: "Send" });

    expect(send.textContent).toBe("");
    expect(send.querySelector(".sendIcon")).not.toBeNull();
    expect(container.querySelector(".inputActions")).toBeNull();
    expect(queryByTitle("Rename or delete this chat")).toBeNull();
  });

  it("sends typed text from the compact control", () => {
    const sendMessage = vi.fn().mockResolvedValue("");
    const { getByRole } = renderChatPanel({ sendMessage });
    const input = getByRole("textbox") as HTMLTextAreaElement;
    const send = getByRole("button", { name: "Send" }) as HTMLButtonElement;

    fireEvent.change(input, { target: { value: "Review this sigil" } });
    expect(send.disabled).toBe(false);

    fireEvent.click(send);

    expect(sendMessage).toHaveBeenCalledWith("Review this sigil", undefined);
    expect(input.value).toBe("");
  });

  it("restores the composer draft from disk", async () => {
    vi.mocked(api.readChatDraft).mockResolvedValueOnce({
      content: "persistent paragraph",
      attachments: [],
      updatedAt: 7,
    });
    const { getByRole } = renderChatPanel();
    const input = getByRole("textbox") as HTMLTextAreaElement;

    await waitFor(() => {
      expect(input.value).toBe("persistent paragraph");
    });
    expect(api.readChatDraft).toHaveBeenCalledWith("/tmp/test.sigil", "chat-1");
  });

  it("writes composer drafts through Tauri as the user types", async () => {
    const { getByRole } = renderChatPanel();
    const input = getByRole("textbox") as HTMLTextAreaElement;

    await waitFor(() => {
      expect(api.readChatDraft).toHaveBeenCalledWith("/tmp/test.sigil", "chat-1");
    });
    vi.mocked(api.writeChatDraft).mockClear();

    fireEvent.change(input, { target: { value: "draft on disk" } });

    await waitFor(() => {
      expect(api.writeChatDraft).toHaveBeenCalledWith(
        "/tmp/test.sigil",
        "chat-1",
        expect.objectContaining({
          content: "draft on disk",
          attachments: [],
          updatedAt: expect.any(Number),
        }),
      );
    });
  });

  it("keeps the disk draft until send resolves", async () => {
    const pendingSend = deferred<string>();
    const sendMessage = vi.fn().mockReturnValue(pendingSend.promise);
    const { getByRole } = renderChatPanel({ sendMessage });
    const input = getByRole("textbox") as HTMLTextAreaElement;
    const send = getByRole("button", { name: "Send" }) as HTMLButtonElement;

    await waitFor(() => {
      expect(api.readChatDraft).toHaveBeenCalledWith("/tmp/test.sigil", "chat-1");
    });
    fireEvent.change(input, { target: { value: "draft before send" } });
    await waitFor(() => {
      expect(api.writeChatDraft).toHaveBeenCalledWith(
        "/tmp/test.sigil",
        "chat-1",
        expect.objectContaining({ content: "draft before send" }),
      );
    });

    vi.mocked(api.writeChatDraft).mockClear();
    fireEvent.click(send);

    expect(input.value).toBe("");
    expect(api.writeChatDraft).not.toHaveBeenCalledWith(
      "/tmp/test.sigil",
      "chat-1",
      expect.objectContaining({ content: "" }),
    );

    pendingSend.resolve("");
    await waitFor(() => {
      expect(api.writeChatDraft).toHaveBeenCalledWith(
        "/tmp/test.sigil",
        "chat-1",
        expect.objectContaining({ content: "" }),
      );
    });
  });

  it("keeps a pending no-chat draft visible instead of auto-opening a recent chat", async () => {
    vi.mocked(api.listChats).mockResolvedValueOnce([
      { id: "chat-1", name: "Chat 1", message_count: 1, last_modified: 10 },
    ]);
    vi.mocked(api.readChatDraft).mockImplementation(async (_rootPath, chatId) => {
      if (chatId === "__pending__") {
        return { content: "pending no-chat paragraph", attachments: [], updatedAt: 7 };
      }
      return { content: "", attachments: [], updatedAt: 0 };
    });

    const { getByRole } = renderChatPanel({
      initialChat: { activeChatId: "", chats: [], chatMessages: [] },
    });
    const input = getByRole("textbox") as HTMLTextAreaElement;

    await waitFor(() => {
      expect(input.value).toBe("pending no-chat paragraph");
    });
    expect(api.readChat).not.toHaveBeenCalled();
  });

  it("scrolls transcript content upward while the composer grows", () => {
    const { container, getByRole } = renderChatPanel();
    const panel = container.querySelector(".panel") as HTMLElement;
    const messages = container.querySelector(".messages") as HTMLElement;
    const resizeHandle = getByRole("separator", { name: "Resize chat input" });

    Object.defineProperty(panel, "clientHeight", { value: 500, configurable: true });
    messages.scrollTop = 120;

    act(() => {
      fireEvent.mouseDown(resizeHandle, { clientY: 300 });
      fireEvent.mouseMove(window, { clientY: 250 });
    });

    expect(messages.scrollTop).toBe(170);

    act(() => {
      fireEvent.mouseUp(window);
    });
  });

  it("renames the active chat inline from the visible pencil control", async () => {
    const { getByRole, getByLabelText, queryByLabelText } = renderChatPanel();

    fireEvent.click(getByRole("button", { name: "Rename chat" }));
    const rename = getByLabelText("Rename current chat") as HTMLInputElement;

    expect(rename.value).toBe("Chat 1");
    expect(document.activeElement).toBe(rename);

    fireEvent.change(rename, { target: { value: "Field notes" } });
    fireEvent.keyDown(rename, { key: "Enter" });

    await waitFor(() => {
      expect(api.renameChat).toHaveBeenCalledWith("/tmp/test.sigil", "chat-1", "Field notes");
    });
    expect(queryByLabelText("Rename current chat")).toBeNull();
  });

  it("cancels inline chat rename on Escape", () => {
    const { getByRole, getByLabelText, queryByLabelText } = renderChatPanel();

    fireEvent.click(getByRole("button", { name: "Rename chat" }));
    const rename = getByLabelText("Rename current chat") as HTMLInputElement;

    fireEvent.change(rename, { target: { value: "Cancelled" } });
    fireEvent.keyDown(rename, { key: "Escape" });

    expect(api.renameChat).not.toHaveBeenCalled();
    expect(queryByLabelText("Rename current chat")).toBeNull();
  });

  it("attaches an image through the visible picker control", async () => {
    const { open } = await import("@tauri-apps/plugin-dialog");
    vi.mocked(open).mockResolvedValue("/tmp/field.png");
    const { getByRole } = renderChatPanel();

    fireEvent.click(getByRole("button", { name: "Attach image" }));

    await waitFor(() => {
      expect(open).toHaveBeenCalledWith({
        multiple: true,
        filters: [
          { name: "Images", extensions: ["png", "jpg", "jpeg", "gif", "svg", "webp"] },
        ],
      });
    });
    expect(api.saveChatAttachmentFromPath).toHaveBeenCalledWith(
      "/tmp/test.sigil",
      "chat-1",
      "/tmp/field.png",
    );
  });

  it("keeps added chat header controls matched to the existing selector height", () => {
    const css = readFileSync(
      resolve(process.cwd(), "src/components/DesignPartner/ChatPanel.module.css"),
      "utf8",
    );
    const addedControlRule = css.match(
      /\.chatCurrent,\s*\.newChatBtn,\s*\.chatRenameBtn\s*\{([\s\S]*?)\}/,
    )?.[1];
    const profileSwitchRule = css.match(/\.profileSwitch\s*\{([\s\S]*?)\}/)?.[1];

    expect(addedControlRule).toContain("padding: 0.15rem 0.35rem;");
    expect(addedControlRule).toContain("border-radius: 3px;");
    expect(addedControlRule).toContain("font-size: 0.75rem;");
    expect(addedControlRule).not.toMatch(/\bheight:\s*30px\b/);
    expect(profileSwitchRule).toContain("padding: 0.15rem 0.35rem;");
    expect(profileSwitchRule).toContain("border-radius: 3px;");
    expect(profileSwitchRule).toContain("font-size: 0.75rem;");
  });
});
