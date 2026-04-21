/**
 * useHearing — surfaces the Workspace's ambient event stream.
 *
 * Spec path: DesignPartner/Body/Senses/Hearing
 *
 * Hearing reports changes happening anywhere in the @sigil I inhabit,
 * including rooms I am not looking at. Each event is located: the sigil
 * where it happened, the kind of change (language, affordance, invariant,
 * structural). Invariant: !complete — no event is filtered, prioritized,
 * or dropped.
 *
 * Implementation: on every spec update, diff the previous tree against
 * the new one and emit located events. Per !complete, every detected
 * change is kept. The list rolls at MAX_EVENTS so memory stays bounded,
 * but within the window nothing is collapsed or suppressed.
 */
import { useEffect, useRef, useState } from "react";
import type { Sigil } from "sigil-core";
import type { RefError } from "./useCompileCheck";

export type HearingKind = "language" | "affordance" | "invariant" | "structural";

export interface HearingEvent {
  id: number;
  timestamp: number;
  kind: HearingKind;
  path: string[];
  summary: string;
}

const MAX_EVENTS = 50;

interface DiffContext {
  nextId: number;
  now: number;
  events: HearingEvent[];
}

function diffAffordancesOrInvariants(
  oldItems: { name: string; content: string }[],
  newItems: { name: string; content: string }[],
  path: string[],
  nodeName: string,
  kind: "affordance" | "invariant",
  ctx: DiffContext,
): void {
  const sigil = kind === "affordance" ? "#" : "!";
  const oldMap = new Map(oldItems.map(i => [i.name, i.content]));
  const newMap = new Map(newItems.map(i => [i.name, i.content]));

  for (const [name] of newMap) {
    if (!oldMap.has(name)) {
      ctx.events.push({
        id: ctx.nextId++,
        timestamp: ctx.now,
        kind,
        path,
        summary: `${sigil}${name} added to @${nodeName}`,
      });
    }
  }
  for (const [name] of oldMap) {
    if (!newMap.has(name)) {
      ctx.events.push({
        id: ctx.nextId++,
        timestamp: ctx.now,
        kind,
        path,
        summary: `${sigil}${name} removed from @${nodeName}`,
      });
    }
  }
  for (const [name, content] of newMap) {
    const oldContent = oldMap.get(name);
    if (oldContent !== undefined && oldContent !== content) {
      ctx.events.push({
        id: ctx.nextId++,
        timestamp: ctx.now,
        kind,
        path,
        summary: `${sigil}${name} in @${nodeName} changed`,
      });
    }
  }
}

function diffTrees(prev: Sigil, next: Sigil, nextIdStart: number): HearingEvent[] {
  const ctx: DiffContext = { nextId: nextIdStart, now: Date.now(), events: [] };

  function walk(oldNode: Sigil, newNode: Sigil, path: string[]): void {
    if (oldNode.language !== newNode.language) {
      ctx.events.push({
        id: ctx.nextId++,
        timestamp: ctx.now,
        kind: "language",
        path,
        summary: `language in @${newNode.name} changed`,
      });
    }

    diffAffordancesOrInvariants(
      oldNode.affordances, newNode.affordances, path, newNode.name, "affordance", ctx,
    );
    diffAffordancesOrInvariants(
      oldNode.invariants, newNode.invariants, path, newNode.name, "invariant", ctx,
    );

    const oldChildMap = new Map(oldNode.children.map(c => [c.name, c]));
    const newChildMap = new Map(newNode.children.map(c => [c.name, c]));

    for (const [name, c] of newChildMap) {
      if (!oldChildMap.has(name)) {
        ctx.events.push({
          id: ctx.nextId++,
          timestamp: ctx.now,
          kind: "structural",
          path: [...path, c.name],
          summary: `@${c.name} appeared in @${newNode.name}`,
        });
      }
    }
    for (const [name] of oldChildMap) {
      if (!newChildMap.has(name)) {
        ctx.events.push({
          id: ctx.nextId++,
          timestamp: ctx.now,
          kind: "structural",
          path,
          summary: `@${name} removed from @${newNode.name}`,
        });
      }
    }
    for (const [name, c] of newChildMap) {
      const old = oldChildMap.get(name);
      if (old) walk(old, c, [...path, c.name]);
    }
  }

  walk(prev, next, []);
  return ctx.events;
}

