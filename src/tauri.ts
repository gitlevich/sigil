import { invoke } from "@tauri-apps/api/core";
import { listen, UnlistenFn } from "@tauri-apps/api/event";
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";

export interface Context {
  name: string;
  path: string;
  domain_language: string;
  children: Context[];
}

export interface Sigil {
  name: string;
  root_path: string;
  vision: string;
  root: Context;
}

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

export interface Chat {
  id: string;
  name: string;
  messages: ChatMessage[];
}

export interface ChatInfo {
  id: string;
  name: string;
  message_count: number;
  last_modified: number;
}

export interface RecentDocument {
  name: string;
  path: string;
  last_opened: number;
}

export interface AiProvider {
  id: string;
  name: string;
  provider: "anthropic" | "openai";
  api_key: string;
  model: string;
  enabled: boolean;
}

export type ResponseStyle = "laconic" | "detailed";

export interface Settings {
  ai_providers: AiProvider[];
  selected_provider_id: string;
  system_prompt: string;
  response_style: ResponseStyle;
}

export function selectedProvider(settings: Settings): AiProvider | undefined {
  return settings.ai_providers.find((p) => p.id === settings.selected_provider_id);
}

export function enabledProviders(settings: Settings): AiProvider[] {
  return settings.ai_providers.filter((p) => p.enabled);
}

export const api = {
  readSigil: (rootPath: string) =>
    invoke<Sigil>("read_sigil", { rootPath }),

  readFile: (path: string) =>
    invoke<string>("read_file", { path }),

  writeFile: (path: string, content: string) =>
    invoke<void>("write_file", { path, content }),

  revealInFinder: (path: string) =>
    invoke<void>("reveal_in_finder", { path }),

  createContext: (parentPath: string, name: string) =>
    invoke<Context>("create_context", { parentPath, name }),

  renameContext: (path: string, newName: string) =>
    invoke<string>("rename_context", { path, newName }),

  deleteContext: (path: string) =>
    invoke<void>("delete_context", { path }),

  listModels: (provider: string, apiKey: string) =>
    invoke<string[]>("list_models", { provider, apiKey }),

  listChats: (rootPath: string) =>
    invoke<ChatInfo[]>("list_chats", { rootPath }),

  readChat: (rootPath: string, chatId: string) =>
    invoke<Chat>("read_chat", { rootPath, chatId }),

  writeChat: (rootPath: string, chat: Chat) =>
    invoke<void>("write_chat", { rootPath, chat }),

  deleteChat: (rootPath: string, chatId: string) =>
    invoke<void>("delete_chat", { rootPath, chatId }),

  renameChat: (rootPath: string, chatId: string, newName: string) =>
    invoke<void>("rename_chat", { rootPath, chatId, newName }),

  sendChatMessage: (rootPath: string, chatId: string, message: string, profile: AiProvider, systemPrompt: string) =>
    invoke<void>("send_chat_message", { rootPath, chatId, message, profile, systemPrompt }),

  listRecentDocuments: () =>
    invoke<RecentDocument[]>("list_recent_documents"),

  addRecentDocument: (path: string) =>
    invoke<void>("add_recent_document", { path }),

  removeRecentDocument: (path: string) =>
    invoke<void>("remove_recent_document", { path }),

  exportSigil: (rootPath: string, outputPath: string) =>
    invoke<void>("export_sigil", { rootPath, outputPath }),

  watchDirectory: (rootPath: string) =>
    invoke<void>("watch_directory", { rootPath }),

  stopWatching: () =>
    invoke<void>("stop_watching"),
};

export const events = {
  onChatToken: (handler: (token: string) => void): Promise<UnlistenFn> =>
    listen<string>("chat-token", (event) => handler(event.payload)),

  onChatStreamEnd: (handler: () => void): Promise<UnlistenFn> =>
    listen("chat-stream-end", () => handler()),

  onChatError: (handler: (error: string) => void): Promise<UnlistenFn> =>
    listen<string>("chat-error", (event) => handler(event.payload)),

  onChatToolUse: (handler: (tool: { name: string; input: Record<string, unknown> }) => void): Promise<UnlistenFn> =>
    listen("chat-tool-use", (event) => handler(event.payload as { name: string; input: Record<string, unknown> })),

  onSigilChanged: (handler: () => void): Promise<UnlistenFn> =>
    listen("sigil-changed", () => handler()),

  onFsChange: (handler: (paths: string[]) => void): Promise<UnlistenFn> =>
    listen<string[]>("fs-change", (event) => handler(event.payload)),
};

let windowCounter = 0;

export function openInNewWindow(rootPath: string): void {
  const label = `editor-${++windowCounter}-${Date.now()}`;
  new WebviewWindow(label, {
    url: `index.html?root=${encodeURIComponent(rootPath)}`,
    title: rootPath.split("/").pop() || "Sigil",
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 600,
  });
}

export function getInitialRootPath(): string | null {
  const params = new URLSearchParams(window.location.search);
  return params.get("root");
}
