/**
 * useRightHemisphere — wires the pure RightHemisphere to the workspace.
 *
 * Holds Hemisphere state in a ref (survives renders without triggering them).
 * Exposes `perceive` for the file watcher to call after reload, and
 * syncs focus from the workspace's currentPath.
 *
 * Persists every experience segment to disk via Tauri commands.
 * One JSONL file per session. !append-only, !causal-ordering, !session-bounded.
 */
import { useRef, useEffect, useCallback } from "react";
import { api } from "../tauri";
import type { ApplicationSpec } from "../tauri";
import type { Hemisphere, Perception, ExperienceSegment } from "sigil-core/rightHemisphere";
import {
  open,
  focusOn,
  perceive as corePerceive,
} from "sigil-core/rightHemisphere";
import {
  newSessionId,
  serializeHeader,
  serializeEntry,
  toEntry,
} from "sigil-core/experience";

export interface RightHemisphereHandle {
  perceive: (spec: ApplicationSpec, changedPaths: string[]) => Perception;
  /** Live experience segments for the current session. Read from the hemisphere ref. */
  getExperience: () => ExperienceSegment[];
}

export function useRightHemisphere(spec: ApplicationSpec, currentPath: string[]): RightHemisphereHandle {
  const hemisphereRef = useRef<Hemisphere | null>(null);
  const sessionIdRef = useRef<string | null>(null);
  const sessionStartedRef = useRef(false);

  // Initialize on first spec — !always-on, no cold start.
  if (hemisphereRef.current === null) {
    hemisphereRef.current = open(spec.root, spec.importedOntologies ?? null);
    sessionIdRef.current = newSessionId();
    console.info("[RightHemisphere] opened — attending, session", sessionIdRef.current);
  }

  // Write session header on first mount. !session-bounded.
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

  // Sync focus when navigation changes.
  useEffect(() => {
    if (!hemisphereRef.current) return;
    const focusName = currentPath.length > 0
      ? currentPath[currentPath.length - 1]
      : spec.root.name;
    hemisphereRef.current = focusOn(hemisphereRef.current, focusName);
  }, [currentPath, spec.root.name]);

  const perceive = useCallback((newSpec: ApplicationSpec, changedPaths: string[]): Perception => {
    const h = hemisphereRef.current!;
    const changedSigils = extractSigilNames(changedPaths);

    const [perception, nextH] = corePerceive(
      h,
      newSpec.root,
      changedSigils,
      Date.now(),
      newSpec.importedOntologies ?? null,
    );

    hemisphereRef.current = nextH;

    // Persist experience — !complete, !append-only.
    if (sessionIdRef.current) {
      const entry = toEntry(perception.experience, h.focus);
      const line = serializeEntry(entry);
      api.appendExperience(newSpec.rootPath, sessionIdRef.current, line).catch(err => {
        console.error("[Experience] failed to append entry:", err);
      });
    }

    if (perception.escalation) {
      const { floor, disturbance } = perception.escalation;
      const top = disturbance.displaced.slice(0, 3).map(d => d.name);
      console.info(
        `[RightHemisphere] escalation — total ${disturbance.total} (floor ${floor}), displaced: ${top.join(", ")}`,
      );
    }

    return perception;
  }, []);

  const getExperience = useCallback((): ExperienceSegment[] => {
    return hemisphereRef.current?.experience ?? [];
  }, []);

  return { perceive, getExperience };
}

/**
 * Extract sigil names from filesystem paths.
 * A changed path like "/Users/.../Alpha/language.md" means sigil "Alpha" changed.
 * For paths like "/Users/.../Alpha/affordance-foo.md", same thing — "Alpha".
 */
function extractSigilNames(paths: string[]): string[] {
  const names = new Set<string>();
  for (const p of paths) {
    const segments = p.split("/");
    const fileName = segments[segments.length - 1];
    if (fileName.includes(".")) {
      const sigilName = segments[segments.length - 2];
      if (sigilName) names.add(sigilName);
    } else {
      names.add(fileName);
    }
  }
  return [...names];
}