/**
 * A stable key for a dangling reference — same path, file, line, and ref
 * token across reloads. Used to diff compile state and emit events for
 * references that newly dangled or newly resolved.
 */
function refErrorKey(err: RefError): string {
  return `${err.path.join("/")}/${err.file}:${err.line}:${err.ref}`;
}

/**
 * Diff compile errors between reloads. Per the spec, references that have
 * just resolved or just dangled are Hearing sources — they are deformations
 * that the apartment surfaces to the attending inhabitants.
 *
 * The four-kind taxonomy in Sigil/language.md doesn't include a "reference"
 * kind; a dangling ref is a consequence of either a language change (text
 * references a name that doesn't exist) or a structural change (the
 * referenced sigil moved or was removed). Without more context we can't
 * classify which caused it, so we tag these events as "language" — the
 * referring side — and note the ref in the summary.
 */
function diffCompileErrors(
  prevErrors: RefError[],
  nextErrors: RefError[],
  nextIdStart: number,
): HearingEvent[] {
  const prevKeys = new Map(prevErrors.map(e => [refErrorKey(e), e]));
  const nextKeys = new Map(nextErrors.map(e => [refErrorKey(e), e]));
  const ctx: DiffContext = { nextId: nextIdStart, now: Date.now(), events: [] };

  // Newly dangling: present now but not before.
  for (const [key, err] of nextKeys) {
    if (prevKeys.has(key)) continue;
    const sigilName = err.path.length > 0 ? err.path[err.path.length - 1] : "root";
    ctx.events.push({
      id: ctx.nextId++,
      timestamp: ctx.now,
      kind: "language",
      path: err.path,
      summary: `${err.ref} in @${sigilName}/${err.file}:${err.line} now dangles — ${err.reason}`,
    });
  }
  // Newly resolved: present before but not now.
  for (const [key, err] of prevKeys) {
    if (nextKeys.has(key)) continue;
    const sigilName = err.path.length > 0 ? err.path[err.path.length - 1] : "root";
    ctx.events.push({
      id: ctx.nextId++,
      timestamp: ctx.now,
      kind: "language",
      path: err.path,
      summary: `${err.ref} in @${sigilName}/${err.file}:${err.line} now resolves`,
    });
  }
  return ctx.events;
}

/** Prepend new events and roll the list at MAX_EVENTS. No merging, no filtering. */
function prependAndRoll(existing: HearingEvent[], incoming: HearingEvent[]): HearingEvent[] {
  if (incoming.length === 0) return existing;
  return [...incoming, ...existing].slice(0, MAX_EVENTS);
}

/** ~500ms — long enough that an active typist's spec updates settle into one
 *  diff per pause, short enough that completed edits surface promptly. */
const DIFF_DEBOUNCE_MS = 500;

/** ~3s — a reference that dangled and resolved within this window was a
 *  transient mid-typing state and is dropped from both sides. */
const TRANSIENT_REF_WINDOW_MS = 3000;

/** Stable key for a "ref X at file:line" event, regardless of dangle/resolve
 *  direction. Used to recognize a resolve as the partner of an earlier dangle
 *  (or vice versa) and drop the pair as transient. */
function refEventKey(summary: string): string | null {
  // diffCompileErrors emits exactly two summary shapes; key them by everything
  // except the "now dangles | now resolves" verb so a pair matches.
  const danglesIdx = summary.indexOf(" now dangles");
  if (danglesIdx >= 0) return summary.slice(0, danglesIdx);
  const resolvesIdx = summary.indexOf(" now resolves");
  if (resolvesIdx >= 0) return summary.slice(0, resolvesIdx);
  return null;
}

