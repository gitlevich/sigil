import { useEffect, useRef } from "react";
import {
  api,
  events,
  type ChatAttachment,
  type ExternalAiBridgeMessage,
} from "../tauri";
import { useChatState } from "../state/ChatContext";
import { useWorkspaceState } from "../state/WorkspaceContext";

type SendMessage = (message: string, attachments?: ChatAttachment[]) => Promise<string>;

function bridgeChatMessage(request: ExternalAiBridgeMessage): string {
  const lines = [
    "External AI says:",
    "",
    request.message,
  ];
  if (request.currentPath && request.currentPath.length > 0) {
    lines.push("", `External AI context: ${request.currentPath.join("/")}`);
  }
  return lines.join("\n");
}

function normalizeBridgeRootPath(rootPath: string): string {
  const normalized = rootPath.trim().replace(/\\/g, "/");
  if (normalized === "/") return normalized;
  return normalized.replace(/\/+$/, "");
}

function sameBridgeRootPath(a: string, b: string): boolean {
  return normalizeBridgeRootPath(a) === normalizeBridgeRootPath(b);
}

export function useExternalAiBridge(sendMessage: SendMessage) {
  const workspace = useWorkspaceState();
  const chat = useChatState();
  const workspaceRef = useRef(workspace);
  const chatStreamingRef = useRef(chat.chatStreaming);
  const sendMessageRef = useRef(sendMessage);
  const busyRef = useRef(false);

  workspaceRef.current = workspace;
  chatStreamingRef.current = chat.chatStreaming;
  sendMessageRef.current = sendMessage;

  useEffect(() => {
    let cancelled = false;
    api.registerExternalAiBridge(workspace.spec.rootPath)
      .then((discovery) => {
        if (!cancelled) {
          console.info(`[external-ai] bridge listening on ${discovery.host}:${discovery.port}`);
        }
      })
      .catch((err) => {
        console.error("[external-ai] failed to register bridge:", err);
      });

    return () => {
      cancelled = true;
      api.unregisterExternalAiBridge(workspace.spec.rootPath).catch((err) => {
        console.error("[external-ai] failed to unregister bridge:", err);
      });
    };
  }, [workspace.spec.rootPath]);

  useEffect(() => {
    const unlisten = events.onExternalAiBridgeMessage(async (request) => {
      if (!sameBridgeRootPath(request.rootPath, workspaceRef.current.spec.rootPath)) {
        return;
      }

      if (busyRef.current || chatStreamingRef.current) {
        const message = "Current Design Partner chat is busy.";
        await api.externalAiBridgeAck(request.requestId, false, message).catch(console.error);
        await api.externalAiBridgeComplete(request.requestId, false, message).catch(console.error);
        return;
      }

      busyRef.current = true;
      try {
        await api.externalAiBridgeAck(
          request.requestId,
          true,
          "Accepted by Sigil and sent to the current Design Partner chat.",
        );
        const response = await sendMessageRef.current(bridgeChatMessage(request));
        await api.externalAiBridgeComplete(request.requestId, true, response);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        await api.externalAiBridgeComplete(request.requestId, false, message).catch(console.error);
      } finally {
        busyRef.current = false;
      }
    });

    return () => {
      unlisten.then((fn) => fn());
    };
  }, []);
}

export const __externalAiBridgeTest = {
  bridgeChatMessage,
  normalizeBridgeRootPath,
  sameBridgeRootPath,
};
