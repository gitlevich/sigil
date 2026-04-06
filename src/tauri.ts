import { invoke } from "@tauri-apps/api/core";
import { listen, UnlistenFn } from "@tauri-apps/api/event";
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import type { Affordance, Invariant, Sigil } from "sigil-core";

export type { Affordance, Invariant, Sigil };

/**
 * SigilFolder — the filesystem projection of a Sigil.
 * Contains language file, affordance files, invariant files, and child SigilFolders.
 */
export interface SigilFolder extends Sigil {
  path: string;
  children: SigilFolder[];
  images: string[];
}

/**
 * ApplicationSpec — the open specification being worked on.
 * Contains the root SigilFolder hierarchy and imported ontologies.
 */
export interface ApplicationSpec {
  name: string;
  rootPath: string;
  vision: string;
  root: SigilFolder;
  importedOntologies?: SigilFolder;
}

// ── Backward compatibility (used during migration, remove after) ──

/** @deprecated Use SigilFolder */
export type Context = SigilFolder;

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

export interface MemoryNode {
  id: string;
  name: string;
  language: string;
}

export interface MemoryEdge {
  source: string;
  target: string;
  label: string;
}

export interface MemoryGraph {
  nodes: MemoryNode[];
  edges: MemoryEdge[];
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

export interface Keybindings {
  "rename-sigil": string;
  "create-sigil": string;
  "delete-line": string;
  "toggle-word-wrap": string;
  "export": string;
  "facet-map": string;
  "panel-vision": string;
  "panel-ontology": string;
  "find-references": string;
}

export const DEFAULT_KEYBINDINGS: Keybindings = {
  "rename-sigil": "Alt-Mod-r",
  "create-sigil": "Alt-Enter",
  "delete-line": "Mod-d",
  "toggle-word-wrap": "Alt-z",
  "export": "Mod-e",
  "facet-map": "Ctrl-5",
  "panel-vision": "Ctrl-v",
  "panel-ontology": "Ctrl-g",
  "find-references": "Alt-Mod-f",
};

export const KEYBINDING_LABELS: Record<keyof Keybindings, string> = {
  "rename-sigil": "Rename Sigil",
  "create-sigil": "Create Sigil from @reference",
  "delete-line": "Delete Line",
  "toggle-word-wrap": "Toggle Word Wrap",
  "export": "Export",
  "facet-map": "Facet: Atlas",
  "panel-vision": "Panel: Vision",
  "panel-ontology": "Panel: Ontology",
  "find-references": "Find References",
};

/** Convert CodeMirror key format to Tauri menu accelerator format */
export function toTauriAccelerator(cmKey: string): string {
  // Parse CodeMirror key string into modifiers + key
  const parts = cmKey.split("-");
  const key = parts.pop()!;
  const mods: string[] = [];
  for (const p of parts) {
    if (p === "Mod") mods.push("CmdOrCtrl");
    else if (p === "Alt") mods.push("Alt");
    else if (p === "Shift") mods.push("Shift");
    else if (p === "Ctrl") mods.push("Ctrl");
    else mods.push(p);
  }
  // Tauri expects CmdOrCtrl before Alt before Shift
  const order = ["CmdOrCtrl", "Ctrl", "Alt", "Shift"];
  mods.sort((a, b) => order.indexOf(a) - order.indexOf(b));
  const normalizedKey = key.length === 1 ? key.toUpperCase() : key;
  return [...mods, normalizedKey].join("+");
}

const isMac = typeof navigator !== "undefined" && (/Mac/i.test(navigator.platform) || /Macintosh/i.test(navigator.userAgent));

/**
 * Build menu item props, working around macOS rendering Option+letter as the
 * produced glyph (e.g. ® for Option+R). For those combos on Mac we drop the
 * native accelerator (CodeMirror keymap still handles it) and show the
 * shortcut hint in the label instead.
 */
export function menuAccelerator(label: string, cmKey: string): { text: string; accelerator?: string } {
  const hasAlt = /Alt-/.test(cmKey);
  if (isMac && hasAlt) {
    return { text: `${label}    ${toDisplayShortcut(cmKey)}` };
  }
  return { text: label, accelerator: toTauriAccelerator(cmKey) };
}

/** Convert CodeMirror key format to human-readable display */
export function toDisplayShortcut(cmKey: string): string {
  return cmKey
    .replace(/Mod-/g, isMac ? "Cmd+" : "Ctrl+")
    .replace(/Alt-/g, isMac ? "Option+" : "Alt+")
    .replace(/Shift-/g, "Shift+")
    .replace(/Ctrl-/g, "Ctrl+")
    .replace(/-/g, "+")
    .replace(/\+([a-z])$/i, (_, c) => "+" + c.toUpperCase())
    .replace(/^([a-z])$/i, (_, c) => c.toUpperCase());
}

export interface Settings {
  ai_providers: AiProvider[];
  selected_provider_id: string;
  system_prompt: string;
  response_style: ResponseStyle;
  keybindings: Keybindings;
}

export function selectedProvider(settings: Settings): AiProvider | undefined {
  return settings.ai_providers.find((p) => p.id === settings.selected_provider_id);
}

export function enabledProviders(settings: Settings): AiProvider[] {
  return settings.ai_providers.filter((p) => p.enabled);
}

export const api = {
  readSigil: (rootPath: string) =>
    invoke<ApplicationSpec>("read_sigil", { rootPath }),

  closeWorkspace: (rootPath: string) =>
    invoke<void>("close_workspace", { rootPath }),

  scaffoldSigil: (rootPath: string) =>
    invoke<void>("scaffold_sigil", { rootPath }),

  checkImportedOntologies: (rootPath: string) =>
    invoke<{ name: string; status: string }[]>("check_imported_ontologies", { rootPath }),

  installOntologies: (rootPath: string, names: string[], overwrite: boolean) =>
    invoke<void>("install_ontologies", { rootPath, names, overwrite }),

  takePendingOpenPath: () =>
    invoke<string | null>("take_pending_open_path"),

  readFile: (path: string) =>
    invoke<string>("read_file", { path }),

  writeFile: (path: string, content: string) =>
    invoke<void>("write_file", { path, content }),

  deleteFile: (path: string) =>
    invoke<void>("delete_file", { path }),

  revealInFinder: (path: string) =>
    invoke<void>("reveal_in_finder", { path }),

  copyImage: (sourcePath: string, destDir: string) =>
    invoke<string>("copy_image", { sourcePath, destDir }),

  writeImageBytes: (destPath: string, data: number[]) =>
    invoke<string>("write_image_bytes", { destPath, data }),

  readImageBase64: (path: string) =>
    invoke<string>("read_image_base64", { path }),

  createContext: (parentPath: string, name: string) =>
    invoke<SigilFolder>("create_context", { parentPath, name }),

  renameContext: (rootPath: string, path: string, newName: string) =>
    invoke<string>("rename_context", { rootPath, path, newName }),

  renameSigil: (rootPath: string, path: string, newName: string) =>
    invoke<string>("rename_sigil", { rootPath, path, newName }),

  moveSigil: (rootPath: string, path: string, newParentPath: string) =>
    invoke<string>("move_sigil", { rootPath, path, newParentPath }),

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

  sendChatMessage: (rootPath: string, chatId: string, message: string, profile: AiProvider, systemPrompt: string, currentPath: string[]) =>
    invoke<void>("send_chat_message", { rootPath, chatId, message, profile, systemPrompt, currentPath }),

  listRecentDocuments: () =>
    invoke<RecentDocument[]>("list_recent_documents"),

  addRecentDocument: (path: string) =>
    invoke<void>("add_recent_document", { path }),

  removeRecentDocument: (path: string) =>
    invoke<void>("remove_recent_document", { path }),

  pruneRecentDocuments: () =>
    invoke<RecentDocument[]>("prune_recent_documents"),

  exportSigil: (rootPath: string, outputPath: string) =>
    invoke<void>("export_sigil", { rootPath, outputPath }),

  memoryRecallForSigil: (sigilPath: string) =>
    invoke<string[]>("memory_recall_for_sigil", { sigilPath }),

  memoryStatus: () =>
    invoke<{ initialized: boolean; chunk_count: number; last_sleep_at: string | null }>("memory_status"),

  memoryTriggerReindex: (rootPath: string) =>
    invoke<string>("memory_trigger_reindex", { rootPath }),

  memoryTriggerSleep: () =>
    invoke<void>("memory_trigger_sleep"),

  readMemories: (rootPath: string) =>
    invoke<MemoryGraph>("read_memories", { rootPath }),

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

  onOpenSigil: (handler: (path: string) => void): Promise<UnlistenFn> =>
    listen<string>("open-sigil", (event) => handler(event.payload)),

  onNavigateTo: (handler: (sigilPath: string) => void): Promise<UnlistenFn> =>
    listen<string>("navigate-to", (event) => handler(event.payload)),

  onSelectText: (handler: (payload: string) => void): Promise<UnlistenFn> =>
    listen<string>("select-text", (event) => handler(event.payload)),

  onReplaceSelectedText: (handler: (text: string) => void): Promise<UnlistenFn> =>
    listen<string>("replace-selected-text", (event) => handler(event.payload)),

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