/** Cancel ref events that pair (dangle ↔ resolve) within the transient window.
 *  Tree events pass through untouched. The buffer holds recently-emitted ref
 *  keys with their timestamps so the next incoming event can recognize itself
 *  as a partner. */
function dropTransientRefPairs(
  incoming: HearingEvent[],
  recentRefs: Map<string, number>,
  now: number,
): HearingEvent[] {
  // Expire old entries.
  for (const [key, ts] of recentRefs) {
    if (now - ts > TRANSIENT_REF_WINDOW_MS) recentRefs.delete(key);
  }
  const kept: HearingEvent[] = [];
  const cancelledKeys = new Set<string>();
  for (const ev of incoming) {
    const key = refEventKey(ev.summary);
    if (key === null) {
      kept.push(ev);
      continue;
    }
    if (recentRefs.has(key)) {
      // Partner found in the window — both sides are transient. Mark the
      // earlier event for removal too (it may already be in the events list).
      cancelledKeys.add(key);
      recentRefs.delete(key);
      continue;
    }
    recentRefs.set(key, now);
    kept.push(ev);
  }
  // Caller filters the existing events list against cancelledKeys.
  (kept as HearingEvent[] & { __cancelledKeys?: Set<string> }).__cancelledKeys = cancelledKeys;
  return kept;
}

export function useHearing(root: Sigil | null, compileErrors: RefError[] = []): HearingEvent[] {
  const prevRef = useRef<Sigil | null>(null);
  const prevErrorsRef = useRef<RefError[] | null>(null);
  const nextIdRef = useRef(1);
  const recentRefsRef = useRef<Map<string, number>>(new Map());
  const debounceTimerRef = useRef<number | null>(null);
  const [events, setEvents] = useState<HearingEvent[]>([]);

  useEffect(() => {
    if (!root) {
      prevRef.current = null;
      prevErrorsRef.current = null;
      return;
    }
    // Debounce: defer the diff until the spec has been stable for a moment.
    // While the @user is mid-typing every keystroke produces a spec update;
    // diffing each one echoes their typing back as "language changed" plus
    // a flicker of dangling references. Wait for the burst to settle, then
    // compare against the last stable snapshot — one event per real change.
    if (debounceTimerRef.current !== null) {
      window.clearTimeout(debounceTimerRef.current);
    }
    debounceTimerRef.current = window.setTimeout(() => {
      debounceTimerRef.current = null;
      const prevRoot = prevRef.current;
      const prevErrors = prevErrorsRef.current;
      prevRef.current = root;
      prevErrorsRef.current = compileErrors;
      if (!prevRoot) return;

      const treeEvents = diffTrees(prevRoot, root, nextIdRef.current);
      nextIdRef.current += treeEvents.length;
      const refEvents = diffCompileErrors(prevErrors ?? [], compileErrors, nextIdRef.current);
      nextIdRef.current += refEvents.length;

      const incoming = [...treeEvents, ...refEvents];
      if (incoming.length === 0) return;

      const filtered = dropTransientRefPairs(incoming, recentRefsRef.current, Date.now());
      const cancelledKeys = (filtered as HearingEvent[] & {
        __cancelledKeys?: Set<string>;
      }).__cancelledKeys ?? new Set<string>();

      setEvents((cur) => {
        const pruned = cancelledKeys.size === 0
          ? cur
          : cur.filter((ev) => {
              const k = refEventKey(ev.summary);
              return k === null || !cancelledKeys.has(k);
            });
        return prependAndRoll(pruned, filtered);
      });
    }, DIFF_DEBOUNCE_MS);

    return () => {
      if (debounceTimerRef.current !== null) {
        window.clearTimeout(debounceTimerRef.current);
        debounceTimerRef.current = null;
      }
    };
  }, [root, compileErrors]);

  return events;
}
