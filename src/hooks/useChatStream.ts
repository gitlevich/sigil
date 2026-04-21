import { useCallback, useEffect, useRef } from "react";
import { api, events, ChatMessage, selectedProvider, fallbackProvider } from "../tauri";
import { useAppState, useAppDispatch } from "../state/AppContext";
import { useWorkspaceState, useWorkspaceActions } from "../state/WorkspaceContext";
import { discardPendingAutoSave } from "./useAutoSave";
import { useChatState, useChatDispatch } from "../state/ChatContext";
import { useExperience } from "../state/ExperienceContext";
import { useToast } from "./useToast";
import { useHearing, type HearingEvent } from "./useHearing";
import { useCompileCheck, type RefError } from "./useCompileCheck";
import { useSpellbook } from "./useSpellbook";
import { consultSpellbook, compressSigil, allRefsPattern, type Disturbance } from "sigil-core";
import type { Sigil } from "sigil-core";
import { useActionDeps } from "./useActionDeps";
import * as actions from "../actions/workspace";

/**
 * A provider whose stream costs the @user money. The remote-call indicator
 * in the GlobalStatusBar tracks any call to one of these, whether it arrived
 * via #increase-resolution or a direct chat with a remote model.
 */
function isRemoteProvider(provider: string | undefined): boolean {
  return provider === "anthropic" || provider === "openai";
}

