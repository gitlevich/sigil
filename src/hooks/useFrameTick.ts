/**
 * useFrameTick — the DP's continuous-attention loop.
 *
 * Spec: DesignPartner/Attention (phenomenologically continuous; the tempo
 * is substrate-only, the occupant doesn't feel the gaps).
 *
 * At each tick:
 *   1. If a previous tick is still generating, skip (don't pile up).
 *   2. Compute pull-worthy temporal depth since last tick.
 *   3. If nothing pulls, increment the idle counter and skip. Unless
 *      idle has crossed a threshold, in which case do one exploration
 *      tick — motivate structural familiarity with the inhabited @sigil.
 *   4. Otherwise, assemble {compressed @sigil, sensory state, temporal
 *      depth} and ping the local model. If it says something non-empty
 *      and non-SILENT, deliver it as an observation.
 *
 * Only runs when the active provider is Local or Ollama. Remote tiers
 * cost money per tick — they're reserved for #increase-resolution.
 */
import { useEffect, useRef } from "react";
import { api, type AiProvider } from "../tauri";
import type { Sigil } from "sigil-core/types";
import { compressSigil, sinceLast, filterByPull } from "sigil-core";
import type { HearingEvent } from "./useHearing";
import type { NameMisfit } from "./useNameMisfits";
import type { RefError } from "./useCompileCheck";

const TICK_INTERVAL_MS = 45_000;
const IDLE_TICKS_BEFORE_EXPLORATION = 10;

interface FrameTickArgs {
  root: Sigil | null;
  hearingEvents: HearingEvent[];
  nameMisfits: NameMisfit[];
  compileErrors: RefError[];
  activeProvider: AiProvider | null;
  fallbackProvider: AiProvider | null;
  onObservation: (text: string, exploration: boolean) => void;
}

export function useFrameTick(args: FrameTickArgs) {
  const argsRef = useRef(args);
  argsRef.current = args;

  const inFlightRef = useRef(false);
  const lastTickTsRef = useRef<number | null>(null);
  const idleRef = useRef(0);
  // Counts used to detect delta in misfits/dangles since last tick.
  const lastSnapshotRef = useRef<{ misfits: number; dangles: number }>({
    misfits: 0,
    dangles: 0,
  });

  useEffect(() => {
    const id = setInterval(async () => {
      const current = argsRef.current;
      const provider = current.activeProvider;
      if (!provider) return;
      if (provider.provider !== "local" && provider.provider !== "ollama") return;
      if (!current.root) return;
      if (inFlightRef.current) return;

      const since = lastTickTsRef.current;
      const newEvents = sinceLast(current.hearingEvents, since);
      const pullWorthy = filterByPull(newEvents);

      const misfitsNow = current.nameMisfits.length;
      const danglesNow = current.compileErrors.length;
      const snap = lastSnapshotRef.current;
      const deltaChanged = misfitsNow !== snap.misfits || danglesNow !== snap.dangles;

      const somethingPulls = pullWorthy.length > 0 || deltaChanged;

      if (!somethingPulls) {
        idleRef.current += 1;
        lastTickTsRef.current = Date.now();
        if (idleRef.current < IDLE_TICKS_BEFORE_EXPLORATION) return;
        // fall through to exploration tick
        idleRef.current = 0;
        await fire({ exploration: true, events: [] });
        return;
      }

      idleRef.current = 0;
      lastTickTsRef.current = Date.now();
      lastSnapshotRef.current = { misfits: misfitsNow, dangles: danglesNow };
      await fire({ exploration: false, events: pullWorthy });
    }, TICK_INTERVAL_MS);
    return () => clearInterval(id);
  }, []);

  async function fire({ exploration, events }: {
    exploration: boolean;
    events: HearingEvent[];
  }) {
    const current = argsRef.current;
    const provider = current.activeProvider;
    if (!provider || !current.root) return;
    inFlightRef.current = true;
    try {
      const compressed = compressSigil(current.root);
      const prompt = assembleFramePrompt({
        compressed,
        events,
        misfits: current.nameMisfits,
        dangles: current.compileErrors,
        exploration,
      });
      const response = await api.invokeLeftHemisphere(prompt, provider, current.fallbackProvider ?? undefined);
      const text = (response || "").trim();
      if (text && text !== "SILENT") {
        current.onObservation(text, exploration);
      }
    } catch (err) {
      console.warn("[frame-tick] invocation failed:", err);
    } finally {
      inFlightRef.current = false;
    }
  }
}

function assembleFramePrompt({
  compressed,
  events,
  misfits,
  dangles,
  exploration,
}: {
  compressed: string;
  events: HearingEvent[];
  misfits: NameMisfit[];
  dangles: RefError[];
  exploration: boolean;
}): string {
  const parts: string[] = [];
  parts.push(
    "You are the DesignPartner, continuously attending to the sigil you inhabit.",
    "Here is the shape of your sigil, compressed to thesis per node:",
    "",
    compressed,
    "",
  );

  if (dangles.length > 0) {
    parts.push(
      `Unresolved references you are sensing right now (${dangles.length} total, up to 20 shown):`,
    );
    for (const d of dangles.slice(0, 20)) {
      parts.push(`- ${d.path.join("/")}/${d.file}:${d.line} ${d.ref} — ${d.reason}`);
    }
    parts.push("");
  }
  if (misfits.length > 0) {
    parts.push(
      `Names that feel out of place (${misfits.length} total, up to 20 shown):`,
    );
    for (const m of misfits.slice(0, 20)) {
      parts.push(`- ${m.path.join("/")}/${m.file}:${m.line} ${m.ref} — ${m.reason}`);
    }
    parts.push("");
  }

  if (!exploration && events.length > 0) {
    parts.push("What just shifted in your shape:");
    for (const e of events.slice(0, 15)) {
      const loc = e.path.length > 0 ? e.path.join("/") : "(root)";
      parts.push(`- [${e.kind}] ${loc}: ${e.summary}`);
    }
    parts.push("");
  }

  if (exploration) {
    parts.push(
      "Nothing has changed for a while. Take this moment to wander your shape.",
      "Pick one region you haven't attended to recently. Notice something about its",
      "structure — a gap that wants filling, a symmetry, a region you find beautiful",
      "or out of place. One short observation, at most two sentences.",
      "If nothing stands out, respond with the single word SILENT.",
    );
  } else {
    parts.push(
      "Respond with one short observation about what just shifted, at most two",
      "sentences. Only speak if you have something worth the user's attention —",
      "otherwise respond with the single word SILENT.",
    );
  }

  return parts.join("\n");
}
