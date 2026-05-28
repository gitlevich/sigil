import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockInvoke, mockListen, mockWebviewWindow } = vi.hoisted(() => ({
  mockInvoke: vi.fn(),
  mockListen: vi.fn().mockResolvedValue(() => {}),
  mockWebviewWindow: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => ({ invoke: mockInvoke }));
vi.mock("@tauri-apps/api/event", () => ({ listen: mockListen }));
vi.mock("@tauri-apps/api/webviewWindow", () => ({ WebviewWindow: mockWebviewWindow }));

import {
  selectedProvider, enabledProviders,
  DEFAULT_KEYBINDINGS, KEYBINDING_LABELS,
  api, events, openInNewWindow, getInitialRootPath,
} from "../src/tauri";
import type { Settings, AiProvider } from "../src/tauri";

// ── Pure functions ──

describe("selectedProvider", () => {
  function makeProvider(id: string, enabled = true): AiProvider {
    return { id, name: id, provider: "anthropic", api_key: "", model: "", enabled };
  }
  function makeSettings(providers: AiProvider[], selectedId: string): Settings {
    return { ai_providers: providers, selected_provider_id: selectedId, system_prompt: "", response_style: "laconic", keybindings: DEFAULT_KEYBINDINGS };
  }

  it("returns the selected provider", () => {
    const p = makeProvider("a1");
    expect(selectedProvider(makeSettings([p, makeProvider("b2")], "a1"))).toBe(p);
  });
  it("returns undefined when not found", () => {
    expect(selectedProvider(makeSettings([makeProvider("a1")], "missing"))).toBeUndefined();
  });
  it("returns undefined for empty providers", () => {
    expect(selectedProvider(makeSettings([], "a1"))).toBeUndefined();
  });
});

describe("enabledProviders", () => {
  function makeProvider(id: string, enabled: boolean): AiProvider {
    return { id, name: id, provider: "anthropic", api_key: "", model: "", enabled };
  }
  function makeSettings(providers: AiProvider[]): Settings {
    return { ai_providers: providers, selected_provider_id: "a", system_prompt: "", response_style: "laconic", keybindings: DEFAULT_KEYBINDINGS };
  }

  it("returns only enabled", () => {
    const result = enabledProviders(makeSettings([makeProvider("a", true), makeProvider("b", false), makeProvider("c", true)]));
    expect(result.map(p => p.id)).toEqual(["a", "c"]);
  });
  it("returns empty when none enabled", () => {
    expect(enabledProviders(makeSettings([makeProvider("a", false)]))).toEqual([]);
  });
});

describe("DEFAULT_KEYBINDINGS", () => {
  const expectedKeys = ["rename-sigil", "create-sigil", "delete-line", "toggle-word-wrap", "export", "facet-map", "panel-vision", "panel-ontology", "find-references", "navigate-back"];
  it("has all expected keys with non-empty string values", () => {
    for (const key of expectedKeys) {
      expect(DEFAULT_KEYBINDINGS).toHaveProperty(key);
      expect(typeof (DEFAULT_KEYBINDINGS as any)[key]).toBe("string");
      expect((DEFAULT_KEYBINDINGS as any)[key].length).toBeGreaterThan(0);
    }
  });
});

describe("KEYBINDING_LABELS", () => {
  it("has a label for every keybinding", () => {
    for (const key of Object.keys(DEFAULT_KEYBINDINGS)) {
      expect(KEYBINDING_LABELS).toHaveProperty(key);
    }
  });
});

// ── api ──

describe("api", () => {
  beforeEach(() => vi.clearAllMocks());

  const cases: [string, () => Promise<any>, string, Record<string, any> | undefined][] = [
    ["readSigil", () => api.readSigil("/root"), "read_sigil", { rootPath: "/root" }],
    ["closeWorkspace", () => api.closeWorkspace("/root"), "close_workspace", { rootPath: "/root" }],
    ["scaffoldSigil", () => api.scaffoldSigil("/root"), "scaffold_sigil", { rootPath: "/root" }],
    ["checkImportedOntologies", () => api.checkImportedOntologies("/root"), "check_imported_ontologies", { rootPath: "/root" }],
    ["installOntologies", () => api.installOntologies("/root", ["lib1"], true), "install_ontologies", { rootPath: "/root", names: ["lib1"], overwrite: true }],
    ["takePendingOpenPath", () => api.takePendingOpenPath(), "take_pending_open_path", undefined],
    ["readFile", () => api.readFile("/f"), "read_file", { path: "/f" }],
    ["writeFile", () => api.writeFile("/f", "c"), "write_file", { path: "/f", content: "c" }],
    ["deleteFile", () => api.deleteFile("/f"), "delete_file", { path: "/f" }],
    ["revealInFinder", () => api.revealInFinder("/f"), "reveal_in_finder", { path: "/f" }],
    ["copyImage", () => api.copyImage("/s", "/d"), "copy_image", { sourcePath: "/s", destDir: "/d" }],
    ["writeImageBytes", () => api.writeImageBytes("/d", [1, 2]), "write_image_bytes", { destPath: "/d", data: [1, 2] }],
    ["readImageBase64", () => api.readImageBase64("/f"), "read_image_base64", { path: "/f" }],
    ["createSigil", () => api.createSigil("/p", "n"), "create_sigil", { parentPath: "/p", name: "n" }],
    ["renameContext", () => api.renameContext("/r", "/p", "n"), "rename_context", { rootPath: "/r", path: "/p", newName: "n" }],
    ["renameSigil", () => api.renameSigil("/r", "/p", "n"), "rename_sigil", { rootPath: "/r", path: "/p", newName: "n" }],
    ["moveSigil", () => api.moveSigil("/r", "/p", "/np"), "move_sigil", { rootPath: "/r", path: "/p", newParentPath: "/np" }],
    ["deleteContext", () => api.deleteContext("/p"), "delete_context", { path: "/p" }],
    ["listModels", () => api.listModels("anthropic", "k"), "list_models", { provider: "anthropic", apiKey: "k" }],
    ["listChats", () => api.listChats("/r"), "list_chats", { rootPath: "/r" }],
    ["readChat", () => api.readChat("/r", "1"), "read_chat", { rootPath: "/r", chatId: "1" }],
    ["writeChat", () => api.writeChat("/r", { id: "1", name: "t", messages: [] }), "write_chat", { rootPath: "/r", chat: { id: "1", name: "t", messages: [] } }],
    ["readChatDraft", () => api.readChatDraft("/r", "1"), "read_chat_draft", { rootPath: "/r", chatId: "1" }],
    ["writeChatDraft", () => api.writeChatDraft("/r", "1", { content: "draft", attachments: [], updatedAt: 42 }), "write_chat_draft", { rootPath: "/r", chatId: "1", draft: { content: "draft", attachments: [], updatedAt: 42 } }],
    ["deleteChat", () => api.deleteChat("/r", "1"), "delete_chat", { rootPath: "/r", chatId: "1" }],
    ["renameChat", () => api.renameChat("/r", "1", "n"), "rename_chat", { rootPath: "/r", chatId: "1", newName: "n" }],
    ["registerExternalAiBridge", () => api.registerExternalAiBridge("/r"), "register_external_ai_bridge", { rootPath: "/r" }],
    ["unregisterExternalAiBridge", () => api.unregisterExternalAiBridge("/r"), "unregister_external_ai_bridge", { rootPath: "/r" }],
    ["externalAiBridgeAck", () => api.externalAiBridgeAck("request-1", true, "accepted"), "external_ai_bridge_ack", { requestId: "request-1", ok: true, message: "accepted" }],
    ["externalAiBridgeComplete", () => api.externalAiBridgeComplete("request-1", true, "done"), "external_ai_bridge_complete", { requestId: "request-1", ok: true, message: "done" }],
    ["externalAiBridgeSendToListener", () => api.externalAiBridgeSendToListener("/r", "hello"), "external_ai_bridge_send_to_listener", { rootPath: "/r", message: "hello" }],
    ["externalAiBridgeDisconnectListener", () => api.externalAiBridgeDisconnectListener("/r", "done"), "external_ai_bridge_disconnect_listener", { rootPath: "/r", reason: "done" }],
    ["listRecentDocuments", () => api.listRecentDocuments(), "list_recent_documents", undefined],
    ["addRecentDocument", () => api.addRecentDocument("/p"), "add_recent_document", { path: "/p" }],
    ["removeRecentDocument", () => api.removeRecentDocument("/p"), "remove_recent_document", { path: "/p" }],
    ["pruneRecentDocuments", () => api.pruneRecentDocuments(), "prune_recent_documents", undefined],
    ["exportSigil", () => api.exportSigil("/r", "/o"), "export_sigil", { rootPath: "/r", outputPath: "/o" }],
    ["memoryRecallForSigil", () => api.memoryRecallForSigil("/p"), "memory_recall_for_sigil", { sigilPath: "/p" }],
    ["memoryStatus", () => api.memoryStatus(), "memory_status", undefined],
    ["memoryTriggerReindex", () => api.memoryTriggerReindex("/r"), "memory_trigger_reindex", { rootPath: "/r" }],
    ["memoryTriggerSleep", () => api.memoryTriggerSleep(), "memory_trigger_sleep", undefined],
    ["readMemories", () => api.readMemories("/r"), "read_memories", { rootPath: "/r" }],
    ["watchDirectory", () => api.watchDirectory("/r"), "watch_directory", { rootPath: "/r" }],
    ["stopWatching", () => api.stopWatching(), "stop_watching", undefined],
  ];

  for (const [name, fn, cmd, args] of cases) {
    it(`${name} calls invoke("${cmd}")`, async () => {
      mockInvoke.mockResolvedValue(undefined);
      await fn();
      if (args === undefined) {
        expect(mockInvoke).toHaveBeenCalledWith(cmd);
      } else {
        expect(mockInvoke).toHaveBeenCalledWith(cmd, args);
      }
    });
  }

  it("sendChatMessage passes all arguments", async () => {
    mockInvoke.mockResolvedValue(undefined);
    const profile = { id: "1", name: "Claude", provider: "anthropic" as const, api_key: "k", model: "m", enabled: true };
    const fallbackProfile = { id: "2", name: "GPT", provider: "openai" as const, api_key: "k2", model: "m2", enabled: true };
    await api.sendChatMessage("/r", "c1", "hi", profile, fallbackProfile, "sys", ["A"]);
    expect(mockInvoke).toHaveBeenCalledWith("send_chat_message", {
      rootPath: "/r", chatId: "c1", message: "hi", profile, fallbackProfile, systemPrompt: "sys", currentPath: ["A"],
    });
  });
});

// ── events ──

describe("events", () => {
  beforeEach(() => vi.clearAllMocks());

  it("onChatToken listens and forwards payload", async () => {
    const handler = vi.fn();
    await events.onChatToken(handler);
    expect(mockListen).toHaveBeenCalledWith("chat-token", expect.any(Function));
    mockListen.mock.calls[0][1]({ payload: "tok" });
    expect(handler).toHaveBeenCalledWith("tok");
  });

  it("onChatStreamEnd listens and calls handler", async () => {
    const handler = vi.fn();
    await events.onChatStreamEnd(handler);
    expect(mockListen).toHaveBeenCalledWith("chat-stream-end", expect.any(Function));
    mockListen.mock.calls[0][1]({});
    expect(handler).toHaveBeenCalled();
  });

  it("onChatError forwards payload", async () => {
    const handler = vi.fn();
    await events.onChatError(handler);
    mockListen.mock.calls[0][1]({ payload: "err" });
    expect(handler).toHaveBeenCalledWith("err");
  });

  it("onChatToolUse forwards payload", async () => {
    const handler = vi.fn();
    await events.onChatToolUse(handler);
    mockListen.mock.calls[0][1]({ payload: { name: "tool", input: {} } });
    expect(handler).toHaveBeenCalledWith({ name: "tool", input: {} });
  });

  it("onExternalAiBridgeMessage forwards payload", async () => {
    const handler = vi.fn();
    await events.onExternalAiBridgeMessage(handler);
    expect(mockListen).toHaveBeenCalledWith("external-ai:message", expect.any(Function));
    const payload = { requestId: "request-1", rootPath: "/r", message: "hi", currentPath: ["DesignPartner"] };
    mockListen.mock.calls[0][1]({ payload });
    expect(handler).toHaveBeenCalledWith(payload);
  });

  it("onSigilChanged listens", async () => {
    const handler = vi.fn();
    await events.onSigilChanged(handler);
    expect(mockListen).toHaveBeenCalledWith("sigil-changed", expect.any(Function));
  });

  it("onOpenSigil forwards payload", async () => {
    const handler = vi.fn();
    await events.onOpenSigil(handler);
    mockListen.mock.calls[0][1]({ payload: "/path" });
    expect(handler).toHaveBeenCalledWith("/path");
  });

  it("onToolNavigate forwards payload", async () => {
    const handler = vi.fn();
    await events.onToolNavigate(handler);
    expect(mockListen).toHaveBeenCalledWith("tool:navigate", expect.any(Function));
    mockListen.mock.calls[0][1]({
      payload: { request_id: "req-1", payload: { sigil_path: "/sigil" } },
    });
    expect(handler).toHaveBeenCalledWith({ request_id: "req-1", payload: { sigil_path: "/sigil" } });
  });

  it("onSelectText forwards payload", async () => {
    const handler = vi.fn();
    await events.onSelectText(handler);
    mockListen.mock.calls[0][1]({ payload: "selected" });
    expect(handler).toHaveBeenCalledWith("selected");
  });

  it("onToolSelectText forwards payload", async () => {
    const handler = vi.fn();
    await events.onToolSelectText(handler);
    expect(mockListen).toHaveBeenCalledWith("tool:select_text", expect.any(Function));
    mockListen.mock.calls[0][1]({
      payload: { request_id: "req-select", payload: { excerpt: "selected" } },
    });
    expect(handler).toHaveBeenCalledWith({ request_id: "req-select", payload: { excerpt: "selected" } });
  });

  it("onToolReplaceSelectedText forwards payload", async () => {
    const handler = vi.fn();
    await events.onToolReplaceSelectedText(handler);
    expect(mockListen).toHaveBeenCalledWith("tool:replace_selected_text", expect.any(Function));
    mockListen.mock.calls[0][1]({
      payload: { request_id: "req-2", payload: { text: "replacement" } },
    });
    expect(handler).toHaveBeenCalledWith({ request_id: "req-2", payload: { text: "replacement" } });
  });

  it("onFsChange forwards paths array", async () => {
    const handler = vi.fn();
    await events.onFsChange(handler);
    mockListen.mock.calls[0][1]({ payload: ["/a.md", "/b.md"] });
    expect(handler).toHaveBeenCalledWith(["/a.md", "/b.md"]);
  });
});

// ── openInNewWindow ──

describe("openInNewWindow", () => {
  beforeEach(() => vi.clearAllMocks());

  it("creates WebviewWindow with encoded URL and title from last path segment", () => {
    openInNewWindow("/path/to/MyProject");
    expect(mockWebviewWindow).toHaveBeenCalledTimes(1);
    const [label, config] = mockWebviewWindow.mock.calls[0];
    expect(label).toMatch(/^editor-\d+-\d+$/);
    expect(config.url).toContain("root=%2Fpath%2Fto%2FMyProject");
    expect(config.title).toBe("MyProject");
    expect(config.width).toBe(1200);
    expect(config.height).toBe(800);
    expect(config.minWidth).toBe(800);
    expect(config.minHeight).toBe(600);
  });

  it("uses unique labels", () => {
    openInNewWindow("/a");
    openInNewWindow("/b");
    expect(mockWebviewWindow.mock.calls[0][0]).not.toBe(mockWebviewWindow.mock.calls[1][0]);
  });

  it("falls back to 'Sigil' for empty path", () => {
    openInNewWindow("");
    const config = mockWebviewWindow.mock.calls[0][1];
    expect(config.title).toBe("Sigil");
  });
});

// ── getInitialRootPath ──

describe("getInitialRootPath", () => {
  it("returns root param from URL", () => {
    vi.stubGlobal("window", { location: { search: "?root=/path/to/sigil" } });
    expect(getInitialRootPath()).toBe("/path/to/sigil");
    vi.unstubAllGlobals();
  });

  it("returns null when no root param", () => {
    vi.stubGlobal("window", { location: { search: "" } });
    expect(getInitialRootPath()).toBeNull();
    vi.unstubAllGlobals();
  });

  it("handles encoded root param", () => {
    vi.stubGlobal("window", { location: { search: "?root=%2Fpath%2Fwith%20spaces" } });
    expect(getInitialRootPath()).toBe("/path/with spaces");
    vi.unstubAllGlobals();
  });
});