export function useChatStream() {
  const appState = useAppState();
  const appDispatch = useAppDispatch();
  const workspace = useWorkspaceState();
  const { navigate, reload } = useWorkspaceActions();
  const navigateRef = useRef(navigate);
  const reloadRef = useRef(reload);
  navigateRef.current = navigate;
  reloadRef.current = reload;
  const actionDeps = useActionDeps();
  const actionDepsRef = useRef(actionDeps);
  actionDepsRef.current = actionDeps;
  const chat = useChatState();
  const chatDispatch = useChatDispatch();
  const { addToast } = useToast();
  const { recordChat } = useExperience();
  const recordChatRef = useRef(recordChat);
  recordChatRef.current = recordChat;
  const accumulatorRef = useRef("");
  const workspaceRef = useRef(workspace);
  const chatRef = useRef(chat);
  workspaceRef.current = workspace;
  chatRef.current = chat;

  // Hearing and compile errors are kept current so they can be woven into
  // the DP's system prompt when a message is sent.
  const compileResult = useCompileCheck(workspace.spec.root, workspace.spec.importedOntologies ?? null, workspace.currentPath);
  const hearingEvents = useHearing(workspace.spec.root, compileResult.errors);
  const spellbook = useSpellbook(workspace.spec.rootPath);
  const compileErrorsRef = useRef(compileResult.errors);
  const hearingEventsRef = useRef(hearingEvents);
  const spellbookRef = useRef(spellbook);
  compileErrorsRef.current = compileResult.errors;
  hearingEventsRef.current = hearingEvents;
  spellbookRef.current = spellbook;

  useEffect(() => {
    const unlistenToken = events.onChatToken((token) => {
      accumulatorRef.current += token;
      const conv = chatRef.current;
      const msgs = [...conv.chatMessages];
      const lastMsg = msgs[msgs.length - 1];
      if (lastMsg && lastMsg.role === "assistant") {
        msgs[msgs.length - 1] = { ...lastMsg, content: accumulatorRef.current };
      } else {
        msgs.push({ role: "assistant", content: accumulatorRef.current });
      }
      chatDispatch({ type: "SET_MESSAGES", messages: msgs });
    });

    const unlistenError = events.onChatError((error) => {
      addToast(error, "error");
      chatDispatch({ type: "SET_STREAMING", streaming: false });
      appDispatch({ type: "SET_RESOLUTION_INCREASE", value: { kind: "rest" } });
      accumulatorRef.current = "";
    });

    const unlistenToolUse = events.onChatToolUse((tool) => {
      accumulatorRef.current += `\n\n*Using tool: ${tool.name}*\n`;
      const conv = chatRef.current;
      const msgs = [...conv.chatMessages];
      const lastMsg = msgs[msgs.length - 1];
      if (lastMsg && lastMsg.role === "assistant") {
        msgs[msgs.length - 1] = { ...lastMsg, content: accumulatorRef.current };
      } else {
        msgs.push({ role: "assistant", content: accumulatorRef.current });
      }
      chatDispatch({ type: "SET_MESSAGES", messages: msgs });
    });

    // When a tool mutates the sigil tree (create/delete/rename/move/write),
    // reload the spec so the workspace sees the change. The file watcher
    // catches disk changes too, but this is a direct path that doesn't
    // depend on watcher latency.
    // Tool dispatches from Bicameron route through the same workspace
    // actions a user click would — deleteSigil, renameSigil, etc.
    // Each handler: run the action, echo result back via toolResult.
    const handleTool = async (
      request_id: string,
      label: string,
      run: () => Promise<string>,
    ) => {
      console.info(`[${label}] dispatched`);
      try {
        const message = await run();
        await api.toolResult(request_id, true, message);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        await api.toolResult(request_id, false, msg);
      }
    };

    const unlistenToolDelete = events.onToolDeleteSigil(({ request_id, payload }) =>
      handleTool(request_id, "tool:delete_sigil", async () => {
        await actions.deleteSigil(payload.abs_path, actionDepsRef.current);
        return `Deleted @${payload.sigil_path}.`;
      }));

    const unlistenToolRename = events.onToolRenameSigil(({ request_id, payload }) =>
      handleTool(request_id, "tool:rename_sigil", async () => {
        await actions.renameSigil(payload.abs_path, payload.new_name, actionDepsRef.current);
        return `Renamed @${payload.sigil_path} to @${payload.new_name}.`;
      }));

    const unlistenToolMove = events.onToolMoveSigil(({ request_id, payload }) =>
      handleTool(request_id, "tool:move_sigil", async () => {
        await actions.moveSigil(payload.abs_path, payload.new_parent_abs_path, actionDepsRef.current);
        return `Moved @${payload.sigil_path} under @${payload.new_parent_sigil_path}.`;
      }));

    const unlistenToolWriteSigil = events.onToolWriteSigil(({ request_id, payload }) =>
      handleTool(request_id, "tool:write_sigil", async () => {
        await api.writeFile(`${payload.abs_path}/language.md`, payload.content);
        return `Wrote @${payload.sigil_path}.`;
      }));

    const unlistenToolCreateSigil = events.onToolCreateSigil(({ request_id, payload }) =>
      handleTool(request_id, "tool:create_sigil", async () => {
        const newFolder = await api.createSigil(payload.parent_abs_path, payload.name);
        if (payload.content) {
          await api.writeFile(`${newFolder.path}/language.md`, payload.content);
        }
        return `Created @${payload.name} under @${payload.parent_sigil_path || "(root)"}.`;
      }));

    const unlistenToolWriteAff = events.onToolWriteAffordance(({ request_id, payload }) =>
      handleTool(request_id, "tool:write_affordance", async () => {
        await api.writeFile(`${payload.abs_path}/affordance-${payload.name}.md`, payload.content);
        return `Wrote #${payload.name} on @${payload.sigil_path}.`;
      }));

    const unlistenToolDeleteAff = events.onToolDeleteAffordance(({ request_id, payload }) =>
      handleTool(request_id, "tool:delete_affordance", async () => {
        await api.deleteFile(`${payload.abs_path}/affordance-${payload.name}.md`);
        return `Deleted #${payload.name} from @${payload.sigil_path}.`;
      }));

    const unlistenToolWriteInv = events.onToolWriteInvariant(({ request_id, payload }) =>
      handleTool(request_id, "tool:write_invariant", async () => {
        await api.writeFile(`${payload.abs_path}/invariant-${payload.name}.md`, payload.content);
        return `Wrote !${payload.name} on @${payload.sigil_path}.`;
      }));

    const unlistenToolDeleteInv = events.onToolDeleteInvariant(({ request_id, payload }) =>
      handleTool(request_id, "tool:delete_invariant", async () => {
        await api.deleteFile(`${payload.abs_path}/invariant-${payload.name}.md`);
        return `Deleted !${payload.name} from @${payload.sigil_path}.`;
      }));

    const unlistenToolWriteVision = events.onToolWriteVision(({ request_id, payload }) =>
      handleTool(request_id, "tool:write_vision", async () => {
        const ws = workspaceRef.current;
        await api.writeFile(`${ws.spec.rootPath}/vision.md`, payload.content);
        return `Wrote vision.md.`;
      }));

    const unlistenToolMarkPlacement = events.onToolMarkPlacement(({ request_id, payload }) =>
      handleTool(request_id, "tool:mark_placement", async () => {
        const langPath = `${payload.abs_path}/language.md`;
        const existing = await api.readFile(langPath).catch(() => "");
        const updated = upsertFrontmatterField(existing, "placement", payload.category);
        await api.writeFile(langPath, updated);
        return `Marked @${payload.sigil_path} placement as ${payload.category}.`;
      }));

    const unlistenSigilChanged = events.onSigilChanged(() => {
      console.info("[sigil-changed] discarding pending autosave and reloading spec");
      // Kill any in-flight autosave first. If the user was editing the
      // sigil Bicameron just deleted, the pending timer would recreate
      // the directory via api.writeFile's create_dir_all behavior.
      discardPendingAutoSave();
      reloadRef.current().catch((err) => {
        console.error("[sigil-changed] reload failed:", err);
      });
    });
    const unlistenNavigate = events.onNavigateTo((sigilPath) => {
      console.info("[navigate-to] received payload:", JSON.stringify(sigilPath));
      const segments = sigilPath.split("/").filter((s) => s.length > 0);
      if (segments.length > 0) {
        console.info("[navigate-to] dispatching navigate to:", segments);
        navigateRef.current(segments);
      } else {
        console.warn("[navigate-to] empty segments after split");
      }
    });

    // #increase-resolution: local emitted the marker, fallback is taking
    // over. Drop the in-flight assistant chunk so the replacement stream
    // starts clean — one voice reaches the @user.
    const unlistenResetAssistant = events.onChatResetAssistant(() => {
      accumulatorRef.current = "";
      const conv = chatRef.current;
      const msgs = [...conv.chatMessages];
      const lastMsg = msgs[msgs.length - 1];
      if (lastMsg && lastMsg.role === "assistant") {
        msgs[msgs.length - 1] = { ...lastMsg, content: "" };
        chatDispatch({ type: "SET_MESSAGES", messages: msgs });
      }
    });

    const unlistenEnd = events.onChatStreamEnd(() => {
      const ws = workspaceRef.current;
      const conv = chatRef.current;
      chatDispatch({ type: "SET_STREAMING", streaming: false });
      appDispatch({ type: "SET_RESOLUTION_INCREASE", value: { kind: "rest" } });
      if (conv.activeChatId && accumulatorRef.current) {
        const msgs = [...conv.chatMessages];
        const lastMsg = msgs[msgs.length - 1];
        if (lastMsg && lastMsg.role === "assistant") {
          msgs[msgs.length - 1] = { ...lastMsg, content: accumulatorRef.current };
        } else {
          msgs.push({ role: "assistant", content: accumulatorRef.current });
        }
        api.writeChat(ws.spec.rootPath, {
          id: conv.activeChatId,
          name: conv.chats.find((c) => c.id === conv.activeChatId)?.name || "Chat",
          messages: msgs,
        }).catch(console.error);

        // Record assistant response as experience — !complete
        recordChatRef.current("assistant", accumulatorRef.current);
      }
      accumulatorRef.current = "";
    });

    return () => {
      unlistenToken.then((fn) => fn());
      unlistenError.then((fn) => fn());
      unlistenToolUse.then((fn) => fn());
      unlistenToolDelete.then((fn) => fn());
      unlistenToolRename.then((fn) => fn());
      unlistenToolMove.then((fn) => fn());
      unlistenToolWriteSigil.then((fn) => fn());
      unlistenToolCreateSigil.then((fn) => fn());
      unlistenToolWriteAff.then((fn) => fn());
      unlistenToolDeleteAff.then((fn) => fn());
      unlistenToolWriteInv.then((fn) => fn());
      unlistenToolDeleteInv.then((fn) => fn());
      unlistenToolWriteVision.then((fn) => fn());
      unlistenToolMarkPlacement.then((fn) => fn());
      unlistenSigilChanged.then((fn) => fn());
      unlistenNavigate.then((fn) => fn());
      unlistenResetAssistant.then((fn) => fn());
      unlistenEnd.then((fn) => fn());
    };
  }, [chatDispatch, appDispatch]);

  const sendMessage = useCallback(async (message: string) => {
    const ws = workspaceRef.current;
    const conv = chatRef.current;

    // If no active chat, create one
    let chatId = conv.activeChatId;
    if (!chatId) {
      chatId = `chat-${Date.now()}`;
      const chatName = `Chat ${conv.chats.length + 1}`;
      const newChats = [...conv.chats, { id: chatId, name: chatName, message_count: 0, last_modified: Date.now() / 1000 }];
      chatDispatch({ type: "SET_CHATS", chats: newChats });
      chatDispatch({ type: "SET_ACTIVE_CHAT", chatId, messages: conv.chatMessages });
    }

    const newMessages: ChatMessage[] = [
      ...conv.chatMessages,
      { role: "user", content: message },
    ];

    chatDispatch({ type: "SET_MESSAGES", messages: newMessages });
    chatDispatch({ type: "SET_STREAMING", streaming: true });

    // Record user message as experience — !complete
    recordChatRef.current("user", message);

    const chatName = conv.chats.find((c) => c.id === chatId)?.name || `Chat ${conv.chats.length + 1}`;
    await api.writeChat(ws.spec.rootPath, {
      id: chatId,
      name: chatName,
      messages: newMessages,
    });
    accumulatorRef.current = "";

    const provider = selectedProvider(appState.settings);
    if (!provider) {
      addToast("No attention provider enabled. Open Settings to add one.", "error");
      chatDispatch({ type: "SET_STREAMING", streaming: false });
      return;
    }

    // The @user's message is a disturbance arriving at the @RightHemisphere.
    // The @Subconscious consults the @Spellbook; if a @Spell matches, it casts
    // and the @LeftHemisphere is not invoked. If no Spell matches, we lift
    // through the @CorpusCallosum — i.e., call the LLM. The Spellbook starts
    // empty, so every chat message lifts today; future Spells will handle
    // what they can without the API.
    const disturbance: Disturbance = {
      kind: "user-chat",
      path: ws.currentPath,
      payload: {
        message,
        currentPath: ws.currentPath,
        recentEventCount: hearingEventsRef.current.length,
      },
    };
    const consultation = consultSpellbook(disturbance, spellbookRef.current);
    if (consultation.cast && consultation.result.success) {
      // Spell handled the disturbance — no LH call.
      const response = consultation.result.summary ?? "";
      const updatedMessages: ChatMessage[] = [
        ...newMessages,
        { role: "assistant", content: response },
      ];
      chatDispatch({ type: "SET_MESSAGES", messages: updatedMessages });
      chatDispatch({ type: "SET_STREAMING", streaming: false });
      recordChatRef.current("assistant", response);
      await api.writeChat(ws.spec.rootPath, {
        id: chatId,
        name: chatName,
        messages: updatedMessages,
      }).catch(console.error);
      console.info(`[Subconscious] cast ${consultation.spell} for user-chat; LH not invoked`);
      return;
    }

    const stylePrefix = appState.settings.response_style === "detailed"
      ? ""
      : "CRITICAL STYLE RULES YOU MUST FOLLOW:\n- NEVER use bullet points, numbered lists, or any list formatting.\n- NEVER use headers or bold text.\n- Maximum 3 sentences per response.\n- Write plain short paragraphs only.\n- You are in a conversation. Talk, don't lecture.\n\n";
    const sensorySuffix = composeSensorySection(hearingEventsRef.current, compileErrorsRef.current);
    // Structural sense — the connections and proximities the @user perceives
    // visually. Skipped for the embedded sidecar (it leaks structured prose);
    // included for any tier that can read aggregate prompts.
    const structuralSuffix = !isRemoteProvider(provider.provider) && provider.provider === "local"
      ? ""
      : composeStructuralSection(ws.spec.root);

    // Local tiers (Local sidecar, Ollama) get a compressed view of the sigil
    // tree so the model knows what paths actually exist — otherwise it
    // fabricates placeholders like "/projects/Scratch" from training data.
    // Remote tiers get the full tree assembled on the Rust side.
    const isLocalTier = provider.provider === "local" || provider.provider === "ollama";
    const sigilAtlas = isLocalTier
      ? "\n\n# Sigils that exist in this workspace\n\nThese are the only sigil paths you can reference. Use exactly these names — do not invent paths.\n\n" + compressSigil(ws.spec.root) + "\n"
      : "";

    const systemPrompt = stylePrefix + appState.settings.system_prompt + sigilAtlas + sensorySuffix + structuralSuffix;

    // Light the tray indicator before any byte leaves this machine, so the
    // @user sees the tier of attention spending cycles. Embedded local stays
    // dark (no indicator); Ollama lights orange; remote lights accent.
    // The stream-end and error handlers above clear it; keep both in sync.
    if (isRemoteProvider(provider.provider)) {
      appDispatch({
        type: "SET_RESOLUTION_INCREASE",
        value: {
          kind: "in-flight",
          tier: "remote",
          provider: provider.provider,
          label: `${provider.provider} · ${provider.model}`,
        },
      });
    } else if (provider.provider === "ollama") {
      appDispatch({
        type: "SET_RESOLUTION_INCREASE",
        value: {
          kind: "in-flight",
          tier: "local",
          provider: provider.provider,
          label: `${provider.provider} · ${provider.model}`,
        },
      });
    }

    try {
      await api.sendChatMessage(
        ws.spec.rootPath,
        chatId,
        message,
        provider,
        fallbackProvider(appState.settings),
        systemPrompt,
        ws.currentPath
      );
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      console.error("Chat error:", errorMsg);
      addToast(errorMsg, "error");
      chatDispatch({ type: "SET_STREAMING", streaming: false });
      appDispatch({ type: "SET_RESOLUTION_INCREASE", value: { kind: "rest" } });
    }
  }, [appState.settings, chatDispatch, addToast, appDispatch]);

  return { sendMessage };
}

