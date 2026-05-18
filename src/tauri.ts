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
  sigilType?: string;
}

/**
 * Idea — the open specification being worked on.
 * Contains the root SigilFolder hierarchy and imported ontologies.
 */
export interface Idea {
  name: string;
  rootPath: string;
  vision: string;
  root: SigilFolder;
  importedOntologies?: SigilFolder;
}

/**
 * ReshapePreview — the blast radius of a proposed reshape, computed without
 * mutating the filesystem. Feeds the Workspace's #propose-reshape affordance.
 */
export interface ReferenceChangeLine {
  lineNumber: number;
  before: string;
  after: string;
}

export interface FileReferenceChange {
  path: string;
  matchCount: number;
  sampleLines: ReferenceChangeLine[];
}

export interface DirectoryRename {
  fromPath: string;
  toPath: string;
}

export interface ReshapePreview {
  operation: string;
  oldName: string;
  newName: string;
  targetOldPath: string;
  targetNewPath: string;
  fileChanges: FileReferenceChange[];
  directoryRenames: DirectoryRename[];
  totalMatchCount: number;
}

export interface DanglingReference {
  filePath: string;
  lineNumber: number;
  lineText: string;
  refToken: string;
}

/**
 * DeletePreview — the blast radius of a proposed delete. Lists references
 * that would be left dangling if the sigil (and its descendants) were removed.
 */
export interface DeletePreview {
  targetPath: string;
  targetName: string;
  descendants: string[];
  danglingReferences: DanglingReference[];
}

/**
 * A Spell manifest as stored on disk in the workspace's .private/spells/ directory.
 * The Subconscious loads these, converts them to Spell values, and consults them
 * for each Disturbance.
 */
export interface SpellManifest {
  name: string;
  situation: string;
  /** Declarative match rule — structure documented in useSpellbook. */
  match: SpellMatchRule;
  /** Ordered list of actions to run when this Spell is cast. */
  actions: SpellAction[];
}

export interface SpellMatchRule {
  /** Match when the disturbance's kind equals this string. Required. */
  kind: string;
  /**
   * Misfit-specific: match only when the sigil is used inside its own
   * definition file. Checks payload.path ends with payload.resolvedTo.
   * Useful for suppressing the common false-positive where a sigil
   * references its own name in its own language.md.
   */
  selfReference?: boolean;
  /** Optional payload predicates — all must pass for the Spell to match. */
  payload?: Record<string, SpellPayloadPredicate>;
}

/** Tiny predicate DSL over a payload field's string value. */
export type SpellPayloadPredicate =
  | { equals: string }
  | { matches: string }; // regex, case-insensitive

export type SpellAction =
  | { type: "reply"; content: string }
  | { type: "suppress" };

/**
 * One image the @user has shown @DesignPartner through @Chat. The path is
 * absolute on disk; the bytes live under
 * `<rootPath>/.private/chats/attachments/<chatId>/`.
 */
export interface ChatAttachment {
  path: string;
  mime_type: string;
}

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  attachments?: ChatAttachment[];
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

export interface ExternalAiBridgeDiscovery {
  protocol: string;
  host: string;
  port: number;
  token: string;
  rootPath: string;
  pid: number;
}

