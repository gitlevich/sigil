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
    ctx.events.push({
      id: ctx.nextId++,
      timestamp: ctx.now,
      kind: "language",
      path: err.path,
      summary: `${err.ref} in ${err.file}:${err.line} now dangles — ${err.reason}`,
    });
  }
  // Newly resolved: present before but not now.
  for (const [key, err] of prevKeys) {
    if (nextKeys.has(key)) continue;
    ctx.events.push({
      id: ctx.nextId++,
      timestamp: ctx.now,
      kind: "language",
      path: err.path,
      summary: `${err.ref} in ${err.file}:${err.line} now resolves`,
    });
  }
  return ctx.events;
}

/** Prepend new events and roll the list at MAX_EVENTS. No merging, no filtering. */
function prependAndRoll(existing: HearingEvent[], incoming: HearingEvent[]): HearingEvent[] {
  if (incoming.length === 0) return existing;
  return [...incoming, ...existing].slice(0, MAX_EVENTS);
}

export function useHearing(root: Sigil | null, compileErrors: RefError[] = []): HearingEvent[] {
  const prevRef = useRef<Sigil | null>(null);
  const prevErrorsRef = useRef<RefError[] | null>(null);
  const nextIdRef = useRef(1);
  const [events, setEvents] = useState<HearingEvent[]>([]);

  useEffect(() => {
    if (!root) {
      prevRef.current = null;
      prevErrorsRef.current = null;
      return;
    }
    const prevRoot = prevRef.current;
    const prevErrors = prevErrorsRef.current;
    prevRef.current = root;
    prevErrorsRef.current = compileErrors;
    if (!prevRoot) return; // First load: nothing to diff against.

    const treeEvents = diffTrees(prevRoot, root, nextIdRef.current);
    nextIdRef.current += treeEvents.length;
    const refEvents = diffCompileErrors(prevErrors ?? [], compileErrors, nextIdRef.current);
    nextIdRef.current += refEvents.length;

    const incoming = [...treeEvents, ...refEvents];
    if (incoming.length === 0) return;
    setEvents((cur) => prependAndRoll(cur, incoming));
  }, [root, compileErrors]);

  return events;
}