/**
 * Insert or replace a single key/value in a markdown file's YAML frontmatter.
 *
 * The frontmatter is a `---\n…\n---` block at the very top of the file. If
 * absent, one is created. If the key exists, its value is replaced; otherwise
 * the key is appended to the end of the existing block. The body below the
 * frontmatter is untouched.
 *
 * Used by the mark_placement tool to set `placement: <category>` on a sigil's
 * language.md without disturbing its narrative or other metadata.
 */
function upsertFrontmatterField(content: string, key: string, value: string): string {
  const fmMatch = content.match(/^---\n([\s\S]*?)\n---\n?/);
  if (!fmMatch) {
    // No frontmatter — synthesize one.
    return `---\n${key}: ${value}\n---\n\n${content}`;
  }
  const fmBody = fmMatch[1];
  const after = content.slice(fmMatch[0].length);
  const lineRe = new RegExp(`^${key}:\\s*.*$`, "m");
  const newFmBody = lineRe.test(fmBody)
    ? fmBody.replace(lineRe, `${key}: ${value}`)
    : `${fmBody}\n${key}: ${value}`;
  return `---\n${newFmBody}\n---\n${after.startsWith("\n") ? "" : "\n"}${after}`;
}

/**
 * Walk the @sigil tree and collect what the @user sees visually as structure:
 * the reference graph (who points at whom), the containment graph (parent/
 * child density), and the leaves. Returns a markdown section the Protector
 * carries in his prompt as a structural sense — the analog of looking at the
 * tree in the OntologyPanel and feeling its connections and proximities.
 *
 * Kept compact: top hubs, scattered orphans, dense parents. Goal is signal,
 * not exhaustive listing — the Protector's other context already carries the
 * full tree.
 */