export interface ExternalAiBridgeMessage {
  requestId: string;
  rootPath: string;
  message: string;
  currentPath?: string[];
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

export interface FsChangeEvent {
  paths: string[];
  kind: "create" | "modify" | "remove" | "other";
}

export interface RecentDocument {
  name: string;
  path: string;
  last_opened: number;
}

export interface AiProvider {
  id: string;
  name: string;
  provider: "anthropic" | "openai" | "local" | "ollama";
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
  "navigate-back": string;
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
  "navigate-back": "Alt-[",
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
  "navigate-back": "Navigate Back",
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
  /**
   * Provider the local @LeftHemisphere reaches for via #increase-resolution.
   * Omitted → the attempt is visible but nothing runs at higher resolution.
   */
  fallback_provider_id?: string;
  system_prompt: string;
  response_style: ResponseStyle;
  keybindings: Keybindings;
  /** When true, a fork action is exposed in the chat header. Defaults true. */
  fork_enabled?: boolean;
}

export function selectedProvider(settings: Settings): AiProvider | undefined {
  return settings.ai_providers.find((p) => p.id === settings.selected_provider_id);
}

export function fallbackProvider(settings: Settings): AiProvider | undefined {
  if (!settings.fallback_provider_id) return undefined;
  return settings.ai_providers.find((p) => p.id === settings.fallback_provider_id && p.enabled);
}

export function enabledProviders(settings: Settings): AiProvider[] {
  return settings.ai_providers.filter((p) => p.enabled);
}

export const api = {
  readSigil: (rootPath: string) =>
    invoke<Idea>("read_sigil", { rootPath }),

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

  /**
   * Persist an image the @user is showing @DesignPartner through @Chat.
   * Bytes are copied into the @sigil's `.private/chats/attachments/<chatId>/`
   * with collision-safe naming; the resolved absolute path and MIME type
   * come back so the @ChatMessage can carry them.
   */
  saveChatAttachmentFromPath: (rootPath: string, chatId: string, sourcePath: string) =>
    invoke<ChatAttachment>("save_chat_attachment_from_path", { rootPath, chatId, sourcePath }),

  saveChatAttachmentFromBytes: (rootPath: string, chatId: string, filename: string, data: number[]) =>
    invoke<ChatAttachment>("save_chat_attachment_from_bytes", { rootPath, chatId, filename, data }),

  createSigil: (parentPath: string, name: string) =>
    invoke<SigilFolder>("create_sigil", { parentPath, name }),

  renameContext: (rootPath: string, path: string, newName: string) =>
    invoke<string>("rename_context", { rootPath, path, newName }),

  renameSigil: (rootPath: string, path: string, newName: string) =>
    invoke<string>("rename_sigil", { rootPath, path, newName }),

  previewRenameSigil: (rootPath: string, path: string, newName: string) =>
    invoke<ReshapePreview>("preview_rename_sigil", { rootPath, path, newName }),

  previewDeleteSigil: (rootPath: string, path: string) =>
    invoke<DeletePreview>("preview_delete_sigil", { rootPath, path }),

  moveSigil: (rootPath: string, path: string, newParentPath: string) =>
    invoke<string>("move_sigil", { rootPath, path, newParentPath }),

  deleteContext: (path: string) =>
    invoke<void>("delete_context", { path }),

  listModels: (provider: string, apiKey: string, showAll: boolean) =>
    invoke<string[]>("list_models", { provider, apiKey, showAll }),

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

  forkChat: (rootPath: string, chatId: string) =>
    invoke<ChatInfo>("fork_chat", { rootPath, chatId }),

  sendChatMessage: (rootPath: string, chatId: string, message: string, profile: AiProvider, fallbackProfile: AiProvider | undefined, systemPrompt: string, currentPath: string[]) =>
    invoke<string>("send_chat_message", { rootPath, chatId, message, profile, fallbackProfile: fallbackProfile ?? null, systemPrompt, currentPath }),
  cancelChat: () => invoke<void>("cancel_chat"),

  registerExternalAiBridge: (rootPath: string) =>
    invoke<ExternalAiBridgeDiscovery>("register_external_ai_bridge", { rootPath }),

  unregisterExternalAiBridge: (rootPath: string) =>
    invoke<void>("unregister_external_ai_bridge", { rootPath }),

  externalAiBridgeAck: (requestId: string, ok: boolean, message: string) =>
    invoke<void>("external_ai_bridge_ack", { requestId, ok, message }),

  externalAiBridgeComplete: (requestId: string, ok: boolean, message: string) =>
    invoke<void>("external_ai_bridge_complete", { requestId, ok, message }),

  externalAiBridgeSendToListener: (rootPath: string, message: string) =>
    invoke<void>("external_ai_bridge_send_to_listener", { rootPath, message }),

  externalAiBridgeDisconnectListener: (rootPath: string, reason: string) =>
    invoke<void>("external_ai_bridge_disconnect_listener", { rootPath, reason }),

  /**
   * Reply to a tool-dispatch request. Called by the frontend listener
   * after it runs the workspace action; the Rust-side tool is awaiting
   * this result and returns it to the model.
   */
  toolResult: (requestId: string, ok: boolean, message: string) =>
    invoke<void>("tool_result", { requestId, ok, message }),

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

  listSpells: (rootPath: string) =>
    invoke<SpellManifest[]>("list_spells", { rootPath }),

  watchDirectory: (rootPath: string) =>
    invoke<void>("watch_directory", { rootPath }),

  stopWatching: () =>
    invoke<void>("stop_watching"),

  appendExperience: (workspacePath: string, sessionId: string, line: string) =>
    invoke<void>("append_experience", { workspacePath, sessionId, line }),

  listExperienceSessions: (workspacePath: string) =>
    invoke<string[]>("list_experience_sessions", { workspacePath }),

  invokeLeftHemisphere: (prompt: string, profile: AiProvider, fallbackProfile?: AiProvider) =>
    invoke<string>("invoke_left_hemisphere", { prompt, profile, fallbackProfile: fallbackProfile ?? null }),

  writeLongTermMemory: (workspacePath: string, json: string) =>
    invoke<void>("write_long_term_memory", { workspacePath, json }),

  readLongTermMemory: (workspacePath: string) =>
    invoke<string>("read_long_term_memory", { workspacePath }),
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

  onExternalAiBridgeMessage: (handler: (message: ExternalAiBridgeMessage) => void): Promise<UnlistenFn> =>
    listen("external-ai:message", (event) => handler(event.payload as ExternalAiBridgeMessage)),

  /**
   * Mid-turn reset: the local @LeftHemisphere emitted #increase-resolution
   * and a fallback took over. The in-flight assistant chunk should be
   * discarded — the replacement stream starts fresh.
   */
  onChatResetAssistant: (handler: () => void): Promise<UnlistenFn> =>
    listen("chat-reset-assistant", () => handler()),

  onResolutionIncreaseBegin: (handler: (info: { hasFallback: boolean }) => void): Promise<UnlistenFn> =>
    listen("resolution-increase:begin", (event) => handler(event.payload as { hasFallback: boolean })),

  onResolutionIncreaseEnd: (handler: () => void): Promise<UnlistenFn> =>
    listen("resolution-increase:end", () => handler()),

  onSigilChanged: (handler: () => void): Promise<UnlistenFn> =>
    listen("sigil-changed", () => handler()),

  onOpenSigil: (handler: (path: string) => void): Promise<UnlistenFn> =>
    listen<string>("open-sigil", (event) => handler(event.payload)),

  onToolNavigate: (
    handler: (req: { request_id: string; payload: { sigil_path: string } }) => void,
  ): Promise<UnlistenFn> =>
    listen("tool:navigate", (event) => handler(event.payload as { request_id: string; payload: { sigil_path: string } })),

  /**
   * Tool-dispatch events: mutating tools ask the frontend to perform the
   * action via its own workspace API. Each payload carries a request_id
   * the handler must echo back via api.toolResult with the outcome.
   */
  onToolDeleteSigil: (
    handler: (req: { request_id: string; payload: { sigil_path: string; abs_path: string } }) => void,
  ): Promise<UnlistenFn> =>
    listen("tool:delete_sigil", (event) => handler(event.payload as { request_id: string; payload: { sigil_path: string; abs_path: string } })),

  onToolRenameSigil: (
    handler: (req: { request_id: string; payload: { sigil_path: string; abs_path: string; new_name: string } }) => void,
  ): Promise<UnlistenFn> =>
    listen("tool:rename_sigil", (event) => handler(event.payload as { request_id: string; payload: { sigil_path: string; abs_path: string; new_name: string } })),

  onToolMoveSigil: (
    handler: (req: { request_id: string; payload: { sigil_path: string; abs_path: string; new_parent_sigil_path: string; new_parent_abs_path: string } }) => void,
  ): Promise<UnlistenFn> =>
    listen("tool:move_sigil", (event) => handler(event.payload as { request_id: string; payload: { sigil_path: string; abs_path: string; new_parent_sigil_path: string; new_parent_abs_path: string } })),

  onToolWriteSigil: (
    handler: (req: { request_id: string; payload: { sigil_path: string; abs_path: string; content: string } }) => void,
  ): Promise<UnlistenFn> =>
    listen("tool:write_sigil", (event) => handler(event.payload as { request_id: string; payload: { sigil_path: string; abs_path: string; content: string } })),

  onToolCreateSigil: (
    handler: (req: { request_id: string; payload: { parent_sigil_path: string; parent_abs_path: string; name: string; content: string } }) => void,
  ): Promise<UnlistenFn> =>
    listen("tool:create_sigil", (event) => handler(event.payload as { request_id: string; payload: { parent_sigil_path: string; parent_abs_path: string; name: string; content: string } })),

  onToolWriteAffordance: (
    handler: (req: { request_id: string; payload: { sigil_path: string; abs_path: string; name: string; content: string } }) => void,
  ): Promise<UnlistenFn> =>
    listen("tool:write_affordance", (event) => handler(event.payload as { request_id: string; payload: { sigil_path: string; abs_path: string; name: string; content: string } })),

  onToolDeleteAffordance: (
    handler: (req: { request_id: string; payload: { sigil_path: string; abs_path: string; name: string } }) => void,
  ): Promise<UnlistenFn> =>
    listen("tool:delete_affordance", (event) => handler(event.payload as { request_id: string; payload: { sigil_path: string; abs_path: string; name: string } })),

  onToolWriteInvariant: (
    handler: (req: { request_id: string; payload: { sigil_path: string; abs_path: string; name: string; content: string } }) => void,
  ): Promise<UnlistenFn> =>
    listen("tool:write_invariant", (event) => handler(event.payload as { request_id: string; payload: { sigil_path: string; abs_path: string; name: string; content: string } })),

  onToolDeleteInvariant: (
    handler: (req: { request_id: string; payload: { sigil_path: string; abs_path: string; name: string } }) => void,
  ): Promise<UnlistenFn> =>
    listen("tool:delete_invariant", (event) => handler(event.payload as { request_id: string; payload: { sigil_path: string; abs_path: string; name: string } })),

  onToolWriteVision: (
    handler: (req: { request_id: string; payload: { content: string } }) => void,
  ): Promise<UnlistenFn> =>
    listen("tool:write_vision", (event) => handler(event.payload as { request_id: string; payload: { content: string } })),

  onToolMarkPlacement: (
    handler: (req: { request_id: string; payload: { sigil_path: string; abs_path: string; category: string } }) => void,
  ): Promise<UnlistenFn> =>
    listen("tool:mark_placement", (event) => handler(event.payload as { request_id: string; payload: { sigil_path: string; abs_path: string; category: string } })),

  onSelectText: (handler: (payload: string) => void): Promise<UnlistenFn> =>
    listen<string>("select-text", (event) => handler(event.payload)),

  onToolReplaceSelectedText: (
    handler: (req: { request_id: string; payload: { text: string } }) => void,
  ): Promise<UnlistenFn> =>
    listen("tool:replace_selected_text", (event) => handler(event.payload as { request_id: string; payload: { text: string } })),

  onFsChange: (handler: (event: FsChangeEvent) => void): Promise<UnlistenFn> =>
    listen<FsChangeEvent>("fs-change", (event) => handler(event.payload)),
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
