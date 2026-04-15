/**
 * useBicameralMind — wires the full McGilchrist cycle to the workspace.
 *
 * Holds Mind state in a ref. On each file change: perceive → Gate decides →
 * if escalated, calls the LLM via Tauri → feeds response through completeTurn.
 * Persists experience to disk. Shows articulations in the Experience panel.
 *
 * The hook name stays useRightHemisphere for backward compatibility with
 * WorkspaceShell — the interface is the same, the internals are now bicameral.
 */
import { useRef, useEffect, useCallback } from "react";
import { api, selectedProvider } from "../tauri";
import type { ApplicationSpec } from "../tauri";
import { useAppState } from "../state/AppContext";
import type { Mind } from "sigil-core/bicameralMind";
import {
  open,
  focus as mindFocus,
  perceive as mindPerceive,
  completeTurn,
  experience as mindExperience,
} from "sigil-core/bicameralMind";
import type { ExperienceSegment } from "sigil-core/rightHemisphere";
import type { Perception } from "sigil-core/rightHemisphere";
import type { Articulation } from "sigil-core/leftHemisphere";
import {
  newSessionId,
  serializeHeader,
  serializeEntry,
  toEntry,
} from "sigil-core/experience";
import type { MemoryState } from "sigil-core/memory";
import { memory as mindMemory } from "sigil-core/bicameralMind";

export interface RightHemisphereHandle {
  perceive: (spec: ApplicationSpec, changedPaths: string[]) => Perception;
  getExperience: () => ExperienceSegment[];
  recordChat: (role: "user" | "assistant", content: string) => void;
  getMemory: () => import("sigil-core/memory").MemoryState;
}

export interface BicameralCallbacks {
  onArticulation?: (articulation: Articulation, sigils: string[]) => void;
}