function composeStructuralSection(root: Sigil): string {
  interface Walker {
    paths: Map<string, string>;        // sigil name → "/"-joined path
    languages: { name: string; path: string; language: string }[];
    childCounts: { name: string; path: string; count: number }[];
    maxDepth: number;
    total: number;
    leaves: number;
  }
  const w: Walker = {
    paths: new Map(), languages: [], childCounts: [],
    maxDepth: 0, total: 0, leaves: 0,
  };

  function walk(node: Sigil, ancestors: string[]) {
    const pathStr = [...ancestors, node.name].join("/");
    w.paths.set(node.name, pathStr);
    w.languages.push({ name: node.name, path: pathStr, language: node.language });
    w.childCounts.push({ name: node.name, path: pathStr, count: node.children.length });
    w.total += 1;
    w.maxDepth = Math.max(w.maxDepth, ancestors.length);
    if (node.children.length === 0) w.leaves += 1;
    for (const c of node.children) walk(c, [...ancestors, node.name]);
  }
  walk(root, []);

  // Reference graph — count @-references TO each name.
  const inDegree = new Map<string, number>();
  for (const { language } of w.languages) {
    if (!language) continue;
    const re = new RegExp(allRefsPattern.source, "g");
    let m: RegExpExecArray | null;
    while ((m = re.exec(language)) !== null) {
      const ref = m[0];
      // Take only @-refs (sigil names), ignore # and !.
      if (!ref.startsWith("@")) continue;
      const name = ref.slice(1).split(/[@#!]/)[0];
      if (!w.paths.has(name)) continue;  // only known sigils
      inDegree.set(name, (inDegree.get(name) ?? 0) + 1);
    }
  }

  const hubs = [...inDegree.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8);
  const orphans = w.languages
    .map(l => l.name)
    .filter(n => !inDegree.has(n) && n !== root.name)
    .slice(0, 8);
  const dense = w.childCounts
    .filter(c => c.count > 5)
    .sort((a, b) => b.count - a.count)
    .slice(0, 6);

  const parts: string[] = [
    "\n\n# Structural sense",
    "",
    "What I perceive of the tree's shape — the connections and proximities the @user sees visually.",
    "",
    `Tree: ${w.total} sigils, max depth ${w.maxDepth}, ${w.leaves} leaves.`,
    "",
  ];

  if (hubs.length > 0) {
    parts.push(
      "Hubs (most referenced — pulling attention through them):",
      hubs.map(([name, n]) => `  @${name} (${n})`).join("\n"),
      "",
    );
  }

  if (orphans.length > 0) {
    parts.push(
      "Unreferenced (no @-refs point to them — they sit alone):",
      "  " + orphans.map(n => `@${n}`).join(", "),
      "",
    );
  }

  if (dense.length > 0) {
    parts.push(
      "Dense parents (>5 children — crowding may be outgrowing the parent):",
      dense.map(c => `  @${c.name} (${c.count})`).join("\n"),
      "",
    );
  }

  return parts.join("\n");
}

/**
 * Weave current RightHemisphere signals into the DesignPartner's system prompt.
 * Hearing reports located events and the compile-check surfaces unresolved
 * @references. Both should reach the DP's context, not only the User's UI.
 */
function composeSensorySection(events: HearingEvent[], compileErrors: RefError[]): string {
  if (events.length === 0 && compileErrors.length === 0) return "";

  const parts: string[] = [
    "\n\n# Your current senses",
    "",
    "These are the signals you are currently sensing in the workspace. They are *yours* — your continuous attention produced them. When the user asks \"what do you sense\", \"anything out of place\", or similar, answer from this section.",
    "",
  ];

  if (compileErrors.length > 0) {
    parts.push(
      "\n## Dangling references — currently unresolved\n\n" +
      "Per Workspace/!deformations-surface-to-attenders, @references that dangle are felt. These are the ones currently unresolved:\n",
    );
    for (const err of compileErrors.slice(0, 30)) {
      const loc = err.path.join("/") + "/" + err.file;
      parts.push(`- ${loc}:${err.line} ${err.ref} — ${err.reason}`);
    }
    if (compileErrors.length > 30) {
      parts.push(`- …and ${compileErrors.length - 30} more`);
    }
    parts.push("");
  }

  if (events.length > 0) {
    parts.push(
      "\n## Hearing — recent located events\n\n" +
      "Changes to the tree, in reverse chronological order.\n",
    );
    for (const e of events.slice(0, 15)) {
      const loc = e.path.length > 0 ? e.path.join("/") : "(root)";
      parts.push(`- [${e.kind}] ${loc} — ${e.summary}`);
    }
    if (events.length > 15) {
      parts.push(`- …and ${events.length - 15} older`);
    }
  }

  return parts.join("\n");
}