export function useRightHemisphere(spec: ApplicationSpec, currentPath: string[], callbacks?: BicameralCallbacks): RightHemisphereHandle {
  const appState = useAppState();
  const settingsRef = useRef(appState.settings);
  settingsRef.current = appState.settings;
  const callbacksRef = useRef(callbacks);
  callbacksRef.current = callbacks;
  const mindRef = useRef<Mind | null>(null);
  const sessionIdRef = useRef<string | null>(null);
  const sessionStartedRef = useRef(false);

  if (mindRef.current === null) {
    mindRef.current = open(spec.root, spec.importedOntologies ?? null);
    sessionIdRef.current = newSessionId();
    console.info("[BicameralMind] opened — attending, session", sessionIdRef.current);
  }

  useEffect(() => {
    if (sessionStartedRef.current) return;
    if (!sessionIdRef.current) return;
    sessionStartedRef.current = true;
    const header = serializeHeader({
      sessionId: sessionIdRef.current,
      startedAt: Date.now(),
      workspace: spec.rootPath,
    });
    api.appendExperience(spec.rootPath, sessionIdRef.current, header).catch(err => {
      console.error("[Experience] failed to write session header:", err);
    });
  }, [spec.rootPath]);

  useEffect(() => {
    if (!mindRef.current) return;
    const focusName = currentPath.length > 0
      ? currentPath[currentPath.length - 1]
      : spec.root.name;
    mindRef.current = mindFocus(mindRef.current, focusName);
  }, [currentPath, spec.root.name]);

  const perceive = useCallback((newSpec: ApplicationSpec, changedPaths: string[]): Perception => {
    const m = mindRef.current!;
    const changedSigils = extractSigilNames(changedPaths, newSpec.rootPath, newSpec.root.name);

    const [result, nextMind] = mindPerceive(
      m, newSpec.root, changedSigils, Date.now(), newSpec.importedOntologies ?? null,
    );
    mindRef.current = nextMind;

    // Persist experience
    if (sessionIdRef.current) {
      const entry = toEntry(result.perception.experience, m.hemisphere.focus);
      const line = serializeEntry(entry);
      api.appendExperience(newSpec.rootPath, sessionIdRef.current, line).catch(err => {
        console.error("[Experience] failed to append entry:", err);
      });
    }

    // If the Gate passed — invoke the LeftHemisphere
    if (result.prompt && settingsRef.current) {
      const provider = selectedProvider(settingsRef.current);
      if (provider) {
        console.info("[BicameralMind] Gate passed — invoking LeftHemisphere");
        api.invokeLeftHemisphere(result.prompt, provider).then(response => {
          const [turnResult, afterTurn] = completeTurn(
            mindRef.current!, response, newSpec.root, newSpec.importedOntologies ?? null,
          );
          mindRef.current = afterTurn;

          // Record the LH articulation as an experience segment
          const articulationSegment: ExperienceSegment = {
            sigils: result.perception.experience.sigils,
            disturbance: { displaced: [], total: 0 },
            timestamp: Date.now(),
            relevant: true,
            resolution: null,
            articulation: turnResult.articulation,
          };
          mindRef.current = {
            ...mindRef.current,
            hemisphere: {
              ...mindRef.current.hemisphere,
              experience: [...mindRef.current.hemisphere.experience, articulationSegment],
            },
          };

          // Persist — !complete, !append-only
          if (sessionIdRef.current) {
            const entry = toEntry(articulationSegment, mindRef.current.hemisphere.focus);
            const line = serializeEntry(entry);
            api.appendExperience(newSpec.rootPath, sessionIdRef.current, line).catch(err2 => {
              console.error("[Experience] failed to append articulation entry:", err2);
            });
          }

          // #address-user — surface the articulation
          callbacksRef.current?.onArticulation?.(turnResult.articulation, result.perception.experience.sigils);
        }).catch(err => {
          console.error("[BicameralMind] LeftHemisphere invocation failed:", err);
        });
      } else {
        console.info("[BicameralMind] Gate passed but no AI provider configured");
        if (result.suppressedReason) {
          console.info("[BicameralMind] suppressed:", result.suppressedReason);
        }
      }
    }

    return result.perception;
  }, []);

  const getExperience = useCallback((): ExperienceSegment[] => {
    return mindRef.current ? mindExperience(mindRef.current) : [];
  }, []);

  const recordChat = useCallback((role: "user" | "assistant", content: string) => {
    if (!mindRef.current) return;
    const focus = mindRef.current.hemisphere.focus;
    const segment: ExperienceSegment = {
      sigils: focus ? [focus] : [],
      disturbance: { displaced: [], total: 0 },
      timestamp: Date.now(),
      relevant: true,  // conversations are always relevant — !complete
      resolution: null,
      message: { role, content },
    };
    mindRef.current = {
      ...mindRef.current,
      hemisphere: {
        ...mindRef.current.hemisphere,
        experience: [...mindRef.current.hemisphere.experience, segment],
      },
    };

    // Persist — !complete, !append-only
    if (sessionIdRef.current) {
      const entry = toEntry(segment, focus);
      const line = serializeEntry(entry);
      api.appendExperience(spec.rootPath, sessionIdRef.current, line).catch(err => {
        console.error("[Experience] failed to append chat entry:", err);
      });
    }
  }, [spec.rootPath]);

  const getMemory = useCallback((): MemoryState => {
    return mindRef.current ? mindMemory(mindRef.current) : { sigils: new Map() };
  }, []);

  return { perceive, getExperience, recordChat, getMemory };
}

function extractSigilNames(paths: string[], workspaceRoot: string, rootName: string): string[] {
  const names = new Set<string>();
  const normalizedRoot = workspaceRoot.endsWith("/") ? workspaceRoot : workspaceRoot + "/";

  for (const p of paths) {
    const fileName = p.split("/").pop() ?? "";
    const isSigilFile = fileName === "language.md"
      || fileName.startsWith("affordance-")
      || fileName.startsWith("invariant-");
    if (!isSigilFile) continue;

    const dir = p.substring(0, p.lastIndexOf("/"));
    const dirName = dir.split("/").pop() ?? "";

    if (dir === workspaceRoot || dir + "/" === normalizedRoot) {
      names.add(rootName);
    } else if (dir.startsWith(normalizedRoot)) {
      names.add(dirName);
    }
  }
  return [...names];
}
